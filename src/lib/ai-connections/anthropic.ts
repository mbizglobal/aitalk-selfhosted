import { randomBytes } from 'node:crypto'
import Anthropic from '@anthropic-ai/sdk'
import type { ResolvedAiConnection } from './index'
import type { ResponsesLikeClient } from './chat-completions'

const MIN_MAX_TOKENS = 16_000
const REQUIRED_TOOL_NOTE = 'You must call one of the provided tools now — answer through a tool call, not with text.'

const id = (p: string) => `${p}_${randomBytes(12).toString('hex')}`
function apiError(status: number, code: string, message: string): Error {
  return Object.assign(new Error(message), { status, code })
}

function imageBlock(url: string): Anthropic.ImageBlockParam {
  const m = /^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/s.exec(url)
  if (!m) throw apiError(400, 'invalid_image', 'only base64 data URLs of png/jpeg/gif/webp images are supported by this AI connection')
  const media = (m[1] === 'jpg' ? 'image/jpeg' : `image/${m[1]}`) as 'image/png'
  return { type: 'image', source: { type: 'base64', media_type: media, data: m[2] } }
}

function userContent(content: unknown): string | Anthropic.ContentBlockParam[] {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const blocks: Anthropic.ContentBlockParam[] = []
  for (const p of content) {
    if (!p || typeof p !== 'object') continue
    if ((p.type === 'input_text' || p.type === 'text') && typeof p.text === 'string') { if (p.text) blocks.push({ type: 'text', text: p.text }) }
    else if (p.type === 'input_image' && typeof p.image_url === 'string') blocks.push(imageBlock(p.image_url))
    else throw apiError(400, 'unsupported_input', `input part "${String(p.type)}" is not supported by this AI connection`)
  }
  return blocks
}

const textOnly = (content: unknown): string => typeof content === 'string' ? content
  : Array.isArray(content) ? content.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('') : ''

export function toAnthropicMessages(input: unknown): { messages: Anthropic.MessageParam[]; system: string[] } {
  const messages: Anthropic.MessageParam[] = []
  const system: string[] = []
  if (input == null) return { messages, system }
  if (typeof input === 'string') return { messages: input ? [{ role: 'user', content: input }] : [], system }
  if (!Array.isArray(input)) throw apiError(400, 'unsupported_input', 'input must be a string or an array')
  const last = () => messages[messages.length - 1]
  const appendBlock = (role: 'user' | 'assistant', block: Anthropic.ContentBlockParam) => {
    const l = last()
    if (l && l.role === role && Array.isArray(l.content)) (l.content as Anthropic.ContentBlockParam[]).push(block)
    else messages.push({ role, content: [block] })
  }
  for (const item of input) {
    if (!item || typeof item !== 'object') continue
    const type = item.type ?? (item.role ? 'message' : undefined)
    if (type === 'message') {
      if (item.role === 'system' || item.role === 'developer') { const t = textOnly(item.content); if (t) system.push(t); continue }
      if (item.role === 'user') {
        const c = userContent(item.content)
        if ((typeof c === 'string' && c) || (Array.isArray(c) && c.length)) messages.push({ role: 'user', content: c })
      } else if (item.role === 'assistant') {
        const t = textOnly(item.content)
        if (t) messages.push({ role: 'assistant', content: t })
      } else throw apiError(400, 'unsupported_input', `message role "${String(item.role)}" is not supported`)
    } else if (type === 'function_call') {
      let args: unknown = {}
      try { args = JSON.parse(item.arguments || '{}') } catch { args = {} }
      appendBlock('assistant', { type: 'tool_use', id: item.call_id || item.id, name: item.name, input: args && typeof args === 'object' ? args : {} })
    } else if (type === 'function_call_output') {
      appendBlock('user', { type: 'tool_result', tool_use_id: item.call_id, content: typeof item.output === 'string' ? item.output : JSON.stringify(item.output ?? '') })
    } else {
      throw apiError(400, 'unsupported_input', `input item "${String(type)}" is not supported by this AI connection`)
    }
  }
  return { messages, system }
}

interface Turn {
  text: string
  calls: Array<{ id: string; name: string; arguments: string }>
  stop: string | null
  usage: { input_tokens: number; output_tokens: number } | null
}

function turnOf(msg: Anthropic.Message): Turn {
  const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('')
  const calls = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, arguments: JSON.stringify(b.input ?? {}) }))
  const u = msg.usage
  return {
    text,
    calls,
    stop: msg.stop_reason,
    usage: u ? { input_tokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), output_tokens: u.output_tokens ?? 0 } : null,
  }
}

function toResponse(rid: string, t: Turn) {
  const truncated = t.stop === 'max_tokens' || t.stop === 'refusal' || t.stop === 'model_context_window_exceeded'
  const output: any[] = []
  if (t.text) output.push({ type: 'message', id: id('msg'), role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: t.text, annotations: [] }] })
  if (!truncated) for (const c of t.calls) output.push({ type: 'function_call', id: `fc_${c.id}`, call_id: c.id, name: c.name, arguments: c.arguments, status: 'completed' })
  return {
    id: rid,
    object: 'response',
    status: truncated ? 'incomplete' : 'completed',
    incomplete_details: truncated ? { reason: t.stop === 'refusal' ? 'content_filter' : t.stop === 'max_tokens' ? 'max_output_tokens' : 'context_window' } : null,
    output,
    output_text: t.text,
    usage: t.usage,
  }
}

