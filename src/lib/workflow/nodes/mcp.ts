
import { PrismaClient } from '@prisma/client'
import { WorkflowNode, WorkflowContext } from '../types'
import { BaseNodeExecutor, NodeExecutionResult } from './base'
import { decryptData, encryptData } from '@/lib/encryption'
import { getConnectionSecret } from '@/lib/secret-vault'
import { safeFetch } from '@/lib/ssrfGuard'
import { agentScopedWhere, MCP_CONNECTION_PROVIDERS } from '@/lib/connection-scope'
import { describeCaughtError, describeUpstreamError } from '@/lib/log-mask'

function describeRpcError(err: unknown): string {
  const raw = (err as { code?: unknown } | null | undefined)?.code
  const code = Number.isInteger(raw) ? String(raw) : 'none'
  let len = -1
  try { len = JSON.stringify(err ?? {}).length } catch { }
  return `code=${code} len=${len}`
}

// ========================================
// ========================================

interface McpToolDefinition {
  name: string
  description: string
  inputSchema?: {
    type: string
    properties?: Record<string, any>
    required?: string[]
  }
}

interface McpToolCallResult {
  content: Array<{
    type: string
    text?: string
    [key: string]: any
  }>
  isError?: boolean
}

interface McpServerInfo {
  name: string
  version: string
  protocolVersion?: string
}

// ========================================
// ========================================

type McpTransport = 'streamable_http' | 'sse'

interface PendingRequest {
  resolve: (value: any) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

export class McpClient {
  private serverUrl: string
  private accessToken: string | null
  private connectionId: string | null
  private sessionId: string | null = null
  private protocolVersion = '2024-11-05'
  private transport: McpTransport
  private messageEndpoint: string | null = null

  private sseReader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private sseAbortController: AbortController | null = null
  private sseConnected: boolean = false

  private pendingRequests: Map<string, PendingRequest> = new Map()

  constructor(
    serverUrl: string,
    accessToken: string | null = null,
    connectionId: string | null = null,
    transport: McpTransport = 'streamable_http'
  ) {
    this.serverUrl = serverUrl
    this.accessToken = accessToken
    this.connectionId = connectionId
    this.transport = serverUrl.endsWith('/sse') ? 'sse' : transport
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'MCP-Protocol-Version': this.protocolVersion,
    }

    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`
    }

    if (this.sessionId) {
      headers['Mcp-Session-Id'] = this.sessionId
    }

    if (this.connectionId) {
      headers['X-MCP-Connection-Id'] = this.connectionId
    }

    return headers
  }

  private handleSSEMessage(data: string): void {
    try {
      const parsed = JSON.parse(data)

      if (parsed.jsonrpc === '2.0' && parsed.id !== undefined) {
        const responseId = String(parsed.id)
        const pending = this.pendingRequests.get(responseId)
        if (pending) {
          clearTimeout(pending.timeout)
          this.pendingRequests.delete(responseId)

          if (parsed.error) {
            pending.reject(new Error(`MCP error: ${describeRpcError(parsed.error)}`))
          } else {
            pending.resolve(parsed.result)
          }
        }
      }
    } catch {
    }
  }

  private async connectSSE(): Promise<void> {
    if (this.sseConnected) return

    const headers: Record<string, string> = {
      'Accept': 'text/event-stream',
      'Cache-Control': 'no-cache',
    }
    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`
    }

    this.sseAbortController = new AbortController()

    const response = await safeFetch(this.serverUrl, {
      method: 'GET',
      headers,
      signal: this.sseAbortController.signal,
    })

    if (!response.ok) {
      throw new Error(`SSE connection failed: ${response.status}`)
    }

    this.sseReader = response.body?.getReader() || null
    if (!this.sseReader) {
      throw new Error('No response body for SSE')
    }

