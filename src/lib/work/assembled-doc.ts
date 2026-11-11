import { createHash } from 'crypto'
import fs from 'fs'
import path from 'path'
import PDFDocument from 'pdfkit'
import { WorkError } from './errors'
import { isCalendarDate } from './dates'
import {
  accountToday, computeRow, decimalOf, docFileColumn, docFpColumn, NUMBER_COLUMN, readRefRows, readSpec, refChoices, specSheetName, STATUS_COLUMN,
  type DocLang, type RefRows, type SpecDoc, type SpecTable,
} from './assembled'
import type { Prisma, PrismaClient } from '@prisma/client'
import type { SheetActor } from './sheet-gate'
import type { WorkFileDeps } from './files'

type Db = PrismaClient | Prisma.TransactionClient
type Row = Readonly<Record<string, unknown>>

export const DOC_MAX_PAGES = 20
const blank = (v: unknown) => v === undefined || v === null || v === ''
const DASH = '—'

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const YES_NO: Record<DocLang, [string, string]> = { en: ['Yes', 'No'], de: ['Ja', 'Nein'], fr: ['Oui', 'Non'], ko: ['예', '아니요'] }

export function docDate(d: string, lang: DocLang): string {
  if (!isCalendarDate(d)) return d
  const [y, m, day] = [d.slice(0, 4), d.slice(5, 7), d.slice(8, 10)]
  if (lang === 'en') return `${Number(day)} ${MONTHS_EN[Number(m) - 1]} ${y}`
  if (lang === 'ko') return `${y}. ${m}. ${day}.`
  return `${day}.${m}.${y}`
}

export function docMoney(v: unknown, cur: unknown, lang: DocLang): string {
  const d = decimalOf(v)
  if (!d) return String(v)
  let n = d.n
  let scale = d.scale
  if (scale < 2) { n *= BigInt(10) ** BigInt(2 - scale); scale = 2 }
  else if (scale > 2) { const q = BigInt(10) ** BigInt(scale - 2); const neg = n < BigInt(0); const a = neg ? -n : n; let r = a / q; if ((a % q) * BigInt(2) >= q) r += BigInt(1); n = neg ? -r : r; scale = 2 }
  const neg = n < BigInt(0)
  const s = (neg ? -n : n).toString().padStart(3, '0')
  const int = s.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, lang === 'de' || lang === 'fr' ? '’' : ',')
  const out = `${neg ? '-' : ''}${int}.${s.slice(-2)}`
  const c = typeof cur === 'string' && cur ? `${cur} ` : ''
  return `${c}${out}`
}

export function docLabel(t: SpecTable, key: string): string {
  if (key === NUMBER_COLUMN) return t.number?.label ?? 'No.'
  if (key === STATUS_COLUMN) return t.status?.label ?? 'Stage'
  return t.columns.find((c) => c.key === key)?.label ?? key
}

export function docValue(t: SpecTable, key: string, row: Row, today: string, refRows: RefRows, lang: DocLang): string {
  if (key === STATUS_COLUMN) return blank(row[STATUS_COLUMN]) ? (t.status?.start ?? DASH) : String(row[STATUS_COLUMN])
  if (key === NUMBER_COLUMN) return blank(row[NUMBER_COLUMN]) ? DASH : String(row[NUMBER_COLUMN])
  const c = t.columns.find((x) => x.key === key)
  if (!c) return DASH
  if (c.kind === 'computed') return computeRow(t, row, today)[key] ?? DASH
  const v = row[key]
  if (blank(v)) return DASH
  switch (c.kind) {
    case 'date': return docDate(String(v), lang)
    case 'money': return docMoney(v, row[`${key}_cur`], lang)
    case 'yesno': return v === true || v === 'true' ? YES_NO[lang][0] : YES_NO[lang][1]
    case 'ref': return refChoices(refRows[key]).find((x) => x.id === v)?.label ?? DASH
    default: return String(v)
  }
}

const fill = (s: string, t: SpecTable, row: Row, today: string, refRows: RefRows, lang: DocLang) => s.replace(/\{([^{}]*)\}/g, (_m, k: string) => docValue(t, k, row, today, refRows, lang))

export interface DocModel {
  lang: DocLang
  header: string | null
  title: string
  intro: string | null
  rows: Array<[string, string]>
  outro: string | null
  sign: string[]
  paper: { file: string; sha256: string; top: number; bottom: number } | null
}

