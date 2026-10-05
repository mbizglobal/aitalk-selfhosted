import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAnthropicClient, toAnthropicMessages } from './anthropic'
import type { ResolvedAiConnection } from './index'

const conn: ResolvedAiConnection = { id: 'c', name: 'n', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'k', headers: {}, apiVersion: null, textModel: 'claude-opus-5-5', imageModel: null, embeddingModel: null, maxOutputTokens: null }

function fakeSdk(turns: Array<{ events: any[]; final: any }>) {
  const calls: any[] = []
  let n = 0
  const sdk: any = { messages: { stream: (params: any) => {
    calls.push(params)
    const t = turns[n++]
    return { async *[Symbol.asyncIterator]() { for (const e of t.events) yield e }, finalMessage: async () => t.final }
  } } }
  return { sdk, calls }
}
const msg = (content: any[], stop = 'end_turn', usage = { input_tokens: 10, output_tokens: 5 }) => ({ content, stop_reason: stop, usage })
const textDelta = (t: string, index = 1) => ({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: t } })
async function events(it: any) { const out: any[] = []; for await (const e of it) out.push(e); return out }

test('streaming text - thinking text is dropped; deltas, usage in completed, request shape (system, no temperature, max_tokens floor)', async () => {
  const { sdk, calls } = fakeSdk([{ events: [{ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } }, textDelta('Hel'), textDelta('lo')], final: msg([{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text: 'Hello' }]) }])
  const ev = await events(await createAnthropicClient(conn, sdk).responses.create({ model: 'claude-opus-5-5', instructions: 'Be brief.', input: 'hi', stream: true, temperature: 0.7, top_p: 1, max_output_tokens: 2048 }))
  assert.deepEqual(ev.filter((e) => e.type === 'response.output_text.delta').map((e) => e.delta), ['Hel', 'lo'])
  assert.equal(ev.at(-1).type, 'response.completed')
  assert.equal(ev.at(-1).response.output_text, 'Hello')
  assert.deepEqual(ev.at(-1).response.usage, { input_tokens: 10, output_tokens: 5 })
  assert.equal(calls[0].system, 'Be brief.')
  assert.equal('temperature' in calls[0] || 'top_p' in calls[0], false)
  assert.equal(calls[0].max_tokens, 16000)
})

test('tools - added (name at once) -> delta -> done; follow-up passes thinking blocks through as is; two tool results go in one user message', async () => {
  const first = msg([{ type: 'thinking', thinking: '', signature: 'SIG1' }, { type: 'tool_use', id: 'tu_1', name: 'a', input: { x: 1 } }, { type: 'tool_use', id: 'tu_2', name: 'b', input: {} }], 'tool_use')
  const { sdk, calls } = fakeSdk([
    { events: [{ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu_1', name: 'a', input: {} } }, { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"x":1}' } }, { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'tu_2', name: 'b', input: {} } }], final: first },
    { events: [textDelta('done', 0)], final: msg([{ type: 'text', text: 'done' }]) },
  ])
  const c = createAnthropicClient(conn, sdk)
  const ev = await events(await c.responses.create({ model: 'm', input: 'go', stream: true, tools: [{ type: 'function', name: 'a', parameters: { type: 'object' } }, { type: 'function', name: 'b' }, { type: 'web_search' }], tool_choice: 'required' }))
  assert.deepEqual(ev.filter((e) => e.type === 'response.output_item.added').map((e) => [e.item.call_id, e.item.name]), [['tu_1', 'a'], ['tu_2', 'b']])
  assert.deepEqual(ev.filter((e) => e.type === 'response.function_call_arguments.done').map((e) => [e.item_id, e.arguments]), [['fc_tu_1', '{"x":1}'], ['fc_tu_2', '{}']])
  assert.deepEqual(calls[0].tool_choice, { type: 'auto' }) // required → auto
  assert.match(calls[0].system, /must call one of the provided tools/)
  assert.equal(calls[0].tools.length, 2)
  const rid = ev.at(-1).response.id
  await events(await c.responses.create({ model: 'm', previous_response_id: rid, input: [{ type: 'function_call_output', call_id: 'tu_1', output: 'A' }, { type: 'function_call_output', call_id: 'tu_2', output: 'B' }], stream: true }))
  const m = calls[1].messages
  assert.deepEqual(m[1], { role: 'assistant', content: first.content })
  assert.deepEqual(m[2], { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'A' }, { type: 'tool_result', tool_use_id: 'tu_2', content: 'B' }] })
  await assert.rejects(createAnthropicClient(conn, fakeSdk([]).sdk).responses.create({ model: 'm', previous_response_id: rid, input: 'x' }), (e: any) => e.code === 'previous_response_not_found')
})