    const decoder = new TextDecoder()
    let buffer = ''

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!this.messageEndpoint) {
          reject(new Error('SSE connection timeout - no endpoint received'))
        }
      }, 5000)

      const readStream = async () => {
        try {
          while (true) {
            const { done, value } = await this.sseReader!.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() || ''

            let currentEvent = ''
            for (const line of lines) {
              if (line.startsWith('event: ')) {
                currentEvent = line.slice(7).trim()
              } else if (line.startsWith('data: ')) {
                const data = line.slice(6).trim()

                if (currentEvent === 'endpoint') {
                  if (data.startsWith('/')) {
                    const baseUrl = new URL(this.serverUrl)
                    this.messageEndpoint = `${baseUrl.origin}${data}`
                  } else if (data.startsWith('http')) {
                    this.messageEndpoint = data
                  } else {
                    const baseUrl = new URL(this.serverUrl)
                    this.messageEndpoint = `${baseUrl.origin}/${data}`
                  }
                  clearTimeout(timeout)
                  this.sseConnected = true
                  setTimeout(() => resolve(), 500)
                }
                else if (currentEvent === 'message') {
                  this.handleSSEMessage(data)
                }
              }
            }
          }
        } catch (err: any) {
          if (err.name !== 'AbortError') {
            for (const [id, pending] of this.pendingRequests) {
              clearTimeout(pending.timeout)
              pending.reject(new Error('SSE connection lost'))
            }
            this.pendingRequests.clear()
          }
        }
      }

      readStream()
    })
  }

  private async sendRequest(method: string, params?: any): Promise<any> {
    const requestId = Date.now().toString() + Math.random().toString(36).slice(2, 8)

    const body = {
      jsonrpc: '2.0',
      id: requestId,
      method,
      params: params || {},
    }

    // Streamable HTTP transport
    if (this.transport !== 'sse') {
      const response = await safeFetch(this.serverUrl, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(body),
      })

      const sessionId = response.headers.get('Mcp-Session-Id')
      if (sessionId) {
        this.sessionId = sessionId
      }

      const contentType = response.headers.get('Content-Type') || ''

      if (contentType.includes('text/event-stream')) {
        return this.handleStreamableHTTPSSEResponse(response)
      }

      if (!response.ok) {
        const summary = describeUpstreamError(response.status, await response.text())
        console.error(`[MCP] Request failed: ${method} - ${summary}`)
        throw new Error(`MCP request failed: ${summary}`)
      }

      const result = await response.json()
      if (result.error) {
        const summary = describeRpcError(result.error)
        console.error(`[MCP] JSON-RPC error: ${method} - ${summary}`)
        throw new Error(`MCP error: ${summary}`)
      }
      return result.result
    }

    await this.connectSSE()
    if (!this.messageEndpoint) {
      throw new Error('SSE message endpoint not available')
    }

    return this.sendSSERequest(requestId, body, method)
  }

  private async sendNotification(method: string, params?: any): Promise<void> {
    const body = {
      jsonrpc: '2.0',
      method,
      params: params || {},
    }

    // Streamable HTTP transport
    if (this.transport !== 'sse') {
      const response = await safeFetch(this.serverUrl, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(body),
      })

      const sessionId = response.headers.get('Mcp-Session-Id')
      if (sessionId) {
        this.sessionId = sessionId
      }

      const text = await response.text().catch(() => '')
      if (!response.ok) {
        const summary = describeUpstreamError(response.status, text)
        console.error(`[MCP] Notification rejected: ${method} - ${summary}`)
        throw new Error(`MCP notification failed: ${summary}`)
      }
      return
    }

    await this.connectSSE()
    if (!this.messageEndpoint) {
      throw new Error('SSE message endpoint not available')
    }

    const endpoint = this.messageEndpoint
    const response = await safeFetch(endpoint, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    })

    const text = await response.text().catch(() => '')
    if (!response.ok) {
      const summary = describeUpstreamError(response.status, text)
      console.error(`[MCP] Notification rejected: ${method} - ${summary}`)
      //
      throw new Error(`MCP notification failed: ${summary}`)
    }
  }

  private async sendSSERequest(requestId: string, body: any, method: string): Promise<any> {
    const endpoint = this.messageEndpoint!
    return new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId)
        reject(new Error(`MCP request timeout: ${method}`))
      }, 30000)

      this.pendingRequests.set(requestId, { resolve, reject, timeout })

      safeFetch(endpoint, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(body),
      }).then(async response => {
        if (response.ok || response.status === 202) {
          const contentType = response.headers.get('Content-Type') || ''
          if (contentType.includes('application/json')) {
            try {
              const result = await response.json()
              if (result.jsonrpc === '2.0' && String(result.id) === requestId) {
                clearTimeout(timeout)
                this.pendingRequests.delete(requestId)
                if (result.error) {
                  reject(new Error(`MCP error: ${describeRpcError(result.error)}`))
                } else {
                  resolve(result.result)
                }
                return
              }
            } catch {
            }
          }
          return
        }

        if (response.status === 404) {
          clearTimeout(timeout)
          this.pendingRequests.delete(requestId)
          this.sseConnected = false
          this.messageEndpoint = null
          console.error(`[MCP] Session not found: ${describeUpstreamError(404, await response.text())}`)
          reject(new Error(`MCP server rejected request (404). The server may require authentication or is unavailable.`))
          return
        }

        const summary = describeUpstreamError(response.status, await response.text())
        clearTimeout(timeout)
        this.pendingRequests.delete(requestId)
        reject(new Error(`MCP POST failed: ${summary}`))
      }).catch(err => {
        clearTimeout(timeout)
        this.pendingRequests.delete(requestId)
        reject(err)
      })
    })
  }

  private resetSSEConnection(): void {
    try {
      if (this.sseAbortController) {
        this.sseAbortController.abort()
        this.sseAbortController = null
      }
    } catch {
    }
    try {
      if (this.sseReader) {
        this.sseReader.cancel()
        this.sseReader = null
      }
    } catch {
    }
    this.messageEndpoint = null
    this.sseConnected = false
  }

  private async handleStreamableHTTPSSEResponse(response: Response): Promise<any> {
    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('No response body')
    }

    const decoder = new TextDecoder()
    let buffer = ''
    let result: any = null

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6)
          if (data === '[DONE]') continue

          try {
            const parsed = JSON.parse(data)
            if (parsed.result) {
              result = parsed.result
            }
          } catch {
          }
        }
      }
    }

    return result
  }

  async initialize(): Promise<McpServerInfo> {
    const result = await this.sendRequest('initialize', {
      protocolVersion: this.protocolVersion,
      capabilities: {
        tools: {},
      },
      clientInfo: {
        name: 'aitalk-workflow',
        version: '1.0.0',
      },
    })

    await this.sendNotification('notifications/initialized', {})

    return result.serverInfo || result
  }

  async listTools(): Promise<McpToolDefinition[]> {
    const result = await this.sendRequest('tools/list', {})
    return result.tools || []
  }

  async callTool(name: string, args: Record<string, any> = {}): Promise<McpToolCallResult> {
    const result = await this.sendRequest('tools/call', {
      name,
      arguments: args,
    })
    return result
  }

  async close(): Promise<void> {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('MCP client closed'))
    }
    this.pendingRequests.clear()

    if (this.sseAbortController) {
      this.sseAbortController.abort()
      this.sseAbortController = null
    }
    if (this.sseReader) {
      try {
        this.sseReader.cancel()
      } catch {
      }
      this.sseReader = null
    }
    this.messageEndpoint = null
    this.sseConnected = false

    //
    const sessionId = this.sessionId
    this.sessionId = null

    if (sessionId && this.transport !== 'sse') {
      try {
        const res = await safeFetch(this.serverUrl, {
          method: 'DELETE',
          headers: { ...this.getHeaders(), 'Mcp-Session-Id': sessionId },
        })
        if (!res.ok && res.status !== 404) this.sessionId = sessionId
      } catch {
        this.sessionId = sessionId
      }
    }
  }
}

