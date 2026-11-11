import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { OpenAI } from 'openai'
import { connectionFingerprint, normalizeTextModels, passedTextModels, resolveAiConnection, type AiConnectionCheck, type AiConnectionDb, type AiConnectionRow, type ResolvedAiConnection } from './index'
import { runConnectionCheck } from './check'

const base = { kind: 'azure' as const, baseUrl: 'https://x.openai.azure.com', apiKey: 'k', headers: {}, apiVersion: null, textModel: 'gpt-6-luna', imageModel: null, embeddingModel: null, maxOutputTokens: null }

test('fingerprint - with one text model it equals the old fingerprint with or without the list (old checks stay valid)', () => {
  const old = connectionFingerprint(base)
  assert.equal(connectionFingerprint({ ...base, textModels: [] }), old)
  assert.equal(connectionFingerprint({ ...base, textModels: ['gpt-6-luna'] }), old)
  assert.notEqual(connectionFingerprint({ ...base, textModels: ['gpt-6-luna', 'gpt-6-sol'] }), old)
  assert.notEqual(connectionFingerprint({ ...base, textModels: ['gpt-6-luna', 'gpt-6-sol'] }), connectionFingerprint({ ...base, textModels: ['gpt-6-luna', 'gpt-6.1-sol'] }))
})

test('list cleanup - default first, empty values and duplicates removed', () => {
  assert.deepEqual(normalizeTextModels('a', ['b', 'a', ' ', 'b', 'c']), ['a', 'b', 'c'])
  assert.deepEqual(normalizeTextModels('a', null), ['a'])
})

test('choosable models - an old check (with models) gives only those that passed, an older check (no models, no text) gives the default only, a failed check gives none', () => {
  const c = { textModel: 'a', textModels: ['a', 'b', 'c'] }
  const ok = (v: boolean) => ({ tools: v, json: true, context: true })
  const check = { ok: true, models: { a: ok(true), b: ok(false), c: ok(true) } } as unknown as AiConnectionCheck
  assert.deepEqual(passedTextModels(c, check), ['a', 'c'])
  assert.deepEqual(passedTextModels(c, { ok: true } as AiConnectionCheck), ['a'])
  assert.deepEqual(passedTextModels(c, { ...check, ok: false }), [])
  assert.deepEqual(passedTextModels(c, null), [])
})

test('resolving a connection returns the models that passed', async () => {
  const decrypt = async (s: string) => s.slice(4)
  const resolved = { ...base, textModels: ['gpt-6-luna', 'gpt-6-sol'] }
  const row: AiConnectionRow = {
    id: 'c1', name: 'Main', kind: 'azure', baseUrl: base.baseUrl, apiKey: 'enc:k', headers: null, apiVersion: null, textModel: 'gpt-6-luna', textModels: ['gpt-6-luna', 'gpt-6-sol'],
    imageModel: null, embeddingModel: null, maxOutputTokens: null, isDefault: true,
    checkResult: { ok: true, models: { 'gpt-6-luna': { tools: true, json: true, context: true }, 'gpt-6-sol': { tools: false, json: true, context: true } } },
    checkFingerprint: connectionFingerprint(resolved),
  }
  const db: AiConnectionDb = { aiConnection: { findUnique: async () => row, findMany: async () => [row], count: async () => 1 } }
  const r = await resolveAiConnection({ db, decrypt })
  assert.equal(r.ok, true)
  if (r.ok) { assert.deepEqual(r.connection.textModels, ['gpt-6-luna', 'gpt-6-sol']); assert.deepEqual(r.passedModels, ['gpt-6-luna']) }
})

function fakeClient(calls: string[]): OpenAI {
  return {
    responses: { create: async (body: any) => { calls.push(body.model); if (body.model.startsWith('fail')) throw Object.assign(new Error('Incorrect API key provided: sk-abcdefghijklmnopqrstuvwxyz'), { status: 401 }); return { output_text: body.model.startsWith('empty') ? '' : 'OK' } } },
    embeddings: { create: async (body: any) => { calls.push(`emb:${body.model}`); return { data: [{ embedding: body.model === 'bad' ? [] : [0.1] }] } } },
  } as unknown as OpenAI
}

test('connection check = basic connection only - one call to the default text model, one embedding call, all chosen text models go to Studio', async () => {
  const calls: string[] = []
  const c: ResolvedAiConnection = { id: 'c1', name: 'n', ...base, textModels: ['gpt-6-luna', 'gpt-6.1-sol'], embeddingModel: 'emb' }
  const r = await runConnectionCheck(c, fakeClient(calls))
  assert.equal(r.ok, true)
  assert.equal(r.text, true)
  assert.equal(r.embedding, true)
  assert.equal(r.models, undefined)
  assert.deepEqual(calls, ['gpt-6-luna', 'emb:emb'])
  assert.deepEqual(passedTextModels(c, r), ['gpt-6-luna', 'gpt-6.1-sol'])
})

