import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WorkError } from './package-api'
import { ReferenceReader, type ReferenceReadLog, type ReferenceView } from './references'

const at = new Date('2026-10-01T00:00:00Z')
const row = (id: string, data: Record<string, unknown>) => ({ id, sheetId: 's1', data, confirmed: null, confirmedBy: null, createdAt: at, updatedAt: at })
const view: ReferenceView = {
  referenceId: 'r1', sourceProjectId: 'p1', includeUnconfirmed: false, selectors: ['x.invoices'], revising: [], periods: [], pairs: [],
  sheets: [{ id: 's1', name: 'Invoices', template: null, family: 'x.invoices', schema: { columns: [{ name: 'number', type: 'string' }, { name: 'date', type: 'date' }, { name: 'note', type: 'string' }] } as never }],
  rows: [row('a', { number: '1', date: '2026-07-01', note: 'x' }), row('b', { number: '2', date: '2026-08-01', note: 'y' }), row('c', { number: '3', date: '2026-09-01', note: 'z' })],
}
const code = (fn: () => unknown) => { try { fn(); return null } catch (e) { return e instanceof WorkError ? e.code : String(e) } }

test('ids = only those rows - read records only those rows - together with column picks', () => {
  const log: ReferenceReadLog = new Map()
  const r = new ReferenceReader([view], log)
  const out = r.rows('r1', 's1', { ids: ['c', 'a', 'zz'], columns: ['number'] })
  assert.deepEqual(out.map((x) => x.id).sort(), ['a', 'c'])
  assert.deepEqual(out[0].data, { number: out[0].id === 'a' ? '1' : '3' })
  assert.deepEqual([...log.get('r1')!.rows].sort(), ['a', 'c'])
  assert.deepEqual([...(log.get('r1')!.cols.get('a') ?? [])], ['number'])
  assert.deepEqual([...(log.get('r1')!.watched ?? [])].sort(), ['a', 'c'])
  const log2: ReferenceReadLog = new Map()
  const all = new ReferenceReader([view], log2).rows('r1', 's1', { ids: ['b'] })
  assert.deepEqual(all.map((x) => x.data.note), ['y'])
  assert.deepEqual([...log2.get('r1')!.rows], ['b'])
  assert.equal(log2.get('r1')!.cols.get('b'), null)
})

test('ids rejected - empty list, over 500, empty text, with dateIn or watch', () => {
  const r = new ReferenceReader([view])
  assert.equal(code(() => r.rows('r1', 's1', { ids: [] })), 'INVALID')
  assert.equal(code(() => r.rows('r1', 's1', { ids: Array.from({ length: 501 }, (_, i) => `x${i}`) })), 'INVALID')
  assert.equal(code(() => r.rows('r1', 's1', { ids: [''] })), 'INVALID')
  assert.equal(code(() => r.rows('r1', 's1', { ids: ['a'], dateIn: { columns: ['date'], range: { start: '2026-07-01', end: '2026-09-30' } } })), 'INVALID')
  assert.equal(code(() => r.rows('r1', 's1', { ids: ['a'], dateIn: { columns: ['date'], range: { start: '2026-07-01', end: '2026-09-30' } }, watch: true })), 'INVALID')
  assert.equal(r.rows('r1', 's1').length, 3)
})
