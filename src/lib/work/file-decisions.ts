import { Prisma } from '@prisma/client'
import { WorkError } from './errors'
import { decryptJson, encryptJson } from './sealed'
import type { WorkFileDeps } from './files'
import { appTemplateOf, type AppCardRow } from './app-templates'
import { findTemplate, rowFileIds, splitFileIds, templateFileColumns, type SheetTemplate } from './sheet-templates'
import { withProjectSheetWrite, type ProjectSheetWriter, type SheetActor } from './sheet-gate'
import { isStaleUnsupported, type DocCard } from './doc-card-check'
import { describeCaughtError } from '@/lib/log-mask'
import { assertScanWrite } from './scan-fence'
import { FORM_FILE_SHAPE } from './myforms'
import { ASSEMBLED_KIND, readAssembledForms, readSpec } from './assembled'
import { findFieldsOf, readFindSummary, sameAsFound } from './doc-find'
import { DOC_READ_IMAGE_MIME } from './doc-read'

export const DECISIONS_MAX = 40
export const MORE_FILES_MAX = 20
export const EXCLUDE_REASONS = ['own_transfer', 'statement', 'other_company', 'duplicate', 'not_business', 'not_expense', 'other'] as const
export type ExcludeReason = (typeof EXCLUDE_REASONS)[number]
const TEXT_MAX = 200
const QUESTION_MAX = 300
const WHY_MAX = 200

export interface StoredDecision {
  kind: 'row' | 'excluded' | 'pending'
  target?: string
  sheetId?: string
  rowId?: string
  partOf?: string
  reason?: ExcludeReason
  text?: string
  of?: string
  question?: string
  by: 'human' | 'ai'
  at: string
}

export type FileStatus =
  | { status: 'attached'; sheetId: string; rowId: string; family: string | null; role: 'main' | 'more' }
  | { status: 'excluded'; reason: ExcludeReason; text?: string; of?: string; by: 'human' | 'ai' }
  | { status: 'pending'; question: string; by: 'human' | 'ai' }
  | { status: 'unreadable'; reason: string }
  | { status: 'new' }

type Attach = { sheetId: string; rowId: string; family: string | null; role: 'main' | 'more' }

interface FileSheet { id: string; family: string | null; tpl: SheetTemplate }

async function fileSheetsOf(deps: WorkFileDeps, userId: string, projectId: string): Promise<FileSheet[]> {
  const assembled = (await readAssembledForms(deps.db, await deps.dataKey(deps.db, userId), { userId, projectId })).map((f) => f.sheetId)
  const sheets = await deps.db.dataSheet.findMany({ where: { kind: 'project', projectId, userId, OR: [{ template: { not: null } }, { form: { deletedAt: null } }, ...(assembled.length ? [{ id: { in: assembled } }] : [])] }, select: { id: true, template: true, templateFamily: true }, orderBy: { id: 'asc' } })
  const out: FileSheet[] = []
  for (const s of sheets) {
    if (!s.template) { out.push({ id: s.id, family: null, tpl: FORM_FILE_SHAPE as SheetTemplate }); continue }
    const tpl = findTemplate(deps.templates, s.template!)
    if (tpl && (templateFileColumns(tpl).length > 0 || tpl.ui?.moreFiles)) out.push({ id: s.id, family: s.templateFamily, tpl })
  }
  return out
}

