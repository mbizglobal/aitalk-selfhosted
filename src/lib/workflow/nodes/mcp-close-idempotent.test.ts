
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { McpClient } from './mcp'

const SERVER = 'https://93.184.216.34/mcp'

const initializeResponse = () =>
  new Response(
    JSON.stringify({ jsonrpc: '2.0', id: '1', result: { serverInfo: { name: 'test-server' } } }),
    { status: 200, headers: { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'sess_1' } },
  )

function stubFetch(responder: (call: number) => Response) {
  const calls: Array<{ url: string; init: any }> = []
  let n = 0
  const original = globalThis.fetch
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), init })
    return responder(n++)
  }) as any
  return { calls, restore: () => { globalThis.fetch = original } }
}

const deletesIn = (calls: Array<{ init: any }>) =>
  calls.filter(c => c.init?.method === 'DELETE')

describe('McpClient.close() is idempotent', () => {
  it('🔴 even if called twice, the session DELETE goes out only once (the executor really calls it twice)', async () => {
    const { calls, restore } = stubFetch(call =>
      call === 0 ? initializeResponse() : new Response(null, { status: 202 }),
    )

    try {
      const client = new McpClient(SERVER)
      await client.initialize()

      await client.close()
      await client.close()

      const deletes = deletesIn(calls)
      assert.equal(
        deletes.length, 1,
        `DELETE 가 ${deletes.length}번 나갔다 — sessionId 를 안 비우면 close() 마다 다시 나간다`,
      )
      assert.equal(deletes[0].init.headers['Mcp-Session-Id'], 'sess_1')
    } finally {
      restore()
    }
  })

  it('🔴 DELETE goes out once even for concurrent calls (guarding only sequential calls is half a fix)', async () => {
    const { calls, restore } = stubFetch(call =>
      call === 0 ? initializeResponse() : new Response(null, { status: 202 }),
    )

    try {
      const client = new McpClient(SERVER)
      await client.initialize()

      await Promise.all([client.close(), client.close()])

      const deletes = deletesIn(calls)
      assert.equal(
        deletes.length, 1,
        `동시 close() 에서 DELETE 가 ${deletes.length}번 — sessionId 를 await 앞에서 비워야 한다`,
      )
    } finally {
      restore()
    }
  })

  it('control: the first close() does send DELETE (making it idempotent did not kill the shutdown itself)', async () => {
    const { calls, restore } = stubFetch(call =>
      call === 0 ? initializeResponse() : new Response(null, { status: 202 }),
    )

    try {
      const client = new McpClient(SERVER)
      await client.initialize()
      await client.close()

      assert.equal(deletesIn(calls).length, 1, '첫 close() 에서 DELETE 가 나가야 한다')
    } finally {
      restore()
    }
  })

  it('close() does not send DELETE when no session id was received', async () => {
    const noSession = () =>
      new Response(
        JSON.stringify({ jsonrpc: '2.0', id: '1', result: { serverInfo: { name: 'test-server' } } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    const { calls, restore } = stubFetch(call =>
      call === 0 ? noSession() : new Response(null, { status: 202 }),
    )

    try {
      const client = new McpClient(SERVER)
      await client.initialize()
      await client.close()

      assert.equal(deletesIn(calls).length, 0, '세션이 없으면 지울 것도 없다')
    } finally {
      restore()
    }
  })

  it('🔴 if DELETE fails, the next close() retries (a remote session must not remain)', async () => {
    let deleteAttempts = 0
    let nonDeleteCalls = 0
    const original = globalThis.fetch
    globalThis.fetch = (async (_url: any, init: any) => {
      if (init?.method === 'DELETE') {
        deleteAttempts++
        if (deleteAttempts === 1) throw new Error('network down')
        return new Response(null, { status: 200 })
      }
      return nonDeleteCalls++ === 0 ? initializeResponse() : new Response(null, { status: 202 })
    }) as any

    try {
      const client = new McpClient(SERVER)
      await client.initialize()

      await client.close()
      await client.close()

      assert.equal(deleteAttempts, 2, '실패한 종료를 재시도하지 않았다 — 원격 세션이 남는다')
    } finally {
      globalThis.fetch = original
    }
  })

  it('🔴 retries even if DELETE returns 500 (`safeFetch` does not throw on HTTP errors)', async () => {
    let deletes = 0
    let others = 0
    const original = globalThis.fetch
    globalThis.fetch = (async (_url: any, init: any) => {
      if (init?.method === 'DELETE') {
        deletes++
        return new Response('server error', { status: deletes === 1 ? 500 : 200 })
      }
      return others++ === 0 ? initializeResponse() : new Response(null, { status: 202 })
    }) as any

    try {
      const client = new McpClient(SERVER)
      await client.initialize()
      await client.close()   // 500
      await client.close()

      assert.equal(deletes, 2, 'HTTP 오류를 실패로 안 봐서 세션이 소실됐다')
    } finally {
      globalThis.fetch = original
    }
  })

  it('does not retry on 404 (already gone on the server, nothing to delete)', async () => {
    let deletes = 0
    let others = 0
    const original = globalThis.fetch
    globalThis.fetch = (async (_url: any, init: any) => {
      if (init?.method === 'DELETE') { deletes++; return new Response(null, { status: 404 }) }
      return others++ === 0 ? initializeResponse() : new Response(null, { status: 202 })
    }) as any

    try {
      const client = new McpClient(SERVER)
      await client.initialize()
      await client.close()
      await client.close()

      assert.equal(deletes, 1, '없는 세션에 DELETE 를 반복한다')
    } finally {
      globalThis.fetch = original
    }
  })

  it('control: if DELETE succeeds, does not retry (retry and duplicate are different)', async () => {
    const { calls, restore } = stubFetch(call =>
      call === 0 ? initializeResponse() : new Response(null, { status: 200 }),
    )
    try {
      const client = new McpClient(SERVER)
      await client.initialize()
      await client.close()
      await client.close()
      assert.equal(deletesIn(calls).length, 1, '성공한 뒤에도 또 보냈다')
    } finally {
      restore()
    }
  })

  it('close() does not throw even without initialize (it is always called in finally)', async () => {
    const { calls, restore } = stubFetch(() => new Response(null, { status: 202 }))
    try {
      await new McpClient(SERVER).close()
      assert.equal(calls.length, 0, '네트워크 호출이 나가면 안 된다')
    } finally {
      restore()
    }
  })
})