export function createAnthropicClient(conn: ResolvedAiConnection, sdk?: Anthropic): ResponsesLikeClient {
  const client = sdk ?? new Anthropic({ apiKey: conn.apiKey, baseURL: conn.baseUrl, defaultHeaders: conn.headers, maxRetries: 0 })
  const conversations = new Map<string, Anthropic.MessageParam[]>()

  const prepare = (req: any) => {
    let history: Anthropic.MessageParam[] = []
    if (req.previous_response_id) {
      const found = conversations.get(req.previous_response_id)
      if (!found) throw apiError(400, 'previous_response_not_found', 'previous response not found in this connection')
      history = found
    }
    const { messages: added, system: inlineSystem } = toAnthropicMessages(req.input)
    const convo = [...history, ...added]
    if (!convo.length || convo[0].role !== 'user') convo.unshift({ role: 'user', content: '(The conversation continues.)' })

    const params: Record<string, any> = { model: req.model, messages: convo }
    const fnTools = (Array.isArray(req.tools) ? req.tools : []).filter((t: any) => t?.type === 'function')
    const dropped = [...new Set((Array.isArray(req.tools) ? req.tools : []).filter((t: any) => t?.type !== 'function').map((t: any) => String(t?.type)))]
    if (dropped.length) console.warn(`[AI Connection] built-in tools not available on this connection, answered without them: ${dropped.join(', ')}`)
    const systemParts = [typeof req.instructions === 'string' ? req.instructions : '', ...inlineSystem]
    if (fnTools.length) {
      params.tools = fnTools.map((t: any) => ({ name: t.name, ...(t.description ? { description: t.description } : {}), input_schema: t.parameters ?? { type: 'object', properties: {} }, ...(typeof t.strict === 'boolean' ? { strict: t.strict } : {}) }))
      const tc = req.tool_choice
      if (tc === 'none') params.tool_choice = { type: 'none' }
      else if (tc === 'required' || (tc && typeof tc === 'object' && tc.type === 'function')) {
        params.tool_choice = { type: 'auto' }
        systemParts.push(tc === 'required' ? REQUIRED_TOOL_NOTE : `You must call the tool "${tc.name}" now.`)
      } else if (tc === 'auto') params.tool_choice = { type: 'auto' }
    }
    const system = systemParts.filter(Boolean).join('\n\n')
    if (system) params.system = system
    const fmt = req.text?.format
    if (fmt?.type === 'json_schema') params.output_config = { format: { type: 'json_schema', schema: fmt.schema } }
    const requested = typeof req.max_output_tokens === 'number' && req.max_output_tokens > 0 ? req.max_output_tokens : 0
    params.max_tokens = Math.max(requested, MIN_MAX_TOKENS)
    if (conn.maxOutputTokens) params.max_tokens = Math.min(params.max_tokens, conn.maxOutputTokens)
    return { convo, params }
  }

  const remember = (rid: string, convo: Anthropic.MessageParam[], msg: Anthropic.Message) => {
    conversations.set(rid, [...convo, { role: 'assistant', content: msg.content as unknown as Anthropic.ContentBlockParam[] }])
  }

  async function* stream(rid: string, s: ReturnType<Anthropic['messages']['stream']>, convo: Anthropic.MessageParam[]): AsyncGenerator<any> {
    yield { type: 'response.created', response: { id: rid, status: 'in_progress' } }
    const toolIds = new Map<number, string>()
    for await (const ev of s) {
      if (ev.type === 'content_block_start' && ev.content_block.type === 'tool_use') {
        toolIds.set(ev.index, ev.content_block.id)
        yield { type: 'response.output_item.added', item: { type: 'function_call', id: `fc_${ev.content_block.id}`, call_id: ev.content_block.id, name: ev.content_block.name, arguments: '' } }
      } else if (ev.type === 'content_block_delta') {
        if (ev.delta.type === 'text_delta' && ev.delta.text) yield { type: 'response.output_text.delta', delta: ev.delta.text }
        else if (ev.delta.type === 'input_json_delta' && ev.delta.partial_json) {
          const tid = toolIds.get(ev.index)
          if (tid) yield { type: 'response.function_call_arguments.delta', item_id: `fc_${tid}`, delta: ev.delta.partial_json }
        }
      }
    }
    const msg = await s.finalMessage()
    const t = turnOf(msg)
    const response = toResponse(rid, t)
    if (response.status === 'incomplete') { yield { type: 'response.incomplete', response }; return }
    if (!t.text.trim() && !t.calls.length) {
      yield { type: 'response.failed', response: { ...response, status: 'failed', error: { code: 'empty_response', message: 'The AI connection returned an empty answer' } } }
      return
    }
    for (const c of t.calls) yield { type: 'response.function_call_arguments.done', item_id: `fc_${c.id}`, arguments: c.arguments }
    remember(rid, convo, msg)
    yield { type: 'response.completed', response }
  }

  return {
    responses: {
      async create(req: any, opts?: { signal?: AbortSignal }) {
        const { convo, params } = prepare(req)
        const rid = id('resp')
        const s = client.messages.stream(params as any, opts)
        if (req.stream) return stream(rid, s, convo)
        const msg = await s.finalMessage()
        const t = turnOf(msg)
        const response = toResponse(rid, t)
        if (response.status === 'completed' && !t.text.trim() && !t.calls.length) throw apiError(502, 'empty_response', 'The AI connection returned an empty answer')
        if (response.status === 'completed') remember(rid, convo, msg)
        return response
      },
    },
    embeddings: {
      create: async () => { throw apiError(400, 'unsupported', 'Anthropic has no embeddings API — use a separate AI connection for embeddings') },
    },
  }
}
