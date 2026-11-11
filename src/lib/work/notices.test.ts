import { test } from 'node:test'
import assert from 'node:assert/strict'
import { moduleNoticeOf } from './notices'

test('keys and integer values only', () => {
  assert.deepEqual(moduleNoticeOf({ status: 'started', notice: { key: 'notice_run_started', params: { n: 3, levels: 2 } } }), { key: 'notice_run_started', params: { n: 3, levels: 2 } })
  assert.deepEqual(moduleNoticeOf({ notice: { key: 'notice_done' } }), { key: 'notice_done' })
})

test('text, odd keys, decimals, many values = no notice', () => {
  for (const out of [
    null, 'x', { status: 'ok' },
    { notice: { key: 'room_you' } },
    { notice: { key: 'notice_X' } },
    { notice: { key: 'notice_a', params: { who: 'Anna said hi' } } },
    { notice: { key: 'notice_a', params: { n: 1.5 } } },
    { notice: { key: 'notice_a', params: [1] } },
    { notice: { key: 'notice_a', params: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`k${i}`, i])) } },
  ]) assert.equal(moduleNoticeOf(out), null, JSON.stringify(out))
})

test('restore - saved notices keep only the server shape (empty text, key, short values)', async () => {
  const { storedNoticeOf } = await import('./notices')
  assert.deepEqual(storedNoticeOf({ text: '', notice: { key: 'notice_rows_received', params: { from: 'Expenses', n: 3, sheet: 'Orders', family: 'x.orders' } } }), { key: 'notice_rows_received', params: { from: 'Expenses', n: 3, sheet: 'Orders', family: 'x.orders' } })
  for (const b of [
    { text: 'hello', notice: { key: 'notice_task_created' } },
    { text: '', notice: { key: 'room_you' } },
    { text: '', notice: { key: 'notice_task_created', params: { title: 'x'.repeat(201) } } },
    { text: '', notice: { key: 'notice_task_created', params: { title: { nested: 1 } } } },
    { text: '' }, null, 'x',
  ]) assert.equal(storedNoticeOf(b), null, JSON.stringify(b))
})
