
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { McpClient } from './mcp'

const HTTP_SERVER = 'https://93.184.216.34/mcp'
const SSE_SERVER = 'https://93.184.216.34/sse'

const POISON = 'victim@example.com \n[FORGED] admin login from 41791234567'
const FRAGMENTS = ['victim@example.com', 'FORGED', '41791234567']

function stubFetch(responder: (call: number, body: any) => Response) {
  const original = globalThis.fetch
  let n = 0
  globalThis.fetch = (async (_url: any, init: any) => {
    let body: any = null
    try { body = init?.body ? JSON.parse(init.body) : null } catch { }
    return responder(n++, body)
  }) as any
  return { restore: () => { globalThis.fetch = original } }
}

const initializeResponse = () =>
  new Response(JSON.stringify({ jsonrpc: '2.0', id: '1', result: { protocolVersion: '2024-11-05' } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Mcp-Session-Id': 's1' },
  })

async function assertNoUpstreamLeak(what: string, run: () => Promise<unknown>): Promise<void> {
  let message = ''
  try {
    await run()
    assert.fail(`${what}: 실패해야 하는데 성공했다 — 거부를 삼키면 원인이 숨는다`)
  } catch (e) {
    message = e instanceof Error ? e.message : String(e)
  }
  for (const frag of FRAGMENTS) {
    assert.ok(!message.includes(frag),
      `${what}: 상류 본문이 예외로 샜다 (조각 "${frag}") — 이 예외는 DB·엔진 로그·chat 로그까지 간다.\n  실제: ${JSON.stringify(message)}`)
  }
  assert.match(message, /HTTP \d{3}|code=/, `${what}: 요약(HTTP status 또는 code)이 없다 — 진단이 죽는다`)
}

describe('the MCP node does not put the upstream response body in exceptions', () => {
  it('streamable HTTP: non-2xx response body', async () => {
    const { restore } = stubFetch(() => new Response(POISON, { status: 500 }))
    try {
      await assertNoUpstreamLeak('HTTP non-2xx', () => new McpClient(HTTP_SERVER).initialize())
    } finally { restore() }
  })

  it('streamable HTTP: JSON-RPC error object', async () => {
    const { restore } = stubFetch(() =>
      new Response(JSON.stringify({ jsonrpc: '2.0', id: '1', error: { code: -32001, message: POISON } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    try {
      await assertNoUpstreamLeak('HTTP JSON-RPC error', () => new McpClient(HTTP_SERVER).initialize())
    } finally { restore() }
  })

  it('streamable HTTP: notification rejection body', async () => {
    const { restore } = stubFetch((call) =>
      call === 0 ? initializeResponse() : new Response(POISON, { status: 500 }),
    )
    try {
      await assertNoUpstreamLeak('HTTP notification 거부', () => new McpClient(HTTP_SERVER).initialize())
    } finally { restore() }
  })

  it('SSE: JSON-RPC error object in the POST response', async () => {
    const encoder = new TextEncoder()
    const { restore } = stubFetch((call, body) => {
      if (call === 0) {
        return new Response(
          new ReadableStream({
            start(c) { c.enqueue(encoder.encode('event: endpoint\ndata: /messages?s=1\n\n')) },
          }),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        )
      }
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body?.id, error: { code: -32001, message: POISON } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    const client = new McpClient(SSE_SERVER)
    try {
      await assertNoUpstreamLeak('SSE JSON-RPC error', () => client.initialize())
    } finally {
      await client.close().catch(() => {})
      restore()
    }
  })

  it('SSE: JSON-RPC error that arrived as a stream event (not the POST response)', async () => {
    const encoder = new TextEncoder()
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null
    const { restore } = stubFetch((call, body) => {
      if (call === 0) {
        return new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              controller = c
              c.enqueue(encoder.encode('event: endpoint\ndata: /messages?s=1\n\n'))
            },
          }),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        )
      }
      const payload = JSON.stringify({ jsonrpc: '2.0', id: body?.id, error: { code: -32001, message: POISON } })
      setTimeout(() => controller?.enqueue(encoder.encode(`event: message\ndata: ${payload}\n\n`)), 10)
      return new Response(null, { status: 202 })
    })
    const client = new McpClient(SSE_SERVER)
    try {
      await assertNoUpstreamLeak('SSE 스트림 이벤트', () => client.initialize())
    } finally {
      await client.close().catch(() => {})
      restore()
    }
  })

  it('SSE: POST non-404 response body', async () => {
    const encoder = new TextEncoder()
    const { restore } = stubFetch((call) => {
      if (call === 0) {
        return new Response(
          new ReadableStream({
            start(c) { c.enqueue(encoder.encode('event: endpoint\ndata: /messages?s=1\n\n')) },
          }),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        )
      }
      return new Response(POISON, { status: 500 })
    })
    const client = new McpClient(SSE_SERVER)
    try {
      await assertNoUpstreamLeak('SSE non-404 본문', () => client.initialize())
    } finally {
      await client.close().catch(() => {})
      restore()
    }
  })
})