test('truncation and refusal = incomplete and no tools are emitted; empty answer = failed / throws', async () => {
  for (const [stop, reason] of [['max_tokens', 'max_output_tokens'], ['refusal', 'content_filter'], ['model_context_window_exceeded', 'context_window']]) {
    const { sdk } = fakeSdk([{ events: [{ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't', name: 'w', input: {} } }], final: msg([{ type: 'tool_use', id: 't', name: 'w', input: {} }], stop) }])
    const ev = await events(await createAnthropicClient(conn, sdk).responses.create({ model: 'm', input: 'x', stream: true }))
    assert.equal(ev.at(-1).type, 'response.incomplete')
    assert.equal(ev.at(-1).response.incomplete_details.reason, reason)
    assert.equal(ev.some((e) => e.type === 'response.function_call_arguments.done'), false)
    assert.equal(ev.at(-1).response.output.length, 0)
  }
  const { sdk } = fakeSdk([{ events: [], final: msg([{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text: '  ' }]) }, { events: [], final: msg([]) }])
  const c = createAnthropicClient(conn, sdk)
  assert.equal((await events(await c.responses.create({ model: 'm', input: 'x', stream: true }))).at(-1).type, 'response.failed')
  await assert.rejects(c.responses.create({ model: 'm', input: 'x' }), (e: any) => e.code === 'empty_response')
})

test('one-shot - json -> output_config; connection limit; image data URL -> base64 block; no embeddings', async () => {
  const { sdk, calls } = fakeSdk([{ events: [], final: msg([{ type: 'text', text: '{"ok":true}' }]) }])
  const c = createAnthropicClient({ ...conn, maxOutputTokens: 4096 }, sdk)
  const r = await c.responses.create({ model: 'm', input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'q' }, { type: 'input_image', image_url: 'data:image/png;base64,AAAA', detail: 'high' }] }], text: { format: { type: 'json_schema', name: 'x', strict: true, schema: { type: 'object' } } } })
  assert.equal(r.output_text, '{"ok":true}')
  assert.deepEqual(calls[0].output_config, { format: { type: 'json_schema', schema: { type: 'object' } } })
  assert.equal(calls[0].max_tokens, 4096)
  assert.deepEqual(calls[0].messages[0].content[1], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } })
  await assert.rejects(c.embeddings.create({}), (e: any) => e.code === 'unsupported')
})

test('input mapping - system messages go to the top; earlier-turn tool records; empty text dropped; if the first message is from the assistant, a user message goes before it', async () => {
  const { messages, system } = toAnthropicMessages([
    { type: 'message', role: 'assistant', content: 'earlier answer' },
    { type: 'message', role: 'system', content: 'note' },
    { type: 'message', role: 'user', content: '' },
    { type: 'function_call', call_id: 'p1', name: 'a', arguments: '{"k":2}' },
    { type: 'function_call_output', call_id: 'p1', output: 'R' },
    { type: 'message', role: 'user', content: 'q' },
  ])
  assert.deepEqual(system, ['note'])
  assert.deepEqual(messages.map((m) => m.role), ['assistant', 'assistant', 'user', 'user'])
  assert.deepEqual((messages[1].content as any[])[0], { type: 'tool_use', id: 'p1', name: 'a', input: { k: 2 } })
  const { sdk, calls } = fakeSdk([{ events: [], final: msg([{ type: 'text', text: 'ok' }]) }])
  await createAnthropicClient(conn, sdk).responses.create({ model: 'm', input: [{ type: 'message', role: 'assistant', content: 'hi' }, { type: 'message', role: 'user', content: 'q' }] })
  assert.equal(calls[0].messages[0].role, 'user')
  assert.throws(() => toAnthropicMessages([{ type: 'message', role: 'user', content: [{ type: 'input_image', image_url: 'https://x/y.png' }] }]), (e: any) => e.code === 'invalid_image')
  assert.deepEqual((toAnthropicMessages([{ type: 'message', role: 'user', content: [{ type: 'input_image', image_url: 'data:image/jpg;base64,QQ==' }] }]).messages[0].content as any[])[0].source.media_type, 'image/jpeg')
})