// ========================================
// ========================================

const PROVIDER_DEFAULTS: Record<string, { authUrl: string; tokenUrl: string }> = {
  notion: {
    authUrl: 'https://api.notion.com/v1/oauth/authorize',
    tokenUrl: 'https://api.notion.com/v1/oauth/token',
  },
  slack: {
    authUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
  },
  github: {
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
  },
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
  },
}

export class McpNodeExecutor extends BaseNodeExecutor {
  async execute(
    node: WorkflowNode,
    context: WorkflowContext,
    prisma: PrismaClient
  ): Promise<NodeExecutionResult> {
    const { mcpConnectionId, mcpToolName, mcpToolArgs } = node.data || {}

    if (!mcpConnectionId) {
      return this.createErrorResult(
        context,
        'MCP connection not configured',
        { mcpConnectionId }
      )
    }

    let ownerScope: { agentId: string; userId?: string }
    try {
      ownerScope = agentScopedWhere(context, 'MCP Node')
    } catch (scopeError: any) {
      console.error(`[MCP] scope check failed: ${describeCaughtError(scopeError)}`)
      return this.createErrorResult(context, scopeError.message, { mcpConnectionId })
    }

    try {
      const connection = await prisma.workflowConnection.findFirst({
        where: {
          id: mcpConnectionId,
          ...ownerScope,
          provider: { in: [...MCP_CONNECTION_PROVIDERS] },
          status: 'active',
        },
      })

      if (!connection) {
        return this.createErrorResult(
          context,
          'MCP connection not found or inactive',
          { mcpConnectionId }
        )
      }

      let accessToken: string | null = null

      const isExpired = connection.tokenExpiresAt &&
        new Date() > new Date(connection.tokenExpiresAt.getTime() - 5 * 60 * 1000)

      if (isExpired && connection.refreshToken && connection.oauthClientId && connection.oauthClientSecret) {
        try {
          const refreshToken = await decryptData(connection.refreshToken)
          const clientId = await decryptData(connection.oauthClientId)
          const clientSecret = await decryptData(connection.oauthClientSecret)

          const providerDefaults = PROVIDER_DEFAULTS[connection.provider] || {}
          const tokenUrl = connection.oauthTokenUrl || providerDefaults.tokenUrl

          if (tokenUrl) {
            const response = await safeFetch(tokenUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
              },
              body: JSON.stringify({
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
              }),
            })

            if (response.ok) {
              const data = await response.json()
              accessToken = data.access_token

              const encryptedToken = await encryptData(accessToken!)
              const encryptedRefreshToken = data.refresh_token ? await encryptData(data.refresh_token) : undefined

              await prisma.workflowConnection.update({
                where: { id: connection.id },
                data: {
                  encryptedToken,
                  refreshToken: encryptedRefreshToken,
                  tokenExpiresAt: data.expires_in
                    ? new Date(Date.now() + data.expires_in * 1000)
                    : undefined,
                  updatedAt: new Date(),
                }
              })
            }
          }
        } catch (err) {
          console.error('[MCP] Failed to refresh token:', describeCaughtError(err))
        }
      }

