import { NextRequest, NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { join } from 'path'
import { authenticateMcpRequest, type McpAuthContext } from '@/lib/mcp-server/auth'
import { MCP_TOOLS, TOOL_REQUIRED_SCOPE, executeMcpTool, maskSecrets } from '@/lib/mcp-server/tools'
import { reserveRateQuota, recordAudit } from '@/lib/mcp-server/infra'
import { renderNodeCatalog } from '@/lib/mcp-server/resources/render-node-catalog'

export const runtime = 'nodejs'

const SERVER_INFO = { name: 'aitalk', version: '0.2.0' }
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26']

const RESOURCES = [
  {
    uri: 'aitalk://workflow-guide',
    name: 'AiTalk Workflow Guide',
    description:
      'How to build AiTalk workflows over MCP: template + parameter flow, node basics, validation levels, error codes. Read before using write tools.',
    mimeType: 'text/markdown',
  },
  {
    uri: 'aitalk://node-catalog',
    name: 'AiTalk Node Catalog',
    description:
      'Full schema of all workflow node types (required fields, enums, edge handle rules, canvas conventions). Read before authoring raw workflowJson with update_workflow. Rendered from the same source the server validates against.',
    mimeType: 'text/markdown',
  },
] as const

let workflowGuideCache: string | null = null
function readResource(uri: string): { mimeType: string; text: string } | null {
  if (uri === 'aitalk://workflow-guide') {
    if (workflowGuideCache === null) {
      workflowGuideCache = readFileSync(
        join(process.cwd(), 'src/lib/mcp-server/resources/workflow-guide.md'),
        'utf8',
      )
    }
    return { mimeType: 'text/markdown', text: workflowGuideCache }
  }
  if (uri === 'aitalk://node-catalog') {
    return { mimeType: 'text/markdown', text: renderNodeCatalog() }
  }
  return null
}

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
          'AiTalk MCP server. Hierarchy: account → agents → workflows. Read: list_agents → list_workflows(agentId) → get_workflow(workflowId). ' +
          'Authoring (write scope) — full chain: create_workflow (from a template via list_workflow_templates, or blank; always created as draft) → ' +
          'edit with patch_workflow_params (typed template parameters — the safe, preferred path) or update_workflow (replace the entire node graph; read aitalk://node-catalog first) → ' +
          'validate_workflow → deploy_workflow (takes it live for real customers immediately — confirm with the owner first). ' +
          'undeploy_workflow switches a live workflow back to draft; it stops taking NEW chats and calls at once (a call already connected finishes normally), so ask the owner first too. ' +
          'request_workflow_deploy is the alternative to deploy_workflow: it returns a confirmationUrl the owner opens and clicks Deploy on themselves — use it when they want to review what goes live. ' +
          'Both editors take expectedVersion (optimistic concurrency) and dryRun. Editing a live (production) workflow reaches customers immediately — confirm with the owner first; archived workflows are rejected. ' +
          'Workflows and agents cannot be deleted over MCP, and there is no test-run tool — use the dashboard for both. ' +
          'Sub-workflows (kind "sub") are workflows the AI calls as a function instead of channel-triggered ones: create with create_workflow({kind:"sub"}) — no template, never deployed, and its Start node defines the tool the caller sees. Read the "Sub-workflows" section of aitalk://workflow-guide first. ' +
          'Read the aitalk://workflow-guide resource before using write tools. ' +
          'AI node tools (SendGrid/Telegram/SMS/SMTP/MCP/web search attached to an AI node): the node catalog documents the ACTION-node contract, which does NOT apply to tool attachments — read the "AI node tools" section of aitalk://workflow-guide first. ' +
          'The sendgrid/telegram/sms/smtp/calendar tool types need data.connectionId (MCP needs data.mcpConnectionId; webSearch, source, functionCalling and workApp need none), and connection ids are NOT discoverable over MCP: reuse one already visible in a get_workflow response for that agent, or ask the owner to create the connection in Agent Studio. Saving one without it deploys fine and then silently does nothing at run time. ' +
          'Knowledge base (RAG) source files: list_source_files / get_source_file / create_source_text / delete_source_file. ' +
          'get_source_file returns the document text (contentSource "stored" = as submitted; "indexed_chunks" = the extracted text the AI searches, which is what dashboard-uploaded PDF/DOCX files give you — no layout or images). ' +
          'There is no in-place update: to correct a document, read it, then delete_source_file + create_source_text with the fixed text (a corrected binary comes back as .txt and the original file is gone). ' +
          'Indexing is asynchronous — after create_source_text, poll get_source_file until status is "completed" (or "failed" — stop then and read errorMessage). ' +
          'IMPORTANT: binary files (PDF/DOCX/PPTX/XLSX/images) cannot be transferred over MCP — convert or extract them to plain text/markdown locally in your environment first and pass the text to create_source_text, or direct the user to the dashboard Storage page. ' +
          'Conversation history (read-only): list_conversations / get_conversation — text chats, voice calls and quiz attempts. ' +
          'This is the owner\'s customer data (caller phone numbers, conversation content) — use it only for what the owner asked; never send it to third parties.',
      })
    }

    case 'ping':
      return rpcResult(id, {})

    case 'tools/list':
      return rpcResult(id, { tools: MCP_TOOLS })

    case 'resources/list':
      return rpcResult(id, { resources: RESOURCES })

    case 'resources/read': {
      const uri = typeof params?.uri === 'string' ? params.uri : ''
      const resource = readResource(uri)
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
