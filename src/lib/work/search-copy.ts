import { createHmac } from 'crypto'
import { Prisma } from '@prisma/client'
import { decodeRow, type DbRow, type WorkSheetDeps } from './sheet-gate'
import { findTemplate, type SearchDecl, type SheetTemplate } from './sheet-templates'
import { describeCaughtError } from '@/lib/log-mask'
import { isCalendarDate } from './dates'

type Tx = Prisma.TransactionClient
const FILL_CHUNK = 500

export function searchKeyOf(dek: Buffer): Buffer {
  return createHmac('sha256', dek).update('aitalk.work.search-key.v1').digest()
}

export function normalizeParty(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
  return s ? s : null
}

export function partyPrint(searchKey: Buffer, v: unknown): string | null {
  const s = normalizeParty(v)
  return s === null ? null : createHmac('sha256', searchKey).update(s).digest('hex')
}

export interface SearchCopy {
  fDate1: string | null; fDate2: string | null; fDate3: string | null; fDate4: string | null
  fAmt1: string | null; fAmt2: string | null; fCur: string | null
  fKey1: string | null; fKey2: string | null; fKey3: string | null; fKey4: string | null
  fParty: string | null; fLink: string | null; fVer: number
}

const AMT = /^-?(\d{1,35})(\.(\d+))?$/
const asDate = (v: unknown) => {
  if (v === undefined || v === null || v === '') return null
  if (typeof v !== 'string' || !isCalendarDate(v)) throw new Error('search copy: not a calendar date')
  return v
}
const asAmt = (v: unknown) => {
  if (v === undefined || v === null || v === '') return null
  const t = typeof v === 'number' && Number.isFinite(v) ? String(v) : v
  const m = typeof t === 'string' ? AMT.exec(t) : null
  if (!m || (m[3]?.length ?? 0) > 30) throw new Error('search copy: amount does not fit')
  return t as string
}
const asKey = (v: unknown) => (typeof v === 'string' && v.trim() ? Array.from(v.trim()).slice(0, 255).join('') : null)
const asLink = (v: unknown) => (typeof v === 'string' && v !== '' && v.length <= 25 ? v : null)
const asCur = (v: unknown) => (typeof v === 'string' && /^[A-Za-z]{3}$/.test(v.trim()) ? v.trim().toUpperCase() : null)

export function computeSearchCopy(decl: SearchDecl, data: Readonly<Record<string, unknown>>, searchKey: Buffer): SearchCopy {
  const d = decl.dates ?? [], a = decl.amounts ?? [], k = decl.keys ?? []
  return {
    fDate1: d[0] ? asDate(data[d[0]]) : null, fDate2: d[1] ? asDate(data[d[1]]) : null,
    fDate3: d[2] ? asDate(data[d[2]]) : null, fDate4: d[3] ? asDate(data[d[3]]) : null,
    fAmt1: a[0] ? asAmt(data[a[0]]) : null, fAmt2: a[1] ? asAmt(data[a[1]]) : null,
    fCur: decl.currency ? asCur(data[decl.currency]) : null,
    fKey1: k[0] ? asKey(data[k[0]]) : null, fKey2: k[1] ? asKey(data[k[1]]) : null,
    fKey3: k[2] ? asKey(data[k[2]]) : null, fKey4: k[3] ? asKey(data[k[3]]) : null,
    fParty: decl.party ? partyPrint(searchKey, data[decl.party]) : null,
    fLink: decl.link ? asLink(data[decl.link]) : null,
    fVer: decl.version,
  }
}

export async function searchReady(db: Tx | WorkSheetDeps['db'], templates: readonly SheetTemplate[], sheetId: string): Promise<boolean> {
  const s = await db.dataSheet.findUnique({ where: { id: sheetId }, select: { template: true, searchVer: true } })
  if (!s?.template) return false
  const decl = findTemplate(templates, s.template).search
  if (!decl || s.searchVer !== decl.version || s.searchVer === 0) return false
  const left = await db.dataSheetRow.findFirst({ where: { sheetId, OR: [{ fVer: { lt: s.searchVer } }, { fVer: { gt: s.searchVer } }] }, select: { id: true } })
  return left === null
}