function indexAttachAll(sheets: readonly FileSheet[], rowsOf: (sheetId: string) => ReadonlyArray<{ id: string; data: Readonly<Record<string, unknown>> }>): Map<string, Attach[]> {
  const out = new Map<string, Attach[]>()
  for (const s of sheets) {
    for (const r of rowsOf(s.id)) {
      const more = new Set(s.tpl.ui?.moreFiles ? splitFileIds(r.data[s.tpl.ui.moreFiles]) : [])
      for (const id of rowFileIds(s.tpl, r.data)) {
        const role = more.has(id) && !templateFileColumns(s.tpl).some((c) => r.data[c] === id) ? 'more' : 'main'
        out.set(id, [...(out.get(id) ?? []), { sheetId: s.id, rowId: r.id, family: s.family, role }])
      }
    }
  }
  for (const list of out.values()) list.sort((a, b) => (a.role === b.role ? a.rowId.localeCompare(b.rowId) : a.role === 'main' ? -1 : 1))
  return out
}
function indexAttach(sheets: readonly FileSheet[], rowsOf: (sheetId: string) => ReadonlyArray<{ id: string; data: Readonly<Record<string, unknown>> }>): Map<string, Attach> {
  return new Map([...indexAttachAll(sheets, rowsOf)].map(([id, list]) => [id, list[0]]))
}

export async function fileRows(deps: WorkFileDeps, q: { userId: string; projectId: string; fileIds: readonly string[] }): Promise<Map<string, Array<Attach & { confirmed: boolean | null }>>> {
  const want = new Set(q.fileIds)
  const sheets = await fileSheetsOf(deps, q.userId, q.projectId)
  const rows = sheets.length && want.size
    ? await deps.db.dataSheetRow.findMany({ where: { sheetId: { in: sheets.map((s) => s.id) }, kind: 'project', projectId: q.projectId, userId: q.userId }, select: { id: true, sheetId: true, rowData: true, confirmed: true } })
    : []
  const bySheet = new Map<string, Array<{ id: string; data: Record<string, unknown> }>>()
  const confirmed = new Map<string, boolean | null>()
  for (const r of rows) {
    let data: Record<string, unknown>
    try { data = JSON.parse(r.rowData) as Record<string, unknown> } catch { continue }
    if (!data || typeof data !== 'object' || Array.isArray(data)) continue
    bySheet.set(r.sheetId, [...(bySheet.get(r.sheetId) ?? []), { id: r.id, data }])
    confirmed.set(r.id, r.confirmed)
  }
  const out = new Map<string, Array<Attach & { confirmed: boolean | null }>>()
  for (const [id, list] of indexAttachAll(sheets, (sid) => bySheet.get(sid) ?? [])) if (want.has(id)) out.set(id, list.map((a) => ({ ...a, confirmed: confirmed.get(a.rowId) ?? null })))
  return out
}

export async function fileStatuses(deps: WorkFileDeps, q: { userId: string; projectId: string }): Promise<Map<string, FileStatus>> {
  const sheets = await fileSheetsOf(deps, q.userId, q.projectId)
  const rows = sheets.length
    ? await deps.db.dataSheetRow.findMany({ where: { sheetId: { in: sheets.map((s) => s.id) }, projectId: q.projectId, userId: q.userId }, select: { id: true, sheetId: true, rowData: true } })
    : []
  const bySheet = new Map<string, Array<{ id: string; data: Record<string, unknown> }>>()
  for (const r of rows) {
    let data: Record<string, unknown>
    try { data = JSON.parse(r.rowData) as Record<string, unknown> } catch { continue }
    if (!data || typeof data !== 'object' || Array.isArray(data)) continue
    bySheet.set(r.sheetId, [...(bySheet.get(r.sheetId) ?? []), { id: r.id, data }])
  }
  const attach = indexAttach(sheets, (id) => bySheet.get(id) ?? [])
  const files = await deps.db.workFile.findMany({ where: { projectId: q.projectId, userId: q.userId, parentFileId: null }, select: { id: true, mimeType: true, decision: true, decisionState: true, readCard: true, readCardState: true } })
  const key = files.some((f) => f.decision || f.readCardState === 'failed') ? await deps.dataKey(deps.db, q.userId) : null
  const out = new Map<string, FileStatus>()
  for (const f of files) {
    const a = attach.get(f.id)
    if (a) { out.set(f.id, { status: 'attached', ...a }); continue }
    if (f.decision && key && (f.decisionState === 'excluded' || f.decisionState === 'pending')) {
      let d: StoredDecision
      try { d = decryptJson<StoredDecision>(f.decision, key) } catch (e) { console.warn(`[work] file decision unreadable ${f.id}: ${describeCaughtError(e)}`); out.set(f.id, { status: 'new' }); continue }
      if (d.kind === 'excluded' && d.reason) { out.set(f.id, { status: 'excluded', reason: d.reason, ...(d.text ? { text: d.text } : {}), ...(d.of ? { of: d.of } : {}), by: d.by }); continue }
      if (d.kind === 'pending' && d.question) { out.set(f.id, { status: 'pending', question: d.question, by: d.by }); continue }
    }
    if (f.readCardState === 'failed' && f.readCard && key) {
      try {
        const fail = decryptJson<{ failed?: unknown }>(f.readCard, key)
        if (typeof fail.failed === 'string' && !isStaleUnsupported(fail.failed, f.mimeType)) { out.set(f.id, { status: 'unreadable', reason: fail.failed }); continue }
      } catch { }
    }
    out.set(f.id, { status: 'new' })
  }
  return out
}

