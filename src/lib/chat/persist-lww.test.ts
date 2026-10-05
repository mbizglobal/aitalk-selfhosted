import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldOverwritePersistedConversation } from './persist-lww'

const ME = { writerId: 'tab-b', revision: 5, lastUpdated: '2026-07-30T10:00:00.000Z' }

test('writes when there is no stored copy', () => {
  assert.equal(shouldOverwritePersistedConversation(null, ME), true)
  assert.equal(shouldOverwritePersistedConversation(undefined, ME), true)
})

test('same tab: does not write if the stored revision is larger', () => {
  assert.equal(
    shouldOverwritePersistedConversation({ writerId: 'tab-b', writerRevision: 6 }, ME),
    false
  )
})

test('same tab: writes if my revision is larger or equal', () => {
  assert.equal(shouldOverwritePersistedConversation({ writerId: 'tab-b', writerRevision: 4 }, ME), true)
  assert.equal(shouldOverwritePersistedConversation({ writerId: 'tab-b', writerRevision: 5 }, ME), true)
})

test('same tab: saving does not stall even if the clock goes backwards (1)', () => {
  const existing = { writerId: 'tab-b', writerRevision: 4, lastUpdated: '2027-01-01T00:00:00.000Z' }
  assert.equal(shouldOverwritePersistedConversation(existing, ME), true)
})

test('same tab: overwrites an old stored copy without writerRevision', () => {
  assert.equal(shouldOverwritePersistedConversation({ writerId: 'tab-b' }, ME), true)
})

test('other tab: does not write if the stored copy is newer', () => {
  const existing = { writerId: 'tab-a', lastUpdated: '2026-07-30T10:00:01.000Z' }
  assert.equal(shouldOverwritePersistedConversation(existing, ME), false)
})

test('other tab: writes if the stored copy is older', () => {
  const existing = { writerId: 'tab-a', lastUpdated: '2026-07-30T09:59:59.000Z' }
  assert.equal(shouldOverwritePersistedConversation(existing, ME), true)
})

test('other tab: the same millisecond is broken deterministically by writerId lexical order (2)', () => {
  assert.equal(
    shouldOverwritePersistedConversation({ writerId: 'tab-a', lastUpdated: ME.lastUpdated }, ME),
    true
  )
  assert.equal(
    shouldOverwritePersistedConversation({ writerId: 'tab-c', lastUpdated: ME.lastUpdated }, ME),
    false
  )
})

test('the same-millisecond tie-break must be asymmetric: no back-and-forth where each side overwrites the other', () => {
  const at = '2026-07-30T10:00:00.000Z'
  const a = { writerId: 'tab-a', revision: 1, lastUpdated: at }
  const b = { writerId: 'tab-b', revision: 1, lastUpdated: at }
  const aOverB = shouldOverwritePersistedConversation({ writerId: b.writerId, lastUpdated: at }, a)
  const bOverA = shouldOverwritePersistedConversation({ writerId: a.writerId, lastUpdated: at }, b)
  assert.notEqual(aOverB, bOverA)
})

test('writes when the time cannot be read, so saving does not stop when there is no basis for a decision', () => {
  assert.equal(shouldOverwritePersistedConversation({ writerId: 'tab-a' }, ME), true)
  assert.equal(
    shouldOverwritePersistedConversation({ writerId: 'tab-a', lastUpdated: 'not-a-date' }, ME),
    true
  )
  assert.equal(
    shouldOverwritePersistedConversation({ writerId: 'tab-a', lastUpdated: ME.lastUpdated }, { ...ME, lastUpdated: null }),
    true
  )
})

test('an old stored copy without writerId is also compared by time', () => {
  const newer = { lastUpdated: '2026-07-30T10:00:05.000Z' }
  const older = { lastUpdated: '2026-07-30T09:00:00.000Z' }
  assert.equal(shouldOverwritePersistedConversation(newer, ME), false)
  assert.equal(shouldOverwritePersistedConversation(older, ME), true)
})
