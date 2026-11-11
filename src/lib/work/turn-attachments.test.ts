import test from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import { turnNotes, withServerPages, type TurnPart } from './turn-attachments'
import { unzippedSize, xlsxText } from './xlsx-text'

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const csv = (name: string, text: string): TurnPart => ({ kind: 'file', name, mimeType: 'text/csv', buffer: Buffer.from(text) })
async function book(sheets: Array<{ name: string; rows: unknown[][] }>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  for (const s of sheets) { const ws = wb.addWorksheet(s.name); for (const r of s.rows) ws.addRow(r) }
  return Buffer.from(await wb.xlsx.writeBuffer())
}
const xlsx = async (name: string, sheets: Array<{ name: string; rows: unknown[][] }>): Promise<TurnPart> => ({ kind: 'file', name, mimeType: XLSX, buffer: await book(sheets) })
const accounts = (n: number) => Array.from({ length: n }, (_, i) => [String(1000 + i).padStart(4, '0'), `Account ${i}`])

test('CSV - up to 400 rows (within the text limit) - not cut at 40 rows', async () => {
  const text = ['N/C,Name', ...accounts(120).map((r) => r.join(','))].join('\n')
  const out = await turnNotes([csv('tb.csv', text)])
  assert.match(out, /first 121 of 121 lines/)
  assert.ok(out.includes('1119,Account 119'))
})

test('turn limit - a later file that fits no line at all = Not read', async () => {
  const big = Array.from({ length: 300 }, (_, i) => `${i},`.padEnd(99, 'x')).join('\n')
  const parts = [csv('a.csv', big), csv('b.csv', big), csv('c.csv', big), csv('d.csv', 'no,name\n1,a')]
  const out = await turnNotes(parts)
  assert.match(out, /\[Not read: d\.csv — over this turn's text limit/)
  assert.doesNotMatch(out, /Not read: a\.csv/)
  const short = Array.from({ length: 79 }, (_, i) => `${i},`.padEnd(99, 'y')).join('\n')
  const out2 = await turnNotes([csv('a.csv', big), csv('b.csv', big), csv('c.csv', short), csv('e.csv', `${'z'.repeat(200)}\n1`)])
  assert.match(out2, /first 79 of 79 lines/)
  assert.match(out2, /Not read: e\.csv/)
})

test('Excel - all of the first five sheets - empty sheets skipped - formulas as values - the sixth = not read', async () => {
  const wb = new ExcelJS.Workbook()
  wb.addWorksheet('Cover').addRow(['Trial balance 2021'])
  wb.addWorksheet('Empty')
  const tb = wb.addWorksheet('TB')
  tb.addRow(['N/C', 'Name', 'Debit'])
  tb.addRow(['0040', 'Computer, Equipment', 10])
  tb.getCell('C3').value = { formula: '1+1', result: 2 }
  tb.getCell('A3').value = '1100'
  tb.getCell('B3').value = 'Debtors'
  for (const n of ['S4', 'S5', 'S6']) wb.addWorksheet(n).addRow([n])
  const part: TurnPart = { kind: 'file', name: 'tb.xlsx', mimeType: XLSX, buffer: Buffer.from(await wb.xlsx.writeBuffer()) }
  const out = await turnNotes([part])
  assert.ok(out.includes('[Sheet Cover]') && out.includes('[Sheet TB]'), out)
  assert.ok(out.includes('0040,"Computer, Equipment",10'))
  assert.ok(out.includes('1100,Debtors,2'))
  assert.ok(!out.includes('[Sheet Empty]'))
  assert.match(out, /\[Sheets not read: S6\]/)
})

test('Excel - when the first sheet fills 400 rows, later sheet names are not read - cut in the header', async () => {
  const out = await turnNotes([await xlsx('big.xlsx', [{ name: 'A', rows: accounts(500) }, { name: 'B', rows: accounts(3) }])])
  assert.match(out, /\[Sheet A — cut at line \d+ of 500\]/)
  assert.match(out, /\[Sheets not read: B\]/)
})

test('Excel - all-empty file, damaged, over 2 MB, small file that expands hugely = one notice line', async () => {
  const empty = await xlsx('empty.xlsx', [{ name: 'A', rows: [] }])
  assert.match(await turnNotes([empty]), /no values in its first sheets/)
  const broken: TurnPart = { kind: 'file', name: 'bad.xlsx', mimeType: XLSX, buffer: Buffer.from('PK\u0003\u0004 not really a workbook') }
  assert.match(await turnNotes([broken]), /bad\.xlsx — could not be read/)
  assert.deepEqual(await xlsxText(Buffer.alloc(2 * 1024 * 1024 + 1)), { ok: false, reason: 'too_big' })
  const real = await book([{ name: 'A', rows: accounts(3) }])
  assert.ok((unzippedSize(real) ?? 0) > 0)
  const bomb = Buffer.from(real)
  const eocd = bomb.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  bomb.writeUInt32LE(5 * 1024 * 1024, bomb.readUInt32LE(eocd + 16) + 24)
  assert.deepEqual(await xlsxText(bomb), { ok: false, reason: 'too_big' })
})

test('pictures and PDF page pictures stay as a list only (regression)', async () => {
  const out = await turnNotes([{ kind: 'page', name: 'tb.pdf', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8]) }, { kind: 'page', name: 'tb.pdf', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8]) }])
  assert.match(out, /- tb\.pdf \(application\/pdf, 2 page images\)/)
  assert.ok(!out.includes('Not read'))
})

