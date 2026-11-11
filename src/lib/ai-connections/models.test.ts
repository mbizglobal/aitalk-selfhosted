import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchModelLists, modelListRequest, modelProviderOf, parseModelList, pickModelLists, versionOf, type RawModel } from './models'

const ids = (l: { id: string }[]) => l.map((m) => m.id)
const t = (y: number, m = 1) => Date.UTC(y, m - 1, 1)

const OPENAI: RawModel[] = [
  ['text-embedding-ada-002', 2022], ['tts-1', 2023], ['whisper-1', 2023], ['davinci:ft-x:demo-2023-02-15', 2023],
  ['gpt-4o', 2024], ['gpt-4o-mini', 2024], ['omni-moderation-latest', 2024], ['text-embedding-3-large', 2024], ['text-embedding-3-small', 2024],
  ['gpt-4.1', 2025], ['gpt-5', 2025], ['gpt-5-pro', 2025], ['gpt-5-search-api', 2025], ['gpt-4o-mini-tts', 2025], ['gpt-realtime', 2025], ['gpt-image-1.5', 2025], ['o3', 2025],
  ['gpt-5.4', 2026, 3], ['gpt-5.4-2026-03-05', 2026, 3], ['gpt-5.3-codex', 2026, 2], ['chat-latest', 2026, 1], ['gpt-6-astra', 2026, 6], ['gpt-6-luna', 2026, 7], ['gpt-6-sol', 2026, 7],
  ['gpt-6.1-sol', 2026, 10], ['gpt-6.1-terra', 2026, 10], ['gpt-image-2.6-flare', 2026, 10], ['gpt-live-1', 2026, 9], ['gpt-realtime-2.1', 2026, 9], ['gpt-transcribe', 2026, 8],
].map(([id, y, m]) => ({ id: id as string, model: id as string, created: t(y as number, (m as number) ?? 1) }))

test('OpenAI - text = gpt-6-luna and 6.1 or later (6-sol and 6-astra left out), image = 5 newest chat models, embedding = 5 newest embedding models', () => {
  const l = pickModelLists('openai', OPENAI)
  assert.deepEqual(ids(l.text), ['gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-luna'])
  assert.deepEqual(ids(l.image), ['gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-luna', 'gpt-6-sol', 'gpt-6-astra'])
  assert.deepEqual(ids(l.embedding), ['text-embedding-3-large', 'text-embedding-3-small', 'text-embedding-ada-002'])
})

test('OpenAI - without gpt-6 the text list is empty (the floor is not lowered), images still list the 5 newest', () => {
  const old = OPENAI.filter((m) => !/^gpt-6/.test(m.id))
  const l = pickModelLists('openai', old)
  assert.deepEqual(ids(l.text), [])
  assert.deepEqual(ids(l.image), ['gpt-5.4', 'gpt-5', 'gpt-4.1', 'o3', 'gpt-4o'])
})

test('OpenAI - a newer version (gpt-7) joins the text list on its own', () => {
  const l = pickModelLists('openai', [...OPENAI, { id: 'gpt-7-nova', model: 'gpt-7-nova', created: t(2027) }])
  assert.equal(l.text[0].id, 'gpt-7-nova')
})

