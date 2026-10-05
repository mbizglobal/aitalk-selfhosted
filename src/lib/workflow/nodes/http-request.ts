
import crypto from 'crypto'
import { maskUrl } from '@/lib/log-mask'
import { BaseNodeExecutor, NodeExecutionResult } from './base'
import { WorkflowNode, WorkflowContext } from '../types'
import { PrismaClient } from '@prisma/client'
import { getConnectionSecret } from '@/lib/secret-vault'
import { safeFetch, SSRFError, DnsLookupError } from '@/lib/ssrfGuard'
import { canReadTemplatePath } from '../template-scope'

// ========================================
// ========================================

interface HttpRequestNodeData {
  mode?: 'single' | 'multi'

  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  url: string

  preset?: string
  baseUrl?: string              // Base URL
  environment?: string
  requests?: Array<{
    alias: string
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
    path: string
    enabled: boolean
    body?: string
    signed?: boolean
  }>
  requestDelay?: number

  httpConnectionId?: string
  authType: 'none' | 'apiKey' | 'bearer' | 'basic' | 'hmac'
  authHeaderName?: string
  authHeaderValue?: string
  bearerToken?: string
  basicUser?: string
  basicPassword?: string
  hmacApiKey?: string
  hmacSecret?: string

  headers?: Array<{ key: string; value: string }>

  bodyType?: 'json' | 'text' | 'none'
  body?: string

  timeout?: number
}

export interface HttpRequestResult {
  success: boolean
  status?: number
  statusText?: string
  headers?: Record<string, string>
  data?: any
  rawBody?: string
  duration?: number // ms
  error?: string
}

// ========================================
// HTTP Request Executor
// ========================================

export class HttpRequestNodeExecutor extends BaseNodeExecutor {
  private isDev = process.env.NODE_ENV === 'development'

  async execute(
    node: WorkflowNode,
    context: WorkflowContext,
    prisma: PrismaClient
  ): Promise<NodeExecutionResult> {
    let nodeData = node.data as HttpRequestNodeData
    const mode = nodeData.mode || 'single'

    nodeData = await this.resolveCredentials(nodeData, context, prisma)

    if (mode === 'multi') {
      return this.executeMulti(node, nodeData, context)
    }

    return this.executeSingle(node, nodeData, context)
  }

  private async resolveCredentials(
    nodeData: HttpRequestNodeData,
    context: WorkflowContext,
    prisma: PrismaClient
  ): Promise<HttpRequestNodeData> {
    if (!nodeData.httpConnectionId) return nodeData

    try {
      const connection = await prisma.workflowConnection.findFirst({
        where: {
          agentId: context.agentId,
          provider: 'http_request',
          label: nodeData.httpConnectionId,
        },
        select: { id: true, encryptedToken: true }
      })

      if (!connection?.encryptedToken) {
        if (this.isDev) {
          console.log('[HTTP] No encrypted credentials found, using node data')
        }
        return nodeData
      }

      const decrypted = await getConnectionSecret(prisma, context.userId, connection.id, connection.encryptedToken)
      const credentials = JSON.parse(decrypted)

      if (this.isDev) {
        console.log(`[HTTP] Credentials loaded from DB (authType: ${credentials.authType})`)
      }

      return {
        ...nodeData,
        authType: credentials.authType || nodeData.authType,
        authHeaderName: credentials.authHeaderName || nodeData.authHeaderName,
        authHeaderValue: credentials.authHeaderValue || nodeData.authHeaderValue,
        bearerToken: credentials.bearerToken || nodeData.bearerToken,
        basicUser: credentials.basicUser || nodeData.basicUser,
        basicPassword: credentials.basicPassword || nodeData.basicPassword,
        hmacApiKey: credentials.hmacApiKey || nodeData.hmacApiKey,
        hmacSecret: credentials.hmacSecret || nodeData.hmacSecret,
      }
    } catch (error) {
      console.error('[HTTP] Failed to resolve credentials:', error)
      return nodeData
    }
  }

