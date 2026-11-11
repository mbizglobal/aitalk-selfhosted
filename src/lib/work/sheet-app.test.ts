import { test } from 'node:test'
import assert from 'node:assert/strict'
import { webScreenRows } from './sheet-app'

type S = Parameters<typeof webScreenRows>[2]
const screen = (over: Partial<S> = {}): S => ({ paging: null, dateColumn: 'date', effectiveFromColumn: null, hideWhen: null, sortBy: null, schema: { columns: [{ name: 'date', type: 'date' }, { name: 'n', type: 'number' }, { name: 'closed', type: 'string' }] }, options: {}, countryColumns: [], ...over } as unknown as S)
const row = (id: string, date: string, extra: Record<string, unknown> = {}) => ({ id, data: { date, ...extra }, confirmed: false, confirmedByAi: false, locked: false, updatedAt: new Date() }) as never
const ids = (r: Array<{ id: string }>) => r.map((x) => x.id)

test('period and date descending - rows outside the period are left out', () => {
  const rows = [row('a', '2026-01-05'), row('b', '2026-03-01'), row('c', '2026-02-10'), row('d', '2025-12-31')]
  assert.deepEqual(ids(webScreenRows('en', null, screen(), rows, { period: { start: '2026-01-01', end: '2026-12-31' } })), ['b', 'c', 'a'])
  assert.deepEqual(ids(webScreenRows('en', null, screen(), rows, {})), ['b', 'c', 'a', 'd'])
})

test('hidden rows (ui.hideWhen) - left out by default, included with showHidden', () => {
  const rows = [row('a', '2026-01-05', { closed: 'yes' }), row('b', '2026-01-06')]
  assert.deepEqual(ids(webScreenRows('en', null, screen({ hideWhen: 'closed' } as Partial<S>), rows, {})), ['b'])
  assert.deepEqual(ids(webScreenRows('en', null, screen({ hideWhen: 'closed' } as Partial<S>), rows, { showHidden: true })), ['b', 'a'])
})

test('sort - the chosen one - otherwise the template sortBy (numeric fields as numbers)', () => {
  const rows = [row('a', '2026-01-01', { n: 10 }), row('b', '2026-01-02', { n: 9 }), row('c', '2026-01-03', { n: 100 })]
  assert.deepEqual(ids(webScreenRows('en', null, screen(), rows, { sort: { col: 'n', dir: 'asc' } })), ['b', 'a', 'c'])
  assert.deepEqual(ids(webScreenRows('en', null, screen({ sortBy: { column: 'n', dir: 'desc' } } as Partial<S>), rows, {})), ['c', 'a', 'b'])
})

test('a paged screen was already filtered and sorted by the server - unchanged', () => {
  const rows = [row('a', '2025-01-01'), row('b', '2027-01-01')]
  assert.deepEqual(ids(webScreenRows('en', null, screen({ paging: {} } as Partial<S>), rows, { period: { start: '2026-01-01', end: '2026-12-31' } })), ['a', 'b'])
})

test('evidence pick - one value - empty = not decided yet - none = all', () => {
  const rows = [row('a', '2026-01-03', { evidence: 'ok' }), row('b', '2026-01-02'), row('c', '2026-01-01', { evidence: 'missing' })]
  assert.deepEqual(ids(webScreenRows('en', null, screen(), rows, { evidence: 'ok' })), ['a'])
  assert.deepEqual(ids(webScreenRows('en', null, screen(), rows, { evidence: '' })), ['b'])
  assert.deepEqual(ids(webScreenRows('en', null, screen(), rows, {})), ['a', 'b', 'c'])
})
