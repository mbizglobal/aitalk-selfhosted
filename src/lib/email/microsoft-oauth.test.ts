import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseMicrosoftEmailConnectType } from './microsoft-oauth'

test('connection type check: the 3 allowed values pass as they are', () => {
  assert.equal(parseMicrosoftEmailConnectType('imap'), 'imap')
  assert.equal(parseMicrosoftEmailConnectType('smtp'), 'smtp')
  assert.equal(parseMicrosoftEmailConnectType('both'), 'both')
})

test('RED connection type check: an unknown value is null, not widened', () => {
  for (const bad of [
    null, undefined, '', ' ', 'IMAP', 'Imap', 'imap ', ' imap', 'imaps', 'smt', 'all',
    'imap,smtp', 'both\n', 0, 1, true, false, {}, [], ['imap'], { type: 'imap' },
    Object.create({ toString: () => 'imap' }),
  ]) {
    assert.equal(
      parseMicrosoftEmailConnectType(bad as unknown), null,
      `${JSON.stringify(bad) ?? String(bad)} 가 통과했다`
    )
  }
})

test('connection type check: not bypassed by prototype pollution', () => {
  const polluted: any = {}
  Object.setPrototypeOf(polluted, { valueOf: () => 'both' })
  assert.equal(parseMicrosoftEmailConnectType(polluted), null)
})
