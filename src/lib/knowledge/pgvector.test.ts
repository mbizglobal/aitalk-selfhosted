import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { AzureAISearchClient } from '@/lib/rag-providers/clients/azure-ai-search'
import { chunkText } from './chunk'
import { assertEmbeddings, embedderFromConnection, pickEmbeddingChoice, KnowledgeEmbeddingUnavailable } from './embedding'
import { extractKnowledgeText, KnowledgeExtractError } from './extract'
import { isCurrentGenerationChunk, versionFromRagStatus } from './sources'
import { pgvectorChunkId } from './pgvector'
import { knowledgeTargetFor } from './index'

const azure = new AzureAISearchClient({ searchApiKey: 'k', searchEndpoint: 'https://x', openaiApiKey: 'k', openaiEndpoint: 'https://y', openaiApiVersion: 'v', regionId: 'r' } as any)
const azureChunk = (t: string): string[] => (azure as any).chunkText(t)

test('splitting: same result as Azure (title, divider, long paragraph, long sentence, empty text)', () => {
  const para = (n: number) => Array.from({ length: n }, (_, i) => `Sentence number ${i} talks about opening hours and prices.`).join(' ')
  const samples = [
    '',
    'short text',
    `# Title\n\nIntro paragraph.\n\n## Section A\n\n${para(20)}\n\n---\n\n## Section B\n\n${para(60)}`,
    `${para(10)}\n\n${para(10)}\n\n${para(10)}\n\n${para(80)}`,
    'x'.repeat(7000),
    `Öffnungszeiten: Mo–Fr 9–18 Uhr。${'가'.repeat(2500)}！ ${para(5)}`,
    Array.from({ length: 200 }, (_, i) => `### Q${i}\nAnswer ${i}.`).join('\n'),
  ]
  for (const s of samples) assert.deepEqual(chunkText(s), azureChunk(s), s.slice(0, 40))
  assert.notDeepEqual(chunkText(samples[3]).slice(1), azureChunk(samples[3]))
})

test('choosing the embedding connection: default first, only one, none, several', async () => {
  const db = (rows: Array<{ id: string; isDefault: boolean; embeddingModel: string | null }>) => ({ aiConnection: { findMany: async () => rows } })
  assert.deepEqual(await pickEmbeddingChoice(db([{ id: 'a', isDefault: false, embeddingModel: 'm-a' }, { id: 'b', isDefault: true, embeddingModel: ' m-b ' }])), { connectionId: 'b', embeddingModel: 'm-b' })
  assert.deepEqual(await pickEmbeddingChoice(db([{ id: 'a', isDefault: false, embeddingModel: 'm-a' }])), { connectionId: 'a', embeddingModel: 'm-a' })
  await assert.rejects(pickEmbeddingChoice(db([])), KnowledgeEmbeddingUnavailable)
  await assert.rejects(pickEmbeddingChoice(db([{ id: 'a', isDefault: false, embeddingModel: 'm' }, { id: 'c', isDefault: false, embeddingModel: 'm' }])), /several/)
  await assert.rejects(pickEmbeddingChoice(db([{ id: 'a', isDefault: true, embeddingModel: '  ' }])), KnowledgeEmbeddingUnavailable)
})

test('embedding: empty, wrong count, wrong length, non-number = failure, order by index', async () => {
  assert.throws(() => assertEmbeddings([], 1))
  assert.throws(() => assertEmbeddings([[]], 1), /empty/)
  assert.throws(() => assertEmbeddings([[1, 2], [1]], 2), /malformed/)
  assert.throws(() => assertEmbeddings([[1, Number.NaN]], 1), /malformed/)
  assert.throws(() => assertEmbeddings([[1, '2']], 1), /malformed/)
  assert.deepEqual(assertEmbeddings([[1, 2]], 1), [[1, 2]])
  const calls: any[] = []
  const client: any = { embeddings: { create: async (req: any) => { calls.push(req); return { data: req.input.map((_: string, i: number) => ({ index: i, embedding: [i, 1] })).reverse() } } } }
  const e = embedderFromConnection({ kind: 'openai_compatible' } as any, 'emb', client)
  const texts = Array.from({ length: 20 }, (_, i) => `t${i}`)
  const out = await e.embed(texts)
  assert.equal(calls.length, 2, '16 개씩')
  assert.deepEqual(out.map((v) => v[0]), [...Array.from({ length: 16 }, (_, i) => i), 0, 1, 2, 3])
  assert.throws(() => embedderFromConnection({ kind: 'anthropic' } as any, 'x', client), KnowledgeEmbeddingUnavailable)
})

