import fs from 'fs'
import path from 'path'
import ExcelJS from 'exceljs'
import PDFDocument from 'pdfkit'
import { WorkError } from './errors'

export type TableAlign = 'left' | 'right' | 'center'
export interface ExportItems { label: string; header: string[]; align: TableAlign[]; rows: string[][][] }
export interface ExportTable { header: string[]; rows: string[][]; align: TableAlign[]; items?: ExportItems }
export const TABLE_EXPORT_FORMATS = ['xlsx', 'csv', 'pdf'] as const
export type TableExportFormat = (typeof TABLE_EXPORT_FORMATS)[number]

const MAX_ROWS = 5000
const MAX_COLS = 40
const MAX_CELL = 2000
const MAX_CHARS = 2_000_000
const MAX_ITEM_COLS = 10
const MAX_ITEMS = 100
const MAX_ITEM_LINES = 20_000
const widest = (vals: Iterable<string>, min: number, max: number) => { let w = min; for (const v of vals) { const n = Array.from(v).length; if (n > w) { w = n; if (w >= max) return max } } return w }
const clean = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, MAX_CELL) : '')

export function parseExportTable(raw: unknown): ExportTable {
  const o = (raw && typeof raw === 'object' ? raw : {}) as { header?: unknown; rows?: unknown; align?: unknown }
  if (!Array.isArray(o.header) || o.header.length === 0 || o.header.length > MAX_COLS) throw new WorkError('INVALID', `header must have 1 to ${MAX_COLS} cells`)
  if (!Array.isArray(o.rows) || o.rows.length > MAX_ROWS) throw new WorkError('INVALID', `rows must be a list of up to ${MAX_ROWS} rows`)
  const header = o.header.map(clean)
  const n = header.length
  const rows = o.rows.map((r) => { const cells = Array.isArray(r) ? r.map(clean) : []; return Array.from({ length: n }, (_, i) => cells[i] ?? '') })
  const al = Array.isArray(o.align) ? o.align : []
  const align = header.map((_, i) => (al[i] === 'right' || al[i] === 'center' ? al[i] as TableAlign : 'left'))
  const items = parseItems((o as { items?: unknown }).items, rows.length)
  const chars = header.join('').length + rows.reduce((t, r) => t + r.join('').length, 0) + (items?.rows.reduce((t, d) => t + d.reduce((u, r) => u + r.join('').length, 0), 0) ?? 0)
  if (chars > MAX_CHARS) throw new WorkError('INVALID', 'the table is too large')
  return { header, rows, align, ...(items ? { items } : {}) }
}

function parseItems(raw: unknown, docs: number): ExportItems | undefined {
  if (raw === undefined || raw === null) return undefined
  const o = (typeof raw === 'object' ? raw : {}) as { label?: unknown; header?: unknown; rows?: unknown; align?: unknown }
  if (!Array.isArray(o.header) || o.header.length === 0 || o.header.length > MAX_ITEM_COLS) throw new WorkError('INVALID', `items header must have 1 to ${MAX_ITEM_COLS} cells`)
  if (!Array.isArray(o.rows) || o.rows.length !== docs) throw new WorkError('INVALID', 'items must have one list per row')
  if (o.rows.reduce((t: number, d: unknown) => t + (Array.isArray(d) ? d.length : 0), 0) > MAX_ITEM_LINES) throw new WorkError('INVALID', `at most ${MAX_ITEM_LINES} item lines`)
  const header = o.header.map(clean)
  const n = header.length
  const rows = o.rows.map((d) => {
    if (!Array.isArray(d) || d.length > MAX_ITEMS) throw new WorkError('INVALID', `a row has up to ${MAX_ITEMS} items`)
    return d.map((r) => { const cells = Array.isArray(r) ? r.map(clean) : []; return Array.from({ length: n }, (_, i) => cells[i] ?? '') })
  })
  const al = Array.isArray(o.align) ? o.align : []
  return { label: clean(o.label) || 'Items', header, rows, align: header.map((_, i) => (al[i] === 'right' || al[i] === 'center' ? al[i] as TableAlign : 'left')) }
}

