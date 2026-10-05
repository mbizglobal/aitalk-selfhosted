import { test } from 'node:test'
import assert from 'node:assert/strict'
import { phoneSuffixMatch, normalizePhoneForStorage } from './phone-match'

test('phoneSuffixMatch: an E.164 needle matches a locally stored number by its last digits', () => {
  assert.equal(phoneSuffixMatch('Phone: 0791234567', '+41791234567'), true)
})

test('phoneSuffixMatch: stored numbers with mixed separators also match as one run', () => {
  assert.equal(phoneSuffixMatch('Phone: 079-123-4567', '0791234567'), true)
  assert.equal(phoneSuffixMatch('Phone: (079) 123 4567', '0791234567'), true)
})

test('phoneSuffixMatch: needles of 7 digits or fewer are rejected (collision risk)', () => {
  assert.equal(phoneSuffixMatch('Phone: 1234567', '1234567'), false)
})

test('phoneSuffixMatch: empty input is false', () => {
  assert.equal(phoneSuffixMatch('', '0791234567'), false)
  assert.equal(phoneSuffixMatch('Phone: 0791234567', ''), false)
})

test('phoneSuffixMatch: endsWith - a run with extra digits after it is rejected (not a substring)', () => {
  assert.equal(phoneSuffixMatch('Phone: 0791234567 30', '0791234567'), false)
})

test('phoneSuffixMatch: a line break does not merge runs (prevents wrongly merging fields)', () => {
  assert.equal(phoneSuffixMatch('1234\n5678', '12345678'), false)
})

test('phoneSuffixMatch: \':\' does not merge runs (protects ISO times like 09:00)', () => {
  assert.equal(phoneSuffixMatch('1234:5678', '12345678'), false)
})

test('phoneSuffixMatch: even if another person\'s number is in the same description, only the person\'s own run matches', () => {
  const haystack = 'Name: A\nPhone: 0791234567\nNote: ref 0799999999'
  assert.equal(phoneSuffixMatch(haystack, '+41791234567'), true)
  assert.equal(phoneSuffixMatch(haystack, '+41788888888'), false)
})

test('normalizePhoneForStorage: removes local separators -> digits only', () => {
  assert.equal(normalizePhoneForStorage('079-123-4567'), '0791234567')
})

test('normalizePhoneForStorage: E.164 keeps the leading +', () => {
  assert.equal(normalizePhoneForStorage('+41 79 123 45 67'), '+41791234567')
})

test('normalizePhoneForStorage: keeps the + even after leading whitespace (decided after trim)', () => {
  assert.equal(normalizePhoneForStorage('  +41791234567 '), '+41791234567')
})

test('normalizePhoneForStorage: empty or digit-less input stays as the original (prevents losing meaning)', () => {
  assert.equal(normalizePhoneForStorage(''), '')
  assert.equal(normalizePhoneForStorage('abc'), 'abc')
  assert.equal(normalizePhoneForStorage('+abc'), '+abc')
})
