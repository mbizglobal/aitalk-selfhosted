import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isItems, newItemId, numericKeys, sumMoney, tidyItems } from './RowEditor'

test('sumMoney - integer cents - skips empty values - null when unreadable', () => {
  assert.equal(sumMoney([{ a: '0.10' }, { a: '0.20' }, { a: '842.2' }], 'a'), 84250)
  assert.equal(sumMoney([{ a: '1.00' }, { b: 'x' }, { a: '' }], 'a'), 100)
  assert.equal(sumMoney([{ a: 5 }], 'a'), 500)
  assert.equal(sumMoney([{ a: '1.005' }], 'a'), null)
  assert.equal(sumMoney([{ a: 'abc' }], 'a'), null)
})

test('tidyItems - trims only screen fields - empty text drops the key - keys not on screen and other values untouched', () => {
  assert.deepEqual(
    tidyItems([{ merchant: 'Coffee Shop ', category: '  ', no: 3, receiptMissing: true, description: ' 원문 ', note: '' }], ['merchant', 'category', 'no']),
    [{ merchant: 'Coffee Shop', no: 3, receiptMissing: true, description: ' 원문 ', note: '' }],
  )
})

test('newItemId - server rule shape - differs from existing ids', () => {
  const id = newItemId([{ id: 'abc' }])
  assert.match(id, /^[A-Za-z0-9_-]{6,24}$/)
  assert.notEqual(id, 'abc')
})

test('isItems - object arrays only', () => {
  assert.equal(isItems([{ a: 1 }]), true)
  assert.equal(isItems([]), true)
  assert.equal(isItems([1]), false)
  assert.equal(isItems({ a: 1 }), false)
})

test('tidyItems - fields that started as numbers stay numbers - no becomes a number only for integer text - text being typed is tidied only on save', () => {
  const before = [{ id: 'aaaaaa', amount: 10, no: 1 }]
  const edited = [{ id: 'aaaaaa', amount: '12.5 ', no: '1.5' }, { id: 'bbbbbb', amount: '7', no: '2' }]
  assert.deepEqual(tidyItems(edited, ['amount', 'no'], numericKeys(before)), [{ id: 'aaaaaa', amount: 12.5, no: '1.5' }, { id: 'bbbbbb', amount: '7', no: 2 }])
})

test('numericKeys - same id several times merges numeric fields', () => {
  const m = numericKeys([{ id: 'x', amount: 1 }, { id: 'x', tax: 2 }, { amount: 3 }, { tax: 4 }])
  assert.deepEqual([...(m.get('x') ?? [])].sort(), ['amount', 'tax'])
  assert.deepEqual([...(m.get(undefined) ?? [])].sort(), ['amount', 'tax'])
})

test('follow-up pick - category to account (hints opt_<value>) - changes only when empty or still the previous pair', async () => {
  const { followedValue, followChange } = await import('./RowEditor')
  const ch = { account: [{ value: '5800', hints: ['opt_meals', 'opt_travel'] }, { value: '6570', hints: ['opt_software'] }, { value: '6600' }] }
  assert.equal(followedValue(ch, 'account', 'travel'), '5800')
  assert.equal(followedValue(ch, 'account', 'other'), null)
  assert.equal(followChange(ch, 'account', '', undefined, 'software'), '6570', '비었으면 채운다')
  assert.equal(followChange(ch, 'account', '5800', 'travel', 'software'), '6570', '바꾸기 전 짝 그대로면 따라간다')
  assert.equal(followChange(ch, 'account', '6600', 'travel', 'software'), undefined, '사람이 따로 고른 값은 둔다')
  assert.equal(followChange(ch, 'account', '5800', 'travel', 'other'), '', '새 분류에 짝이 없으면 비운다(전 짝이었을 때만)')
  assert.equal(followChange(ch, 'account', '5800', 'travel', 'meals'), undefined, '같은 계정이면 그대로')
})
