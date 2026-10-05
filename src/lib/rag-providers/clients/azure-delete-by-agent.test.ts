
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

import { AzureAISearchClient } from './azure-ai-search'

type SearchStub = (path: string, method: string, body?: any) => Promise<any>

function makeClient(searchRequest: SearchStub) {
  const client = new AzureAISearchClient({
    searchApiKey: 'test-key',
    searchEndpoint: 'https://test.search.windows.net',
    openaiApiKey: 'test-key',
    openaiEndpoint: 'https://test.cognitiveservices.azure.com',
    openaiApiVersion: '2024-12-01-preview',
    regionId: 'switzerlandnorth',
  })
  ;(client as unknown as Record<string, unknown>).searchRequest = searchRequest
  return client
}

const withDeleteResult = (deleteResponse: unknown): SearchStub => async (path, _method, body) => {
  if (path.endsWith('/docs/search')) return { value: [{ id: 'agent123_file_0' }] }
  if (path.endsWith('/docs/index')) {
    if (deleteResponse instanceof Error) throw deleteResponse
    return deleteResponse
  }
  throw new Error(`unexpected path: ${path}`)
}

test('(1) per-document partial failures are thrown to the caller; silent success would delete only the DB', async () => {
  const client = makeClient(
    withDeleteResult({ value: [{ key: 'agent123_file_0', status: false, statusCode: 500 }] }),
  )
  await assert.rejects(
    () => client.deleteByAgent('agent123'),
    /partially failed/,
    '부분 실패가 삼켜졌다 — 호출자가 삭제 완료로 보고한다',
  )
})

test('(1-b) HTTP errors (the batch request itself failing) also throw', async () => {
  const boom = Object.assign(new Error('service unavailable'), { status: 503 })
  const client = makeClient(withDeleteResult(boom))
  await assert.rejects(() => client.deleteByAgent('agent123'), /service unavailable/)
})

test('(2) 🔴 404 (no index) is success; raising it as failure would block deletion forever', async () => {
  const notFound = Object.assign(new Error('index not found'), { status: 404 })
  const client = makeClient(async () => { throw notFound })
  await assert.doesNotReject(
    () => client.deleteByAgent('agent123'),
    '404 를 실패로 올렸다 — 지울 대상이 없는데 삭제가 막힌다',
  )
})

test('(3) normal deletion finishes quietly (over-rejection control)', async () => {
  const client = makeClient(
    withDeleteResult({ value: [{ key: 'agent123_file_0', status: true }] }),
  )
  await assert.doesNotReject(() => client.deleteByAgent('agent123'))
})

test('(3-b) nothing happens when there are 0 documents to delete', async () => {
  const client = makeClient(async (path) => {
    if (path.endsWith('/docs/search')) return { value: [] }
    throw new Error('삭제 배치를 보내면 안 된다 — 지울 문서가 없다')
  })
  await assert.doesNotReject(() => client.deleteByAgent('agent123'))
})

test('idempotent: per-document 404 is not counted as failure (delete succeeds even for missing keys)', async () => {
  const client = makeClient(
    withDeleteResult({ value: [{ key: 'agent123_file_0', status: false, statusCode: 404 }] }),
  )
  await assert.doesNotReject(
    () => client.deleteByAgent('agent123'),
    '이미 없는 문서를 실패로 셌다 — 재삭제가 영원히 실패한다',
  )
})

const fileStub = (deleteResponse: unknown): SearchStub => async (path, _m, _b) => {
  if (path.endsWith('/docs/search')) return { value: [{ id: 'agent123_7_0' }] }
  if (path.endsWith('/docs/index')) {
    if (deleteResponse instanceof Error) throw deleteResponse
    return deleteResponse
  }
  throw new Error(`unexpected path: ${path}`)
}

test('deleteFile (1) per-document partial failures are thrown; swallowing them kills the caller\'s row preservation', async () => {
  const client = makeClient(fileStub({ value: [{ key: 'agent123_7_0', status: false, statusCode: 500 }] }))
  await assert.rejects(() => client.deleteFile('agent123', '7'), /partially failed/)
})

test('deleteFile (1-b) HTTP errors also throw', async () => {
  const boom = Object.assign(new Error('service unavailable'), { status: 503 })
  await assert.rejects(() => makeClient(fileStub(boom)).deleteFile('agent123', '7'), /service unavailable/)
})