type Fix = { column: string; value: unknown; why: string }
type Input =
  | { fileId: string; kind: 'row'; target: string; moreFileIds: string[]; set: Record<string, unknown>; fix: Fix[] }
  | { fileId: string; kind: 'excluded'; reason: ExcludeReason; text?: string; of?: string }
  | { fileId: string; kind: 'pending'; question: string }
  | { fileId: string; kind: 'detach' }
  | { fileId: string; kind: 'attach'; rowId: string }
  | { fileId: string; kind: 'reset' }

const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''
const cut = (s: string, n: number) => s.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, n)

function parseOne(raw: unknown, human: boolean): Input | string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'each decision must be an object'
  const r = raw as Record<string, unknown>
  if (!isStr(r.fileId)) return 'fileId is required'
  const fileId = r.fileId
  switch (r.kind) {
    case 'row': {
      if (human) return 'a person makes rows on the sheet'
      if (!isStr(r.target)) return 'target is required for a row'
      const more = r.moreFileIds === undefined || r.moreFileIds === null ? [] : r.moreFileIds
      if (!Array.isArray(more) || more.some((x) => !isStr(x))) return 'moreFileIds must be a list of file ids'
      if (more.length > MORE_FILES_MAX) return `at most ${MORE_FILES_MAX} moreFileIds`
      if (new Set(more).size !== more.length) return 'a file is twice in moreFileIds'
      if (more.includes(fileId)) return 'the main file cannot be in its own moreFileIds'
      const set = r.set === undefined || r.set === null ? {} : r.set
      if (typeof set !== 'object' || Array.isArray(set)) return 'set must be an object'
      const fixRaw = r.fix === undefined || r.fix === null ? [] : r.fix
      if (!Array.isArray(fixRaw)) return 'fix must be a list of { column, value, why }'
      const fix: Fix[] = []
      for (const f of fixRaw) {
        if (!f || typeof f !== 'object' || !isStr((f as Fix).column) || !isStr((f as Fix).why)) return 'each fix needs column, value and why'
        const v = (f as Fix).value
        if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return `fix ${(f as Fix).column} needs a value`
        if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') return `fix ${(f as Fix).column} takes one value (text, number or yes/no)`
        fix.push({ column: (f as Fix).column, value: (f as Fix).value, why: cut((f as Fix).why, WHY_MAX) })
      }
      if (new Set(fix.map((f) => f.column)).size !== fix.length) return 'a column is twice in fix'
      return { fileId, kind: 'row', target: r.target, moreFileIds: more as string[], set: set as Record<string, unknown>, fix }
    }
    case 'excluded': {
      if (!EXCLUDE_REASONS.includes(r.reason as ExcludeReason)) return `reason must be one of ${EXCLUDE_REASONS.join(', ')}`
      if (r.text !== undefined && r.text !== null && typeof r.text !== 'string') return 'text must be text'
      const text = isStr(r.text) ? cut(r.text, TEXT_MAX) : undefined
      if (r.reason === 'other' && !text) return 'reason "other" needs text'
      if (r.reason === 'duplicate' && !isStr(r.of)) return 'reason "duplicate" needs of (the file it duplicates)'
      if (r.of !== undefined && r.of !== null && !isStr(r.of)) return 'of must be a file id'
      if (r.of === fileId) return 'a file cannot duplicate itself'
      return { fileId, kind: 'excluded', reason: r.reason as ExcludeReason, ...(text ? { text } : {}), ...(isStr(r.of) ? { of: r.of } : {}) }
    }
    case 'pending': {
      if (human) return 'a person answers questions in the chat'
      if (!isStr(r.question)) return 'question is required'
      return { fileId, kind: 'pending', question: cut(r.question, QUESTION_MAX) }
    }
    case 'detach': return { fileId, kind: 'detach' }
    case 'attach': return isStr(r.rowId) ? { fileId, kind: 'attach', rowId: r.rowId } : 'rowId is required to attach a file to a row'
    case 'reset': return human ? { fileId, kind: 'reset' } : 'reset is for a person — to change your decision, give the new decision'
    default: return 'kind must be row, excluded, pending, attach or detach'
  }
}

