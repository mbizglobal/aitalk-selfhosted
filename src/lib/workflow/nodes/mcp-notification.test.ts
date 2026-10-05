
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

const bodyOf = (call: { init: any }) => JSON.parse(call.init.body)

describe('notifications/initialized is a notification, not a request', () => {
  it('initialize succeeds even with 202 and an empty body (it used to fail everything here)', async () => {
    const { calls, restore } = stubFetch(call =>
      call === 0 ? initializeResponse() : new Response(null, { status: 202 }),
    )

    try {
      const info = await new McpClient(SERVER).initialize()
      assert.deepEqual(info, { name: 'test-server' }, 'initialize 가 serverInfo 를 돌려줘야 한다')
      assert.equal(calls.length, 2, 'initialize → notifications/initialized 두 번 나가야 한다')
    } finally {
      restore()
    }
  })

  it('the notification body has no id (with an id the server is obliged to respond)', async () => {
    const { calls, restore } = stubFetch(call =>
      call === 0 ? initializeResponse() : new Response(null, { status: 202 }),
    )

    try {
      await new McpClient(SERVER).initialize()

      assert.ok('id' in bodyOf(calls[0]), 'initialize 는 요청이므로 id 가 있어야 한다')

      const notif = bodyOf(calls[1])
      assert.equal(notif.method, 'notifications/initialized')
      assert.equal(notif.jsonrpc, '2.0')
      assert.ok(!('id' in notif), '🔴 알림에 id 가 실렸다 — 종전 결함(sendRequest 경유)의 지문이다')
    } finally {
      restore()
    }
  })

  it('also sends the session id issued by initialize on the notification request', async () => {
    const { calls, restore } = stubFetch(call =>
      call === 0 ? initializeResponse() : new Response(null, { status: 202 }),
    )

    try {
      await new McpClient(SERVER).initialize()
      assert.equal(calls[1].init.headers['Mcp-Session-Id'], 'sess_1')
    } finally {
      restore()
    }
  })

  it('throws if the server rejects the notification (non-2xx); a rejection is not passed off as success', async () => {
    const { restore } = stubFetch(call =>
      call === 0 ? initializeResponse() : new Response('not acceptable', { status: 500 }),
    )

    try {
      await assert.rejects(
        () => new McpClient(SERVER).initialize(),
        /MCP notification failed: HTTP 500/,
        '알림 거부를 삼키면 원인이 뒤따르는 tools/list 실패까지 숨는다 (codex R1 #1)',
      )
    } finally {
      restore()
    }
  })

  it('same for SSE transport: no id on the notification and success on 202 with an empty body', async () => {
    const encoder = new TextEncoder()
    const sseStream = () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('event: endpoint\ndata: /messages?s=1\n\n'))
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      )

    const sseStub = (notificationResponse: () => Response) => {
      const calls: Array<{ url: string; init: any }> = []
      const original = globalThis.fetch
      globalThis.fetch = (async (url: any, init: any) => {
        calls.push({ url: String(url), init })
        if ((init?.method ?? 'GET') === 'GET') return sseStream()        // connectSSE
        const body = JSON.parse(init.body)
        if (body.method === 'initialize') {
          return new Response(
            JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { serverInfo: { name: 'sse-server' } } }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        return notificationResponse()
      }) as any
      return { calls, restore: () => { globalThis.fetch = original } }
    }

    const { calls, restore } = sseStub(() => new Response(null, { status: 202 }))
    const client = new McpClient('https://93.184.216.34/sse')
    try {
      const info = await client.initialize()
      assert.deepEqual(info, { name: 'sse-server' })

      const notif = bodyOf(calls[calls.length - 1])
      assert.equal(notif.method, 'notifications/initialized')
      assert.ok(!('id' in notif), '🔴 SSE 알림에 id 가 실렸다 — 응답을 30초 기다리게 된다')
      assert.equal(calls[calls.length - 1].url, 'https://93.184.216.34/messages?s=1')
    } finally {
      await client.close()
      restore()
    }

    const rejected = sseStub(() => new Response('nope', { status: 500 }))
    const client2 = new McpClient('https://93.184.216.34/sse')
    try {
      await assert.rejects(
        () => client2.initialize(),
        /MCP notification failed: HTTP 500/,
        'SSE 경로가 알림 거부를 삼켰다',
      )
    } finally {
      await client2.close()
      rejected.restore()
    }
  })

  it('does not parse the body; succeeds even on 200 with a non-JSON body', async () => {
    const { restore } = stubFetch(call =>
      call === 0
        ? initializeResponse()
        : new Response('OK', { status: 200, headers: { 'Content-Type': 'text/plain' } }),
    )

    try {
      const info = await new McpClient(SERVER).initialize()
      assert.deepEqual(info, { name: 'test-server' })
    } finally {
      restore()
    }
  })
})
