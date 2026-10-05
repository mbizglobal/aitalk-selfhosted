import { randomBytes } from 'node:crypto'
import { OpenAI } from 'openai'
import type { ResolvedAiConnection } from './index'

type ChatMessage = Record<string, any>

export interface ResponsesLikeClient {
  responses: { create(req: any, opts?: { signal?: AbortSignal }): Promise<any> }
  embeddings: { create(req: any, opts?: { signal?: AbortSignal }): Promise<any> }
}

const id = (p: string) => `${p}_${randomBytes(12).toString('hex')}`

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((p: any) => (p && (p.type === 'text' || p.type === 'output_text') && typeof p.text === 'string' ? p.text : '')).join('')
}

function apiError(status: number, code: string, message: string): Error {
  return Object.assign(new Error(message), { status, code })
}

function toChatContent(content: unknown, role: string): any {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: any[] = []
  for (const p of content) {
    if (!p || typeof p !== 'object') continue
    if ((p.type === 'input_text' || p.type === 'output_text' || p.type === 'text') && typeof p.text === 'string') parts.push({ type: 'text', text: p.text })
    else if (p.type === 'input_image' && typeof p.image_url === 'string') parts.push({ type: 'image_url', image_url: { url: p.image_url, ...(p.detail ? { detail: p.detail } : {}) } })
    else throw apiError(400, 'unsupported_input', `input part "${String(p.type)}" is not supported by this AI connection`)
  }
  if (role !== 'user') return parts.map((x) => (x.type === 'text' ? x.text : '')).join('')
  return parts.length === 1 && parts[0].type === 'text' ? parts[0].text : parts
}

export function toChatMessages(input: unknown): ChatMessage[] {
  if (input == null) return []
  if (typeof input === 'string') return [{ role: 'user', content: input }]
  if (!Array.isArray(input)) throw apiError(400, 'unsupported_input', 'input must be a string or an array')
  const out: ChatMessage[] = []
  for (const item of input) {
    if (!item || typeof item !== 'object') continue
    const type = item.type ?? (item.role ? 'message' : undefined)
    if (type === 'message') {
      const role = item.role === 'developer' ? 'system' : item.role
      if (!['user', 'assistant', 'system'].includes(role)) throw apiError(400, 'unsupported_input', `message role "${String(item.role)}" is not supported`)
      out.push({ role, content: toChatContent(item.content, role) })
    } else if (type === 'function_call') {
      const call = { id: item.call_id || item.id, type: 'function', function: { name: item.name, arguments: item.arguments || '{}' } }
      const last = out[out.length - 1]
      if (last && last.role === 'assistant' && Array.isArray(last.tool_calls) && !last.content) last.tool_calls.push(call)
      else out.push({ role: 'assistant', content: null, tool_calls: [call] })
    } else if (type === 'function_call_output') {
      out.push({ role: 'tool', tool_call_id: item.call_id, content: typeof item.output === 'string' ? item.output : JSON.stringify(item.output ?? '') })
    } else {
      throw apiError(400, 'unsupported_input', `input item "${String(type)}" is not supported by this AI connection`)
    }
  }
  return out
}