  private async executeSingle(
    node: WorkflowNode,
    nodeData: HttpRequestNodeData,
    context: WorkflowContext
  ): Promise<NodeExecutionResult> {
    const { method = 'GET', url, authType = 'none', timeout = 30 } = nodeData

    if (!url) {
      const error = 'Missing required field: URL'
      console.error(`[HTTP] Error: ${error}`)
      return this.createErrorResult(context, error, { method, url, authType })
    }

    //
    if (authType === 'hmac') {
      const error = 'hmac auth is only supported in multi mode — switch the node to multi mode or pick another auth type'
      console.error(`[HTTP] Error: ${error}`)
      return this.createErrorResult(context, error, { method, url, authType })
    }

    const startTime = Date.now()
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    try {
      const resolvedUrl = this.substituteVariables(url, context)

      const headers: Record<string, string> = {}

      switch (authType) {
        case 'apiKey': {
          const headerName = this.substituteVariables(nodeData.authHeaderName || 'Authorization', context)
          const headerValue = this.substituteVariables(nodeData.authHeaderValue || '', context)
          if (headerValue) {
            headers[headerName] = headerValue
          }
          break
        }
        case 'bearer': {
          const token = this.substituteVariables(nodeData.bearerToken || '', context)
          if (token) {
            headers['Authorization'] = `Bearer ${token}`
          }
          break
        }
        case 'basic': {
          const user = this.substituteVariables(nodeData.basicUser || '', context)
          const pass = this.substituteVariables(nodeData.basicPassword || '', context)
          if (user) {
            const encoded = Buffer.from(`${user}:${pass}`).toString('base64')
            headers['Authorization'] = `Basic ${encoded}`
          }
          break
        }
      }

      if (nodeData.headers && Array.isArray(nodeData.headers)) {
        for (const h of nodeData.headers) {
          if (h.key) {
            headers[this.substituteVariables(h.key, context)] =
              this.substituteVariables(h.value || '', context)
          }
        }
      }

      let bodyContent: string | undefined
      const bodyType = nodeData.bodyType || 'none'

      if (['POST', 'PUT', 'PATCH'].includes(method) && bodyType !== 'none' && nodeData.body) {
        bodyContent = this.substituteVariables(nodeData.body, context)
        if (bodyType === 'json' && !headers['Content-Type']) {
          headers['Content-Type'] = 'application/json'
        }
      }

      if (this.isDev) {
        console.log(`[HTTP] ${method} ${maskUrl(resolvedUrl)}`)
        console.log(`[HTTP] Auth: ${authType}`)
      }

      const controller = new AbortController()
      const timeoutMs = (timeout || 30) * 1000
      timeoutId = setTimeout(() => controller.abort(), timeoutMs)

      const response = await safeFetch(resolvedUrl, {
        method,
        headers,
        body: bodyContent,
        signal: controller.signal,
      })

      const duration = Date.now() - startTime

      const responseHeaders: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value
      })

      const rawBody = await response.text()
      let data: any = rawBody

      const contentType = response.headers.get('content-type') || ''
      if (contentType.includes('application/json') || rawBody.startsWith('{') || rawBody.startsWith('[')) {
        try {
          data = JSON.parse(rawBody)
        } catch {
          data = rawBody
        }
      }

      const result: HttpRequestResult = {
        success: response.ok,
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        data,
        rawBody: rawBody.length > 10000 ? rawBody.substring(0, 10000) + '...(truncated)' : rawBody,
        duration,
      }

      if (this.isDev) {
        console.log(`[HTTP] Response: ${response.status} ${response.statusText} (${duration}ms)`)
      }

      const updatedContext: WorkflowContext = {
        ...context,
        httpResult: result,
      }

