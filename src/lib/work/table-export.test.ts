import { test } from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import { parseExportTable, tableCsv, tablePdf, tableXlsx } from './table-export'

const t = parseExportTable({ header: ['날짜', '구분', '거래처', '세액'], rows: [['10월 28일', '영수증', 'Google LLC', 'CHF 0.71'], ['11월 1일', '청구서', '=HYPERLINK("x")', '1,234.50'], ['짧은 줄']], align: ['left', 'left', 'left', 'right'] })

test('table — header · rows padded to the header · align · limits', () => {
  assert.deepEqual(t.rows[2], ['짧은 줄', '', '', ''])
  assert.deepEqual(t.align, ['left', 'left', 'left', 'right'])
  assert.throws(() => parseExportTable({ header: [], rows: [] }), /header/)
  assert.throws(() => parseExportTable({ header: ['a'], rows: Array.from({ length: 5001 }, () => ['x']) }), /rows/)
})

test('csv — BOM · quotes · a formula becomes text', () => {
  const s = tableCsv(t).toString('utf8')
  assert.ok(s.startsWith('﻿날짜,구분,거래처,세액'))
  assert.ok(s.includes(`"'=HYPERLINK(""x"")"`), s)
  assert.ok(s.includes('"1,234.50"'))
})

test('xlsx — numbers as numbers · currency text stays text · a formula is a string cell', async () => {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await tableXlsx(t) as never)
  const ws = wb.getWorksheet('Table')!
  assert.equal(ws.getCell('D3').value, 1234.5)
  assert.equal(ws.getCell('D2').value, 'CHF 0.71')
  assert.equal(ws.getCell('C3').value, '=HYPERLINK("x")')
  assert.equal(ws.getCell('A1').font?.bold, true)
})

test('pdf — a PDF with the Korean font · many rows go on to more pages', async () => {
  const one = await tablePdf(t)
  assert.equal(one.subarray(0, 5).toString(), '%PDF-')
  const many = await tablePdf(parseExportTable({ header: ['a', 'b'], rows: Array.from({ length: 400 }, (_, i) => [String(i), '긴 글 '.repeat(5)]) }))
  assert.ok((many.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length > 1)
})

test('code review R1 — negative-looking formulas · CR inside a cell · leading zeros and long numbers stay text · PDF columns · a cell longer than a page', async () => {
  const r = parseExportTable({ header: ['a', 'b'], rows: [['-1+2', '-5'], ['x\ry', '-1,234.50'], ['0012', '1234567890123456'], ['0', '0.5']] })
  const s = tableCsv(r).toString('utf8')
  assert.ok(s.includes("'-1+2") && s.includes(',-5\r\n'), s)
  assert.ok(s.includes(',x y,') || s.includes('\nx y,'), s)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await tableXlsx(r) as never)
  const ws = wb.getWorksheet('Table')!
  assert.equal(ws.getCell('A4').value, '0012')
  assert.equal(ws.getCell('B4').value, '1234567890123456')
  assert.equal(ws.getCell('A5').value, 0)
  assert.equal(ws.getCell('B5').value, 0.5)
  await assert.rejects(tablePdf(parseExportTable({ header: Array.from({ length: 21 }, (_, i) => `c${i}`), rows: [] })), /up to 20 columns/)
  const wide = await tablePdf(parseExportTable({ header: Array.from({ length: 20 }, (_, i) => (i === 0 ? 'x' : 'a long header text here')), rows: [Array.from({ length: 20 }, () => '긴 글 '.repeat(300))] }))
  assert.equal(wide.subarray(0, 5).toString(), '%PDF-')
})

test('code review R2 — a tall header and a row longer than a page still make a PDF', async () => {
  const pdf = await tablePdf(parseExportTable({ header: ['긴 머리 '.repeat(200), 'b'], rows: [['긴 글 '.repeat(600), 'x'], ['y', 'z']] }))
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-')
})

const ti = parseExportTable({
  header: ['Date', 'Doctor', 'Total'], align: ['left', 'left', 'right'],
  rows: [['2026-10-12', 'Dr. Keller', '115.50'], ['2026-10-21', 'Apotheke', '37.10'], ['2026-10-03', 'Dr. Huber', '']],
  items: { label: 'Lines', header: ['Item', 'Amount'], align: ['left', 'right'], rows: [[['Konsultation', '80.00'], ['Labor', '35.50']], [['=cmd', '12.90']], []] },
})

