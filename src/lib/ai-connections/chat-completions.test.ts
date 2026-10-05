import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createChatCompletionsClient, toChatMessages, toChatParams } from './chat-completions'
import type { ResolvedAiConnection } from './index'

const conn: ResolvedAiConnection = { id: 'c', name: 'n', kind: 'openai_compatible', baseUrl: 'http://x/v1', apiKey: 'k', headers: {}, apiVersion: null, textModel: 'm', imageModel: null, embeddingModel: null, maxOutputTokens: 2048 }

function fakeSdk(script: any[][] | any[]) {
  const calls: any[] = []
  let n = 0
  const sdk: any = {
    chat: { completions: { create: async (req: any) => {
      calls.push(req)
      const out = script[n++]
      if (!req.stream) return out
      return (async function* () { for (const c of out as any[]) yield c })()
    } } },
    embeddings: { create: async () => ({ data: [{ embedding: [1] }] }) },
  }
  return { sdk, calls }
}
const delta = (d: any, finish: string | null = null) => ({ choices: [{ index: 0, delta: d, finish_reason: finish }] })
const usage = (i: number, o: number) => ({ choices: [], usage: { prompt_tokens: i, completion_tokens: o } })
async function events(it: any) { const out: any[] = []; for await (const e of it) out.push(e); return out }

test('streaming text - deltas; thinking text dropped; usage in completed; output_text', async () => {
  const { sdk, calls } = fakeSdk([[delta({ role: 'assistant', content: '', reasoning: 'thinking...' }), delta({ content: 'Hel' }), delta({ content: 'lo' }), delta({}, 'stop'), usage(10, 3)]])
  const c = createChatCompletionsClient(conn, sdk)
  const ev = await events(await c.responses.create({ model: 'm', instructions: 'Be brief.', input: 'hi', stream: true, max_output_tokens: 9999 }))
  assert.deepEqual(ev.filter((e) => e.type === 'response.output_text.delta').map((e) => e.delta), ['Hel', 'lo'])
  const done = ev.at(-1)
  assert.equal(done.type, 'response.completed')
  assert.equal(done.response.output_text, 'Hello')
  assert.deepEqual(done.response.usage, { input_tokens: 10, output_tokens: 3 })
  assert.deepEqual(calls[0].messages, [{ role: 'system', content: 'Be brief.' }, { role: 'user', content: 'hi' }])
  assert.equal(calls[0].max_tokens, 2048)
  assert.deepEqual(calls[0].stream_options, { include_usage: true })
})

test('tool calls - both Ollama style (one chunk) and OpenAI style (split) give added -> delta -> done with matching indexes', async () => {
  for (const chunks of [
    [delta({ tool_calls: [{ id: 'call_a', index: 0, type: 'function', function: { name: 'ping', arguments: '{"value":7}' } }] }), delta({}, 'tool_calls')],
    [delta({ tool_calls: [{ index: 0, id: 'call_a', function: { name: 'ping', arguments: '' } }] }), delta({ tool_calls: [{ index: 0, function: { arguments: '{"val' } }] }), delta({ tool_calls: [{ index: 0, function: { arguments: 'ue":7}' } }] }), delta({}, 'tool_calls')],
  ]) {
    const { sdk } = fakeSdk([chunks])
    const ev = await events(await createChatCompletionsClient(conn, sdk).responses.create({ model: 'm', input: 'x', stream: true, tools: [{ type: 'function', name: 'ping', parameters: {} }] }))
    const added = ev.find((e) => e.type === 'response.output_item.added')
    assert.deepEqual(added.item, { type: 'function_call', id: 'fc_call_a', call_id: 'call_a', name: 'ping', arguments: '' })
    const done = ev.find((e) => e.type === 'response.function_call_arguments.done')
    assert.deepEqual(done, { type: 'response.function_call_arguments.done', item_id: 'fc_call_a', arguments: '{"value":7}' })
    const fc = ev.at(-1).response.output.find((o: any) => o.type === 'function_call')
    assert.equal(fc.call_id, 'call_a')
  }
})

test('tool name in several chunks - announced after the name fully arrives; whitespace-only answer = empty answer', async () => {
  const { sdk } = fakeSdk([
    [delta({ tool_calls: [{ index: 0, id: 'call_b', function: { name: 'lookup_' } }] }), delta({ tool_calls: [{ index: 0, function: { name: 'account' } }] }), delta({ tool_calls: [{ index: 0, function: { arguments: '{}' } }] }), delta({}, 'tool_calls')],
    [delta({ content: ' \n ' }), delta({}, 'stop')],
  ])
  const c = createChatCompletionsClient(conn, sdk)
  const ev = await events(await c.responses.create({ model: 'm', input: 'x', stream: true, tools: [{ type: 'function', name: 'lookup_account' }] }))
  const added = ev.filter((e) => e.type === 'response.output_item.added')
  assert.equal(added.length, 1)
  assert.equal(added[0].item.name, 'lookup_account')
  const blank = await events(await c.responses.create({ model: 'm', input: 'x', stream: true }))
  assert.equal(blank.at(-1).type, 'response.failed')
})

test('servers that do not follow the standard - tools arriving separately per call without index; text arriving as an array of parts', async () => {
  const { sdk } = fakeSdk([
    [delta({ tool_calls: [{ id: 'c1', function: { name: 'a', arguments: '{"x":1}' } }] }), delta({ tool_calls: [{ id: 'c2', function: { name: 'b', arguments: '{"y":2}' } }] }), delta({}, 'tool_calls')],
    [delta({ content: [{ type: 'text', text: 'Hi' }] }), delta({}, 'stop')],
  ])
  const c = createChatCompletionsClient(conn, sdk)
  const ev = await events(await c.responses.create({ model: 'm', input: 'x', stream: true }))
  assert.deepEqual(ev.filter((e) => e.type === 'response.function_call_arguments.done').map((e) => [e.item_id, e.arguments]), [['fc_c1', '{"x":1}'], ['fc_c2', '{"y":2}']])
  const t = await events(await c.responses.create({ model: 'm', input: 'x', stream: true }))
  assert.equal(t.at(-1).response.output_text, 'Hi')
})