test('the per-file limit hit from the first row = split the rows notice (same when pasted again)', async () => {
  const out = await turnNotes([csv('one.csv', `${'w'.repeat(9_000)}\n1,a`)])
  assert.match(out, /Not read: one\.csv — its first line is longer than 8000 characters/)
  assert.doesNotMatch(out, /over this turn's text limit/)
})

test('Excel - up to the changed sheet header (cut at line) stays within the file text limit', async () => {
  const rows = Array.from({ length: 390 }, (_, i) => [String(i).padStart(4, '0'), 'n'.repeat(15)])
  const out = await turnNotes([await xlsx('long.xlsx', [{ name: 'A', rows }])])
  const body = out.split('```')[1]
  assert.ok(body.length <= 8_000 + 2, String(body.length))
  assert.match(body, /\[Sheet A — cut at line \d+ of 390\]/)
})

test('Excel - a 0000 number format keeps leading zeros - text conversion stops at the field limit', async () => {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('TB')
  ws.addRow(['N/C', 'Name'])
  ws.addRow([40, 'Computers'])
  ws.addRow([1100, 'Debtors'])
  ws.getColumn(1).numFmt = '0000'
  wb.addWorksheet('Big').addRows(Array.from({ length: 12_000 }, (_, i) => [i, 'x']))
  wb.addWorksheet('After').addRow(['z'])
  const x = await xlsxText(Buffer.from(await wb.xlsx.writeBuffer()))
  assert.ok(x.ok)
  if (!x.ok) return
  assert.deepEqual(x.sheets[0].lines, ['N/C,Name', '0040,Computers', '1100,Debtors'])
  assert.equal(x.sheets[1].cut, true)
  assert.ok(x.sheets[1].lines.length < 12_000)
  assert.deepEqual(x.notRead, ['After'])
})

test('Excel - 0000 format on formula results too - header + first row over the file limit = split the rows', async () => {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('TB')
  ws.getCell('A1').value = { formula: '20+20', result: 40 }
  ws.getCell('B1').value = 'Computers'
  ws.getColumn(1).numFmt = '0000'
  const x = await xlsxText(Buffer.from(await wb.xlsx.writeBuffer()))
  assert.ok(x.ok && x.sheets[0].lines[0] === '0040,Computers', JSON.stringify(x))
  const long = await turnNotes([await xlsx('wide.xlsx', [{ name: 'TB', rows: [['w'.repeat(7_995)], ['1', 'a']] }])])
  assert.match(long, /Not read: wide\.xlsx — its first line is longer than 8000 characters/)
})

test('Excel - field limit reached before the first value row = too many fields (not no values)', async () => {
  const out = await turnNotes([await xlsx('wide.xlsx', [{ name: 'TB', rows: [Array(16_000).fill(' '), Array(16_000).fill(' '), ['1', 'a']] }])])
  assert.match(out, /wide\.xlsx — too many cells to read here/)
})

test('Excel - a one-row sheet is judged by the short header - not enough text left in the turn = paste again', async () => {
  const big = Array.from({ length: 300 }, (_, i) => `${i},`.padEnd(99, 'x')).join('\n')
  const out = await turnNotes([csv('a.csv', big), csv('b.csv', big), csv('c.csv', big.slice(0, 7_000)), await xlsx('one.xlsx', [{ name: 'TB', rows: [['w'.repeat(7_000)]] }])])
  assert.match(out, /Not read: one\.xlsx — over this turn's text limit/)
})

const LIMIT = { maxImages: 12, maxBytes: 20 * 1024 * 1024 }

async function pdfOf(pages: number): Promise<Buffer> {
  const { default: PDFDocument } = await import('pdfkit')
  const doc = new PDFDocument({ size: 'A6' })
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<void>((r) => doc.on('end', () => r()))
  for (let i = 0; i < pages; i++) { if (i) doc.addPage(); doc.text(`page ${i + 1}`) }
  doc.end()
  await done
  return Buffer.concat(chunks)
}

test('PDF original file part - the server turns it into page picture parts (name = PDF name, jpeg, one per page) - other parts unchanged', async () => {
  const csv: TurnPart = { kind: 'file', name: 'a.csv', mimeType: 'text/csv', buffer: Buffer.from('x,y\n1,2\n') }
  const out = await withServerPages([csv, { kind: 'file', name: 'bill.pdf', mimeType: 'application/pdf', buffer: await pdfOf(2) }], LIMIT)
  assert.equal(out[0], csv)
  const pages = out.filter((p) => p.kind === 'page')
  assert.equal(pages.length, 2)
  assert.ok(pages.every((p) => p.name === 'bill.pdf' && p.mimeType === 'image/jpeg' && p.buffer[0] === 0xff && p.buffer[1] === 0xd8))
  assert.equal(out.some((p) => p.mimeType === 'application/pdf'), false)
})

test('page pictures with the same name already sent (browser) - left as is - PDFs that cannot be drawn stay original', async () => {
  const pdf: TurnPart = { kind: 'file', name: 'x.pdf', mimeType: 'application/pdf', buffer: await pdfOf(1) }
  const page: TurnPart = { kind: 'page', name: 'x.pdf', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff]) }
  assert.deepEqual(await withServerPages([pdf, page], LIMIT), [pdf, page])
  const broken: TurnPart = { kind: 'file', name: 'bad.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 not really a pdf') }
  assert.deepEqual(await withServerPages([broken], LIMIT), [broken])
})