test('Claude - text = 5.5 and later, image = 5 newest with image_input, no embeddings', () => {
  const raw = parseModelList('claude', { data: [
    ['claude-haiku-5-5', '2026-10-07'], ['claude-sonnet-5-5', '2026-09-28'], ['claude-opus-5-5', '2026-09-21'], ['claude-fable-5-1', '2026-08-28'],
    ['claude-opus-5', '2026-07-24'], ['claude-sonnet-4-6', '2026-02-17'], ['claude-opus-4-5-20251101', '2025-11-24'],
  ].map(([id, d]) => ({ id, created_at: `${d}T00:00:00Z`, capabilities: { image_input: { supported: true } } })) })
  const l = pickModelLists('claude', raw)
  assert.deepEqual(ids(l.text), ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'])
  assert.deepEqual(ids(l.image), ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-4-6'])
  assert.deepEqual(l.embedding, [])
})

test('Gemini - text = 3.8 and later, speech, image and live models left out, embedding = embedContent, no dates so version order', () => {
  const m = (name: string, ...methods: string[]) => ({ name: `models/${name}`, supportedGenerationMethods: methods })
  const raw = parseModelList('gemini', { models: [
    m('gemini-2.5-flash', 'generateContent'), m('gemini-3.5-flash', 'generateContent'), m('gemini-3.6-flash', 'generateContent'), m('gemini-3.7-flash', 'generateContent'),
    m('gemini-3.8-flash', 'generateContent'), m('gemini-3.8-flash-tts', 'generateContent'), m('gemini-3.1-flash-image', 'generateContent'), m('gemini-3.8-live', 'bidiGenerateContent'),
    m('gemma-4-31b-it', 'generateContent'), m('gemini-flash-latest', 'generateContent'), m('lyria-3.5', 'generateContent'),
    m('gemini-embedding-001', 'embedContent'), m('gemini-embedding-2', 'embedContent'), m('gemini-embedding-2-preview', 'embedContent'),
  ] })
  const l = pickModelLists('gemini', raw)
  assert.deepEqual(ids(l.text), ['gemini-3.8-flash'])
  assert.deepEqual(ids(l.image), ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-2.5-flash'])
  assert.deepEqual(ids(l.embedding), ['gemini-embedding-2', 'gemini-embedding-2-preview', 'gemini-embedding-001'])
})

test('Azure - stores the deployment name, judges by the model inside it, leaves out failed deployments', () => {
  const raw = parseModelList('azure', { data: [
    { id: 'chat-main', model: 'gpt-6-luna', status: 'succeeded', created_at: 1780000000 },
    { id: 'gpt-realtime-2-1', model: 'gpt-realtime-2.1', status: 'succeeded' },
    { id: 'old-chat', model: 'gpt-4.1', status: 'succeeded', created_at: 1740000000 },
    { id: 'broken', model: 'gpt-6-sol', status: 'failed' },
    { id: 'emb', model: 'text-embedding-3-small', status: 'succeeded' },
  ] })
  const l = pickModelLists('azure', raw)
  assert.deepEqual(l.text, [{ id: 'chat-main', model: 'gpt-6-luna' }])
  assert.deepEqual(ids(l.image), ['chat-main', 'old-chat'])
  assert.deepEqual(ids(l.embedding), ['emb'])
})

test('reading the version number', () => {
  assert.deepEqual(versionOf('openai', 'gpt-6.1-terra'), [6, 1])
  assert.deepEqual(versionOf('openai', 'gpt-5.4-2026-03-05'), [5, 4])
  assert.deepEqual(versionOf('claude', 'claude-opus-4-5-20251101'), [4, 5])
  assert.deepEqual(versionOf('claude', 'claude-opus-5'), [5])
  assert.deepEqual(versionOf('gemini', 'models/gemini-3.8-flash'), [3, 8])
  assert.deepEqual(versionOf('gemini', 'gemini-embedding-001'), [1])
})

test('services that give a model list - only four, own server and hosting give null', () => {
  assert.equal(modelProviderOf('openai_compatible', 'https://api.openai.com/v1'), 'openai')
  assert.equal(modelProviderOf('openai_compatible', 'https://generativelanguage.googleapis.com/v1beta/openai/'), 'gemini')
  assert.equal(modelProviderOf('anthropic', 'https://api.anthropic.com'), 'claude')
  assert.equal(modelProviderOf('azure', 'https://x.openai.azure.com'), 'azure')
  assert.equal(modelProviderOf('openai_compatible', 'http://ollama:11434/v1'), null)
  assert.equal(modelProviderOf('openai_compatible', 'https://maas.phoeniqs.com/v1'), null)
  assert.equal(modelProviderOf('anthropic', 'https://proxy.example.com'), null)
})

test('request - key only in headers, Gemini uses its base address, Azure uses the old version on the resource address', () => {
  const g = modelListRequest('gemini', 'https://generativelanguage.googleapis.com/v1beta/openai/', 'K')
  assert.equal(g.url, 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000')
  const a = modelListRequest('azure', 'https://res.openai.azure.com/openai/v1/', 'K')
  assert.equal(a.url, 'https://res.openai.azure.com/openai/deployments?api-version=2022-12-01')
  assert.equal(modelListRequest('claude', 'https://api.anthropic.com/v1', 'K').url, 'https://api.anthropic.com/v1/models?limit=1000')
  for (const p of ['openai', 'claude', 'gemini', 'azure'] as const) assert.ok(!modelListRequest(p, 'https://x.example.com/v1', 'SECRETKEY').url.includes('SECRETKEY'))
})

test('list failure - our own message, key-like text hidden', async () => {
  const fake = (status: number, body: string) => (async () => new Response(body, { status })) as unknown as typeof fetch
  await assert.rejects(fetchModelLists('openai', 'https://api.openai.com/v1', 'k', fake(401, '{}')), /did not accept the API key/)
  await assert.rejects(fetchModelLists('openai', 'https://api.openai.com/v1', 'k', fake(500, 'bad sk-abcdefghijklmnopqrstuvwxyz')), (e: Error) => e.message.includes('[hidden]') && !e.message.includes('abcdefghij'))
  await assert.rejects(fetchModelLists('openai', 'https://api.openai.com/v1', 'k', (async () => { throw new Error('ECONNREFUSED') }) as unknown as typeof fetch), /Could not reach/)
  const ok = await fetchModelLists('openai', 'https://api.openai.com/v1', 'k', fake(200, JSON.stringify({ data: [{ id: 'gpt-6-luna', created: 1780000000 }] })))
  assert.deepEqual(ids(ok.text), ['gpt-6-luna'])
})

test('R1 - two digits without a dot (gpt-35-turbo = 3.5) do not count as gpt-6 or later', () => {
  assert.deepEqual(versionOf('azure', 'gpt-35-turbo'), [3, 5])
  const l = pickModelLists('azure', [{ id: 'old35', model: 'gpt-35-turbo' }, { id: 'new', model: 'gpt-6-luna' }])
  assert.deepEqual(ids(l.text), ['new'])
})

test('R1 - Claude models marked as not reading images (false, supported:false) are left out of image choices', () => {
  const raw = parseModelList('claude', { data: [
    { id: 'claude-opus-5-5', created_at: '2026-10-01T00:00:00Z', capabilities: { image_input: false } },
    { id: 'claude-sonnet-5-5', created_at: '2026-09-01T00:00:00Z', capabilities: { image_input: { supported: false } } },
    { id: 'claude-haiku-5-5', created_at: '2026-08-01T00:00:00Z', capabilities: { image_input: { supported: true } } },
    { id: 'claude-opus-5-6', created_at: '2026-07-01T00:00:00Z', capabilities: { image_input: true } },
  ] })
  assert.deepEqual(ids(pickModelLists('claude', raw).image), ['claude-haiku-5-5', 'claude-opus-5-6'])
})

test('R1 - an unexpected response or no text model to choose is an error (falls back to typing the name)', async () => {
  const fake = (body: string) => (async () => new Response(body, { status: 200 })) as unknown as typeof fetch
  await assert.rejects(fetchModelLists('openai', 'https://api.openai.com/v1', 'k', fake('not json')), /no text models/)
  await assert.rejects(fetchModelLists('openai', 'https://api.openai.com/v1', 'k', fake('{"models":[]}')), /no text models/)
  await assert.rejects(fetchModelLists('openai', 'https://api.openai.com/v1', 'k', fake(JSON.stringify({ data: [{ id: 'gpt-4.1' }] }))), /no text models/)
})

test('R2 - only gpt-35 is 3.5, future two-digit versions (gpt-10, gemini-10) stay as they are', () => {
  assert.deepEqual(versionOf('openai', 'gpt-10-nova'), [10, 0])
  assert.deepEqual(versionOf('gemini', 'gemini-10-flash'), [10, 0])
  assert.deepEqual(versionOf('azure', 'gpt-35-turbo-16k'), [3, 5])
  assert.deepEqual(ids(pickModelLists('openai', [{ id: 'gpt-10-nova', model: 'gpt-10-nova' }]).text), ['gpt-10-nova'])
})

test('Infomaniak - text = Kimi K2.6+ and Qwen 3.5+ of 100B or more only, embedding = Qwen3 Embedding and BGE Gemma2 only (real list 2026-11-06)', () => {
  const raw = parseModelList('infomaniak', { data: ['bge_multilingual_gemma2', 'mini_lm_l12_v2', 'Qwen/Qwen3-Embedding-8B', 'mistralai/Ministral-3-14B-Instruct-2512', 'google/gemma-4-31B-it', 'moonshotai/Kimi-K2.6', 'mistralai/Mistral-Small-4-119B-2603', 'Qwen/Qwen3.5-397B-A17B-FP8', 'swiss-ai/Apertus-v1.5-70B', 'Qwen/Qwen3.8-27B-FP8', 'moonshotai/Kimi-K2.5', 'moonshotai/Kimi-K3', 'Qwen/Qwen4-480B-A35B'].map((id) => ({ id, created: null })) })
  const l = pickModelLists('infomaniak', raw)
  assert.deepEqual(ids(l.text).sort(), ['Qwen/Qwen3.5-397B-A17B-FP8', 'Qwen/Qwen4-480B-A35B', 'moonshotai/Kimi-K2.6', 'moonshotai/Kimi-K3'].sort())
  assert.deepEqual(ids(l.embedding).sort(), ['Qwen/Qwen3-Embedding-8B', 'bge_multilingual_gemma2'])
  assert.equal(modelProviderOf('openai_compatible', 'https://api.infomaniak.com/2/ai/113307/openai/v1'), 'infomaniak')
  assert.equal(modelListRequest('infomaniak', 'https://api.infomaniak.com/2/ai/113307/openai/v1/', 'K').url, 'https://api.infomaniak.com/2/ai/113307/openai/v1/models')
})

test('Claude - only the opus, sonnet and haiku families (other names such as fable are left out), newer versions (opus 6) join on their own', () => {
  const raw = parseModelList('claude', { data: ['claude-opus-6', 'claude-fable-5-5', 'claude-haiku-5-5', 'claude-sonnet-5-1'].map((id, i) => ({ id, created_at: `2026-1${i}-01T00:00:00Z` })) })
  assert.deepEqual(ids(pickModelLists('claude', raw).text).sort(), ['claude-haiku-5-5', 'claude-opus-6'])
})