      return this.createSuccessResult(updatedContext, {
        input: {
          method,
          url: resolvedUrl,
          authType,
        },
        output: {
          status: response.status,
          statusText: response.statusText,
          dataPreview: typeof data === 'object'
            ? JSON.stringify(data).substring(0, 500)
            : String(data).substring(0, 500),
          duration,
        },
      })
    } catch (error: any) {
      const duration = Date.now() - startTime
      const isTimeout = error.name === 'AbortError'
      const errorMessage = error instanceof SSRFError
        ? 'Request blocked: target host is not allowed (SSRF protection)'
        : error instanceof DnsLookupError
        ? 'Request blocked: DNS lookup failed'
        : isTimeout
        ? `Request timeout after ${timeout}s`
        : error.message || 'Unknown HTTP error'

      console.error(`[HTTP] Exception: ${errorMessage}`)

      const result: HttpRequestResult = {
        success: false,
        error: errorMessage,
        duration,
      }

      const updatedContext: WorkflowContext = {
        ...context,
        httpResult: result,
      }

      return this.createErrorResult(updatedContext, errorMessage, {
        method,
        url,
        authType,
      })
    } finally {
      clearTimeout(timeoutId)
    }
  }

  private substituteVariables(template: string, context: WorkflowContext): string {
    if (!template) return ''

    let result = template

    result = result.replace(/\{\{context\.([^}]+)\}\}/g, (match, path) => {
      if (!canReadTemplatePath(context, path)) return ''
      const value = this.getValueFromPath(context, path)
      if (value === undefined || value === null) return ''
      if (typeof value === 'object') return JSON.stringify(value)
      return String(value)
    })

    result = result.replace(/\{\{message\}\}/g, context.message || '')

    result = result.replace(/\{\{aiResponse\}\}/g, context.aiResponse || '')

    result = result.replace(/\{\{httpResult\.([^}]+)\}\}/g, (match, path) => {
      const httpResult = (context as any).httpResult
      if (!httpResult) return ''
      const value = this.getValueFromPath(httpResult, path)
      if (value === undefined || value === null) return ''
      if (typeof value === 'object') return JSON.stringify(value)
      return String(value)
    })

    result = result.replace(/\{\{jsonData\.([^}]+)\}\}/g, (match, path) => {
      if (!context.jsonData) return ''
      const value = this.getValueFromPath(context.jsonData, path)
      if (value === undefined || value === null) return ''
      if (typeof value === 'object') return JSON.stringify(value)
      return String(value)
    })

    return result
  }

  private async executeMulti(
    node: WorkflowNode,
    nodeData: HttpRequestNodeData,
    context: WorkflowContext
  ): Promise<NodeExecutionResult> {
    const {
      baseUrl = '',
      requests = [],
      requestDelay = 0,
      authType = 'none',
      timeout = 30,
    } = nodeData

    if (!baseUrl) {
      const error = 'Missing required field: Base URL'
      console.error(`[HTTP Multi] Error: ${error}`)
      return this.createErrorResult(context, error, { mode: 'multi', baseUrl, authType, requestCount: requests.length })
    }

    const enabledRequests = requests.filter(r => r.enabled)
    if (enabledRequests.length === 0) {
      const error = 'No enabled requests'
      console.error(`[HTTP Multi] Error: ${error}`)
      return this.createErrorResult(context, error, { mode: 'multi', baseUrl, authType, requestCount: requests.length })
    }

    const startTime = Date.now()
    const results: Record<string, HttpRequestResult> = {}

    let gotAnyResponse = false
    const errors: string[] = []

    const commonHeaders = this.buildAuthHeaders(nodeData, context)

    if (nodeData.headers && Array.isArray(nodeData.headers)) {
      for (const h of nodeData.headers) {
        if (h.key) {
          commonHeaders[this.substituteVariables(h.key, context)] =
            this.substituteVariables(h.value || '', context)
        }
      }
    }

    if (this.isDev) {
      console.log(`[HTTP Multi] ${enabledRequests.length} requests to ${baseUrl}`)
    }

    for (let i = 0; i < enabledRequests.length; i++) {
      const req = enabledRequests[i]
      const resolvedBase = this.substituteVariables(baseUrl, context)
      const resolvedPath = this.substituteVariables(req.path, context)
      let fullUrl = resolvedBase + resolvedPath
      const reqStartTime = Date.now()
      let timeoutId: ReturnType<typeof setTimeout> | undefined

      try {
        const headers = { ...commonHeaders }

        if (req.signed && authType === 'hmac' && nodeData.hmacSecret) {
          fullUrl = this.applyHmacSigning(fullUrl, nodeData.hmacSecret)
        }

        let bodyContent: string | undefined
        if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
          bodyContent = this.substituteVariables(req.body, context)
          if (!headers['Content-Type']) {
            headers['Content-Type'] = 'application/json'
          }
        }

        if (this.isDev) {
          console.log(`[HTTP Multi] [${i + 1}/${enabledRequests.length}] ${req.method} ${fullUrl} (${req.alias})${req.signed ? ' [SIGNED]' : ''}`)
        }

        const controller = new AbortController()
        const timeoutMs = (timeout || 30) * 1000
        timeoutId = setTimeout(() => controller.abort(), timeoutMs)

        const response = await safeFetch(fullUrl, {
          method: req.method,
          headers,
          body: bodyContent,
          signal: controller.signal,
        })

        const duration = Date.now() - reqStartTime

        const rawBody = await response.text()
        let data: any = rawBody

        const contentType = response.headers.get('content-type') || ''
        if (contentType.includes('application/json') || rawBody.startsWith('{') || rawBody.startsWith('[')) {
          try {
            data = JSON.parse(rawBody)
          } catch {
            data = rawBody
          }
        }

        results[req.alias] = {
          success: response.ok,
          status: response.status,
          statusText: response.statusText,
          data,
          rawBody: rawBody.length > 10000 ? rawBody.substring(0, 10000) + '...(truncated)' : rawBody,
          duration,
        }
        gotAnyResponse = true

        if (!response.ok) {
          errors.push(`${req.alias}: ${response.status} ${response.statusText}`)
        }

        if (this.isDev) {
          console.log(`[HTTP Multi] [${req.alias}] ${response.status} (${duration}ms)`)
        }
      } catch (error: any) {
        const duration = Date.now() - reqStartTime
        const isTimeout = error.name === 'AbortError'
        const errorMessage = error instanceof SSRFError
          ? 'Request blocked: target host is not allowed (SSRF protection)'
          : error instanceof DnsLookupError
          ? 'Request blocked: DNS lookup failed'
          : isTimeout
          ? `Request timeout after ${timeout}s`
          : error.message || 'Unknown HTTP error'

        results[req.alias] = {
          success: false,
          error: errorMessage,
          duration,
        }
        errors.push(`${req.alias}: ${errorMessage}`)
        console.error(`[HTTP Multi] [${req.alias}] Error: ${errorMessage}`)
      } finally {
        clearTimeout(timeoutId)
      }

      if (requestDelay && requestDelay > 0 && i < enabledRequests.length - 1) {
        await new Promise(resolve => setTimeout(resolve, requestDelay))
      }
    }

    const totalDuration = Date.now() - startTime
    const successCount = Object.values(results).filter(r => r.success).length

    const updatedContext: WorkflowContext = {
      ...context,
      httpResult: results as any,
    }

    if (this.isDev) {
      console.log(`[HTTP Multi] Done: ${successCount}/${enabledRequests.length} succeeded (${totalDuration}ms)`)
    }

    if (gotAnyResponse) {
      return this.createSuccessResult(updatedContext, {
        input: {
          mode: 'multi',
          baseUrl,
          requestCount: enabledRequests.length,
        },
        output: {
          successCount,
          totalCount: enabledRequests.length,
          duration: totalDuration,
          aliases: enabledRequests.map(r => r.alias),
          errors: errors.length > 0 ? errors : undefined,
        },
      })
    }

    return this.createErrorResult(updatedContext, `All ${enabledRequests.length} requests failed without a response`, {
      mode: 'multi',
      baseUrl,
      errors,
    })
  }

  private buildAuthHeaders(
    nodeData: HttpRequestNodeData,
    context: WorkflowContext
  ): Record<string, string> {
    const headers: Record<string, string> = {}
    const authType = nodeData.authType || 'none'

    switch (authType) {
      case 'apiKey': {
        const headerName = this.substituteVariables(nodeData.authHeaderName || 'Authorization', context)
        const headerValue = this.substituteVariables(nodeData.authHeaderValue || '', context)
        if (headerValue) {
          headers[headerName] = headerValue
        }
        break
      }
      case 'bearer': {
        const token = this.substituteVariables(nodeData.bearerToken || '', context)
        if (token) {
          headers['Authorization'] = `Bearer ${token}`
        }
        break
      }
      case 'basic': {
        const user = this.substituteVariables(nodeData.basicUser || '', context)
        const pass = this.substituteVariables(nodeData.basicPassword || '', context)
        if (user) {
          const encoded = Buffer.from(`${user}:${pass}`).toString('base64')
          headers['Authorization'] = `Basic ${encoded}`
        }
        break
      }
      case 'hmac': {
        const apiKey = nodeData.hmacApiKey || ''
        if (apiKey) {
          headers['X-MBX-APIKEY'] = apiKey
        }
        break
      }
    }

    return headers
  }

  private applyHmacSigning(fullUrl: string, secret: string): string {
    const url = new URL(fullUrl)
    url.searchParams.set('recvWindow', '60000')
    url.searchParams.set('timestamp', Date.now().toString())
    const queryString = url.searchParams.toString()
    const signature = crypto
      .createHmac('sha256', secret)
      .update(queryString)
      .digest('hex')
    url.searchParams.set('signature', signature)
    return url.toString()
  }

  private getValueFromPath(obj: any, path: string): any {
    if (!obj || !path) return undefined

    const parts = path.split('.')
    let current = obj

    for (const part of parts) {
      if (current === null || current === undefined) return undefined

      const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/)
      if (arrayMatch) {
        const [, arrayName, indexStr] = arrayMatch
        current = current[arrayName]
        if (!Array.isArray(current)) return undefined
        current = current[parseInt(indexStr, 10)]
      } else {
        current = current[part]
      }
    }

    return current
  }
}
