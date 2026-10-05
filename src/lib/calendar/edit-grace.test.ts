import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isWithinEditGrace, BOOKING_EDIT_GRACE_MS } from './edit-grace'

const NOW = Date.parse('2026-09-21T14:29:00Z')

test('isWithinEditGrace: reads both Google created and Outlook createdDateTime (7 fractional digits)', () => {
  assert.equal(isWithinEditGrace({ created: '2026-09-21T14:27:40.000Z' }, NOW), true)
  assert.equal(isWithinEditGrace({ createdDateTime: '2026-09-21T14:27:40.1234567Z' }, NOW), true)
})

test('isWithinEditGrace: after 1 hour the policy applies again', () => {
  assert.equal(isWithinEditGrace({ created: new Date(NOW - BOOKING_EDIT_GRACE_MS + 1000).toISOString() }, NOW), true)
  assert.equal(isWithinEditGrace({ created: new Date(NOW - BOOKING_EDIT_GRACE_MS).toISOString() }, NOW), false)
  assert.equal(isWithinEditGrace({ created: '2026-09-20T14:29:00Z' }, NOW), false)
})

test('isWithinEditGrace: false if the creation time is unknown - the policy applies as is (the safe side)', () => {
  for (const ev of [null, undefined, {}, { created: '' }, { created: 'not a date' }, { created: 12345 }, { createdDateTime: null }]) {
    assert.equal(isWithinEditGrace(ev as any, NOW), false, JSON.stringify(ev))
  }
})

test('isWithinEditGrace: accepts a slightly skewed future creation time due to clock drift, but not a large skew', () => {
  assert.equal(isWithinEditGrace({ created: new Date(NOW + 60_000).toISOString() }, NOW), true)
  assert.equal(isWithinEditGrace({ created: new Date(NOW + 10 * 60_000).toISOString() }, NOW), false)
})