const FORMULA = /^[=+\-@\t\r]/
const PLAIN_NEGATIVE = /^-(\d{1,3}([,']\d{3})+|\d+)(\.\d+)?$/
const csvCell = (v: string) => {
  const s = FORMULA.test(v) && !PLAIN_NEGATIVE.test(v) ? `'${v}` : v
  return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function tableCsv(t: ExportTable): Buffer {
  const it = t.items
  const body = it ? t.rows.flatMap((r, i) => (it.rows[i].length ? it.rows[i].map((x) => [...r, ...x]) : [[...r, ...it.header.map(() => '')]])) : t.rows
  const lines = [it ? [...t.header, ...it.header] : t.header, ...body].map((r) => r.map(csvCell).join(','))
  return Buffer.from(`﻿${lines.join('\r\n')}\r\n`, 'utf8')
}

const NUMBER = /^-?(0|[1-9]\d{0,2}([,']\d{3})+|[1-9]\d*)(\.\d+)?$/
const asNumber = (v: string) => (NUMBER.test(v) && v.replace(/\D/g, '').length <= 15 ? Number(v.replace(/[,']/g, '')) : null)

export async function tableXlsx(t: ExportTable): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const it = t.items
  const sheet = (name: string, header: string[], rows: string[][], align: TableAlign[]) => {
    const ws = wb.addWorksheet(name)
    ws.addRow(header).font = { bold: true }
    for (const r of rows) ws.addRow(r.map((v) => asNumber(v) ?? v))
    ws.views = [{ state: 'frozen', ySplit: 1 }]
    header.forEach((h, i) => {
      const col = ws.getColumn(i + 1)
      col.width = widest([h, ...(function* () { for (const r of rows) yield r[i] })()], 6, 58) + 2
      if (align[i] !== 'left') col.alignment = { horizontal: align[i] }
    })
  }
  if (!it) sheet('Table', t.header, t.rows, t.align)
  else {
    sheet('Table', ['#', ...t.header], t.rows.map((r, i) => [String(i + 1), ...r]), ['right', ...t.align])
    const name = it.label.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31).replace(/^[\s']+|[\s']+$/g, '')
    sheet(!name || name.toLowerCase() === 'table' ? 'Items' : name, ['#', ...it.header], t.rows.flatMap((_, i) => it.rows[i].map((x) => [String(i + 1), ...x])), ['right', ...it.align])
  }
  return Buffer.from(await wb.xlsx.writeBuffer())
}

const FONT_FILES = { regular: 'public/fonts/Pretendard-Regular.ttf', bold: 'public/fonts/Pretendard-Bold.ttf' }
const fontBytes = new Map<string, Buffer>()
const fontOf = (file: string) => { let b = fontBytes.get(file); if (!b) fontBytes.set(file, (b = fs.readFileSync(path.join(process.cwd(), file)))); return b }

export const PDF_MAX_COLS = 20

export async function tablePdf(t: ExportTable): Promise<Buffer> {
  if (t.header.length > PDF_MAX_COLS) throw new WorkError('INVALID', `a PDF takes up to ${PDF_MAX_COLS} columns — use Excel or CSV`)
  const want = t.header.map((h, i) => Math.min(40, Math.max(4, ...[h, ...t.rows.map((r) => r[i])].map((v) => Array.from(v).length))))
  const landscape = t.header.length > 6 || want.reduce((a, b) => a + b, 0) > 90
  const doc = new PDFDocument({ size: 'A4', layout: landscape ? 'landscape' : 'portrait', margin: 36, bufferPages: false })
  doc.registerFont('R', fontOf(FONT_FILES.regular))
  doc.registerFont('B', fontOf(FONT_FILES.bold))
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject) })
  const SIZE = 8.5
  const PAD = 4
  const left = doc.page.margins.left
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right
  const total = want.reduce((a, b) => a + b, 0)
  const n = t.header.length
  const widths = want.map((w) => width * (0.5 / n + (0.5 * w) / total))
  const bottom = () => doc.page.height - doc.page.margins.bottom
  const usable = doc.page.height - doc.page.margins.top - doc.page.margins.bottom
  const natural = (cells: string[], font: string) => {
    doc.font(font).fontSize(SIZE)
    return Math.max(...cells.map((c, i) => doc.heightOfString(c || ' ', { width: widths[i] - PAD * 2 }))) + PAD * 2
  }
  const headLimit = Math.floor(usable / 2)
  const rowLimit = () => usable - Math.min(natural(t.header, 'B'), headLimit) - 1
  const heightOf = (cells: string[], font: string) => Math.min(font === 'B' ? headLimit : rowLimit(), natural(cells, font))
  const drawRow = (cells: string[], y: number, h: number, head: boolean) => {
    let x = left
    if (head) doc.rect(left, y, width, h).fill('#EEF0F3')
    doc.fillColor('#111').font(head ? 'B' : 'R').fontSize(SIZE)
    cells.forEach((c, i) => {
      doc.text(c, x + PAD, y + PAD, { width: widths[i] - PAD * 2, height: h - PAD * 2, ellipsis: true, align: head ? 'left' : t.align[i] })
      x += widths[i]
    })
    doc.moveTo(left, y + h).lineTo(left + width, y + h).lineWidth(0.5).strokeColor('#C9CDD3').stroke()
  }
  const headH = heightOf(t.header, 'B')
  let y = doc.page.margins.top
  drawRow(t.header, y, headH, true)
  y += headH
  const newPage = () => { doc.addPage(); y = doc.page.margins.top; drawRow(t.header, y, headH, true); y += headH }
  const it = t.items
  const IND = 18
  const ISIZE = 7.5
  const iw = width - IND
  const itWant = it ? it.header.map((h, i) => widest([h, ...(function* () { for (const d of it.rows) for (const r of d) yield r[i] })()], 4, 40)) : []
  const itTotal = itWant.reduce((a, b) => a + b, 0)
  const itWidths = itWant.map((w) => iw * (0.5 / itWant.length + (0.5 * w) / itTotal))
  const itNatural = (cells: string[], font: string) => {
    doc.font(font).fontSize(ISIZE)
    return Math.max(...cells.map((c, i) => doc.heightOfString(c || ' ', { width: itWidths[i] - PAD * 2 }))) + PAD * 2
  }
  const itHeadH = it ? Math.min(Math.floor(usable / 4), itNatural(it.header, 'B')) : 0
  const itHeight = (cells: string[], font: string) => (font === 'B' ? itHeadH : Math.min(rowLimit() - itHeadH - 1, itNatural(cells, font)))
  const drawItem = (cells: string[], h: number, head: boolean) => {
    let x = left + IND
    if (head) doc.rect(left + IND, y, iw, h).fill('#F5F6F8')
    doc.fillColor('#333').font(head ? 'B' : 'R').fontSize(ISIZE)
    cells.forEach((c, i) => {
      doc.text(c, x + PAD, y + PAD, { width: itWidths[i] - PAD * 2, height: h - PAD * 2, ellipsis: true, align: head ? 'left' : it!.align[i] })
      x += itWidths[i]
    })
    doc.moveTo(left + IND, y + h).lineTo(left + width, y + h).lineWidth(0.3).strokeColor('#DDE0E4').stroke()
    y += h
  }
  t.rows.forEach((r, n) => {
    const h = heightOf(r, 'R')
    if (y + h > bottom()) newPage()
    drawRow(r, y, h, false)
    y += h
    const lines = it?.rows[n] ?? []
    if (!it || !lines.length) return
    const ih = itHeight(it.header, 'B')
    if (y + ih > bottom()) newPage()
    drawItem(it.header, ih, true)
    for (const x of lines) {
      const xh = itHeight(x, 'R')
      if (y + xh > bottom()) { newPage(); drawItem(it.header, ih, true) }
      drawItem(x, xh, false)
    }
  })
  doc.end()
  return done
}

export const TABLE_EXPORT_TYPES: Record<TableExportFormat, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
  pdf: 'application/pdf',
}

export async function exportTable(format: TableExportFormat, t: ExportTable): Promise<Buffer> {
  return format === 'csv' ? tableCsv(t) : format === 'xlsx' ? tableXlsx(t) : tablePdf(t)
}
