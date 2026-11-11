import { test } from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import { extractFileText, FileTextError, pageLines, XLSX_MIME } from './file-text'

const at = (str: string, x: number, y: number, size = 9, width = str.length * size * 0.5) => ({ str, transform: [size, 0, 0, size, x, y], width })

test('same height is one line - top to bottom - a wide gap becomes two spaces', () => {
  const items = [at('100.00', 300, 500), at('Fee', 60, 500), at('30.09.2026', 10, 500), at('Opening', 10, 520)]
  assert.equal(pageLines(items), 'Opening\n30.09.2026 Fee  100.00')
})

test('hidden zero-size text and space pieces are dropped', () => {
  const items = [at('Total', 10, 500), { str: 'HIDDEN_KEY,123', transform: [0, 0, 0, 0, 0, 800], width: 0 }, at('   ', 34, 500, 9, 200), at('12.00', 36, 500)]
  assert.equal(pageLines(items), 'Total 12.00')
})

test('rotated text is appended after, in original order', () => {
  const turned = (str: string, x: number, y: number) => ({ str, transform: [0, 12, -12, 0, x, y], width: 40 })
  assert.equal(pageLines([turned('FIRST', 100, 100), at('Body', 10, 500), turned('SECOND', 100, 142)]), 'Body\nFIRST SECOND')
  const upside = (str: string, x: number) => ({ str, transform: [-12, 0, 0, -12, x, 300], width: 40 })
  assert.equal(pageLines([upside('FIRST', 200), upside('SECOND', 150)]), 'FIRST SECOND')
})

test('italic text stays on the same line', () => {
  const italic = (str: string, x: number) => ({ str, transform: [9, 0, 2, 9, x, 500], width: str.length * 4.5 })
  assert.equal(pageLines([at('Balance', 10, 480), italic('1234', 48), at('Account', 10, 500)]), 'Account 1234\nBalance')
})

test('text slanted by a few degrees stays in line alignment', () => {
  const tilted = (str: string, x: number, y: number) => ({ str, transform: [9, 0.3, -0.3, 9, x, y], width: str.length * 4.5 })
  assert.equal(pageLines([tilted('Balance', 10, 480), tilted('1234', 48, 500), tilted('Account', 10, 500)]), 'Account 1234\nBalance')
  assert.equal(pageLines([{ str: 'FIRST', transform: [10, 1, -1, 10, 0, 100], width: 25 }, { str: 'SECOND', transform: [10, 1, -1, 10, 100, 110], width: 30 }]), 'FIRST  SECOND')
  assert.equal(pageLines([at('Label', 100, 500), { str: 'Value', transform: [10, 0.1, -0.1, 10, 500, 500], width: 25 }]), 'Label  Value')
})

test('empty page - non-text pieces', () => {
  assert.equal(pageLines([]), '')
  assert.equal(pageLines([null, 1, { str: 'x' }, { transform: [9, 0, 0, 9, 0, 0] }]), '')
})

const book = async (sheets: Array<{ name: string; rows: unknown[][] }>) => {
  const wb = new ExcelJS.Workbook()
  for (const sh of sheets) wb.addWorksheet(sh.name).addRows(sh.rows)
  return Buffer.from(await wb.xlsx.writeBuffer())
}

test('Excel - header row + CSV rows per sheet - formulas as values - dates as YYYY-MM-DD', async () => {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Claim')
  ws.addRow(['Date', 'Description', 'Amount', 'Currency', 'Rate', 'CHF'])
  ws.addRow([new Date(Date.UTC(2026, 9, 6)), 'Taxi, Milano', 20, 'EUR', 0.96, { formula: 'ROUND(C2*E2*20,0)/20', result: 19.2 }])
  wb.addWorksheet('Notes').addRow(['Total', 19.2])
  const t = await extractFileText(Buffer.from(await wb.xlsx.writeBuffer()), XLSX_MIME, 6_000)
  assert.equal(t.kind, 'text')
  assert.equal(t.text, '[Sheet Claim]\nDate,Description,Amount,Currency,Rate,CHF\n2026-10-06,"Taxi, Milano",20,EUR,0.96,19.2\n[Sheet Notes]\nTotal,19.2')
  assert.equal(t.truncated, undefined)
})

test('Excel - text limit - unread sheets = truncated', async () => {
  const long = await extractFileText(await book([{ name: 'A', rows: Array.from({ length: 50 }, (_, i) => [i, 'x'.repeat(50)]) }]), XLSX_MIME, 200)
  assert.equal(long.text.length, 200)
  assert.equal(long.truncated, true)
  const six = await extractFileText(await book(Array.from({ length: 6 }, (_, i) => ({ name: `S${i}`, rows: [[i]] }))), XLSX_MIME, 6_000)
  assert.equal(six.truncated, true)
  assert.ok(!six.text.includes('[Sheet S5]'))
})

test('Excel - empty book = empty text - broken file = unreadable', async () => {
  const empty = await extractFileText(await book([{ name: 'Empty', rows: [] }]), XLSX_MIME, 6_000)
  assert.deepEqual([empty.text, empty.truncated], ['', undefined])
  await assert.rejects(extractFileText(Buffer.from('not a zip'), XLSX_MIME, 6_000), (e) => e instanceof FileTextError && e.reason === 'unreadable')
})

test('XML (bank camt) = text file - reading does not return unreadable for a file the upload accepts', async () => {
  const xml = '<?xml version="1.0"?><Document><Stmt><Acct>DE89</Acct></Stmt></Document>'
  for (const mime of ['application/xml', 'text/xml']) {
    const t = await extractFileText(Buffer.from(xml), mime, 1000)
    assert.equal(t.kind, 'text')
    assert.equal(t.text, xml)
  }
})