const filesOf = (d: Input): string[] => (d.kind === 'row' ? [d.fileId, ...d.moreFileIds] : [d.fileId])
const touchedBy = (d: Input): string[] => (d.kind === 'excluded' && d.of ? [...filesOf(d), d.of] : filesOf(d))

function rowData(spec: AppCardRow, tpl: SheetTemplate, card: DocCard | null, d: Extract<Input, { kind: 'row' }>): Record<string, unknown> {
  const fileCols = new Set([...templateFileColumns(tpl), ...(tpl.ui?.moreFiles ? [tpl.ui.moreFiles] : [])])
  const fixCols = new Set(d.fix.map((f) => f.column))
  for (const k of Object.keys(d.set)) {
    if (fileCols.has(k)) throw new WorkError('INVALID', `${k} is a file column — give files with fileId and moreFileIds`)
    if (!spec.settable.includes(k)) throw new WorkError('INVALID', `set may only use ${spec.settable.join(', ')}`)
    if (fixCols.has(k)) throw new WorkError('INVALID', `${k} is both in set and fix`)
  }
  for (const f of d.fix) {
    if (fileCols.has(f.column)) throw new WorkError('INVALID', `${f.column} is a file column — give files with fileId and moreFileIds`)
    if (!spec.fixable.includes(f.column)) throw new WorkError('INVALID', `fix may only use ${spec.fixable.join(', ')}`)
  }
  const base = spec.fromCard(card as Readonly<Record<string, unknown>> | null)
  const data: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(base)) if (v !== null && v !== undefined && v !== '' && !fileCols.has(k)) data[k] = v
  for (const [k, v] of Object.entries(d.set)) if (k !== 'note' && v !== null && v !== undefined) data[k] = v
  for (const f of d.fix) data[f.column] = f.value
  const notes: string[] = []
  if (isStr(d.set.note)) notes.push(d.set.note.trim())
  if (d.fix.length) notes.push(`corrected: ${d.fix.map((f) => `${f.column} (${f.why})`).join('; ')}`)
  if (!card) notes.push('values given by the person (the file could not be read)')
  if (card?.checks?.length) notes.push(`card checks: ${card.checks.join(', ')}`)
  if (notes.length) data.note = notes.join(' · ').slice(0, 1_000)
  return data
}

type LockedFile = { id: string; parent_file_id: string | null; decision: Uint8Array | null; decision_state: string | null; read_card: Uint8Array | null; read_card_state: string | null }