test('connection check - an empty answer (all spent on thinking) fails with a thinking-off hint, key errors are hidden, an empty embedding vector fails', async () => {
  const empty = await runConnectionCheck({ id: 'c1', name: 'n', ...base, textModel: 'empty-qwen', textModels: ['empty-qwen'] }, fakeClient([]))
  assert.equal(empty.ok, false)
  assert.match(empty.error ?? '', /Thinking off/)
  const bad = await runConnectionCheck({ id: 'c1', name: 'n', ...base, textModel: 'fail-x', textModels: ['fail-x'] }, fakeClient([]))
  assert.equal(bad.ok, false)
  assert.match(bad.error ?? '', /^text: 401/)
  assert.ok(!(bad.error ?? '').includes('abcdefghij'))
  const { createChatCompletionsClient } = await import('./chat-completions')
  const nullSdk: any = { chat: { completions: { create: async () => ({ choices: [{ message: { content: null, reasoning: 'thinking…' }, finish_reason: 'stop' }] }) } }, embeddings: { create: async () => ({ data: [] }) } }
  const compat: ResolvedAiConnection = { id: 'c1', name: 'n', ...base, kind: 'openai_compatible', baseUrl: 'http://x/v1', textModels: ['qwen'], textModel: 'qwen', thinkingOff: false }
  const viaAdapter = await runConnectionCheck(compat, createChatCompletionsClient(compat, nullSdk) as unknown as OpenAI)
  assert.equal(viaAdapter.ok, false)
  assert.match(viaAdapter.error ?? '', /Thinking off/)
  const emb = await runConnectionCheck({ id: 'c1', name: 'n', ...base, textModels: ['gpt-6-luna'], embeddingModel: 'bad' }, fakeClient([]))
  assert.equal(emb.ok, false)
  assert.equal((await runConnectionCheck({ id: 'c1', name: 'n', ...base } as unknown as ResolvedAiConnection, fakeClient([]))).ok, true)
})

test('thinking off - when on, every request carries chat_template_kwargs, when off it does not (streaming and single)', async () => {
  const { createChatCompletionsClient } = await import('./chat-completions')
  const sent: any[] = []
  const sdk: any = { chat: { completions: { create: async (req: any) => { sent.push(req); return req.stream ? (async function* () { yield { choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }] } })() : { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] } } } }, embeddings: { create: async (req: any) => { sent.push(req); return { data: [{ embedding: [1] }] } } } }
  const c: ResolvedAiConnection = { id: 'c', name: 'n', ...base, kind: 'openai_compatible', baseUrl: 'http://x/v1', textModels: ['m'], textModel: 'm', thinkingOff: true }
  const on = createChatCompletionsClient(c, sdk)
  await on.responses.create({ model: 'm', input: 'hi' })
  for await (const _ of await on.responses.create({ model: 'm', input: 'hi', stream: true })) { }
  await on.embeddings.create({ model: 'e', input: 'x' })
  assert.deepEqual(sent[0].chat_template_kwargs, { enable_thinking: false })
  assert.deepEqual(sent[1].chat_template_kwargs, { enable_thinking: false })
  assert.equal(sent[2].chat_template_kwargs, undefined)
  const off = createChatCompletionsClient({ ...c, thinkingOff: false }, sdk)
  await off.responses.create({ model: 'm', input: 'hi' })
  assert.equal(sent[3].chat_template_kwargs, undefined)
})

test('thinking off - old connections with it off keep their fingerprint, turning it on needs a new check, only read for OpenAI-compatible', async () => {
  assert.equal(connectionFingerprint({ ...base, thinkingOff: false }), connectionFingerprint(base))
  assert.notEqual(connectionFingerprint({ ...base, thinkingOff: true }), connectionFingerprint(base))
  const decrypt = async (s: string) => s.slice(4)
  const row = (kind: string): AiConnectionRow => ({ id: 'c1', name: 'n', kind, baseUrl: 'https://x.example.com', apiKey: 'enc:k', headers: null, apiVersion: null, textModel: 'm', imageModel: null, embeddingModel: null, maxOutputTokens: null, thinkingOff: true, isDefault: true, checkResult: null, checkFingerprint: null })
  const { decryptAiConnectionRow } = await import('./index')
  assert.equal((await decryptAiConnectionRow(row('openai_compatible'), decrypt))?.thinkingOff, true)
  assert.equal((await decryptAiConnectionRow(row('azure'), decrypt))?.thinkingOff, false)
  assert.equal((await decryptAiConnectionRow(row('anthropic'), decrypt))?.thinkingOff, false)
  assert.equal((await decryptAiConnectionRow({ ...row('openai_compatible'), thinkingOff: undefined }, decrypt))?.thinkingOff, false)
})
