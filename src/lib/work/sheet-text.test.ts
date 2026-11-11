import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sheetExportTable, sheetCellText, sheetTableLayout, sheetTableColumns, sheetVisibleColumns } from './sheet-text'

const screen = {
  schema: { columns: [
    { name: 'date', type: 'date' }, { name: 'amount', type: 'money' }, { name: 'evidence', type: 'string' },
    { name: 'paid', type: 'boolean' }, { name: 'country', type: 'string' }, { name: 'category', type: 'string' },
    { name: 'secret', type: 'string' }, { name: 'status', type: 'string' }, { name: 'items', type: 'json' },
  ] },
  hidden: ['secret'],
  options: { category: ['travel'] },
  countryColumns: ['country'],
  colLabels: {},
  details: { column: 'items' },
  dotFrom: 'dot',
  derived: {
    columns: [
      { name: 'dot', label: 'dot', type: 'status' },
      { name: 'state', label: 'derived_state', type: 'status', replaces: 'status', after: 'amount' },
      { name: 'tail', label: 'derived_tail', type: 'text', after: 'nope' },
    ],
    cells: { r1: { state: 'paid', tail: 'x', dot: 'green' } },
  },
}

test('field positions - evidence first, hidden, shown-instead fields, detail fields left out, calc fields after their after, missing after at the end, dot fields left out', () => {
  const layout = sheetTableLayout(screen, sheetTableColumns(screen, sheetVisibleColumns(screen)))
  assert.deepEqual(layout.map((x) => `${x.kind[0]}:${x.col.name}`), ['s:evidence', 's:date', 's:amount', 'd:state', 's:paid', 's:country', 's:category', 'd:tail'])
})

test('field text - yes/no, empty yes/no, country, pick translation keys, objects, numbers', () => {
  assert.equal(sheetCellText('en', true, undefined, null, { name: 'paid', boolean: true }), 'Yes')
  assert.equal(sheetCellText('en', null, undefined, null, { name: 'paid', boolean: true }), '')
  assert.equal(sheetCellText('en', 'DE', undefined, null, { name: 'country', country: true }), 'Germany (DE)')
  assert.equal(sheetCellText('en', 'other', ['travel'], null, { name: 'category' }), 'other')
  assert.equal(sheetCellText('en', [1, 2], undefined, null), '[1,2]')
  assert.equal(sheetCellText('en', 12.5, undefined, null), '12.5')
})

test('download table - header - right alignment (money) - calc field values - calc rows leave calc fields empty', () => {
  const t = sheetExportTable('en', null, screen, [{ id: 'r1', data: { date: '2026-10-01', amount: '4.50', evidence: 'ok', paid: false, country: 'CH', category: 'travel' } }, { id: 'v', virtual: true, data: {} }])
  assert.equal(t.header.length, 8)
  assert.equal(t.align[2], 'right')
  assert.equal(t.rows[0][3], 'paid')
  assert.equal(t.rows[0][5], 'Switzerland (CH)')
  assert.equal(t.rows[1][3], '')
  assert.equal(t.rows[1][7], '')
})

test('download table - only My forms form sheets expand item fields - other templates still drop detail rows', () => {
  const base = {
    schema: { columns: [{ name: 'f_d', type: 'date' }, { name: 'f_it', type: 'json' }] },
    hidden: [], options: {}, labels: { f_d: 'Date', f_it: 'Lines', i_a: 'Item', i_b: 'Covered' },
    details: { column: 'f_it', columns: ['i_a', 'i_b'], money: [], booleans: ['i_b'], label: 'f_it' },
  }
  const rows = [{ id: 'r1', data: { f_d: '2026-10-12', f_it: [{ i_a: 'Labor', i_b: true }, { i_a: 'X' }] } }, { id: 'r2', data: { f_d: '2026-10-13' } }]
  const mine = sheetExportTable('en', null, { ...base, formId: 'f1' }, rows)
  assert.deepEqual(mine.header, ['Date'])
  assert.equal(mine.items?.label, 'Lines')
  assert.deepEqual(mine.items?.header, ['Item', 'Covered'])
  assert.deepEqual(mine.items?.rows, [[['Labor', 'Yes'], ['X', '']], []])
  assert.equal(sheetExportTable('en', null, base, rows).items, undefined)
})
