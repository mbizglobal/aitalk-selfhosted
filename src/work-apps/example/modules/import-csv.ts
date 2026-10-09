/**
 * Action module — reads a CSV file from the Files tab and adds its lines to the Expenses sheet.
 * Uses only the handles: files.info / files.read (the read is logged for whoever asked) and sheets.write
 * (rows are written as this module — they stay unconfirmed until a person confirms them).
 *
 * CSV: first line "date,description,amount", then one expense per line, e.g. 2026-07-03,Train ticket,12.50
 * Fields may be in double quotes ("Lunch, team"); "" inside quotes is one quote. A file already imported is refused
 * (rows remember the file's sha256 in the hidden column "source") — importing twice would count every expense twice.
 */
import { isCalendarDate, moduleStop, WorkError, type ActionWorkModule, type ModuleRunCtx } from '@/lib/work/package-api'
import { EXPENSES } from '../templates'
import { toCents } from '../money'

export interface ExpenseLine { date: string; description: string; amount: string }

/**
 * One CSV line → fields. A field may be wrapped in double quotes (commas inside stay, "" is one quote).
 * A quote is allowed only at the start of a field, and only spaces may follow the closing quote — otherwise the line is
 * malformed (null): «Lunch,"12"50» must not quietly become the amount 1250.
 */
export function splitCsvLine(line: string): string[] | null {
  const out: string[] = []
  let i = 0
  for (;;) {
    while (line[i] === ' ' || line[i] === '\t') i++
    let field = ''
    if (line[i] === '"') {
      i++
      for (;;) {
        if (i >= line.length) return null // unclosed quote
        if (line[i] === '"' && line[i + 1] === '"') { field += '"'; i += 2 } else if (line[i] === '"') { i++; break } else field += line[i++]
      }
      while (line[i] === ' ' || line[i] === '\t') i++
      if (i < line.length && line[i] !== ',') return null // text after the closing quote
    } else {
      while (i < line.length && line[i] !== ',') {
        if (line[i] === '"') return null // a quote in the middle of a field
        field += line[i++]
      }
      field = field.trim()
    }
    out.push(field)
    if (i >= line.length) return out
    i++ // the comma
  }
}

/** Pure — parsing is tested without a database */
export function parseExpensesCsv(text: string): ExpenseLine[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).map((l) => l.trim())
  if (splitCsvLine(lines[0] ?? '')?.map((h) => h.toLowerCase()).join() !== 'date,description,amount') throw moduleStop('csv_header', 'first line must be date,description,amount')
  const out: ExpenseLine[] = []
  lines.slice(1).forEach((l, i) => {
    if (!l) return
    const parts = splitCsvLine(l) ?? []
    // Without quotes a comma in the description splits it — the first field is the date, the last the amount
    const date = parts[0] ?? ''
    const amount = parts[parts.length - 1] ?? ''
    const description = parts.slice(1, -1).join(', ').trim()
    if (parts.length < 3 || !isCalendarDate(date) || !description || toCents(amount) === null) {
      throw moduleStop('csv_line', `line ${i + 2} is not date,description,amount`, { line: i + 2 })
    }
    out.push({ date, description, amount })
  })
  if (!out.length) throw moduleStop('csv_empty', 'no expense lines')
  return out
}

export const importCsvModule: ActionWorkModule<ModuleRunCtx> = {
  id: 'example.import-csv',
  version: 1,
  kind: 'read',
  title: { en: 'Import CSV' },
  description: { en: 'Adds the lines of a CSV file (date,description,amount) to the Expenses sheet as unconfirmed rows.' },
  input: { type: 'object', properties: { fileId: { type: 'string' } }, required: ['fileId'], additionalProperties: false },
  output: { type: 'object', properties: { inserted: { type: 'number' } } },
  needs: [`${EXPENSES}>=1`],
  async run(ctx, raw) {
    const fileId = (raw as { fileId?: unknown } | null)?.fileId
    if (typeof fileId !== 'string' || !fileId) throw new WorkError('INVALID', 'fileId is required')
    const info = await ctx.files.info(fileId)
    if (!info) throw new WorkError('NOT_FOUND')
    if (!/^text\/(csv|plain)$/.test(info.mimeType.split(';')[0].trim().toLowerCase())) throw moduleStop('csv_not_text', `file type ${info.mimeType}`)
    const { buffer } = await ctx.files.read(fileId)
    const lines = parseExpensesCsv(buffer.toString('utf8'))
    const [sheet] = await ctx.sheets.list(EXPENSES)
    if (!sheet) throw moduleStop('sheet_missing', 'no expenses sheet', { sheet: EXPENSES })
    // One write lock for all lines — a line in a submitted period stops the whole import (LOCKED), nothing half-written.
    // The «already imported» check is inside the same lock, so two imports of one file at once cannot both pass
    await ctx.sheets.write({ sheetIds: [sheet.id] }, async (w) => {
      if ((await w.rows(sheet.id)).some((r) => r.data.source === info.sha256)) throw moduleStop('csv_already_imported', 'this file is already in the sheet')
      for (const l of lines) await w.insert(sheet.id, { ...l, source: info.sha256 })
    })
    return { inserted: lines.length }
  },
}
