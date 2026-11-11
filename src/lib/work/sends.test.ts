import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeRecipients, isAutoOff, isWebSearchOff, viewStatus, queryFingerprint, SEND_SENDING_LIMIT_MS } from './sends'

test('recipient - empty, blank, empty list, one empty value in a list = all refused', () => {
  assert.deepEqual(normalizeRecipients(' a@x.ch '), ['a@x.ch'])
  assert.deepEqual(normalizeRecipients(['a@x.ch', 'b@x.ch']), ['a@x.ch', 'b@x.ch'])
  for (const bad of [null, undefined, '', '   ', [], [''], ['a@x.ch', ' '], ['a@x.ch', null], 42, {}]) {
    assert.equal(normalizeRecipients(bad), null, JSON.stringify(bad))
  }
})

test('off switch - null, {}, empty list, missing key = not off; an undeclared id does not switch off other auto sends', () => {
  for (const off of [null, undefined, {}, { autoOff: [] }, { webSearchOff: true }, { autoOff: 'x.a' }, [], 'x']) {
    assert.equal(isAutoOff(off, 'x.a'), false, JSON.stringify(off))
  }
  assert.equal(isAutoOff({ autoOff: ['x.ghost'] }, 'x.a'), false)
  assert.equal(isAutoOff({ autoOff: ['x.ghost', 'x.a'] }, 'x.a'), true)
  assert.equal(isWebSearchOff(null), false)
  assert.equal(isWebSearchOff({}), false)
  assert.equal(isWebSearchOff({ webSearchOff: 'true' }), false)
  assert.equal(isWebSearchOff({ webSearchOff: true }), true)
})

test('sending past the limit counts as unknown, other states unchanged', () => {
  const now = new Date('2026-10-10T12:00:00Z')
  const at = (ms: number) => new Date(now.getTime() - ms)
  assert.equal(viewStatus({ status: 'sending', claimedAt: at(SEND_SENDING_LIMIT_MS - 1) }, now), 'sending')
  assert.equal(viewStatus({ status: 'sending', claimedAt: at(SEND_SENDING_LIMIT_MS + 1) }, now), 'unknown')
  for (const s of ['pending', 'sent', 'failed', 'unknown', 'refused', 'discarded']) {
    assert.equal(viewStatus({ status: s, claimedAt: at(SEND_SENDING_LIMIT_MS * 10) }, now), s)
  }
})

test('query fingerprint changes when the SQL or parameter names change', () => {
  const a = queryFingerprint({ sql: 'UPDATE t SET x = $1', params: ['x'] })
  assert.equal(a, queryFingerprint({ sql: 'UPDATE t SET x = $1', params: ['x'] }))
  assert.notEqual(a, queryFingerprint({ sql: 'UPDATE t SET x = $1 ', params: ['x'] }))
  assert.notEqual(a, queryFingerprint({ sql: 'UPDATE t SET x = $1', params: ['y'] }))
})