test('items — parse · one list per row · limits', () => {
  assert.equal(ti.items?.rows[0].length, 2)
  assert.deepEqual(ti.items?.rows[2], [])
  assert.throws(() => parseExportTable({ header: ['a'], rows: [['x']], items: { header: ['i'], rows: [] } }), /one list per row/)
  assert.throws(() => parseExportTable({ header: ['a'], rows: [['x']], items: { header: Array.from({ length: 11 }, () => 'c'), rows: [[]] } }), /items header/)
  assert.throws(() => parseExportTable({ header: ['a'], rows: [['x']], items: { header: ['i'], rows: [Array.from({ length: 101 }, () => ['y'])] } }), /100 items/)
  assert.equal(parseExportTable({ header: ['a'], rows: [['x']] }).items, undefined)
})

test('items csv — one line per item · document cells repeated · a document without items = one line · formula in an item becomes text', () => {
  const lines = tableCsv(ti).toString('utf8').replace(/^﻿/, '').trim().split('\r\n')
  assert.equal(lines[0], 'Date,Doctor,Total,Item,Amount')
  assert.equal(lines.length, 1 + 2 + 1 + 1)
  assert.equal(lines[1], '2026-10-12,Dr. Keller,115.50,Konsultation,80.00')
  assert.equal(lines[2], '2026-10-12,Dr. Keller,115.50,Labor,35.50')
  assert.equal(lines[3], "2026-10-21,Apotheke,37.10,'=cmd,12.90")
  assert.equal(lines[4], '2026-10-03,Dr. Huber,,,')
})

test('items xlsx — two sheets joined by # · numbers stay numbers', async () => {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await tableXlsx(ti) as never)
  const docs = wb.getWorksheet('Table')!
  const items = wb.getWorksheet('Lines')!
  assert.deepEqual([docs.getCell('A1').value, docs.getCell('B1').value], ['#', 'Date'])
  assert.equal(docs.getCell('A4').value, 3)
  assert.equal(items.rowCount, 1 + 3)
  assert.deepEqual([items.getCell('A2').value, items.getCell('B2').value, items.getCell('C2').value], [1, 'Konsultation', 80])
  assert.deepEqual([items.getCell('A4').value, items.getCell('B4').value], [2, '=cmd'])
})

test('items pdf — renders · many items across pages', async () => {
  const many = parseExportTable({ header: ['Date'], rows: [['2026-10-12']], items: { label: 'Lines', header: ['Item', 'Amount'], rows: [Array.from({ length: 100 }, (_, i) => [`Position ${i + 1}`, '1.00'])] } })
  const one = await tablePdf(ti)
  const big = await tablePdf(many)
  assert.ok(one.subarray(0, 5).toString() === '%PDF-' && big.length > one.length)
  assert.ok((big.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length >= 2)
})

test('items — review fixes: sheet name «table» · quotes · line cap · very long item in PDF', async () => {
  const one = (label: string) => parseExportTable({ header: ['a'], rows: [['x']], items: { label, header: ['i'], rows: [[['y']]] } })
  for (const [label, want] of [['table', 'Items'], ['TABLE', 'Items'], ["'Lines'", 'Lines'], ["' 'Lines' '", 'Lines'], ['a[b]:c', 'a b  c']] as const) {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await tableXlsx(one(label)) as never)
    assert.deepEqual(wb.worksheets.map((w) => w.name), ['Table', want], label)
  }
  assert.throws(() => parseExportTable({ header: ['a'], rows: Array.from({ length: 201 }, () => ['x']), items: { header: ['i'], rows: Array.from({ length: 201 }, () => Array.from({ length: 100 }, () => [''])) } }), /item lines/)
  const big = parseExportTable({ header: ['a'], rows: Array.from({ length: 200 }, () => ['x']), items: { header: ['i'], rows: Array.from({ length: 200 }, () => Array.from({ length: 100 }, () => [''])) } })
  assert.ok((await tableXlsx(big)).length > 0 && (await tablePdf(big)).length > 0)
  const longItem = parseExportTable({ header: ['a'], rows: [['x']], items: { header: ['i'], rows: [[['word '.repeat(400).trim()]]] } })
  assert.ok((await tablePdf(longItem)).subarray(0, 5).toString() === '%PDF-')
})