test('follow-up - same instance\'s response id + tool results -> converted to earlier conversation, tool_calls and tool messages', async () => {
  const { sdk, calls } = fakeSdk([
    [delta({ tool_calls: [{ id: 'call_a', index: 0, function: { name: 'ping', arguments: '{}' } }] }), delta({}, 'tool_calls')],
    [delta({ content: 'pong' }), delta({}, 'stop')],
  ])
  const c = createChatCompletionsClient(conn, sdk)
  const first = await events(await c.responses.create({ model: 'm', instructions: 'S', input: 'go', stream: true, tools: [{ type: 'function', name: 'ping' }] }))
  const rid = first.at(-1).response.id
  const second = await events(await c.responses.create({ model: 'm', instructions: 'S', previous_response_id: rid, input: [{ type: 'function_call_output', call_id: 'call_a', output: 'ok' }], stream: true }))
  assert.equal(second.at(-1).response.output_text, 'pong')
  assert.deepEqual(calls[1].messages, [
    { role: 'system', content: 'S' },
    { role: 'user', content: 'go' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'call_a', type: 'function', function: { name: 'ping', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'call_a', content: 'ok' },
  ])
  await assert.rejects(createChatCompletionsClient(conn, fakeSdk([]).sdk).responses.create({ model: 'm', previous_response_id: rid, input: 'x', stream: true }), (e: any) => e.code === 'previous_response_not_found')
})

test('truncation - incomplete; a truncated tool call has neither done nor output', async () => {
  const { sdk } = fakeSdk([[delta({ content: 'part' }), delta({ tool_calls: [{ id: 'call_a', index: 0, function: { name: 'write', arguments: '{"rows":[{"a":' } }] }), delta({}, 'length')]])
  const ev = await events(await createChatCompletionsClient(conn, sdk).responses.create({ model: 'm', input: 'x', stream: true }))
  assert.equal(ev.at(-1).type, 'response.incomplete')
  assert.equal(ev.at(-1).response.incomplete_details.reason, 'max_output_tokens')
  assert.equal(ev.some((e) => e.type === 'response.function_call_arguments.done'), false)
  assert.equal(ev.at(-1).response.output.some((o: any) => o.type === 'function_call'), false)
})

test('empty answer - streaming gives response.failed(empty_response); one-shot throws', async () => {
  const { sdk } = fakeSdk([[delta({ reasoning: 'hmm' }), delta({}, 'stop')], { choices: [{ message: { content: '' }, finish_reason: 'stop' }] }])
  const c = createChatCompletionsClient(conn, sdk)
  const ev = await events(await c.responses.create({ model: 'm', input: 'x', stream: true }))
  assert.equal(ev.at(-1).type, 'response.failed')
  assert.equal(ev.at(-1).response.error.code, 'empty_response')
  await assert.rejects(c.responses.create({ model: 'm', input: 'x' }), (e: any) => e.code === 'empty_response')
})

test('one-shot - output_text, usage, image parts', async () => {
  const { sdk, calls } = fakeSdk([{ choices: [{ message: { content: 'Red' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 1 } }])
  const r = await createChatCompletionsClient(conn, sdk).responses.create({ model: 'img', input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'colour?' }, { type: 'input_image', image_url: 'data:image/png;base64,AA', detail: 'high' }] }] })
  assert.equal(r.output_text, 'Red')
  assert.deepEqual(r.usage, { input_tokens: 5, output_tokens: 1 })
  assert.deepEqual(calls[0].messages[0].content, [{ type: 'text', text: 'colour?' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AA', detail: 'high' } }])
})

test('request mapping - json_schema; dropping built-in tools; tool_choice; grouping earlier-turn tool records; rejecting unknown parts', () => {
  const p = toChatParams({ model: 'm', temperature: 0.2, tools: [{ type: 'web_search' }, { type: 'function', name: 'f', parameters: { type: 'object' } }], tool_choice: 'required', text: { format: { type: 'json_schema', name: 'x', strict: true, schema: { type: 'object' } } }, reasoning: { effort: 'low' } }, null)
  assert.deepEqual(p.tools, [{ type: 'function', function: { name: 'f', parameters: { type: 'object' } } }])
  assert.equal(p.tool_choice, 'required')
  assert.deepEqual(p.response_format, { type: 'json_schema', json_schema: { name: 'x', schema: { type: 'object' }, strict: true } })
  assert.equal('reasoning' in p, false)
  assert.equal(p.max_tokens, undefined)
  const m = toChatMessages([
    { type: 'message', role: 'user', content: 'q1' },
    { type: 'function_call', call_id: 'p1', name: 'a', arguments: '{}' },
    { type: 'function_call', call_id: 'p2', name: 'b', arguments: '{}' },
    { type: 'function_call_output', call_id: 'p1', output: 'A' },
    { type: 'function_call_output', call_id: 'p2', output: 'B' },
    { type: 'message', role: 'assistant', content: 'ans' },
  ])
  assert.equal(m[1].tool_calls.length, 2)
  assert.deepEqual(m.slice(2).map((x) => x.role), ['tool', 'tool', 'assistant'])
  assert.throws(() => toChatMessages([{ type: 'input_file', file_id: 'x' }]), (e: any) => e.code === 'unsupported_input')
})