test('extraction: text, md (even with empty format), Word stops, photo goes to the image model, empty text stops', async () => {
  const reason = (p: Promise<unknown>) => p.then(() => 'ok', (e) => e instanceof KnowledgeExtractError ? e.reason : `other:${e}`)
  assert.equal((await extractKnowledgeText(Buffer.from('Hello\n\nWorld'), 'a.txt', 'text/plain', null)).text, 'Hello\n\nWorld')
  assert.equal((await extractKnowledgeText(Buffer.from('# T\nbody'), 'notes.md', '', null)).text, '# T\nbody')
  assert.equal(await reason(extractKnowledgeText(Buffer.from('PK...'), 'a.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', null)), 'unsupported_type')
  assert.equal(await reason(extractKnowledgeText(Buffer.from('bin'), 'a.zip', 'application/zip', null)), 'unsupported_type')
  assert.equal(await reason(extractKnowledgeText(Buffer.from('   \n'), 'a.txt', 'text/plain', null)), 'empty_text')
  assert.equal(await reason(extractKnowledgeText(Buffer.from([1, 2, 3]), 'p.png', 'image/png', null)), 'no_image_model')
  const seen: any[] = []
  const r = await extractKnowledgeText(Buffer.from([1, 2, 3]), 'p.png', 'image/png', async (imgs, label) => { seen.push({ imgs, label }); return { text: 'Menu: pizza 12 CHF', truncated: false } })
  assert.equal(r.text, 'Menu: pizza 12 CHF')
  assert.equal(seen[0].imgs[0].mime, 'image/png')
  assert.equal(await reason(extractKnowledgeText(Buffer.from([1]), 'p.jpg', '', async () => ({ text: '', truncated: false }))), 'empty_text', '받아쓰기가 빈 글이면 멈춤')
  assert.equal(await reason(extractKnowledgeText(Buffer.from([1]), 'p.jpg', '', async () => { throw Object.assign(new Error('x'), { code: 'NO_IMAGE_MODEL' }) })), 'no_image_model')
  assert.equal(await reason(extractKnowledgeText(Buffer.alloc(21 * 1024 * 1024), 'big.txt', 'text/plain', null)), 'too_large')
  assert.equal(await reason(extractKnowledgeText(Buffer.from('a'.repeat(5_000_001)), 'long.txt', 'text/plain', null)), 'truncated')
  assert.equal(await reason(extractKnowledgeText(Buffer.from('a'.repeat(5_000_000)), 'exact.txt', 'text/plain', null)), 'ok', '딱 상한 = 통과')
  assert.equal(await reason(extractKnowledgeText(Buffer.from([1]), 'p.png', 'image/png', async () => ({ text: 'half', truncated: true }))), 'truncated')
})

test('edition and current generation: pgvector chunk id (<document>_<ingestId>_<generation>_<n>)', () => {
  const ingest = 'a'.repeat(32)
  const rs = JSON.stringify({ pgvector: { generationId: 3, ingestId: ingest, chunkCount: 2, contentHash: '0123456789abcdef' } })
  assert.equal(versionFromRagStatus(rs), `0123456789abcdef:${crypto.createHash('sha256').update(ingest).digest('hex').slice(0, 8)}`)
  assert.equal(isCurrentGenerationChunk('ag', pgvectorChunkId(11, ingest, 3, 0), rs, '11'), true)
  assert.equal(isCurrentGenerationChunk('ag', pgvectorChunkId(11, ingest, 4, 5), rs, '11'), true, '다시 넣는 중인 세대의 조각도 같은 판')
  assert.equal(isCurrentGenerationChunk('ag', pgvectorChunkId(11, 'b'.repeat(32), 3, 0), rs, '11'), false, '앞선 넣기의 잔재')
  assert.equal(isCurrentGenerationChunk('ag', pgvectorChunkId(12, ingest, 3, 0), rs, '11'), false, '다른 문서 번호')
  assert.equal(isCurrentGenerationChunk('ag', pgvectorChunkId(11, ingest, 3, 0), rs, null), false)
})

test('edition selection: cloud = Azure only for Managed regions, selfhosted = pgvector regardless of subscription', () => {
  const prev = process.env.AITALK_EDITION
  try {
    delete process.env.AITALK_EDITION
    assert.deepEqual(knowledgeTargetFor({ serviceVariant: 'managed', managedRegion: 'switzerlandnorth' }), { provider: 'azure_ai_search', regionId: 'switzerlandnorth' })
    assert.equal(knowledgeTargetFor({ serviceVariant: 'managed', managedRegion: null }), null)
    assert.equal(knowledgeTargetFor({ serviceVariant: 'self', managedRegion: 'x' }), null)
    assert.equal(knowledgeTargetFor(null), null)
    process.env.AITALK_EDITION = 'selfhosted'
    assert.deepEqual(knowledgeTargetFor(null), { provider: 'pgvector', regionId: 'local' })
    assert.deepEqual(knowledgeTargetFor({ serviceVariant: 'managed', managedRegion: 'switzerlandnorth' }), { provider: 'pgvector', regionId: 'local' })
  } finally {
    if (prev === undefined) delete process.env.AITALK_EDITION
    else process.env.AITALK_EDITION = prev
  }
})
