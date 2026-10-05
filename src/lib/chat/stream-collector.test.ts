
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { ChatStreamCollector, collectChatStream, MAX_COLLECTED_CHARS } from './stream-collector'

const enc = new TextEncoder()

function frame(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`
}

function feed(chunks: string[]) {
  const c = new ChatStreamCollector()
  for (const ch of chunks) c.push(ch)
  c.end()
  return c.result
}

function sseResponse(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      for (const ch of chunks) ctrl.enqueue(enc.encode(ch))
      ctrl.close()
    },
  })
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
}

describe('ChatStreamCollector: body accumulation', () => {
  it('joins content frames in order', () => {
    const r = feed([frame({ content: '안녕' }), frame({ content: '하세요' }), 'data: [DONE]\n\n'])
    assert.equal(r.content, '안녕하세요')
    assert.equal(r.done, true)
  })

  it('takes model, tokens and responseId from completed', () => {
    const r = feed([
      frame({ content: 'hi' }),
      frame({ type: 'completed', responseId: 'resp_1', model: 'gpt-4o-mini', inputTokens: 12, outputTokens: 34 }),
      'data: [DONE]\n\n',
    ])
    assert.deepEqual(
      { c: r.content, id: r.responseId, m: r.model, i: r.inputTokens, o: r.outputTokens, done: r.completed },
      { c: 'hi', id: 'resp_1', m: 'gpt-4o-mini', i: 12, o: 34, done: true }
    )
  })

  it('completed, debug-log and summary-update are not mixed into the body', () => {
    const r = feed([
      frame({ content: 'A' }),
      frame({ type: 'summary-update', summary: '요약본문', foldedCount: 3 }),
      frame({ type: 'debug-log', logs: ['x'] }),
      frame({ type: 'completed', responseId: 'r', model: 'm' }),
      frame({ content: 'B' }),
    ])
    assert.equal(r.content, 'AB', '본문 외 프레임이 섞이면 저장 내용이 오염된다')
  })

  it('RED: marks it when an error frame is seen: a failed run must not be recorded as a conversation', () => {
    const r = feed([frame({ content: 'A' }), frame({ error: 'Stream error' })])
    assert.equal(r.sawError, true)
  })

  it('quietly skips a broken JSON frame (same behavior as the widget)', () => {
    const r = feed(['data: {broken\n\n', frame({ content: 'ok' })])
    assert.equal(r.content, 'ok')
  })

  it('ignores lines that are not data:', () => {
    const r = feed([': keep-alive\n\n', 'event: ping\n', frame({ content: 'x' })])
    assert.equal(r.content, 'x')
  })
})

describe('RED ChatStreamCollector: chunk boundaries (the value of this file)', () => {
  it('does not lose a frame even if it arrives cut in the middle', () => {
    const whole = frame({ content: '가나다' }) + frame({ content: '라마바' })
    for (const cut of [1, 5, 12, 20, whole.length - 1]) {
      const r = feed([whole.slice(0, cut), whole.slice(cut)])
      assert.equal(r.content, '가나다라마바', `cut=${cut} 에서 텍스트가 어긋난다`)
    }
  })

  it('gives the same result even when fed one character at a time', () => {
    const whole = frame({ content: 'hello' }) + frame({ content: ' world' }) + 'data: [DONE]\n\n'
    const r = feed(whole.split(''))
    assert.equal(r.content, 'hello world')
    assert.equal(r.done, true)
  })

  it('end() handles it even if the last line has no newline', () => {
    const r = feed([`data: ${JSON.stringify({ content: '끝' })}`])
    assert.equal(r.content, '끝')
  })

  it('handles CRLF too', () => {
    const r = feed([`data: ${JSON.stringify({ content: 'x' })}\r\n\r\n`])
    assert.equal(r.content, 'x')
  })
})

describe('RED ChatStreamCollector: accumulation limit', () => {
  it('stops adding past the limit and sets truncated', () => {
    const big = 'x'.repeat(MAX_COLLECTED_CHARS + 10_000)
    const r = feed([frame({ content: big }), frame({ content: '뒤에 더' })])
    assert.ok(r.content.length <= MAX_COLLECTED_CHARS + big.length,
      '상한 뒤로는 누적이 멈춰야 한다')
    assert.equal(r.truncated, true, '잘렸다는 표시가 없으면 조용히 이력이 상한다')
    assert.equal(r.content.includes('뒤에 더'), false, '상한 뒤 조각이 담기면 안 된다')
  })

  it('a normal length is not cut: real answers never get near the limit', () => {
    const r = feed([frame({ content: 'x'.repeat(16_000) }), frame({ content: '끝' })])
    assert.equal(r.truncated, false)
    assert.equal(r.content.endsWith('끝'), true)
  })
})

describe('collectChatStream: pass-through + collection', () => {
  it('RED: does not change the bytes: the client receives the original as is', async () => {
    const chunks = [frame({ content: '안녕 😀' }), frame({ type: 'completed', responseId: 'r' }), 'data: [DONE]\n\n']
    const original = chunks.join('')

    const wrapped = collectChatStream(sseResponse(chunks), () => {})
    assert.equal(await wrapped.text(), original)
  })

  it('onFinish is called exactly once after the stream is fully read', async () => {
    const calls: any[] = []
    const wrapped = collectChatStream(
      sseResponse([frame({ content: 'A' }), frame({ type: 'completed', model: 'm', inputTokens: 1, outputTokens: 2 }), 'data: [DONE]\n\n']),
      c => calls.push(c)
    )
    await wrapped.text()
    assert.equal(calls.length, 1, `onFinish 는 한 번만 불려야 한다 (실제 ${calls.length}회)`)
    assert.equal(calls[0].content, 'A')
    assert.equal(calls[0].model, 'm')
  })

  it('onFinish is called when the stream ends even without [DONE]', async () => {
    const calls: any[] = []
    const wrapped = collectChatStream(sseResponse([frame({ content: 'A' })]), c => calls.push(c))
    await wrapped.text()
    assert.equal(calls.length, 1)
    assert.equal(calls[0].done, false)
  })

  it('RED: the client response does not break even if onFinish throws ([DONE] path)', async () => {
    const chunks = [frame({ content: 'A' }), 'data: [DONE]\n\n']
    const wrapped = collectChatStream(sseResponse(chunks), () => {
      throw new Error('저장 실패')
    })
    assert.equal(await wrapped.text(), chunks.join(''), '저장 실패가 대화를 망치면 안 된다')
  })

  it('RED: an onFinish exception does not break the response even when it ends without [DONE] (flush path)', async () => {
    const chunks = [frame({ content: 'A' })]
    const wrapped = collectChatStream(sseResponse(chunks), () => {
      throw new Error('저장 실패')
    })
    assert.equal(await wrapped.text(), chunks.join(''), 'flush 경로의 저장 실패도 삼켜야 한다')
  })

  it('the body stays intact even if a multibyte character is cut at a chunk boundary', async () => {
    const whole = enc.encode(frame({ content: '한글 🇨🇭 émoji' }) + 'data: [DONE]\n\n')
    const lead = whole.findIndex(b => b >= 0xc0)
    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(whole.slice(0, lead + 1))
        ctrl.enqueue(whole.slice(lead + 1))
        ctrl.close()
      },
    })
    const calls: any[] = []
    const wrapped = collectChatStream(new Response(stream), c => calls.push(c))
    await wrapped.text()
    assert.equal(calls[0].content, '한글 🇨🇭 émoji')
  })

  it('a response with no body is returned as is', () => {
    const r = new Response(null, { status: 204 })
    assert.equal(collectChatStream(r, () => {}), r)
  })
})