export function toChatParams(req: any, maxOutputCap: number | null) {
  const params: Record<string, any> = { model: req.model }
  if (typeof req.temperature === 'number') params.temperature = req.temperature
  if (typeof req.top_p === 'number') params.top_p = req.top_p
  const max = typeof req.max_output_tokens === 'number' && req.max_output_tokens > 0 ? req.max_output_tokens : maxOutputCap
  if (max) params.max_tokens = maxOutputCap ? Math.min(max, maxOutputCap) : max
  const allTools: any[] = Array.isArray(req.tools) ? req.tools : []
  const fnTools = allTools.filter((t: any) => t?.type === 'function')
  const dropped = [...new Set(allTools.filter((t: any) => t?.type !== 'function').map((t: any) => String(t?.type)))]
  if (dropped.length) console.warn(`[AI Connection] built-in tools not available on this connection, answered without them: ${dropped.join(', ')}`)
  if (fnTools.length) {
    params.tools = fnTools.map((t: any) => ({ type: 'function', function: { name: t.name, ...(t.description ? { description: t.description } : {}), parameters: t.parameters ?? { type: 'object', properties: {} }, ...(typeof t.strict === 'boolean' ? { strict: t.strict } : {}) } }))
    const tc = req.tool_choice
    if (tc === 'auto' || tc === 'none' || tc === 'required') params.tool_choice = tc
    else if (tc && typeof tc === 'object' && tc.type === 'function' && tc.name) params.tool_choice = { type: 'function', function: { name: tc.name } }
  }
  const fmt = req.text?.format
  if (fmt?.type === 'json_schema') params.response_format = { type: 'json_schema', json_schema: { name: fmt.name || 'output', schema: fmt.schema, ...(typeof fmt.strict === 'boolean' ? { strict: fmt.strict } : {}) } }
  else if (fmt?.type === 'json_object') params.response_format = { type: 'json_object' }
  return params
}

interface Turn {
  text: string
  calls: Array<{ id: string; name: string; arguments: string }>
  finish: string | null
  usage: { input_tokens: number; output_tokens: number } | null
}

function toResponse(rid: string, t: Turn) {
  const truncated = t.finish === 'length' || t.finish === 'content_filter'
  const output: any[] = []
  if (t.text) output.push({ type: 'message', id: id('msg'), role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: t.text, annotations: [] }] })
  if (!truncated) for (const c of t.calls) output.push({ type: 'function_call', id: `fc_${c.id}`, call_id: c.id, name: c.name, arguments: c.arguments, status: 'completed' })
  return {
    id: rid,
    object: 'response',
    status: truncated ? 'incomplete' : 'completed',
    incomplete_details: truncated ? { reason: t.finish === 'length' ? 'max_output_tokens' : 'content_filter' } : null,
    output,
    output_text: t.text,
    usage: t.usage,
  }
}