export async function fillSearchCopies(deps: WorkSheetDeps, q: { userId: string; projectId: string }): Promise<{ sheets: number; filled: number; broken: number; skipped: number }> {
  const out = { sheets: 0, filled: 0, broken: 0, skipped: 0 }
  const sheets = await deps.db.dataSheet.findMany({ where: { projectId: q.projectId, userId: q.userId, kind: 'project', template: { not: null } }, select: { id: true, template: true, searchVer: true }, orderBy: { id: 'asc' } })
  let key: Buffer | null = null
  for (const s of sheets) {
    let t: SheetTemplate
    try { t = findTemplate(deps.templates, s.template!) } catch { continue }
    const decl = t.search
    if (!decl) continue
    out.sheets++
    if (s.searchVer > decl.version) continue
    if (s.searchVer < decl.version) {
      const up = await deps.db.dataSheet.updateMany({ where: { id: s.id, searchVer: { lt: decl.version } }, data: { searchVer: decl.version } })
      if (up.count === 0 && (await deps.db.dataSheet.findUnique({ where: { id: s.id }, select: { searchVer: true } }))?.searchVer !== decl.version) continue
    }
    key ??= searchKeyOf(await deps.dataKey(deps.db, q.userId))
    const v = decl.version
    let after: string | undefined
    for (;;) {
      const rows = await deps.db.dataSheetRow.findMany({
        where: { sheetId: s.id, kind: 'project', projectId: q.projectId, userId: q.userId, fVer: { notIn: [v, -v] }, ...(after ? { id: { gt: after } } : {}) },
        orderBy: { id: 'asc' }, take: FILL_CHUNK,
        select: { id: true, sheetId: true, rowData: true, sealed: true, confirmed: true, confirmedBy: true, createdAt: true, updatedAt: true },
      })
      if (!rows.length) break
      after = rows[rows.length - 1].id
      const dek = await deps.dataKey(deps.db, q.userId)
      const stmts: Prisma.PrismaPromise<number>[] = []
      const broken: boolean[] = []
      for (const r of rows) {
        let c: SearchCopy | null = null
        try { c = computeSearchCopy(decl, decodeRow(r as DbRow, dek).data, key) } catch (e) { console.warn('[work-search] broken row', r.id, describeCaughtError(e)) }
        const at = r.updatedAt.toISOString().replace('Z', '')
        const cond = Prisma.sql`id = ${r.id} AND updated_at = ${at}::timestamp(3) AND f_ver NOT IN (${v}, ${-v}) AND (SELECT search_ver FROM data_sheets WHERE id = ${s.id}) = ${v}`
        broken.push(!c)
        if (!c) { stmts.push(deps.db.$executeRaw`UPDATE data_sheet_rows SET f_ver = ${-v} WHERE ${cond}`); continue }
        stmts.push(deps.db.$executeRaw`
          UPDATE data_sheet_rows SET
            f_date1 = ${c.fDate1}::date, f_date2 = ${c.fDate2}::date, f_date3 = ${c.fDate3}::date, f_date4 = ${c.fDate4}::date,
            f_amt1 = ${c.fAmt1}::numeric, f_amt2 = ${c.fAmt2}::numeric, f_cur = ${c.fCur},
            f_key1 = ${c.fKey1}, f_key2 = ${c.fKey2}, f_key3 = ${c.fKey3}, f_key4 = ${c.fKey4},
            f_party = ${c.fParty}, f_link = ${c.fLink}, f_ver = ${v}
          WHERE ${cond}`)
      }
      const done = await deps.db.$transaction(stmts)
      done.forEach((n, i) => { if (n === 0) out.skipped++; else if (broken[i]) out.broken++; else out.filled++ })
    }
  }
  return out
}