test('limits - pictures only within this turn count - remaining PDFs stay original - byte limit too', async () => {
  const five = await pdfOf(5)
  const pdfs: TurnPart[] = ['a.pdf', 'b.pdf', 'c.pdf'].map((name) => ({ kind: 'file', name, mimeType: 'application/pdf', buffer: five }))
  const photo: TurnPart = { kind: 'file', name: 'p.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]) }
  const out = await withServerPages([photo, ...pdfs], LIMIT)
  assert.equal(out.filter((p) => p.kind === 'page').length, 11)
  assert.deepEqual(out.filter((p) => p.kind === 'page' && p.name === 'c.pdf').length, 1)
  const tight = await withServerPages(pdfs, { maxImages: 12, maxBytes: five.length + 10 })
  assert.ok(tight.every((p) => p.kind === 'file'))
})

test('two PDFs with the same name - the later one is grouped separately as (2)', async () => {
  const a: TurnPart = { kind: 'file', name: 'scan.pdf', mimeType: 'application/pdf', buffer: await pdfOf(1) }
  const b: TurnPart = { kind: 'file', name: 'scan.pdf', mimeType: 'application/pdf', buffer: await pdfOf(2) }
  const out = await withServerPages([a, b], LIMIT)
  assert.deepEqual(out.map((p) => p.name), ['scan.pdf', 'scan (2).pdf', 'scan (2).pdf'])
  const taken: TurnPart = { kind: 'file', name: 'scan (2).pdf', mimeType: 'text/plain', buffer: Buffer.from('x') }
  const out2 = await withServerPages([a, taken, b], LIMIT)
  assert.deepEqual(out2.map((p) => p.name), ['scan.pdf', 'scan (2).pdf', 'scan (3).pdf', 'scan (3).pdf'])
})

test('part count limit - within 24 after the change', async () => {
  const csvs: TurnPart[] = Array.from({ length: 22 }, (_, i) => ({ kind: 'file', name: `c${i}.csv`, mimeType: 'text/csv', buffer: Buffer.from('a\n') }))
  const out = await withServerPages([...csvs, { kind: 'file', name: 'big.pdf', mimeType: 'application/pdf', buffer: await pdfOf(5) }], LIMIT)
  assert.equal(out.length, 24)
  assert.equal(out.filter((p) => p.kind === 'page').length, 2)
})