export function createChatCompletionsClient(conn: ResolvedAiConnection, sdk?: OpenAI): ResponsesLikeClient {
  const client = sdk ?? new OpenAI({ apiKey: conn.apiKey, baseURL: conn.baseUrl, defaultHeaders: conn.headers, maxRetries: 0 })
  const conversations = new Map<string, ChatMessage[]>()

  const prepare = (req: any) => {
    let history: ChatMessage[] = []
    if (req.previous_response_id) {
      const found = conversations.get(req.previous_response_id)
      if (!found) throw apiError(400, 'previous_response_not_found', 'previous response not found in this connection')
      history = found
    }
    const convo = [...history, ...toChatMessages(req.input)]
    const system = typeof req.instructions === 'string' && req.instructions ? [{ role: 'system', content: req.instructions }] : []
    return { convo, messages: [...system, ...convo], params: toChatParams(req, conn.maxOutputTokens) }
  }

  const remember = (rid: string, convo: ChatMessage[], t: Turn) => {
    const assistant: ChatMessage = { role: 'assistant', content: t.text || null }
    if (t.calls.length && t.finish !== 'length') assistant.tool_calls = t.calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } }))
    conversations.set(rid, [...convo, assistant])
  }

  async function* stream(rid: string, chunks: AsyncIterable<any>, convo: ChatMessage[]): AsyncGenerator<any> {
    const t: Turn = { text: '', calls: [], finish: null, usage: null }
    const byIndex = new Map<number, { id: string; name: string; arguments: string; announced: boolean }>()
    yield { type: 'response.created', response: { id: rid, status: 'in_progress' } }
    for await (const chunk of chunks) {
      if (chunk?.usage) t.usage = { input_tokens: chunk.usage.prompt_tokens ?? 0, output_tokens: chunk.usage.completion_tokens ?? 0 }
      const choice = chunk?.choices?.[0]
      if (!choice) continue
      const d = choice.delta ?? {}
      const piece = textOf(d.content)
      if (piece) {
        t.text += piece
        yield { type: 'response.output_text.delta', delta: piece }
      }
      for (const [pos, tc] of (Array.isArray(d.tool_calls) ? d.tool_calls : []).entries()) {
        const byId = typeof tc.index !== 'number' && tc.id ? [...byIndex.entries()].find(([, v]) => v.id === tc.id)?.[0] : undefined
        const index = typeof tc.index === 'number' ? tc.index : byId ?? (tc.id ? byIndex.size : pos)
        let call = byIndex.get(index)
        if (!call) {
          call = { id: tc.id || id('call'), name: '', arguments: '', announced: false }
          byIndex.set(index, call)
        }
        if (tc.function?.name) call.name += tc.function.name
        if (tc.function?.arguments) {
          if (!call.announced && call.name) {
            call.announced = true
            yield { type: 'response.output_item.added', item: { type: 'function_call', id: `fc_${call.id}`, call_id: call.id, name: call.name, arguments: '' } }
          }
          call.arguments += tc.function.arguments
          yield { type: 'response.function_call_arguments.delta', item_id: `fc_${call.id}`, delta: tc.function.arguments }
        }
      }
      if (choice.finish_reason) t.finish = choice.finish_reason
    }
    for (const call of byIndex.values()) {
      if (!call.announced && call.name) {
        call.announced = true
        yield { type: 'response.output_item.added', item: { type: 'function_call', id: `fc_${call.id}`, call_id: call.id, name: call.name, arguments: '' } }
      }
    }
    t.calls = [...byIndex.values()].filter((c) => c.name).map(({ id: cid, name, arguments: a }) => ({ id: cid, name, arguments: a || '{}' }))
    const response = toResponse(rid, t)
    if (response.status === 'incomplete') {
      yield { type: 'response.incomplete', response }
      return
    }
    if (!t.text.trim() && !t.calls.length) {
      yield { type: 'response.failed', response: { ...response, status: 'failed', error: { code: 'empty_response', message: 'The AI connection returned an empty answer' } } }
      return
    }
    for (const c of t.calls) yield { type: 'response.function_call_arguments.done', item_id: `fc_${c.id}`, arguments: c.arguments }
    remember(rid, convo, t)
    yield { type: 'response.completed', response }
  }

  return {
    responses: {
      async create(req: any, opts?: { signal?: AbortSignal }) {
        const { convo, messages, params } = prepare(req)
        const rid = id('resp')
        if (req.stream) {
          const chunks = await client.chat.completions.create({ ...params, messages, stream: true, stream_options: { include_usage: true } } as any, opts)
          return stream(rid, chunks as unknown as AsyncIterable<any>, convo)
        }
        const r: any = await client.chat.completions.create({ ...params, messages } as any, opts)
        const choice = r.choices?.[0]
        const t: Turn = {
          text: textOf(choice?.message?.content),
          calls: (choice?.message?.tool_calls ?? []).filter((c: any) => c?.function?.name).map((c: any) => ({ id: c.id || id('call'), name: c.function.name, arguments: c.function.arguments || '{}' })),
          finish: choice?.finish_reason ?? null,
          usage: r.usage ? { input_tokens: r.usage.prompt_tokens ?? 0, output_tokens: r.usage.completion_tokens ?? 0 } : null,
        }
        const response = toResponse(rid, t)
        if (response.status === 'completed' && !t.text.trim() && !t.calls.length) throw apiError(502, 'empty_response', 'The AI connection returned an empty answer')
        if (response.status === 'completed') remember(rid, convo, t)
        return response
      },
    },
    embeddings: {
      create: (req: any, opts?: { signal?: AbortSignal }) => client.embeddings.create(req, opts),
    },
  }
}
