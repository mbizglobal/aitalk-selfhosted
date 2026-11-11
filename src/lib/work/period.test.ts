import { test } from 'node:test'
import assert from 'node:assert/strict'
import { periodContaining, zurichToday } from './dates'

const p = (rule: string, d: unknown) => periodContaining(rule, d)

test('quarter boundaries - 3-31 = Q1, 4-1 = Q2, 12-31 = Q4 of that year, 1-1 = Q1 of that year', () => {
  assert.deepEqual(p('quarter', '2026-03-31'), { title: '2026 Q1', periodStart: '2026-01-01', periodEnd: '2026-03-31' })
  assert.deepEqual(p('quarter', '2026-04-01'), { title: '2026 Q2', periodStart: '2026-04-01', periodEnd: '2026-06-30' })
  assert.deepEqual(p('quarter', '2026-09-30'), { title: '2026 Q3', periodStart: '2026-07-01', periodEnd: '2026-09-30' })
  assert.deepEqual(p('quarter', '2026-12-31'), { title: '2026 Q4', periodStart: '2026-10-01', periodEnd: '2026-12-31' })
  assert.equal(p('quarter', '2027-01-01')?.title, '2027 Q1')
})

test('month and year - last day, leap year', () => {
  assert.deepEqual(p('month', '2028-02-29'), { title: '2028-02', periodStart: '2028-02-01', periodEnd: '2028-02-29' })
  assert.deepEqual(p('month', '2026-02-10'), { title: '2026-02', periodStart: '2026-02-01', periodEnd: '2026-02-28' })
  assert.deepEqual(p('year', '2026-12-31'), { title: '2026', periodStart: '2026-01-01', periodEnd: '2026-12-31' })
  assert.equal(p('year', '2027-01-01')?.title, '2027')
})

test('non-existent day, wrong shape, time attached, no rule = null', () => {
  for (const d of ['2026-02-29', '2026-04-31', '2026-06-31', '2026-09-31', '2026-11-31', '2026-02-30', '2026-1-1', '2026-01-01T00:00:00Z', '', null, undefined, 20260101, '2026-13-01']) {
    assert.equal(p('quarter', d), null, String(d))
  }
  assert.equal(p('custom', '2026-05-05'), null)
  assert.equal(p('weird', '2026-05-05'), null)
})

test('Zurich today - around midnight', () => {
  assert.equal(zurichToday(new Date('2026-12-31T23:30:00Z')), '2027-01-01')
  assert.equal(zurichToday(new Date('2026-06-30T21:59:00Z')), '2026-06-30')
  assert.equal(zurichToday(new Date('2026-06-30T22:01:00Z')), '2026-07-01')
})
