import { test } from 'node:test'
import assert from 'node:assert/strict'
import { streamThenSave, type TurnStreamEnd } from './turn-stream'

const enc = new TextEncoder()
const sse = (s: string) => enc.encode(`data: ${JSON.stringify({ content: s })}\n\n`)
const tick = () => new Promise((r) => setTimeout(r, 5))

function source(parts: string[], opts: { failAt?: number } = {}) {
  let i = 0
  return new ReadableStream<Uint8Array>({
    async pull(c) {
      await tick()
      if (opts.failAt === i) { c.error(new Error('upstream broke')); return }
      if (i < parts.length) c.enqueue(sse(parts[i++]))
      else { c.enqueue(enc.encode('data: [DONE]\n\n')); c.close() }
    },
  })
}

async function readAll(s: ReadableStream<Uint8Array>) {
  const r = s.getReader()
  let text = ''
  for (;;) { const { done, value } = await r.read(); if (done) break; text += new TextDecoder().decode(value) }
  return text
}

test('reading to the end - the client gets the bytes unchanged and saving is done when the stream closes', async () => {
  let saved: TurnStreamEnd | null = null
  const out = streamThenSave(source(['Hel', 'lo']), async (end) => { await tick(); await tick(); saved = end })
  const text = await readAll(out)
  assert.ok(saved, '닫힌 뒤에는 저장돼 있어야 한다(화면이 그때 대화를 다시 읽는다)')
  assert.equal(saved!.content, 'Hello')
  assert.equal(saved!.readFailed, false)
  assert.ok(text.includes('"content":"Hel"') && text.includes('[DONE]'))
})

test('when the client disconnects after the first chunk - the server reads to the end and saves the whole answer', async () => {
  let resolveSaved!: (e: TurnStreamEnd) => void
  const savedP = new Promise<TurnStreamEnd>((r) => { resolveSaved = r })
  const out = streamThenSave(source(['one ', 'two ', 'three']), async (end) => { resolveSaved(end) })
  const r = out.getReader()
  await r.read()
  await r.cancel()
  const saved = await savedP
  assert.equal(saved.content, 'one two three')
  assert.equal(saved.readFailed, false)
})

test('when the source breaks midway - up to what was collected - readFailed reported once', async () => {
  const calls: TurnStreamEnd[] = []
  const out = streamThenSave(source(['a', 'b', 'c'], { failAt: 2 }), async (end) => { calls.push(end) })
  await assert.rejects(readAll(out))
  await tick(); await tick()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].content, 'ab')
  assert.equal(calls[0].readFailed, true)
})

test('when saving throws - the client stream still closes', async () => {
  const out = streamThenSave(source(['x']), async () => { throw new Error('db down') })
  const text = await readAll(out)
  assert.ok(text.includes('[DONE]'))
})