export function buildDocModel(t: SpecTable, d: SpecDoc, appName: string, row: Row, today: string, refRows: RefRows, paperSha: string | null): DocModel {
  const f = (s: string) => fill(s, t, row, today, refRows, d.lang)
  return {
    lang: d.lang,
    header: d.letterhead ? null : f(d.header ?? appName),
    title: f(d.title),
    intro: d.intro ? f(d.intro) : null,
    rows: d.fields.map((k) => [docLabel(t, k), docValue(t, k, row, today, refRows, d.lang)]),
    outro: d.outro ? f(d.outro) : null,
    sign: d.sign ?? [],
    paper: d.letterhead && paperSha ? { file: d.letterhead.file, sha256: paperSha, top: d.letterhead.top ?? 120, bottom: d.letterhead.bottom ?? 80 } : null,
  }
}

export const docHash = (m: DocModel): string => createHash('sha256').update(JSON.stringify(m)).digest('hex').slice(0, 32)
export const docFp = (hash: string, day: string) => `${hash}:${day}`
export function parseDocFp(v: unknown): { hash: string; day: string } | null {
  if (typeof v !== 'string') return null
  const [hash, day] = v.split(':')
  return hash && day && isCalendarDate(day) ? { hash, day } : null
}

export function docFileName(t: SpecTable, d: SpecDoc, row: Row): string {
  const printed = d.fields.includes(NUMBER_COLUMN) || /\{number\}/.test(`${d.title}${d.intro ?? ''}${d.outro ?? ''}${d.letterhead ? '' : d.header ?? ''}`)
  const no = printed && t.number && !blank(row[NUMBER_COLUMN]) ? `-${String(row[NUMBER_COLUMN])}` : ''
  return `${d.label}${no}`.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').slice(0, 100) + '.pdf'
}

const FONT_FILES = { regular: 'public/fonts/Pretendard-Regular.ttf', bold: 'public/fonts/Pretendard-Bold.ttf' }
const fontBytes = new Map<string, Buffer>()
const fontOf = (file: string) => { let b = fontBytes.get(file); if (!b) fontBytes.set(file, (b = fs.readFileSync(path.join(process.cwd(), file)))); return b }

export async function renderDoc(m: DocModel, paper: Buffer | null, author: string): Promise<Buffer> {
  const top = m.paper ? m.paper.top : 56
  const bottomMargin = m.paper ? m.paper.bottom : 56
  const doc = new PDFDocument({ size: 'A4', margins: { top, bottom: bottomMargin, left: 56, right: 56 }, info: { Title: m.title, Author: author }, bufferPages: true })
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>((res, rej) => { doc.on('end', () => res(Buffer.concat(chunks))); doc.on('error', rej) })
  doc.registerFont('R', fontOf(FONT_FILES.regular))
  doc.registerFont('B', fontOf(FONT_FILES.bold))
  const left = 56
  const width = doc.page.width - 112
  const bottom = () => doc.page.height - bottomMargin
  const room = (h: number) => { if (doc.y + h > bottom()) doc.addPage() }
  if (m.header) { doc.font('B').fontSize(12).fillColor('#111').text(m.header, left, doc.y, { width }); doc.moveDown(1) }
  doc.font('B').fontSize(16).fillColor('#111').text(m.title, left, doc.y, { width })
  doc.moveDown(0.6)
  if (m.intro) { doc.font('R').fontSize(10.5).fillColor('#222').text(m.intro, left, doc.y, { width }); doc.moveDown(0.8) }
  const lw = Math.round(width * 0.32)
  const vw = width - lw - 12
  for (const [label, value] of m.rows) {
    doc.font('R').fontSize(10)
    const h = Math.max(doc.heightOfString(label, { width: lw }), doc.heightOfString(value, { width: vw })) + 8
    room(h <= bottom() - top ? h : 48)
    const y0 = doc.y
    doc.font('B').fontSize(10).fillColor('#444').text(label, left, y0, { width: lw })
    const afterLabel = doc.y
    const labelPage = doc.bufferedPageRange().count
    doc.font('R').fontSize(10).fillColor('#111').text(value, left + lw + 12, y0, { width: vw })
    const samePage = doc.bufferedPageRange().count === labelPage
    doc.y = (samePage ? Math.max(afterLabel, doc.y) : doc.y) + 4
    doc.moveTo(left, doc.y - 2).lineTo(left + width, doc.y - 2).lineWidth(0.5).strokeColor('#ddd').stroke()
  }
  if (m.outro) { doc.moveDown(0.8); doc.font('R').fontSize(10.5).fillColor('#222').text(m.outro, left, doc.y, { width }) }
  if (m.sign.length) {
    room(70)
    const y = Math.max(doc.y + 40, doc.y)
    const gap = 20
    const w = (width - gap * (m.sign.length - 1)) / m.sign.length
    m.sign.forEach((name, i) => {
      const x = left + i * (w + gap)
      doc.moveTo(x, y).lineTo(x + w, y).lineWidth(0.7).strokeColor('#888').stroke()
      doc.font('R').fontSize(9).fillColor('#555').text(name, x, y + 4, { width: w })
    })
  }
  const pages = doc.bufferedPageRange().count
  doc.end()
  const out = await done
  if (pages > DOC_MAX_PAGES) throw new WorkError('INVALID', `the document would have ${pages} pages — at most ${DOC_MAX_PAGES}`)
  if (!paper) return out
  const { overlayPaper } = await import('./pdf-paper')
  try {
    return await overlayPaper(out, paper, { title: m.title, author })
  } catch {
    throw new WorkError('INVALID', 'the letterhead PDF cannot be used as a background — save it again as a normal PDF and upload it')
  }
}