      if (!accessToken && connection.encryptedToken) {
        try {
          accessToken = await getConnectionSecret(prisma, context.userId, connection.id, connection.encryptedToken, connection.authType)
        } catch (err) {
          return this.createErrorResult(
            context,
            'Failed to decrypt access token',
            { mcpConnectionId }
          )
        }
      }

      if (!connection.serverUrl) {
        return this.createErrorResult(
          context,
          'MCP server URL not configured',
          { mcpConnectionId }
        )
      }
      const client = new McpClient(connection.serverUrl, accessToken)

      try {
        await client.initialize()

        const tools = await client.listTools()

        let toolResult: McpToolCallResult | null = null
        if (mcpToolName) {
          let parsedArgs = mcpToolArgs || {}
          if (typeof parsedArgs === 'string') {
            try {
              parsedArgs = JSON.parse(parsedArgs)
            } catch {
              parsedArgs = {}
            }
          }

          toolResult = await client.callTool(mcpToolName, parsedArgs)
        }

        await prisma.workflowConnection.update({
          where: { id: mcpConnectionId },
          data: { lastUsedAt: new Date() },
        })

        await client.close()

        const updatedContext: WorkflowContext = {
          ...context,
          mcpTools: tools.map(t => ({ name: t.name, description: t.description })),
          mcpResult: toolResult,
        }

        return this.createSuccessResult(updatedContext, {
          input: { mcpConnectionId, mcpToolName, mcpToolArgs },
          output: {
            tools: tools.map(t => t.name),
            result: toolResult,
          },
        })
      } finally {
        try {
          await client.close()
        } catch {
        }
      }
    } catch (error: any) {
      try {
        await prisma.workflowConnection.updateMany({
          where: { id: mcpConnectionId, ...ownerScope },
          data: {
            status: 'error',
            errorMessage: error.message,
          },
        })
      } catch {
      }

      return this.createErrorResult(
        context,
        `MCP error: ${error.message}`,
        { mcpConnectionId, mcpToolName, mcpToolArgs }
      )
    }
  }
}

export const mcpExecutor = new McpNodeExecutor()
