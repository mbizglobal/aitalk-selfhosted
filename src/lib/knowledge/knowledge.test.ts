import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { createAzureKnowledgeStore } from './azure'
import { attachSources, versionFromRagStatus, isCurrentGenerationChunk } from './sources'
import { getKnowledgeStore, tryGetKnowledgeStore, KnowledgeStoreUnavailable } from './index'

const gen = (fileId: string) => crypto.createHash('sha256').update(fileId).digest('hex').slice(0, 8)

function fakeClient() {
  const calls: string[] = []
  const client: any = {
    getSharedIndexName: () => 'managed-test',
    createStore: async (a: string) => { calls.push(`createStore:${a}`) },
    uploadFile: async (idx: string, buf: Buffer, name: string, mime: string, meta: any) => {
      calls.push(`upload:${idx}:${name}:${meta.agentId}:${meta.storageId}:${meta.ragSpace ?? 'none'}:${buf.length}`)
      return { fileId: 'f-1', status: 'completed', chunkCount: 3, textSize: 99, pageCount: 2 }
    },
    deleteChunksByKey: async (a: string, f: string, n: number) => { calls.push(`byKey:${a}:${f}:${n}`) },
    deleteFile: async (a: string, s: string) => { calls.push(`byFilter:${a}:${s}`) },
    deleteByAgent: async (a: string) => { calls.push(`agent:${a}`) },
    deleteByUser: async (u: string) => { calls.push(`user:${u}`) },
    search: async (a: string, q: string, k: number, opts: any) => {
      calls.push(`search:${a}:${k}:${JSON.stringify(opts ?? null)}`)
      return [
        { id: 'ag1_f-1_0', content: 'one', score: 2.5, metadata: { title: 'a.pdf', chunkIndex: 0, storageId: '11' } },
        { id: 'ag1_f-2_0', content: 'two', score: 1.5, metadata: { title: '', chunkIndex: 'x', storageId: '12' } },
        { id: 'ag1_f-9_0', content: 'three', score: 1, metadata: { title: 'stray', chunkIndex: 1, storageId: '99' } },
        { id: 'ag1_f-0_3', content: 'old', score: 0.5, metadata: { title: 'a.pdf', chunkIndex: 3, storageId: '11' } },
      ]
    },
    listChunks: async (a: string, opts: any) => { calls.push(`list:${a}:${JSON.stringify(opts)}`); return [] },
  }
  return { client, calls }
}

test('put: uploadFile once (index preparation happens inside it), returns key + fingerprint', async () => {
  const { client, calls } = fakeClient()
  const s = createAzureKnowledgeStore({} as any, client)
  const bytes = Buffer.from('hello world')
  const r = await s.ingest({ agentId: 'ag1' }, { userId: 'u1', storageId: 11, fileName: 'a.txt', file: new Blob([bytes]), ragSpace: '' })
  assert.deepEqual(calls, ['upload:managed-test:a.txt:ag1:11::11'])
  assert.deepEqual(r.providerRef, { indexName: 'managed-test', fileId: 'f-1', chunkCount: 3, contentHash: crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16) })
  assert.equal(r.pageCount, 2)
  assert.equal(r.textSize, 99)
  await assert.rejects(s.ingest({ agentId: '' }, { userId: 'u1', storageId: 1, fileName: 'x', file: bytes }), /agentId/)
})

test('delete: key first if there is a key, by document number only otherwise', async () => {
  const { client, calls } = fakeClient()
  const s = createAzureKnowledgeStore({} as any, client)
  const steps: string[] = []
  await s.deleteDoc({ agentId: 'ag1' }, '11', { fileId: 'f-1', chunkCount: 3 }, { onStep: (x) => steps.push(x) })
  await s.deleteDoc({ agentId: 'ag1' }, '12', null)
  await s.deleteDoc({ agentId: 'ag1' }, '13', { fileId: 'f-2', chunkCount: 0 })
  assert.deepEqual(calls, ['byKey:ag1:f-1:3', 'byFilter:ag1:11', 'byFilter:ag1:12', 'byFilter:ag1:13'])
  assert.deepEqual(steps, ['chunks-by-key', 'chunks-by-filter'])
  await assert.rejects(s.deleteUser(''), /userId/)
})

test('search: passes space options as is, attaches source and edition (does not attach another agent\'s Storage)', async () => {
  const { client, calls } = fakeClient()
  const rows = [
    { id: 11, title: 'a.pdf', ragStatus: JSON.stringify({ azure_ai_search: { fileId: 'f-1', contentHash: 'abcdef0123456789', chunkCount: 3 } }) },
    { id: 12, title: 'b.txt', ragStatus: JSON.stringify({ azure_ai_search: { fileId: 'f-2', chunkCount: 1 } }) },
  ]
  const lookups: any[] = []
  const lookup = async (agentId: string, ids: number[]) => { lookups.push([agentId, ids]); return rows.filter((r) => ids.includes(r.id)) }
  const s = createAzureKnowledgeStore({} as any, client, lookup)
  const hits = await s.search({ agentId: 'ag1', ragSpace: { id: '6', includeNull: false } }, 'q', 5)
  assert.deepEqual(calls, ['search:ag1:5:{"ragSpace":"6","includeNullSpace":false}'])
  assert.deepEqual(lookups, [['ag1', [11, 12, 99]]])
  assert.deepEqual(hits.map((h) => [h.id, h.score, h.source.storageId, h.source.title, h.source.chunkIndex, h.source.version]), [
    ['ag1_f-1_0', 2.5, '11', 'a.pdf', 0, `abcdef0123456789:${gen('f-1')}`],
    ['ag1_f-2_0', 1.5, '12', 'b.txt', null, `-:${gen('f-2')}`],
    ['ag1_f-9_0', 1, '99', 'stray', 1, null],
    ['ag1_f-0_3', 0.5, '11', 'a.pdf', 3, null],
  ])
  calls.length = 0
  await s.search({ agentId: 'ag1' }, 'q', 3)
  assert.deepEqual(calls, ['search:ag1:3:null'])
})

