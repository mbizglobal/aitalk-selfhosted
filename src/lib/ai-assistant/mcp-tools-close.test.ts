
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

import { listMcpToolsAndClose } from './context-builder'

type Fail = 'initialize' | 'listTools' | 'close' | null

function fakeClient(fail: Fail, tools: any[] = [{ name: 'a', description: 'A' }]) {
  const seen = { initialize: 0, listTools: 0, close: 0 }
  return {
    seen,
    client: {
      async initialize() { seen.initialize++; if (fail === 'initialize') throw new Error('server refused') },
      async listTools() { seen.listTools++; if (fail === 'listTools') throw new Error('rpc error'); return tools },
      async close() { seen.close++; if (fail === 'close') throw new Error('close failed') },
    } as any,
  }
}

describe('listMcpToolsAndClose - closes the connection even on failure', () => {
  it('close() is called even if `initialize()` throws (this is where it actually leaked)', async () => {
    const { seen, client } = fakeClient('initialize')

    const tools = await listMcpToolsAndClose(client)

    assert.equal(seen.close, 1, 'initialize 실패 시 close() 가 안 불렸다 — SSE reader 가 샌다')
    assert.deepEqual(tools, [], '실패하면 빈 목록')
  })

  it('close() is called even if `listTools()` throws (sibling path)', async () => {
    const { seen, client } = fakeClient('listTools')

    const tools = await listMcpToolsAndClose(client)

    assert.equal(seen.close, 1)
    assert.deepEqual(tools, [])
  })

  it('the failure is swallowed - even if tools cannot be read, the connection info itself must still be delivered (existing behavior)', async () => {
    const { client } = fakeClient('initialize')
    await assert.doesNotReject(() => listMcpToolsAndClose(client))
  })

  it('a `close()` failure is also swallowed - cleanup failure must not spread to the caller', async () => {
    const { seen, client } = fakeClient('close')

    const tools = await listMcpToolsAndClose(client)

    assert.equal(seen.close, 1)
    assert.equal(tools.length, 1, '정리 실패가 정상 결과를 지우면 안 된다')
  })

  it('control case - the success path also closes and returns the normalized list', async () => {

    const { seen, client } = fakeClient(null, [
      { name: 'x', description: 'X', inputSchema: { type: 'object' } },
      { name: 'y' },
    ])

    const tools = await listMcpToolsAndClose(client)

    assert.equal(seen.initialize, 1)
    assert.equal(seen.listTools, 1)
    assert.equal(seen.close, 1, '성공 경로에서도 닫아야 한다')
    assert.deepEqual(tools, [
      { name: 'x', description: 'X', inputSchema: { type: 'object' } },
      { name: 'y', description: '', inputSchema: undefined },
    ])
  })
})

describe('fetchMcpInfo actually uses the helper (syntax contract)', () => {
  const SOURCE = 'src/lib/ai-assistant/context-builder.ts'

  const parse = (path = SOURCE, text?: string) =>
    ts.createSourceFile(path, text ?? readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)

  function bodyOf(sf: ts.SourceFile, name: string): ts.Node {
    let found: ts.Node | undefined
    const walk = (node: ts.Node) => {
      if (found) return
      const isFn =
        (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
        node.name?.getText() === name
      if (isFn && (node as any).body) { found = (node as any).body; return }
      ts.forEachChild(node, walk)
    }
    walk(sf)
    assert.ok(found, `함수를 못 찾았다: ${name} — 이름이 바뀌었으면 이 검사도 함께 고친다`)
    return found!
  }

  function callsIn(scope: ts.Node): string[] {
    const out: string[] = []
    const walk = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const e = node.expression
        out.push(ts.isPropertyAccessExpression(e) ? `${e.expression.getText()}.${e.name.getText()}` : e.getText())
      }
      ts.forEachChild(node, walk)
    }
    walk(scope)
    return out
  }

  function toolsInitializer(scope: ts.Node): string | null {
    let found: string | null = null
    const walk = (node: ts.Node) => {
      if (found) return
      if (ts.isVariableDeclaration(node) && node.name.getText() === 'tools' && node.initializer) {
        let init: ts.Expression = node.initializer
        if (ts.isAwaitExpression(init)) init = init.expression
        if (ts.isCallExpression(init)) { found = init.expression.getText(); return }
      }
      ts.forEachChild(node, walk)
    }
    walk(scope)
    return found
  }

  it('the `tools` of fetchMcpInfo is the helper\'s return value (a call alone is not enough)', () => {
    assert.equal(
      toolsInitializer(bodyOf(parse(), 'fetchMcpInfo')), 'listMcpToolsAndClose',
      'tools 를 헬퍼가 아닌 다른 방법으로 채운다 — inline 으로 되돌아갔거나 죽은 분기에만 헬퍼가 있다',
    )
  })

  it('fetchMcpInfo does not call initialize or listTools directly', () => {
    const calls = callsIn(bodyOf(parse(), 'fetchMcpInfo'))
    assert.ok(!calls.includes('client.initialize'), 'initialize 를 직접 부른다 — 정리 책임이 흩어진다')
    assert.ok(!calls.includes('client.listTools'), 'listTools 를 직접 부른다')
  })

  it('control case - the checker actually catches (positive and negative fixtures)', () => {
    const bad = parse('a.ts', `class C { async fetchMcpInfo(){ await client.initialize(); const tools = await client.listTools(); return tools } }`)
    assert.notEqual(toolsInitializer(bodyOf(bad, 'fetchMcpInfo')), 'listMcpToolsAndClose', '옛 형태를 통과시킨다')

    const good = parse('b.ts', `class C { async fetchMcpInfo(){ const tools = await listMcpToolsAndClose(new McpClient(u)); return tools } }`)
    assert.equal(toolsInitializer(bodyOf(good, 'fetchMcpInfo')), 'listMcpToolsAndClose', '올바른 형태를 거부한다')
  })

  it('control case - a helper call in a dead branch does not satisfy the contract', () => {
    const dead = parse('c.ts', `class C { async fetchMcpInfo(){ if (never) listMcpToolsAndClose(c); const tools = await c.listTools(); return tools } }`)
    assert.notEqual(
      toolsInitializer(bodyOf(dead, 'fetchMcpInfo')), 'listMcpToolsAndClose',
      '죽은 분기에 호출만 있어도 통과한다 — 결과 결합을 봐야 한다',
    )
  })

  it('known limitation - import aliases give a false failure (pinned: if this improves, this test fails)', () => {
    const aliased = parse('d.ts', `class C { async fetchMcpInfo(){ const tools = await load(new McpClient(u)); return tools } }`)
    assert.notEqual(
      toolsInitializer(bodyOf(aliased, 'fetchMcpInfo')), 'listMcpToolsAndClose',
      '별칭을 따라가기 시작했다 — 위 「알려진 한계」 주석을 갱신할 것',
    )
  })
})