async function lockFiles(w: ProjectSheetWriter, userId: string, projectId: string, ids: readonly string[]): Promise<Map<string, LockedFile>> {
  const sorted = [...new Set(ids)].sort()
  const rows = await w.withTx((tx) => tx.$queryRaw<LockedFile[]>(Prisma.sql`
    SELECT id, parent_file_id, decision, decision_state, read_card, read_card_state FROM work_file
    WHERE id IN (${Prisma.join(sorted)}) AND project_id = ${projectId} AND user_id = ${userId}
    ORDER BY id FOR UPDATE`))
  return new Map(rows.map((r) => [r.id, r]))
}

export interface DecisionCtx {
  deps: WorkFileDeps
  userId: string
  projectId: string
  actor: SheetActor
}

export async function applyFileDecisions(c: DecisionCtx, raw: unknown): Promise<{ results: Array<Record<string, unknown>> }> {
  if (!Array.isArray(raw) || raw.length === 0) throw new WorkError('INVALID', 'decisions must be a non-empty list')
  if (raw.length > DECISIONS_MAX) throw new WorkError('INVALID', `at most ${DECISIONS_MAX} decisions per call`)
  const human = c.actor.type === 'human'
  const parsed = raw.map((x) => parseOne(x, human))
  const seen = new Map<string, number>()
  for (const p of parsed) if (typeof p !== 'string') for (const f of touchedBy(p)) seen.set(f, (seen.get(f) ?? 0) + 1)
  const p0 = await c.deps.db.workProject.findFirst({ where: { id: c.projectId, userId: c.userId }, select: { kind: true } })
  if (!p0) throw new WorkError('NOT_FOUND')
  const cardRows = appTemplateOf(p0.kind)?.cardRows ?? {}
  const asmTargets: AsmTargets = p0.kind === ASSEMBLED_KIND
    ? new Map((await readAssembledForms(c.deps.db, await c.deps.dataKey(c.deps.db, c.userId), { userId: c.userId, projectId: c.projectId })).flatMap((f) => (f.assembled?.table.file ? [[f.assembled.table.key, { sheetId: f.sheetId, fill: fillWithCurrency(f.assembled.table) }] as const] : [])))
    : new Map()
  const key = await c.deps.dataKey(c.deps.db, c.userId)
  const sheets = await fileSheetsOf(c.deps, c.userId, c.projectId)
  const results: Array<Record<string, unknown>> = []
  for (let i = 0; i < parsed.length; i++) {
    const d = parsed[i]
    const fileId = typeof raw[i] === 'object' && raw[i] && typeof (raw[i] as { fileId?: unknown }).fileId === 'string' ? (raw[i] as { fileId: string }).fileId : null
    if (typeof d === 'string') { results.push({ fileId, error: d }); continue }
    const twice = touchedBy(d).find((f) => (seen.get(f) ?? 0) > 1)
    if (twice) { results.push({ fileId, error: `file ${twice} is in two decisions of this call — give each file once` }); continue }
    try {
      results.push({ fileId, ok: true, ...(await applyOne(c, d, key, sheets, cardRows, asmTargets)) })
    } catch (e) {
      if (e instanceof WorkError) { results.push({ fileId, error: e.detail || e.code, code: e.code, ...(e.stop ? { stop: e.stop } : {}) }); continue }
      console.warn(`[work] file decision ${fileId}: ${describeCaughtError(e)}`)
      results.push({ fileId, error: 'this decision could not be applied — try again' })
    }
  }
  return { results }
}

type AsmTargets = ReadonlyMap<string, { sheetId: string; fill: readonly string[] }>

function fillWithCurrency(t: import('./assembled').SpecTable): string[] {
  const fill = t.file?.fill ?? []
  return [...fill, ...fill.filter((k) => t.columns.find((c) => c.key === k)?.kind === 'money').map((k) => `${k}_cur`)]
}