test('search: chunks come back as is even if the lookup fails', async () => {
  const hits = [{ id: 'ag1_f_0', content: 'x', score: 1, source: { storageId: '11', title: 't', chunkIndex: 0, version: null } }]
  const out = await attachSources('ag1', hits, async () => { throw new Error('db down') })
  assert.deepEqual(out, hits)
  assert.deepEqual(await attachSources('ag1', [], async () => { throw new Error('not called') }), [])
})

test('edition: per ragStatus shape, filename is not included', () => {
  assert.equal(versionFromRagStatus(null), null)
  assert.equal(versionFromRagStatus('not json'), null)
  assert.equal(versionFromRagStatus(JSON.stringify({ azure_ai_search: { status: 'failed' } })), null)
  assert.equal(versionFromRagStatus(JSON.stringify({ azure_ai_search: { fileId: 'f', contentHash: '' } })), `-:${gen('f')}`)
  assert.equal(versionFromRagStatus(JSON.stringify({ azure_ai_search: { fileId: 'f', contentHash: 'salary_report' } })), `-:${gen('f')}`, '지문 모양이 아니면 버린다')
  const v = versionFromRagStatus(JSON.stringify({ azure_ai_search: { fileId: 'Salary_Report_2026_pdf_mr0t0761', contentHash: '0123456789abcdef' } }))
  assert.equal(v, `0123456789abcdef:${gen('Salary_Report_2026_pdf_mr0t0761')}`)
  assert.ok(!/salary/i.test(v!), '파일명이 판에 새지 않는다')
})

test('selection: selfhosted = pgvector (region-independent), cloud with no region = unusable (the try edition is null)', async () => {
  const prev = process.env.AITALK_EDITION
  try {
    process.env.AITALK_EDITION = 'selfhosted'
    assert.equal((await getKnowledgeStore({ regionId: 'switzerlandnorth', allowSelfHosted: true })).provider, 'pgvector')
    assert.equal((await getKnowledgeStore({ regionId: null, allowSelfHosted: true })).provider, 'pgvector')
    await assert.rejects(getKnowledgeStore({ regionId: 'switzerlandnorth' }), KnowledgeStoreUnavailable)
    assert.equal(await tryGetKnowledgeStore({ regionId: 'switzerlandnorth' }), null)
    delete process.env.AITALK_EDITION
    await assert.rejects(getKnowledgeStore({ regionId: '' }), (e: any) => e instanceof KnowledgeStoreUnavailable && e.code === 'AZURE_SEARCH_NOT_CONFIGURED')
    assert.equal(await tryGetKnowledgeStore({ regionId: null }), null)
  } finally {
    if (prev === undefined) delete process.env.AITALK_EDITION
    else process.env.AITALK_EDITION = prev
  }
})

test('generation check: down to the agent prefix of the chunk id (15 characters, leading _ replaced) per the actual rule', () => {
  const rs = JSON.stringify({ azure_ai_search: { fileId: 'doc_txt_mr0t0761' } })
  assert.equal(isCurrentGenerationChunk('Wc3AzysPtdNuSN_NTXW6', 'Wc3AzysPtdNuSN__doc_txt_mr0t0761_4', rs), true)
  assert.equal(isCurrentGenerationChunk('Wc3AzysPtdNuSN_NTXW6', 'Wc3AzysPtdNuSN__doc_txt_mr0t0700_4', rs), false)
  assert.equal(isCurrentGenerationChunk('_abc', '-abc_doc_txt_mr0t0761_0', rs), true)
  assert.equal(isCurrentGenerationChunk('ag1', 'ag1_doc_txt_mr0t0761_0', null), false)
})

test('source log: a non-numeric storageId (document name) is not logged', async () => {
  const logs: string[] = []
  const orig = console.log
  console.log = (...a: unknown[]) => { logs.push(a.join(' ')) }
  try {
    await attachSources('ag1', [
      { id: 'ag1_x_0', content: 'c', score: 1, source: { storageId: 'Salary_Report_2026.txt', title: 'Salary_Report_2026.txt', chunkIndex: 0, version: null } },
      { id: 'ag1_f_0', content: 'c', score: 1, source: { storageId: '11', title: 't', chunkIndex: 0, version: null } },
    ], async () => [])
  } finally { console.log = orig }
  const line = logs.find((l) => l.startsWith('[Knowledge] sources')) ?? ''
  assert.match(line, /used=\?@\?,11@\?/)
  assert.ok(!/salary/i.test(line), line)
})