interface DocInputs {
  t: SpecTable
  d: SpecDoc
  sheetId: string
  appName: string
  row: Record<string, unknown>
  today: string
  refRows: RefRows
  paper: { id: string; sha256: string } | null
  cur: { file: string | null; fp: { hash: string; day: string } | null }
}

async function docInputs(db: Db, key: Buffer, q: { userId: string; projectId: string; table: string; rowId: string; doc: string }): Promise<DocInputs> {
  const sp = await readSpec(db, key, { userId: q.userId, projectId: q.projectId })
  const t = sp?.spec.tables.find((x) => x.key === q.table)
  if (!sp || !t || t.hidden) throw new WorkError('NOT_FOUND', 'no such table in this app')
  const d = t.docs?.find((x) => x.key === q.doc)
  if (!d || d.hidden) throw new WorkError('INVALID', `doc must be one of ${(t.docs ?? []).filter((x) => !x.hidden).map((x) => x.key).join(', ') || '(none in this table)'}`)
  const sheet = await db.dataSheet.findFirst({ where: { userId: q.userId, projectId: q.projectId, kind: 'project', template: null, name: specSheetName(t.key) }, select: { id: true } })
  if (!sheet) throw new WorkError('NOT_FOUND', 'no such table in this app')
  const r = await db.dataSheetRow.findFirst({ where: { id: q.rowId, sheetId: sheet.id, projectId: q.projectId, userId: q.userId, kind: 'project' } })
  if (!r) throw new WorkError('NOT_FOUND', `no row ${q.rowId} in table "${t.key}"`)
  const { decodeRow } = await import('./sheet-gate')
  const row = decodeRow(r, key).data
  let paper: DocInputs['paper'] = null
  if (d.letterhead) {
    const f = await db.workFile.findFirst({ where: { id: d.letterhead.file, projectId: q.projectId, userId: q.userId }, select: { id: true, sha256: true, mimeType: true } })
    if (!f || f.mimeType !== 'application/pdf') throw new WorkError('INVALID', `${d.label}: the letterhead file is not a PDF in this app — upload it again and fix the template`)
    paper = { id: f.id, sha256: f.sha256 }
  }
  const fileId = row[docFileColumn(d.key)]
  return {
    t, d, sheetId: sheet.id, appName: sp.spec.name, row, today: await accountToday(db, q.userId), refRows: await readRefRows(db, key, q, t), paper,
    cur: { file: typeof fileId === 'string' && fileId ? fileId : null, fp: parseDocFp(row[docFpColumn(d.key)]) },
  }
}

const modelOf = (a: DocInputs, day: string) => buildDocModel(a.t, a.d, a.appName, a.row, day, a.refRows, a.paper?.sha256 ?? null)

export interface MadeDoc { fileId: string; name: string; made: boolean }