async function applyOne(c: DecisionCtx, d: Input, key: Buffer, sheets: readonly FileSheet[], cardRows: Readonly<Record<string, AppCardRow>>, asmTargets: AsmTargets = new Map()): Promise<Record<string, unknown>> {
  const by: StoredDecision['by'] = c.actor.type === 'human' ? 'human' : 'ai'
  const at = new Date().toISOString()
  return withProjectSheetWrite(c.deps, { userId: c.userId, projectId: c.projectId, sheetIds: sheets.map((s) => s.id), actor: c.actor }, async (w) => {
    const files = await lockFiles(w, c.userId, c.projectId, filesOf(d).concat(d.kind === 'excluded' && d.of ? [d.of] : []))
    for (const id of filesOf(d)) {
      const f = files.get(id)
      if (!f) throw new WorkError('NOT_FOUND', `file ${id} is not in this work app`)
      if (f.parent_file_id) throw new WorkError('INVALID', `file ${id} is a page image — use its original file`)
    }
    if (d.kind === 'excluded' && d.of && (!files.get(d.of) || files.get(d.of)!.parent_file_id)) throw new WorkError('NOT_FOUND', `file ${d.of} is not in this work app`)
    await w.withTx((tx) => assertScanWrite(tx, filesOf(d), d.kind === 'excluded' && d.of ? [d.of] : []))
    const rowsBy = new Map<string, Array<{ id: string; data: Record<string, unknown> }>>()
    for (const s of sheets) rowsBy.set(s.id, (await w.rows(s.id)).map((r) => ({ id: r.id, data: r.data })))
    const attachAll = indexAttachAll(sheets, (id) => rowsBy.get(id) ?? [])
    const attach = new Map([...attachAll].map(([id, list]) => [id, list[0]]))
    if (by === 'ai') {
      for (const id of filesOf(d)) {
        const f = files.get(id)!
        if (!f.decision) continue
        let was: StoredDecision
        try { was = decryptJson<StoredDecision>(f.decision, key) } catch (e) { console.warn(`[work] file decision unreadable ${id}: ${describeCaughtError(e)}`); continue }
        if (was.by === 'human' && (was.kind !== 'row' || attach.has(id))) throw new WorkError('INVALID', `file ${id} was decided by a person — leave it`)
      }
    }
    const save = (id: string, dec: StoredDecision | null) => w.withTx((tx) => tx.workFile.update({ where: { id }, data: dec ? { decision: encryptJson(dec, key), decisionState: dec.kind } : { decision: null, decisionState: null } }))

    if (d.kind === 'detach') {
      const list = attachAll.get(d.fileId) ?? []
      if (list.length === 0) throw new WorkError('INVALID', 'this file is not on a row')
      const main = list.find((a) => a.role === 'main')
      if (main) throw new WorkError('INVALID', `this file is the main file of row ${main.rowId} — delete that row instead`)
      for (const a of list) {
        const s = sheets.find((x) => x.id === a.sheetId)!
        const more = s.tpl.ui!.moreFiles!
        const before = rowsBy.get(a.sheetId)!.find((r) => r.id === a.rowId)!.data
        const rest = splitFileIds(before[more]).filter((x) => x !== d.fileId)
        const after = await w.update(a.sheetId, a.rowId, { [more]: rest.length ? rest.join(',') : null })
        if (s.tpl.dateColumn && s.tpl.ui?.file) {
          const mainCol = s.tpl.ui.file
          await w.syncRowFiles(a.rowId, (x) => [...new Set([...(typeof x[mainCol] === 'string' && x[mainCol] ? [x[mainCol] as string] : []), ...splitFileIds(x[more])])], s.tpl.dateColumn, before, after.data)
        }
      }
      await save(d.fileId, null)
      return { detached: true, rowIds: list.map((a) => a.rowId) }
    }

    for (const id of filesOf(d)) {
      const a = attach.get(id)
      if (a) throw new WorkError('INVALID', a.role === 'main' ? `file ${id} is the main file of row ${a.rowId} — delete that row first` : `file ${id} is on row ${a.rowId} — detach it first`)
    }
    if (d.kind === 'reset') { await save(d.fileId, null); return { reset: true } }
    if (d.kind === 'attach') {
      const s = sheets.find((x) => (rowsBy.get(x.id) ?? []).some((r) => r.id === d.rowId))
      if (!s) throw new WorkError('NOT_FOUND', `row ${d.rowId} is not in this work app`)
      const more = s.tpl.ui?.moreFiles
      if (!more) throw new WorkError('INVALID', 'that sheet takes no extra files')
      const before = rowsBy.get(s.id)!.find((r) => r.id === d.rowId)!.data
      const list = [...splitFileIds(before[more]), d.fileId]
      if (list.length > MORE_FILES_MAX) throw new WorkError('INVALID', `a row takes at most ${MORE_FILES_MAX} extra files`)
      const after = await w.update(s.id, d.rowId, { [more]: list.join(',') })
      if (s.tpl.dateColumn && s.tpl.ui?.file) {
        const main = s.tpl.ui.file
        await w.syncRowFiles(d.rowId, (x) => [...new Set([...(typeof x[main] === 'string' && x[main] ? [x[main] as string] : []), ...splitFileIds(x[more])])], s.tpl.dateColumn, before, after.data)
      }
      const mainId = typeof before[s.tpl.ui!.file!] === 'string' ? (before[s.tpl.ui!.file!] as string) : undefined
      await save(d.fileId, { kind: 'row', sheetId: s.id, rowId: d.rowId, ...(mainId ? { partOf: mainId } : {}), by, at })
      return { attached: true, rowId: d.rowId }
    }
    if (d.kind === 'excluded') { await save(d.fileId, { kind: 'excluded', reason: d.reason, ...(d.text ? { text: d.text } : {}), ...(d.of ? { of: d.of } : {}), by, at }); return { status: 'excluded' } }
    if (d.kind === 'pending') { await save(d.fileId, { kind: 'pending', question: d.question, by, at }); return { status: 'pending' } }

    const asm0 = asmTargets.get(d.target)
    if (asm0) {
      const now = await w.withTx((tx) => readSpec(tx, key, { userId: c.userId, projectId: c.projectId }))
      const nt = now?.spec.tables.find((t) => t.key === d.target)
      if (!nt || nt.hidden || !nt.file) throw new WorkError('INVALID', `the table ${d.target} no longer takes files`)
      const asm = { sheetId: asm0.sheetId, fill: fillWithCurrency(nt) }
      const fill = new Set(asm.fill)
      const bad = [...Object.keys(d.set), ...d.fix.map((f) => f.column)].filter((k) => !fill.has(k))
      if (bad.length) throw new WorkError('INVALID', `this table fills only ${[...fill].join(', ')} from a file — not ${bad.join(', ')}`)
      if (!sheets.some((s) => s.id === asm.sheetId)) throw new WorkError('NOT_FOUND', `no ${d.target} table in this work app`)
      const data: Record<string, unknown> = { ...d.set }
      for (const f of d.fix) data[f.column] = f.value
      if (by === 'ai') await w.withTx(async (tx) => {
        const mf = await tx.workFile.findFirst({ where: { id: d.fileId, projectId: c.projectId, userId: c.userId }, select: { mimeType: true } })
        if (!mf) throw new WorkError('NOT_FOUND', `file ${d.fileId} is not in this work app`)
        if (mf.mimeType !== 'application/pdf' && !DOC_READ_IMAGE_MIME.has(mf.mimeType)) return
        const fields = findFieldsOf(nt)
        const sum = await readFindSummary(tx, key, { userId: c.userId, projectId: c.projectId }, { fileId: d.fileId, fields })
        if (!sum || !sum.complete) throw new WorkError('INVALID', `read this file with work_find_in_document (table ${d.target}) until complete is true — then write only the values it found`)
        const filled = (k: string) => data[k] !== undefined && data[k] !== null && data[k] !== ''
        const why: string[] = []
        for (const f of fields) {
          const r = sum.fields[f.key]
          if (!filled(f.key) && !(f.kind === 'money' && filled(`${f.key}_cur`))) continue
          if (r.status === 'found') { if (!sameAsFound(f, data, r.value)) why.push(`${f.key}: the document says ${r.value} (page ${r.page}) — write that or leave it empty`) }
          else if (r.status === 'candidates') why.push(`${f.key}: leave it empty and ask the person — candidates: ${r.candidates.map((x) => `${x.value} (p${x.page})`).join(', ')}`)
          else why.push(`${f.key}: not stated in the document — leave it empty`)
        }
        if (why.length) throw new WorkError('INVALID', why.join(' · '))
      })
      data[FORM_FILE_SHAPE.ui!.file!] = d.fileId
      if (d.moreFileIds.length) data[FORM_FILE_SHAPE.ui!.moreFiles!] = d.moreFileIds.join(',')
      const row = await w.insert(asm.sheetId, data)
      await save(d.fileId, { kind: 'row', target: d.target, sheetId: asm.sheetId, rowId: row.id, by, at })
      for (const m of d.moreFileIds) await save(m, { kind: 'row', target: d.target, sheetId: asm.sheetId, rowId: row.id, partOf: d.fileId, by, at })
      return { rowId: row.id, sheetId: asm.sheetId }
    }
    const spec = cardRows[d.target]
    if (!spec) throw new WorkError('INVALID', Object.keys(cardRows).length ? `target must be one of ${Object.keys(cardRows).join(', ')}` : asmTargets.size ? `target must be a table that takes files: ${[...asmTargets.keys()].join(', ')}` : 'this work app does not make rows from cards')
    const sheet = sheets.find((s) => s.family === spec.family)
    if (!sheet || !sheet.tpl.ui?.file) throw new WorkError('NOT_FOUND', `no ${spec.family} sheet in this work app`)
    const main = files.get(d.fileId)!
    let card: DocCard | null = null
    if (main.read_card_state === 'ok' && main.read_card) {
      try { card = decryptJson<DocCard>(main.read_card, key) } catch { card = null }
    }
    if (!card) {
      if (main.read_card_state !== 'failed') throw new WorkError('INVALID', 'this file has no card yet — read it with work_read_documents first')
      if (d.fix.length === 0) throw new WorkError('INVALID', 'this file could not be read — if the person gave the values, put every required value in fix (with why); otherwise decide excluded or pending')
    }
    const data = rowData(spec, sheet.tpl, card, d)
    if (!card) {
      const missing = sheet.tpl.columns.filter((col) => col.required && !templateFileColumns(sheet.tpl).includes(col.name) && (data[col.name] === undefined || data[col.name] === null || data[col.name] === '')).map((col) => col.name)
      if (missing.length) throw new WorkError('INVALID', `the file could not be read — give every required value in fix: ${missing.join(', ')}`)
    }
    data[sheet.tpl.ui.file] = d.fileId
    if (d.moreFileIds.length) {
      if (!sheet.tpl.ui.moreFiles) throw new WorkError('INVALID', 'this sheet takes no moreFileIds')
      data[sheet.tpl.ui.moreFiles] = d.moreFileIds.join(',')
    }
    const row = await w.insert(sheet.id, data)
    if (sheet.tpl.dateColumn) {
      const mainCol = sheet.tpl.ui.file
      const moreCol = sheet.tpl.ui.moreFiles
      await w.syncRowFiles(row.id, (x) => [...new Set([...(typeof x[mainCol] === 'string' && x[mainCol] ? [x[mainCol] as string] : []), ...(moreCol ? splitFileIds(x[moreCol]) : [])])], sheet.tpl.dateColumn, null, row.data)
    }
    await save(d.fileId, { kind: 'row', target: d.target, sheetId: sheet.id, rowId: row.id, by, at })
    for (const m of d.moreFileIds) await save(m, { kind: 'row', target: d.target, sheetId: sheet.id, rowId: row.id, partOf: d.fileId, by, at })
    return { rowId: row.id, sheetId: sheet.id }
  })
}
