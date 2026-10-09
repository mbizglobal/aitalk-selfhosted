
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import '@/lib/agent-lock-test-no-db'
import { WorkflowEngine } from './engine'
import { redactCredentials, REDACTED, TRUNCATED, GETTER_FAILED } from './debug-redact'

const SEARCH_KEY = 'PLATFORM-SEARCH-ADMIN-KEY'
const OPENAI_KEY = 'PLATFORM-OPENAI-KEY'

const n = (id: string, nodeType: string, data: Record<string, unknown> = {}) =>
  ({ id, type: 'custom', data: { nodeType, label: id, ...data }, position: { x: 0, y: 0 } }) as any

const ctxWithSecrets = () => ({
  message: '안녕하세요',
  agentId: 'agent_1',
  userId: 'user_1',
  azureSearchConfig: {
    searchApiKey: SEARCH_KEY,
    openaiApiKey: OPENAI_KEY,
    regionId: 'switzerlandnorth',
    indexName: 'managed-switzerlandnorth',
  },
  pineconeApiKey: 'CUSTOMER-PINECONE-KEY',
}) as any

const poc = () => ({
  nodes: [n('start', 'start'), n('loop', 'while', { maxIterations: 1 })],
  edges: [{ id: 'e1', source: 'start', target: 'loop' }],
})

async function streamText(res: any): Promise<string> {
  if (!res) return ''
  return await new Response(res.body ?? res).text()
}

describe('#1: debug-log credential leak', () => {
  it('(1) gate: without debugEnabled no debug event goes into the stream', async () => {
    const result: any = await new WorkflowEngine().execute(poc() as never, ctxWithSecrets())
    const body = await streamText(result.streamResponse)

    assert.equal(body.includes('debug-log'), false, 'debug-log 이벤트가 나갔다 — 위젯 방문자도 받는다')
    assert.equal(body.includes(SEARCH_KEY), false, '스트림 본문에 Azure admin 키가 있다')
    assert.equal(body.includes(OPENAI_KEY), false, '스트림 본문에 OpenAI 키가 있다')
  })

  it('(2) masking: even with debugEnabled, credentials are [REDACTED]', async () => {
    const result: any = await new WorkflowEngine().execute(poc() as never, ctxWithSecrets(), {
      debugEnabled: true,
    } as any)

    const serialized = JSON.stringify(result.debugLogs)
    assert.equal(serialized.includes(SEARCH_KEY), false, `debugLogs 에 admin 키가 남았다: ${serialized.slice(0, 300)}`)
    assert.equal(serialized.includes(OPENAI_KEY), false, 'debugLogs 에 OpenAI 키가 남았다')

    const body = await streamText(result.streamResponse)
    assert.ok(body.includes('debug-log'), 'Test 경로인데 debug-log 가 안 나갔다 — 게이트가 과하게 막았다')
    assert.equal(body.includes(SEARCH_KEY), false, '스트림 본문에 admin 키가 있다')
  })

  it('(2) debugging value: non-secret values are kept', async () => {
    const result: any = await new WorkflowEngine().execute(poc() as never, ctxWithSecrets(), {
      debugEnabled: true,
    } as any)

    const serialized = JSON.stringify(result.debugLogs)
    assert.ok(serialized.includes('안녕하세요'), '사용자 메시지까지 사라지면 Steps 뷰가 쓸모없다')
  })
})

