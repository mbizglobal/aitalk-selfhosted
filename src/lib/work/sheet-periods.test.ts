import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OPEN_END, uncoveredRanges } from './sheet-periods'

const done = (start: string, end: string) => ({ start, end, status: 'submitted' })
const Q1 = { start: '2026-01-01', end: '2026-03-31' }
const JAN = done('2026-01-01', '2026-01-31')
const FEB = done('2026-02-01', '2026-02-28')
const MAR = done('2026-03-01', '2026-03-31')

test('empty list = the whole range - fully covered = empty array - no gap between two adjacent months', () => {
  assert.deepEqual(uncoveredRanges([], Q1), [Q1])
  assert.deepEqual(uncoveredRanges([JAN, FEB, MAR], Q1), [])
  assert.deepEqual(uncoveredRanges([MAR, JAN, FEB], Q1), [], '순서와 상관없다')
})

test('gaps at the start, middle and end', () => {
  assert.deepEqual(uncoveredRanges([FEB, MAR], Q1), [{ start: '2026-01-01', end: '2026-01-31' }])
  assert.deepEqual(uncoveredRanges([JAN, MAR], Q1), [{ start: '2026-02-01', end: '2026-02-28' }])
  assert.deepEqual(uncoveredRanges([JAN, FEB], Q1), [{ start: '2026-03-01', end: '2026-03-31' }])
  assert.deepEqual(uncoveredRanges([FEB], Q1), [{ start: '2026-01-01', end: '2026-01-31' }, { start: '2026-03-01', end: '2026-03-31' }])
})

test('open, waiting for approval and unknown states do not cover', () => {
  for (const status of ['open', 'awaiting', '']) {
    assert.deepEqual(uncoveredRanges([JAN, { ...FEB, status }, MAR], Q1), [{ start: '2026-02-01', end: '2026-02-28' }], status)
  }
})

test('tasks outside the range - tasks across the range - a one-day range', () => {
  assert.deepEqual(uncoveredRanges([done('2025-12-01', '2025-12-31'), done('2026-04-01', '2026-04-30')], Q1), [Q1])
  assert.deepEqual(uncoveredRanges([done('2025-01-01', '2026-12-31')], Q1), [], '1년 업무 하나가 분기를 덮는다')
  const day = { start: '2026-02-28', end: '2026-02-28' }
  assert.deepEqual(uncoveredRanges([FEB], day), [])
  assert.deepEqual(uncoveredRanges([JAN], day), [day])
  assert.deepEqual(uncoveredRanges([done('2026-02-28', '2026-03-31')], { start: '2026-02-27', end: '2026-02-28' }), [{ start: '2026-02-27', end: '2026-02-27' }], '양 끝 포함')
})

test('range or task ending at OPEN_END - computing the next day does not overflow', () => {
  const open = { start: '2026-01-01', end: OPEN_END }
  assert.deepEqual(uncoveredRanges([done('2026-01-01', OPEN_END)], open), [])
  assert.deepEqual(uncoveredRanges([JAN], open), [{ start: '2026-02-01', end: OPEN_END }])
})
