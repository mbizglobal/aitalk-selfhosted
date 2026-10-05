import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { createHttpSearchKnowledgeStore, HttpSearchError, MAX_RESPONSE_BYTES, validateHttpSearchUrl } from './http'
import { getKnowledgeStore, knowledgeTargetFor, selfHostedKnowledgeKind, KnowledgeStoreUnavailable } from './index'

type Handler = (req: { headers: http.IncomingHttpHeaders; body: any; method?: string; url?: string }, res: http.ServerResponse) => void

async function withServer(handler: Handler, fn: (url: string, calls: any[]) => Promise<void>) {
  const calls: any[] = []
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      let body: any = null
      try { body = JSON.parse(raw) } catch { body = raw }
      const r = { headers: req.headers, body, method: req.method, url: req.url }
      calls.push(r)
      handler(r, res)
    })
  })
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/search`
  try { await fn(url, calls) } finally { server.closeAllConnections(); await new Promise((ok) => server.close(ok)) }
}

const json = (res: http.ServerResponse, status: number, body: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }

test('request shape, response to chunks, descending score, topK', async () => {
  await withServer((req, res) => json(res, 200, { results: [
    { content: 'Saturday 09:00-13:00', score: 0.4, source: { id: 'doc-7', title: 'Hours', version: 'v3', chunkIndex: 2, url: 'https://intranet/doc-7' } },
    { content: 'Sunday closed', score: 0.9, source: { id: 'doc-8', title: 'Hours' } },
    { content: 'extra', score: 0.1, source: { id: 'doc-9' } },
  ] }), async (url, calls) => {
    const store = createHttpSearchKnowledgeStore({ url, secret: 's3cret', installId: 'firma-1' })
    assert.equal(store.provider, 'http_search')
    const logs: string[] = []
    const orig = console.log
    console.log = (...a: unknown[]) => { logs.push(a.join(' ')) }
    let hits
    try { hits = await store.search({ agentId: 'ag1', ragSpace: { id: '5', includeNull: true } }, 'open saturday?', 2) } finally { console.log = orig }
    const c = calls[0]
    assert.equal(c.method, 'POST')
    assert.equal(c.headers.authorization, 'Bearer s3cret')
    assert.deepEqual(c.body, { version: 1, query: 'open saturday?', topK: 2, scope: { installId: 'firma-1', agentId: 'ag1', ragSpace: { id: '5', includeDefault: true } } })
    assert.equal(hits.length, 2, 'topK 까지만')
    assert.deepEqual(hits.map((h) => h.score), [0.9, 0.4], '점수 내림차순')
    const h = hits.find((x) => x.source.external?.id === 'doc-7')!
    assert.deepEqual(h.source, { storageId: null, title: 'Hours', chunkIndex: 2, version: 'v3', external: { id: 'doc-7', url: 'https://intranet/doc-7' } })
    const line = logs.find((l) => l.startsWith('[Knowledge] sources')) ?? ''
    assert.match(line, /external=2 versioned=1/)
    assert.ok(!/doc-7|Hours/.test(line), '고객 문서 id · 제목은 로그에 안 싣는다')
  })
})

test('no empty success: throws if the shape is wrong, only results: [] is 0 items', async () => {
  const cases: Array<[unknown, RegExp | null]> = [
    [{ results: [] }, null],
    [{}, /results is not an array/],
    [{ results: [{ content: '', score: 1, source: { id: 'a' } }] }, /content missing/],
    [{ results: [{ content: 'x', score: '1', source: { id: 'a' } }] }, /score is not a number/],
    [{ results: [{ content: 'x', score: 1, source: {} }] }, /source.id missing/],
    [{ results: [{ content: 'x', score: Number.NaN, source: { id: 'a' } }] }, /score is not a number/],
  ]
  for (const [body, err] of cases) {
    await withServer((_r, res) => json(res, 200, body), async (url) => {
      const p = createHttpSearchKnowledgeStore({ url, secret: 's', installId: 'i' }).search({ agentId: 'a' }, 'q', 5)
      if (err) await assert.rejects(p, err)
      else assert.deepEqual(await p, [])
    })
  }
  await withServer((_r, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>login</html>') }, async (url) => {
    await assert.rejects(createHttpSearchKnowledgeStore({ url, secret: 's', installId: 'i' }).search({ agentId: 'a' }, 'q', 5), /results is not an array/)
  })
})

test('error status: only the status and shape-checked code, the customer server\'s text is not included', async () => {
  await withServer((_r, res) => json(res, 401, { error: { code: 'bad_secret', message: 'secret for firma-1 is wrong: s3cret' } }), async (url) => {
    const e = await createHttpSearchKnowledgeStore({ url, secret: 's', installId: 'i' }).search({ agentId: 'a' }, 'q', 5).then(() => null, (x) => x)
    assert.ok(e instanceof HttpSearchError && e.status === 401 && e.code === 'bad_secret')
    assert.ok(!/s3cret|firma/.test(e.message), e.message)
  })
  await withServer((_r, res) => json(res, 500, { error: { code: 'x y <script>' } }), async (url) => {
    const e = await createHttpSearchKnowledgeStore({ url, secret: 's', installId: 'i' }).search({ agentId: 'a' }, 'q', 5).then(() => null, (x) => x)
    assert.ok(e instanceof HttpSearchError && e.status === 500 && e.code === undefined, '모양이 틀린 코드는 버린다')
  })
})

test('timeout, does not follow to another address, no retry, unreachable', async () => {
  await withServer(() => { }, async (url, calls) => {
    const e = await createHttpSearchKnowledgeStore({ url, secret: 's', installId: 'i', timeoutMs: 200 }).search({ agentId: 'a' }, 'q', 5).then(() => null, (x) => x)
    assert.ok(e instanceof HttpSearchError && e.code === 'timeout', String(e))
    assert.equal(calls.length, 1, '재시도 없음')
  })
  await withServer((r, res) => {
    if (r.url === '/elsewhere') return json(res, 200, { results: [{ content: 'leaked', score: 1, source: { id: 'x' } }] })
    res.writeHead(307, { Location: '/elsewhere' }); res.end()
  }, async (url, calls) => {
    const e = await createHttpSearchKnowledgeStore({ url, secret: 's', installId: 'i' }).search({ agentId: 'a' }, 'q', 5).then(() => null, (x) => x)
    assert.ok(e instanceof HttpSearchError && e.code === 'unreachable', String(e))
    assert.equal(calls.length, 1, '비밀이 다른 길로 가지 않았다')
  })
})

test('put stops, delete has nothing to do, list is empty, count 0, agentId required, address check', async () => {
  await withServer((_r, res) => json(res, 200, { results: [] }), async (url, calls) => {
    const store = createHttpSearchKnowledgeStore({ url, secret: 's', installId: 'i' })
    await assert.rejects(store.ingest({ agentId: 'a' }, { userId: 'u', storageId: 1, fileName: 'a.txt', file: Buffer.from('x') }), (e: any) => e.code === 'KNOWLEDGE_EXTERNAL')
    await store.deleteDoc({ agentId: 'a' }, '1')
    await store.deleteAgent('a')
    await store.deleteUser('u')
    assert.deepEqual(await store.listChunks({ agentId: 'a' }), [])
    assert.deepEqual(await store.search({ agentId: 'a' }, 'q', 0), [])
    await assert.rejects(store.search({ agentId: '' }, 'q', 5), /agentId/)
    assert.equal(calls.length, 0, '부르지 않았다')
  })
  for (const bad of ['ftp://x/search', 'https://user:pw@x/search', 'https://x/search#k', 'not a url']) assert.throws(() => validateHttpSearchUrl(bad), HttpSearchError, bad)
  assert.throws(() => createHttpSearchKnowledgeStore({ url: 'https://x/search', secret: '', installId: 'i' }), /SECRET/)
})

test('install setting: empty means pgvector, http, unknown value throws, http without address/secret means "none" (does not fall to pgvector)', async () => {
  assert.equal(selfHostedKnowledgeKind({}), 'pgvector')
  assert.equal(selfHostedKnowledgeKind({ KNOWLEDGE_STORE: ' PGVECTOR ' }), 'pgvector')
  assert.equal(selfHostedKnowledgeKind({ KNOWLEDGE_STORE: 'http', KNOWLEDGE_HTTP_URL: 'https://x/s', KNOWLEDGE_HTTP_SECRET: 'k' }), 'http_search')
  assert.throws(() => selfHostedKnowledgeKind({ KNOWLEDGE_STORE: 'http', KNOWLEDGE_HTTP_URL: 'https://x/s' }), KnowledgeStoreUnavailable)
  assert.throws(() => selfHostedKnowledgeKind({ KNOWLEDGE_STORE: 'elastic' }), KnowledgeStoreUnavailable)
  const keys = ['AITALK_EDITION', 'KNOWLEDGE_STORE', 'KNOWLEDGE_HTTP_URL', 'KNOWLEDGE_HTTP_SECRET'] as const
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]))
  try {
    process.env.AITALK_EDITION = 'selfhosted'
    process.env.KNOWLEDGE_STORE = 'http'
    delete process.env.KNOWLEDGE_HTTP_URL
    delete process.env.KNOWLEDGE_HTTP_SECRET
    await assert.rejects(getKnowledgeStore({ allowSelfHosted: true }), KnowledgeStoreUnavailable)
    assert.throws(() => knowledgeTargetFor(null), KnowledgeStoreUnavailable)
    process.env.KNOWLEDGE_HTTP_URL = 'http://127.0.0.1:9/search'
    process.env.KNOWLEDGE_HTTP_SECRET = '   '
    assert.throws(() => knowledgeTargetFor(null), KnowledgeStoreUnavailable, '공백만 = 없음')
    process.env.KNOWLEDGE_HTTP_SECRET = 'x'
    assert.deepEqual(knowledgeTargetFor(null), { provider: 'http_search', regionId: 'local' })
    assert.equal((await getKnowledgeStore({ allowSelfHosted: true })).provider, 'http_search')
    await assert.rejects(getKnowledgeStore({ regionId: 'x' }), KnowledgeStoreUnavailable, '안 연 자리는 그대로 「없음」')
    delete process.env.AITALK_EDITION
    assert.equal(knowledgeTargetFor(null), null, 'cloud 는 이 설정을 안 본다')
  } finally {
    for (const k of keys) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k] }
  }
})

test('sorts first and then cuts, so closer results further back are not discarded', async () => {
  await withServer((_r, res) => json(res, 200, { results: [
    { content: 'a', score: 0.1, source: { id: 'a' } }, { content: 'b', score: 0.2, source: { id: 'b' } }, { content: 'c', score: 0.99, source: { id: 'c' } },
  ] }), async (url) => {
    const hits = await createHttpSearchKnowledgeStore({ url, secret: 's', installId: 'i' }).search({ agentId: 'a' }, 'q', 1)
    assert.deepEqual(hits.map((h) => h.source.external?.id), ['c'])
  })
})

test('huge response: cut off while receiving (both length header and streaming), cap on result count', async () => {
  const big = 'x'.repeat(MAX_RESPONSE_BYTES + 10)
  await withServer((_r, res) => json(res, 200, { results: [{ content: big, score: 1, source: { id: 'a' } }] }), async (url) => {
    await assert.rejects(createHttpSearchKnowledgeStore({ url, secret: 's', installId: 'i' }).search({ agentId: 'a' }, 'q', 5), (e: any) => e.code === 'too_large')
  })
  await withServer((_r, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    const chunk = 'x'.repeat(1024 * 1024)
    let n = 0
    const push = () => { if (n++ < 8 && !res.destroyed) { res.write(chunk); setTimeout(push, 5) } else res.end() }
    res.write('{"results":[{"content":"'); push()
  }, async (url) => {
    await assert.rejects(createHttpSearchKnowledgeStore({ url, secret: 's', installId: 'i' }).search({ agentId: 'a' }, 'q', 5), (e: any) => e.code === 'too_large')
  })
  await withServer((_r, res) => json(res, 200, { results: Array.from({ length: 201 }, (_, i) => ({ content: 'c', score: 1, source: { id: String(i) } })) }), async (url) => {
    await assert.rejects(createHttpSearchKnowledgeStore({ url, secret: 's', installId: 'i' }).search({ agentId: 'a' }, 'q', 5), /too many results/)
  })
})

test('source address, chunk number, whitespace-only values', async () => {
  await withServer((_r, res) => json(res, 200, { results: [
    { content: 'a', score: 0.5, source: { id: 'a', url: 'https://user:pw@intranet/a' } },
    { content: 'b', score: 0.4, source: { id: 'b', url: 'javascript:alert(1)' } },
    { content: 'c', score: 0.3, source: { id: 'c', url: 'https://intranet/c' } },
  ] }), async (url) => {
    const hits = await createHttpSearchKnowledgeStore({ url, secret: 's', installId: 'i' }).search({ agentId: 'a' }, 'q', 5)
    assert.deepEqual(hits.map((h) => h.source.external?.url ?? null), [null, null, 'https://intranet/c'], '사용자 정보 · http(s) 아님 = 버림')
  })
  for (const bad of [-1, 1.5, '0']) {
    await withServer((_r, res) => json(res, 200, { results: [{ content: 'a', score: 1, source: { id: 'a', chunkIndex: bad } }] }), async (url) => {
      await assert.rejects(createHttpSearchKnowledgeStore({ url, secret: 's', installId: 'i' }).search({ agentId: 'a' }, 'q', 5), /chunkIndex/, String(bad))
    })
  }
  await withServer((_r, res) => json(res, 200, { results: [] }), async (url, calls) => {
    await assert.rejects(createHttpSearchKnowledgeStore({ url, secret: 's', installId: 'i' }).search({ agentId: '  ' }, 'q', 5), /agentId/)
    assert.equal(calls.length, 0)
  })
  assert.throws(() => createHttpSearchKnowledgeStore({ url: 'https://x/search', secret: '   ', installId: 'i' }), /SECRET/)
})
