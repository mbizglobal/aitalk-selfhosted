import { NextRequest, NextResponse } from 'next/server'
import { authenticateMcpRequest, type McpAuthContext } from '@/lib/mcp-server/auth'
import { MCP_TOOLS, TOOL_REQUIRED_SCOPE, executeMcpTool, maskSecrets } from '@/lib/mcp-server/tools'
import { reserveRateQuota, recordAudit } from '@/lib/mcp-server/infra'
import { MCP_RESOURCES, readMcpResource } from '@/lib/mcp-server/mcp-resources'
import { serverInstructions } from '@/lib/mcp-server/instructions'
import { isSelfHosted } from '@/lib/edition'

export const runtime = 'nodejs'

const SERVER_INFO = { name: 'aitalk', version: '0.2.0' }
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26']

function rpcResult(id: unknown, result: unknown) {
  return NextResponse.json({ jsonrpc: '2.0', id, result })
}

function rpcError(id: unknown, code: number, message: string, status = 200) {
  return NextResponse.json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } }, { status })
}

function extractWorkflowId(args: Record<string, unknown> | undefined): string | undefined {
  const v = args?.workflowId
  return typeof v === 'string' && v ? v : undefined
}

async function handleMessage(auth: McpAuthContext, message: any): Promise<NextResponse> {
  const { id, method, params } = message
  const hasId = Object.prototype.hasOwnProperty.call(message, 'id')

  if (typeof method !== 'string') {
    const isResponse = hasId && ('result' in message || 'error' in message)
    if (isResponse) return new NextResponse(null, { status: 202 })
    return rpcError(hasId ? id : null, -32600, 'Invalid request')
  }

  if (!hasId) {
    return new NextResponse(null, { status: 202 })
  }

  switch (method) {
    case 'initialize': {
      const requested = typeof params?.protocolVersion === 'string' ? params.protocolVersion : ''
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : SUPPORTED_PROTOCOL_VERSIONS[0]
      return rpcResult(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false }, resources: { listChanged: false, subscribe: false } },
        serverInfo: SERVER_INFO,
        instructions:
          serverInstructions(isSelfHosted()),
      })
    }

    case 'ping':
      return rpcResult(id, {})

    case 'tools/list':
      return rpcResult(id, { tools: MCP_TOOLS })

    case 'resources/list':
      return rpcResult(id, { resources: MCP_RESOURCES })

    case 'resources/read': {
      const uri = typeof params?.uri === 'string' ? params.uri : ''
      const resource = readMcpResource(uri)
      if (!resource) return rpcError(id, -32002, `Resource not found: ${uri}`)
      return rpcResult(id, { contents: [{ uri, mimeType: resource.mimeType, text: resource.text }] })
    }

    case 'tools/call': {
      const name = typeof params?.name === 'string' ? params.name : ''
      if (!name) return rpcError(id, -32602, 'Invalid params: name is required')
      const args = params?.arguments && typeof params.arguments === 'object' ? params.arguments : undefined

      const startedAt = Date.now()

      if (TOOL_REQUIRED_SCOPE[name] === 'write') {
        if (await reserveRateQuota(auth.tokenId, 'write')) {
          await recordAudit({
            tokenId: auth.tokenId, userId: auth.userId, tool: name,
            ok: false, code: 'RATE_LIMITED',
            workflowId: extractWorkflowId(args), durationMs: Date.now() - startedAt,
          })
          return rpcResult(id, {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Write rate limit exceeded (12/min). Slow down and retry.', code: 'RATE_LIMITED' }) }],
            isError: true,
          })
        }
      }

      let result: Awaited<ReturnType<typeof executeMcpTool>> | null = null
      try {
        result = await executeMcpTool(auth, name, args)
      } finally {
        await recordAudit({
          tokenId: auth.tokenId,
          userId: auth.userId,
          tool: name,
          ok: result?.ok ?? false,
          code: result === null ? 'EXCEPTION' : result.ok ? undefined : (result.code ?? 'TOOL_ERROR'),
          workflowId: extractWorkflowId(args),
          durationMs: Date.now() - startedAt,
        })
      }

      //   (codex R18 title → R19 mimeType → R20 workflow name/description·agent title·version note
      if (!result.ok) {
        const text = result.code || result.meta
          ? JSON.stringify(maskSecrets({ error: result.message, code: result.code, ...(result.meta ?? {}) }), null, 2)
          : maskSecrets(result.message)
        return rpcResult(id, { content: [{ type: 'text', text }], isError: true })
      }
      return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(maskSecrets(result.data), null, 2) }] })
    }

    default:
      return rpcError(id, -32601, `Method not found: ${method}`)
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateMcpRequest(request.headers)
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (await reserveRateQuota(auth.tokenId, 'read')) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
    }

    let message: any
    try {
      message = await request.json()
    } catch {
      return rpcError(null, -32700, 'Parse error')
    }
    if (Array.isArray(message) || typeof message !== 'object' || message === null || message.jsonrpc !== '2.0') {
      return rpcError(null, -32600, 'Invalid request')
    }

    return await handleMessage(auth, message)
  } catch (error) {
    console.error('[POST /api/mcp-server] Error:', error)
    return rpcError(null, -32603, 'Internal error', 500)
  }
}

export async function GET() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 })
}

export async function DELETE() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 })
}