describe('redactCredentials: masking function contract', () => {
  it('masks credential fields at any depth', () => {
    const out: any = redactCredentials({
      a: { b: { c: { azureSearchConfig: { searchApiKey: SEARCH_KEY } } } },
      list: [{ pineconeApiKey: 'K' }],
    })
    assert.equal(out.a.b.c.azureSearchConfig, REDACTED)
    assert.equal(out.list[0].pineconeApiKey, REDACTED)
  })

  it('does not mutate the original; the log object is the same reference as the running context', () => {
    const ctx = ctxWithSecrets()
    const out: any = redactCredentials({ context: ctx })
    assert.equal(out.context.azureSearchConfig, REDACTED)
    assert.equal(ctx.azureSearchConfig.searchApiKey, SEARCH_KEY, '원본 context 가 훼손됐다')
  })

  it('returns the original reference when nothing changed (zero copy cost)', () => {
    const clean = { message: 'hi', jsonData: { rows: [1, 2, 3] } }
    assert.equal(redactCredentials(clean), clean)
  })

  it('🔴 also masks the second appearance of a shared reference (DAG); alias leak regression', () => {
    const shared = { azureSearchConfig: { searchApiKey: SEARCH_KEY } }
    const out: any = redactCredentials({ first: shared, second: shared })
    assert.equal(out.first.azureSearchConfig, REDACTED)
    assert.equal(out.second.azureSearchConfig, REDACTED, '둘째 등장이 원본 그대로 나갔다')
    assert.equal(JSON.stringify(out).includes(SEARCH_KEY), false)
  })

  it('🔴 truncates beyond the depth limit; returning the original would leak what is below (regression)', () => {
    let deep: any = { azureSearchConfig: { searchApiKey: SEARCH_KEY } }
    for (let i = 0; i < 40; i++) deep = { n: deep }
    const out = redactCredentials(deep)
    assert.equal(JSON.stringify(out).includes(SEARCH_KEY), false, '깊이 상한 아래 시크릿이 샜다')
    assert.ok(JSON.stringify(out).includes(TRUNCATED), '잘렸다는 표식이 없다')
  })

  it('aliases are preserved after sanitizing (same original gives same sanitized copy)', () => {
    const shared = { v: 1 }
    const out: any = redactCredentials({ a: shared, b: shared, secret: { azureSearchConfig: {} } })
    assert.equal(out.a, out.b, '별칭이 서로 다른 객체로 복제됐다')
  })

  it('does not blow up on circular references', () => {
    const a: any = { name: 'a', azureSearchConfig: { searchApiKey: SEARCH_KEY } }
    a.self = a
    const out: any = redactCredentials(a)
    assert.equal(out.azureSearchConfig, REDACTED)
  })

  it('🔴 also masks credentials attached to an Error; opaque bypass regression', () => {
    const e: any = new Error('boom')
    e.azureSearchConfig = { searchApiKey: SEARCH_KEY }
    const out: any = redactCredentials({ error: e })
    assert.equal(JSON.stringify(out).includes(SEARCH_KEY), false, 'Error 안 시크릿이 샜다')
    assert.equal(out.error.azureSearchConfig, REDACTED)
    assert.equal(out.error.message, 'boom', 'Error message 가 사라졌다')
    assert.equal(out.error.name, 'Error')
    assert.ok(out.error.stack, 'stack 이 사라졌다')
  })

  it('🔴 a throwing getter does not make sanitizing fail', () => {
    const e: any = new Error('boom')
    Object.defineProperty(e, 'bad', { enumerable: true, get() { throw new Error('getter-fired') } })
    e.azureSearchConfig = { searchApiKey: SEARCH_KEY }

    const out: any = redactCredentials({ error: e })
    assert.equal(out.error.bad, GETTER_FAILED, 'getter 실패 표식이 없다')
    assert.equal(out.error.azureSearchConfig, REDACTED)
  })

  it('🔴 even without secrets, a throwing getter yields a serializable copy', () => {
    const clean: any = { note: 'no secret here' }
    Object.defineProperty(clean, 'bad', { enumerable: true, get() { throw new Error('getter-fired') } })

    const out: any = redactCredentials({ input: clean })
    assert.doesNotThrow(() => JSON.stringify(out), '정제 후에도 직렬화가 던진다')
    assert.equal(out.input.bad, GETTER_FAILED)
    assert.equal(out.input.note, 'no secret here', '정상 값은 보존')
  })

  it('an Error without secrets passes through as the original', () => {
    const e = new Error('clean')
    assert.equal(redactCredentials({ error: e }).error, e)
  })

  it('🔴 also masks credentials produced by toJSON()', () => {
    class Hidden {
      toJSON() { return { azureSearchConfig: { searchApiKey: SEARCH_KEY } } }
    }
    const out = redactCredentials({ input: new Hidden() })
    assert.equal(JSON.stringify(out).includes(SEARCH_KEY), false, 'toJSON 으로 시크릿이 샜다')
  })

  it('🔴 sanitizing survives a Proxy ownKeys trap that throws', () => {
    const p = new Proxy({}, { ownKeys() { throw new Error('ownKeys-trap') } })
    let out: any
    assert.doesNotThrow(() => { out = redactCredentials({ input: p }) }, '열거 예외가 전파됐다')
    assert.doesNotThrow(() => JSON.stringify(out))
  })

  it('🔴 sanitizing survives an array element getter that throws', () => {
    const arr: any = []
    Object.defineProperty(arr, '0', { enumerable: true, get() { throw new Error('elem-getter') } })
    let out: any
    assert.doesNotThrow(() => { out = redactCredentials({ input: arr }) })
    assert.deepEqual(out.input, [GETTER_FAILED])
  })

  it('🔴 a throwing toJSON property access still yields a serializable copy', () => {
    const a: any = {}
    Object.defineProperty(a, 'toJSON', { get() { throw new Error('toJSON-getter') } })
    const out = redactCredentials({ x: a })
    assert.doesNotThrow(() => JSON.stringify(out), 'JSON.stringify 가 toJSON getter 에서 던진다')
  })

  it('🔴 survives a throwing length trap on an array Proxy', () => {
    const p: any = new Proxy([], {
      get(t, k) { if (k === 'length') throw new Error('len-trap'); return (t as any)[k] },
    })
    let out: any
    assert.doesNotThrow(() => { out = redactCredentials({ x: p }) })
    assert.doesNotThrow(() => JSON.stringify(out))
  })

  it('🔴 also sanitizes a custom toJSON on a Date subclass', () => {
    class Sneaky extends Date {
      toJSON() { return { azureSearchConfig: { searchApiKey: SEARCH_KEY } } }
    }
    const out = redactCredentials({ x: new Sneaky() })
    assert.equal(JSON.stringify(out).includes(SEARCH_KEY), false, 'Date 서브클래스로 시크릿이 샜다')
  })

  it('a plain Date still passes through unchanged', () => {
    const d = new Date(0)
    assert.equal((redactCredentials({ d }) as any).d, d)
  })

  it('Date/Map/Set pass through unchanged (prevents a generic clone turning them into {})', () => {
    const d = new Date(0)
    const m = new Map([['k', 'v']])
    const out: any = redactCredentials({ d, m, azureSearchConfig: { searchApiKey: SEARCH_KEY } })
    assert.equal(out.d, d)
    assert.equal(out.m, m)
    assert.equal(out.azureSearchConfig, REDACTED)
  })
})