export async function makeSpecDoc(deps: WorkFileDeps, i: { userId: string; projectId: string; table: string; rowId: string; doc: string; actor: SheetActor }): Promise<MadeDoc> {
  if (i.actor.type !== 'human' && i.actor.type !== 'ai') throw new WorkError('FORBIDDEN', 'documents are made by a person or the app AI')
  const key = await deps.dataKey(deps.db, i.userId)
  const [{ withProjectSheetWrite }, files] = await Promise.all([import('./sheet-gate'), import('./files')])
  for (let attempt = 0; attempt < 2; attempt++) {
    const a = await docInputs(deps.db, key, i)
    const hash = docHash(modelOf(a, a.today))
    const name = docFileName(a.t, a.d, a.row)
    const lockedLink = async (pick: (b: DocInputs, tx: Prisma.TransactionClient) => Promise<string | null>): Promise<string | null> =>
      withProjectSheetWrite(deps, { userId: i.userId, projectId: i.projectId, sheetIds: [a.sheetId], actor: i.actor }, (w) => w.withTx(async (tx) => {
        const b = await docInputs(tx, key, i)
        if (docHash(modelOf(b, b.today)) !== hash) return null
        if (b.cur.file && b.cur.fp?.hash === hash && (await tx.workFile.findFirst({ where: { id: b.cur.file, projectId: i.projectId, userId: i.userId }, select: { id: true } }))) return b.cur.file
        const id = await pick(b, tx)
        if (!id) return null
        await w.setSpecDoc(b.sheetId, i.rowId, b.d.key, id, docFp(hash, b.today))
        return id
      }))
    if (a.cur.file && a.cur.fp?.hash === hash && (await deps.db.workFile.findFirst({ where: { id: a.cur.file, projectId: i.projectId, userId: i.userId }, select: { id: true } }))) {
      const got = await lockedLink(async () => null)
      if (got) return { fileId: got, name, made: false }
      continue
    }
    let paper: Buffer | null = null
    if (a.paper) {
      const f = await files.readProjectFile(deps, { userId: i.userId, fileId: a.paper.id, actor: i.actor, mergeReadMs: 10 * 60_000 })
      const { checkPaper } = await import('./pdf-paper')
      const why = await checkPaper(f.buffer)
      if (why) throw new WorkError('INVALID', `${a.d.label}: ${why}`)
      paper = f.buffer
    }
    const bytes = await renderDoc(modelOf(a, a.today), paper, a.appName)
    const prep = await files.prepareProjectFile(deps, { userId: i.userId, projectId: i.projectId, kind: 'report', originalName: name, mimeType: 'application/pdf', buffer: bytes, actor: i.actor })
    const mine = 'prepared' in prep ? prep.prepared : null
    let inserted = false
    let usedMine = false
    try {
      const got = await lockedLink(async (_b, tx) => {
        if (!mine) {
          const had = await tx.workFile.findFirst({ where: { id: (prep as { existing: { id: string } }).existing.id, projectId: i.projectId, userId: i.userId }, select: { id: true } })
          return had?.id ?? null
        }
        const r = await files.insertPreparedFile(tx, key, mine, i.actor)
        inserted = r.created
        return r.file.id
      })
      usedMine = inserted && !!got
      if (got) return { fileId: got, name, made: true }
    } finally {
      if (mine && !usedMine) await files.discardPreparedFile(deps, mine)
    }
  }
  throw new WorkError('STALE', 'the row is changing right now — try again')
}

export async function currentSpecDoc(db: Db, key: Buffer, q: { userId: string; projectId: string; table: string; rowId: string; doc: string }): Promise<{ ok: true; fileId: string; sha256: string } | { ok: false; why: string }> {
  let a: DocInputs
  try { a = await docInputs(db, key, q) } catch (e) { return { ok: false, why: e instanceof WorkError ? e.detail || e.code : 'the document cannot be read' } }
  if (!a.cur.file || !a.cur.fp) return { ok: false, why: `${a.d.label}: make the document first` }
  const f = await db.workFile.findFirst({ where: { id: a.cur.file, projectId: q.projectId, userId: q.userId }, select: { id: true, sha256: true } })
  if (!f) return { ok: false, why: `${a.d.label}: the document file was deleted — make the document again` }
  if (docHash(modelOf(a, a.cur.fp.day)) !== a.cur.fp.hash) return { ok: false, why: `${a.d.label}: the row changed after the document was made — make the document again` }
  return { ok: true, fileId: f.id, sha256: f.sha256 }
}
