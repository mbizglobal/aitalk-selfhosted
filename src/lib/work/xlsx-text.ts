

export const XLSX_MAX_BYTES = 2 * 1024 * 1024
const XLSX_MAX_UNZIPPED = 4 * 1024 * 1024
const XLSX_MAX_SHEETS = 5
const XLSX_MAX_CELLS = 20_000
const XLSX_TIME_MS = 3_000

export interface XlsxSheetText {
  name: string
  lines: string[]
  cut: boolean
}
export type XlsxText =
  | { ok: true; sheets: XlsxSheetText[]; notRead: string[]; stopped: boolean }
  | { ok: false; reason: 'too_big' | 'unreadable' }

export function unzippedSize(buf: Buffer): number | null {
  const min = Math.max(0, buf.length - 0xffff - 22)
  let eocd = -1
  for (let i = buf.length - 22; i >= min; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) return null
  const entries = buf.readUInt16LE(eocd + 10)
  let at = buf.readUInt32LE(eocd + 16)
  if (entries === 0xffff || at === 0xffffffff) return null
  let total = 0
  for (let n = 0; n < entries; n++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014b50) return null
    const size = buf.readUInt32LE(at + 24)
    if (size === 0xffffffff) return null
    total += size
    at += 46 + buf.readUInt16LE(at + 28) + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32)
  }
  return total
}

const ZEROS = /^0+$/
function padded(v: unknown, numFmt: unknown): string | null {
  const n = v && typeof v === 'object' && 'result' in v ? (v as { result?: unknown }).result : v
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && typeof numFmt === 'string' && ZEROS.test(numFmt) ? String(n).padStart(numFmt.length, '0') : null
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10)
  if (typeof v === 'object') {
    const o = v as { result?: unknown; richText?: Array<{ text?: string }>; text?: unknown; error?: unknown }
    if ('result' in o) return cellText(o.result)
    if (Array.isArray(o.richText)) return o.richText.map((t) => t.text ?? '').join('')
    if ('text' in o) return cellText(o.text)
    if ('error' in o) return String(o.error)
    return ''
  }
  return String(v)
}

const csvCell = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

export async function xlsxText(buf: Buffer): Promise<XlsxText> {
  if (buf.length > XLSX_MAX_BYTES) return { ok: false, reason: 'too_big' }
  const unzipped = unzippedSize(buf)
  if (unzipped === null || unzipped > XLSX_MAX_UNZIPPED) return { ok: false, reason: unzipped === null ? 'unreadable' : 'too_big' }
  let wb: import('exceljs').Workbook
  try {
    const ExcelJS = (await import('exceljs')).default
    wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf as unknown as ArrayBuffer)
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
  const started = Date.now()
  const sheets: XlsxSheetText[] = []
  const notRead: string[] = []
  let cells = 0
  let stopped = false
  wb.worksheets.forEach((ws, i) => {
    if (i >= XLSX_MAX_SHEETS || stopped) { notRead.push(ws.name); return }
    const lines: string[] = []
    let cut = false
    for (let r = 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r)
      const values = Array.isArray(row.values) ? row.values.slice(1) : []
      cells += values.length
      if (cells > XLSX_MAX_CELLS || Date.now() - started > XLSX_TIME_MS) { cut = true; stopped = true; break }
      const texts = values.map((v, c) => (padded(v, row.getCell(c + 1).numFmt) ?? cellText(v)).trim())
      while (texts.length && !texts[texts.length - 1]) texts.pop()
      if (texts.length) lines.push(texts.map(csvCell).join(','))
    }
    if (lines.length) sheets.push({ name: ws.name, lines, cut })
    else if (cut) notRead.push(ws.name)
  })
  return { ok: true, sheets, notRead, stopped }
}
