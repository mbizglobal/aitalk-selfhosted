import { test } from 'node:test'
import assert from 'node:assert/strict'
import { enterTurn } from './app-scope'

const later = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

test('the next turn waits for the previous one - even while the previous turn is still thinking (before saving)', async () => {
  const order: string[] = []
  const a = enterTurn('k1', 1000)
  await a.wait
  const b = enterTurn('k1', 1000)
  const bDone = b.wait.then(() => order.push('b'))
  await later(20)
  order.push('a-saved')
  a.release()
  await bDone
  assert.deepEqual(order, ['a-saved', 'b'])
  b.release()
})

test('three overlapping go one at a time - C waits for B to save', async () => {
  const order: string[] = []
  const a = enterTurn('k2', 1000); await a.wait
  const b = enterTurn('k2', 1000)
  const c = enterTurn('k2', 1000)
  const bRun = b.wait.then(async () => { order.push('b-start'); await later(20); order.push('b-saved'); b.release() })
  const cRun = c.wait.then(() => { order.push('c-start'); c.release() })
  await later(10); order.push('a-saved'); a.release()
  await Promise.all([bRun, cRun])
  assert.deepEqual(order, ['a-saved', 'b-start', 'b-saved', 'c-start'])
})

test('other conversations (room, task) do not wait', async () => {
  const a = enterTurn('p|t|team', 1000); await a.wait
  const t0 = Date.now()
  const b = enterTurn('p|t|private:human', 1000); await b.wait
  assert.ok(Date.now() - t0 < 50)
  a.release(); b.release()
})

test('a very long previous turn waits only up to the limit - releasing twice is fine - finished entries are cleared', async () => {
  const keep = setInterval(() => {}, 10)
  const a = enterTurn('k3', 1000); await a.wait
  const t0 = Date.now()
  const b = enterTurn('k3', 50); await b.wait
  clearInterval(keep)
  assert.ok(Date.now() - t0 < 500)
  a.release(); a.release(); b.release()
  await later(5)
  const t1 = Date.now()
  const c = enterTurn('k3', 1000); await c.wait
  assert.ok(Date.now() - t1 < 50)
  c.release()
})
