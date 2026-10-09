/**
 * Example Work App — tests without a database: registration next to VAT, CSV parsing, money, the total, and the import
 * module with fake handles (the handles are the only way to the database — so a fake ctx is enough).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { composeWorkApps } from '@/lib/work/registry'
import type { ModuleRunCtx, WorkAppToolCtx } from '@/lib/work/package-api'
import { vatWorkApp } from '@/work-apps/vat'
import { exampleWorkApp } from '.'
import { fromCents, toCents } from './money'
import { importCsvModule, parseExpensesCsv, splitCsvLine } from './modules/import-csv'
import { sumRows, totalModule } from './modules/total'
import { summaryTool } from './tools'

const stopCode = (fn: () => unknown) => {
  try { fn() } catch (e) { return (e as { stop?: { code: string } }).stop?.code ?? (e as { code?: string }).code }
  return null
}
const stopped = (code: string) => (e: { stop?: { code: string } }) => e.stop?.code === code

test('registers next to VAT — core 2, English only', () => {
  const vat = vatWorkApp()
  const ex = exampleWorkApp()
  const r = composeWorkApps([() => vat, () => ex], [vat.meta, ex.meta])
  assert.deepEqual(r.appTemplates.map((a) => a.kind), ['vat', 'example'])
  assert.deepEqual(Object.keys(ex.meta.i18n), ['en'])
  // Same column names as VAT (date · amount) — the keys do not collide because they start with "example."
  assert.ok('col_amount' in vat.meta.i18n.en && 'example.col_amount' in ex.meta.i18n.en)
})

test('every stop code used in the app has an English text', () => {
  const keys = exampleWorkApp().meta.i18n.en
  for (const c of ['row_value_missing', 'csv_not_text', 'csv_header', 'csv_line', 'csv_empty', 'sheet_missing', 'csv_already_imported']) assert.ok(keys[`example.stop_${c}`], c)
})

test('money — text ↔ cents', () => {
  assert.equal(toCents('12.5'), BigInt(1250))
  assert.equal(toCents('-3.10'), BigInt(-310))
  assert.equal(toCents('7'), BigInt(700))
  for (const bad of ['1.234', '', ' ', 'abc', '1,50', '+1.00', null, 12.5]) assert.equal(toCents(bad), null, String(bad))
  assert.equal(fromCents(BigInt(-5)), '-0.05')
  assert.equal(fromCents(BigInt(123456)), '1234.56')
})

test('CSV — header, blank lines, commas in the description, BOM; bad lines stop with the line number', () => {
  const csv = '﻿date,description,amount\r\n2026-07-03,Train ticket,12.50\n\n2026-07-04,Lunch, team,40\n'
  assert.deepEqual(parseExpensesCsv(csv), [
    { date: '2026-07-03', description: 'Train ticket', amount: '12.50' },
    { date: '2026-07-04', description: 'Lunch, team', amount: '40' },
  ])
  assert.equal(stopCode(() => parseExpensesCsv('when,what,how much\n')), 'csv_header')
  assert.equal(stopCode(() => parseExpensesCsv('date,description,amount\n')), 'csv_empty')
  assert.equal(stopCode(() => parseExpensesCsv('date,description,amount\n2026-02-30,x,1')), 'csv_line')
  assert.equal(stopCode(() => parseExpensesCsv('date,description,amount\n2026-02-01,,1')), 'csv_line')
  assert.throws(() => parseExpensesCsv('date,description,amount\n2026-07-01,a,1\n2026-07-02,b,x'), (e: { stop?: unknown }) => {
    assert.deepEqual(e.stop, { code: 'csv_line', params: { line: 3 } })
    return true
  })
})

test('CSV — quoted fields (as spreadsheets export them) and a header with spaces', () => {
  assert.deepEqual(splitCsvLine('a,"b, c","say ""hi""", d '), ['a', 'b, c', 'say "hi"', 'd'])
  assert.equal(splitCsvLine('a,"open'), null)
  // A quote only opens a field — in the middle, or text after the closing quote, makes the line malformed
  for (const bad of ['2026-07-04,Lunch,"12"50', '2026-07-04,Lu"nch",1', '2026-07-04,"Lunch" x,1']) assert.equal(splitCsvLine(bad), null, bad)
  assert.equal(stopCode(() => parseExpensesCsv('date,description,amount\n2026-07-04,Lunch,"12"50')), 'csv_line')
  assert.deepEqual(splitCsvLine('"",x'), ['', 'x'])
  assert.deepEqual(parseExpensesCsv('"Date", Description ,AMOUNT\n"2026-07-04","Lunch, team","40.00"'), [{ date: '2026-07-04', description: 'Lunch, team', amount: '40.00' }])
  assert.equal(stopCode(() => parseExpensesCsv('date,description,amount\n2026-07-04,"Lunch,40')), 'csv_line')
})

test('total — sums the period rows; preview splits confirmed and all rows', async () => {
  const rows = [
    { id: 'a', sheetId: 's', family: 'example.expenses', data: { amount: '10.00' }, confirmed: true },
    { id: 'b', sheetId: 's', family: 'example.expenses', data: { amount: '2.55' }, confirmed: false },
  ]
  assert.deepEqual(sumRows(rows), { total: '12.55', count: 2 })
  assert.deepEqual(sumRows([]), { total: '0.00', count: 0 })
  assert.equal(stopCode(() => sumRows([{ data: {} }])), 'row_value_missing')
  const ctx = { periodRows: () => rows } as unknown as Parameters<typeof totalModule.run>[0]
  assert.deepEqual(await totalModule.preview!(ctx, {}), { confirmed: { total: '10.00', count: 1 }, draft: { total: '12.55', count: 2 }, unconfirmed: 1 })
})

type FakeWriter = { rows(sheetId: string): Promise<unknown[]>; insert(sheetId: string, data: Record<string, unknown>): Promise<unknown> }
function fakeCtx(over: { mime?: string; text?: string; sheets?: Array<{ id: string; name: string; template: string }>; existing?: Array<{ data: Record<string, unknown> }> } = {}) {
  const inserted: Array<{ sheetId: string; data: Record<string, unknown> }> = []
  const writes: string[][] = []
  const ctx = {
    files: {
      async info(id: string) { return id === 'f1' ? { id, mimeType: over.mime ?? 'text/csv', originalName: 'x.csv', sha256: 'h' } : null },
      async read(id: string) { return { id, sha256: 'h', originalName: 'x.csv', buffer: Buffer.from(over.text ?? 'date,description,amount\n2026-07-03,Train,12.50\n2026-07-05,Taxi,30') } },
    },
    sheets: {
      async list() { return over.sheets ?? [{ id: 's1', name: 'Expenses', template: 'example.expenses@1' }] },
      async write(req: { sheetIds: string[] }, fn: (w: FakeWriter) => Promise<unknown>) {
        writes.push(req.sheetIds)
        return fn({ async rows() { return over.existing ?? [] }, async insert(sheetId, data) { inserted.push({ sheetId, data }); return {} } })
      },
    },
  } as unknown as ModuleRunCtx
  return { ctx, inserted, writes }
}

test('import-csv — reads through the file handle, writes all lines in one write, refuses the same file twice', async () => {
  const f = fakeCtx()
  assert.deepEqual(await importCsvModule.run(f.ctx, { fileId: 'f1' }), { inserted: 2 })
  assert.deepEqual(f.writes, [['s1']])
  assert.deepEqual(f.inserted.map((x) => x.data.description), ['Train', 'Taxi'])
  assert.ok(f.inserted.every((x) => x.data.source === 'h'), 'rows remember the file fingerprint')
  // The same file again → stopped inside the write lock, nothing inserted
  const again = fakeCtx({ existing: [{ data: { source: 'h' } }] })
  await assert.rejects(importCsvModule.run(again.ctx, { fileId: 'f1' }), stopped('csv_already_imported'))
  assert.equal(again.inserted.length, 0)
  assert.deepEqual(await importCsvModule.run(fakeCtx({ mime: 'TEXT/CSV; charset=utf-8' }).ctx, { fileId: 'f1' }), { inserted: 2 })
  await assert.rejects(importCsvModule.run(f.ctx, {}), (e: { code?: string }) => e.code === 'INVALID')
  await assert.rejects(importCsvModule.run(f.ctx, { fileId: 'other-project' }), (e: { code?: string }) => e.code === 'NOT_FOUND')
  await assert.rejects(importCsvModule.run(fakeCtx({ mime: 'application/pdf' }).ctx, { fileId: 'f1' }), stopped('csv_not_text'))
  await assert.rejects(importCsvModule.run(fakeCtx({ sheets: [] }).ctx, { fileId: 'f1' }), stopped('sheet_missing'))
  // A bad line stops before anything is written
  const bad = fakeCtx({ text: 'date,description,amount\n2026-07-03,Train,12.50\noops' })
  await assert.rejects(importCsvModule.run(bad.ctx, { fileId: 'f1' }), stopped('csv_line'))
  assert.equal(bad.inserted.length, 0)
})

test('example_summary — counts rows and unconfirmed rows (no totals — those come from example.total)', async () => {
  const ctx = {
    sheets: {
      async list() { return [{ id: 's1', name: 'Expenses', template: 'example.expenses@1' }] },
      async read() { return { rows: [{ data: { amount: '1.00' }, confirmed: true }, { data: { amount: '2.00' }, confirmed: false }] } },
    },
  } as unknown as WorkAppToolCtx
  assert.deepEqual(await summaryTool.run(ctx, {}), { rows: 2, unconfirmed: 1 })
})