test('deleteFile (2) 🔴 index 404 is success; raising it as failure would block deletion forever', async () => {
  const notFound = Object.assign(new Error('index not found'), { status: 404 })
  const client = makeClient(async () => { throw notFound })
  await assert.doesNotReject(() => client.deleteFile('agent123', '7'))
})

test('deleteFile (3) normal deletion finishes quietly', async () => {
  const client = makeClient(fileStub({ value: [{ key: 'agent123_7_0', status: true, statusCode: 200 }] }))
  await assert.doesNotReject(() => client.deleteFile('agent123', '7'))
})

test('deleteChunksByKey (1) partial failures are thrown', async () => {
  const client = makeClient(async (path) => {
    if (path.endsWith('/docs/index')) return { value: [{ key: 'k0', status: false, statusCode: 500 }] }
    throw new Error(`unexpected path: ${path}`)
  })
  await assert.rejects(() => client.deleteChunksByKey('agent123', 'file_1', 1), /partially failed/)
})

test('deleteChunksByKey (2) index 404 is success', async () => {
  const notFound = Object.assign(new Error('index not found'), { status: 404 })
  const client = makeClient(async () => { throw notFound })
  await assert.doesNotReject(() => client.deleteChunksByKey('agent123', 'file_1', 1))
})

test('deleteChunksByKey (3) normal deletion finishes quietly', async () => {
  const client = makeClient(async (path) => {
    if (path.endsWith('/docs/index')) return { value: [{ key: 'k0', status: true, statusCode: 200 }] }
    throw new Error(`unexpected path: ${path}`)
  })
  await assert.doesNotReject(() => client.deleteChunksByKey('agent123', 'file_1', 1))
})

test('🔴 the `options` of both Azure helpers is only `signal`; no escape hatch to suppress errors', () => {
  const ALLOWED_OPTION_PROPS = new Set(['signal'])
  const rel = 'src/lib/rag-providers/clients/azure-ai-search.ts'
  const src = readFileSync(path.resolve(__dirname, '../../../..', rel), 'utf8')
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

  const targets = new Set(['deleteFile', 'deleteChunksByKey'])
  const seen: string[] = []
  const visit = (n: ts.Node) => {
    if (ts.isMethodDeclaration(n) && n.name && targets.has(n.name.getText())) {
      const name = n.name.getText()
      seen.push(name)
      const opt = n.parameters.find(p => p.name.getText() === 'options')
      if (opt?.type && ts.isTypeLiteralNode(opt.type)) {
        for (const m of opt.type.members) {
          const prop = m.name?.getText()
          assert.ok(
            prop && ALLOWED_OPTION_PROPS.has(prop),
            `${name} 의 options 에 허용되지 않은 프로퍼티 \`${prop}\` 가 있다 — ` +
              '오류를 삼키는 탈출구가 되살아났을 수 있다. 계약을 바꿀 거면 이 목록부터 고칠 것.',
          )
        }
      }
    }
    ts.forEachChild(n, visit)
  }
  ts.forEachChild(sf, visit)
  assert.deepEqual(seen.sort(), ['deleteChunksByKey', 'deleteFile'], '대상 메서드를 못 찾았다')
})

test('🔴 `deleteFromBlob` does not catch failures (there is no catch)', () => {
  const src = readFileSync(
    path.resolve(__dirname, '../../../..', 'src/lib/managed/blob-storage.ts'), 'utf8')
  const sf = ts.createSourceFile('blob-storage.ts', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let fn: ts.FunctionDeclaration | null = null
  const visit = (n: ts.Node) => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === 'deleteFromBlob') fn = n
    ts.forEachChild(n, visit)
  }
  ts.forEachChild(sf, visit)
  assert.ok(fn, '`deleteFromBlob` 을 못 찾았다 — 이 검사가 무의미해졌다')

  const swallows: string[] = []
  ts.forEachChild(fn!, function scan(n: ts.Node) {
    if (ts.isCatchClause(n)) swallows.push('try/catch')
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === 'catch'
    ) swallows.push(n.getText().slice(0, 60))
    ts.forEachChild(n, scan)
  })
  assert.deepEqual(
    swallows, [],
    '`deleteFromBlob` 이 다시 실패를 잡는다 — 호출부 catch 가 또 죽는다: ' + swallows.join(' · '),
  )

  assert.equal(fn!.parameters.length, 2, `\`deleteFromBlob\` 파라미터가 ${fn!.parameters.length}개다`)
})
