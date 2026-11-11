
import { Prisma, type PrismaClient } from '@prisma/client'
import { encryptJson, decryptJson } from './sealed'
import { WorkError } from './errors'
import {
  actorLabel,
  assertProjectWritable,
  decodeRow,
  lockProjectForShare,
  lockProjectForWrite,
  sheetMeta,
  type LockedProject,
  type SheetActor,
  type SheetMeta,
  type SheetRowView,
  type WorkSheetDeps,
} from './sheet-gate'
import { calendarDateOf, type SheetSchema } from './sheet-columns'
import { dateInAny, effectiveIntervals, rangesOverlap, type DateRange } from './sheet-periods'
import { isCalendarDate } from './dates'
import { validateTemplateRegistry, type SheetTemplate } from './sheet-templates'
import { closesLongCycle, referenceLinesOf, type ReferenceLine } from './reference-lines'
import { isWorkAppRow } from './app-canvas'
import { hiddenAppIds } from './app-canvas-sync'
export { referenceLinesOf, type ReferenceLine } from './reference-lines'

const TX_TIMEOUT_MS = 30_000
const MAX_SELECTORS = 50
type Tx = Prisma.TransactionClient
type Db = PrismaClient | Tx

import { fingerprint, stable } from './fingerprint'
import { booksOf } from './shared-apps'
export { fingerprint }
export const rowFp = (key: Buffer, r: { sheetId: string; data: Readonly<Record<string, unknown>> }) => fingerprint(key, 'row', { s: r.sheetId, d: r.data })
const pickCols = (data: Readonly<Record<string, unknown>>, cols: readonly string[]): Record<string, unknown> =>
  Object.fromEntries(cols.filter((c) => data[c] !== undefined).map((c) => [c, data[c]]))
const snapRowFp = (key: Buffer, r: { sheetId: string; data: Readonly<Record<string, unknown>> }, cols?: readonly string[]) =>
  rowFp(key, cols ? { sheetId: r.sheetId, data: pickCols(r.data, cols) } : r)
export const pairFp = (key: Buffer, p: { fromRowId: string; toRowId: string; kind: string; confirmed: boolean }) =>
  fingerprint(key, 'pair', { f: p.fromRowId, t: p.toRowId, k: p.kind, c: p.confirmed })

function clip(range: DateRange, window: DateRange): DateRange | null {
  if (!rangesOverlap(range, window)) return null
  return { start: range.start > window.start ? range.start : window.start, end: range.end < window.end ? range.end : window.end }
}

export interface ReferenceSheetView {
  id: string
  name: string
  template: string | null
  family: string
  schema: SheetSchema
}

export interface ReferencePairView {
  id: string
  fromRowId: string
  toRowId: string
  kind: string
  confirmed: boolean
}

export interface ReferenceView {
  referenceId: string
  sourceProjectId: string
  includeUnconfirmed: boolean
  selectors: readonly string[]
  sheets: readonly ReferenceSheetView[]
  rows: readonly SheetRowView[]
  pairs: readonly ReferencePairView[]
  revising: readonly string[]
  periods: readonly ReferencePeriod[]
  sourceBooks?: readonly string[]
}

export interface ReferencePeriod {
  taskId: string
  start: string
  end: string
  status: string
  number: number | null
}

interface SourceTask {
  id: string
  status: string
  number: number | null
  period: DateRange | null
}

export interface ViewTrace {
  tasks: Map<string, SourceTask>
  rowTasks: Map<string, string[]>
  fragments: Map<string, Array<{ window: DateRange | null; range: DateRange }>>
  touchingPairs: ReferencePairView[]
}

export interface ReferenceRow {
  id: string
  fromProjectId: string
  toProjectId: string
  sheets: string[]
  includeUnconfirmed: boolean
}

async function sourceTasks(db: Db, userId: string, projectId: string): Promise<SourceTask[]> {
  const tasks = await db.workTask.findMany({
    where: { projectId, userId },
    select: { id: true, status: true, periodStart: true, periodEnd: true, currentSubmissionId: true },
  })
  const subIds = tasks.map((t) => t.currentSubmissionId).filter((x): x is string => !!x)
  const subs = subIds.length ? await db.workSubmission.findMany({ where: { id: { in: subIds } }, select: { id: true, number: true } }) : []
  const num = new Map(subs.map((s) => [s.id, s.number]))
  return tasks.map((t) => ({
    id: t.id,
    status: t.status,
    number: t.currentSubmissionId ? num.get(t.currentSubmissionId) ?? null : null,
    period: t.periodStart && t.periodEnd ? { start: t.periodStart.toISOString().slice(0, 10), end: t.periodEnd.toISOString().slice(0, 10) } : null,
  }))
}

function dateOf(meta: SheetMeta, column: string, data: Record<string, unknown>): string {
  const d = calendarDateOf(meta.byName.get(column)!, data[column])
  if (!d) throw new WorkError('INVALID', `${column} must be a date`)
  return d
}

async function computeView(db: Db, key: Buffer, templates: readonly SheetTemplate[], userId: string, ref: ReferenceRow): Promise<{ view: ReferenceView; trace: ViewTrace }> {
  const selectors = new Set(ref.sheets)
  const sheetRows = await db.dataSheet.findMany({
    where: { kind: 'project', projectId: ref.toProjectId, userId },
    select: { id: true, name: true, schema: true, template: true, templateFamily: true },
    orderBy: { id: 'asc' },
  })
  const picked = sheetRows.map((s) => ({ s, meta: sheetMeta(s, templates) })).filter((x) => selectors.has(x.meta.family))

  const tasks = await sourceTasks(db, userId, ref.toProjectId)
  const dated = tasks.filter((t) => t.period)
  const confirmedOnlyRows = !ref.includeUnconfirmed && (await db.workProject.findFirst({ where: { id: ref.toProjectId, userId }, select: { kind: true } }))?.kind === 'assembled'
  const submitted = dated.filter((t) => t.status === 'submitted')
  const scope = ref.includeUnconfirmed ? dated : submitted
  const confirmedPeriods = submitted.map((t) => t.period!)

  const trace: ViewTrace = { tasks: new Map(), rowTasks: new Map(), fragments: new Map(), touchingPairs: [] }
  const rows: SheetRowView[] = []
  for (const { s, meta } of picked) {
    const raw = await db.dataSheetRow.findMany({
      where: { sheetId: s.id, kind: 'project', projectId: ref.toProjectId, userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })
    const all = raw.map((r) => decodeRow(r, key))
    const t = meta.template
    if (t?.dateColumn) {
      for (const r of all) {
        const d = dateOf(meta, t.dateColumn, r.data)
        if (!ref.includeUnconfirmed && !dateInAny(d, confirmedPeriods)) continue
        rows.push(r)
        trace.rowTasks.set(r.id, scope.filter((x) => x.period!.start <= d && d <= x.period!.end).map((x) => x.id))
      }
    } else if (t?.effectiveFromColumn) {
      const col = t.effectiveFromColumn
      const intervals = effectiveIntervals(all.map((r) => ({ id: r.id, start: dateOf(meta, col, r.data) })))
      for (const r of all) {
        const iv = intervals.get(r.id)!
        if (!ref.includeUnconfirmed && !confirmedPeriods.some((p) => rangesOverlap(iv, p))) continue
        rows.push(r)
        const hits = scope.filter((x) => rangesOverlap(iv, x.period!))
        trace.rowTasks.set(r.id, hits.map((x) => x.id))
        trace.fragments.set(r.id, hits.length ? hits.map((x) => ({ window: x.period!, range: clip(iv, x.period!)! })) : [{ window: null, range: iv }])
      }
    } else {
      for (const r of all) { if (confirmedOnlyRows && r.confirmed !== true) continue; rows.push(r); trace.rowTasks.set(r.id, []) }
    }
  }
  const byTask = new Map(tasks.map((x) => [x.id, x]))
  for (const ids of trace.rowTasks.values()) for (const id of ids) trace.tasks.set(id, byTask.get(id)!)

  const visible = new Set(rows.map((r) => r.id))
  const ids = [...visible]
  const touching = ids.length
    ? await db.sheetRowPair.findMany({
        where: { projectId: ref.toProjectId, userId, OR: [{ fromRowId: { in: ids } }, { toRowId: { in: ids } }] },
        select: { id: true, fromRowId: true, toRowId: true, kind: true, confirmed: true },
        orderBy: { id: 'asc' },
      })
    : []
  trace.touchingPairs = touching

  const view: ReferenceView = {
    referenceId: ref.id,
    sourceProjectId: ref.toProjectId,
    includeUnconfirmed: ref.includeUnconfirmed,
    selectors: [...ref.sheets],
    sheets: picked.map(({ s, meta }) => ({ id: s.id, name: s.name, template: s.template, family: meta.family, schema: meta.schema })),
    rows,
    pairs: touching.filter((p) => visible.has(p.fromRowId) && visible.has(p.toRowId)),
    revising: picked.some(({ meta }) => meta.template?.dateColumn || meta.template?.effectiveFromColumn)
      ? tasks.filter((x) => x.status === 'open' && x.number !== null).map((x) => x.id)
      : [],
    periods: dated
      .map((t) => ({ taskId: t.id, start: t.period!.start, end: t.period!.end, status: t.status, number: t.number }))
      .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0)),
    sourceBooks: (await booksOf(db, userId, [ref.toProjectId])).get(ref.toProjectId) ?? [],
  }
  return { view, trace }
}

function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v)
    for (const k of Object.keys(v as object)) deepFreeze((v as Record<string, unknown>)[k])
  }
  return v
}

export type ReferenceReadLog = Map<string, ReferenceReadEntry>
export interface ReferenceReadEntry {
  rows: Set<string>; pairs: Set<string>; tasks: Set<string>; cols: Map<string, Set<string> | null>
  scopes?: Map<string, ReferenceWatchScope>; watched?: Set<string>
}
export interface ReferenceWatchScope { sheetId: string; dateIn: { columns: string[]; range: DateRange } }
const emptyReadEntry = (): ReferenceReadEntry => ({ rows: new Set<string>(), pairs: new Set<string>(), tasks: new Set<string>(), cols: new Map() })

export interface ReferenceRowsOptions {
  columns?: readonly string[]
  dateIn?: { columns: readonly string[]; range: DateRange }
  watch?: true
  ids?: readonly string[]
}

const MAX_ROW_IDS = 500

export class ReferenceReader {
  private readonly byId: ReadonlyMap<string, ReferenceView>

  constructor(views: readonly ReferenceView[], private readonly log?: ReferenceReadLog) {
    this.byId = new Map(views.map((v) => [v.referenceId, deepFreeze(v)]))
  }

  private note(referenceId: string, what: 'rows' | 'pairs' | 'tasks', ids: readonly string[]): void {
    if (!this.log) return
    const e = this.log.get(referenceId) ?? emptyReadEntry()
    for (const id of ids) e[what].add(id)
    this.log.set(referenceId, e)
  }

  references(): Array<{ referenceId: string; sourceProjectId: string; includeUnconfirmed: boolean; selectors: readonly string[]; revising: readonly string[]; sourceBooks: readonly string[] }> {
    return [...this.byId.values()].map((v) => ({
      referenceId: v.referenceId,
      sourceProjectId: v.sourceProjectId,
      includeUnconfirmed: v.includeUnconfirmed,
      selectors: v.selectors,
      revising: v.revising,
      sourceBooks: v.sourceBooks ?? [],
    }))
  }

  sheets(referenceId: string): readonly ReferenceSheetView[] {
    return this.view(referenceId).sheets
  }

  rows(referenceId: string, sheetId: string, opts?: ReferenceRowsOptions): readonly SheetRowView[] {
    const v = this.view(referenceId)
    const sheet = v.sheets.find((s) => s.id === sheetId)
    if (!sheet) throw new WorkError('NOT_FOUND')
    if (opts?.watch !== undefined && (opts.watch !== true || opts.dateIn === undefined)) throw new WorkError('INVALID', 'watch needs dateIn')
    let out = v.rows.filter((r) => r.sheetId === sheetId)
    if (opts?.ids !== undefined) {
      const ids = opts.ids
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_ROW_IDS || ids.some((id) => typeof id !== 'string' || id === '')) {
        throw new WorkError('INVALID', `ids must be a list of 1 to ${MAX_ROW_IDS} row ids`)
      }
      if (opts.dateIn !== undefined || opts.watch !== undefined) throw new WorkError('INVALID', 'ids cannot be combined with dateIn or watch')
      const want = new Set(ids)
      out = out.filter((r) => want.has(r.id))
      if (this.log) {
        const e = this.log.get(referenceId) ?? emptyReadEntry()
        e.watched = e.watched ?? new Set()
        for (const row of out) e.watched.add(row.id)
        this.log.set(referenceId, e)
      }
    }
    if (!opts || (opts.columns === undefined && opts.dateIn === undefined)) {
      this.note(referenceId, 'rows', out.map((r) => r.id))
      this.noteCols(referenceId, out, null)
      return out
    }
    const known = new Set(sheet.schema.columns.map((c) => c.name))
    const names = (list: unknown, what: string): string[] => {
      if (!Array.isArray(list) || list.length === 0 || list.some((c) => typeof c !== 'string' || !known.has(c))) {
        throw new WorkError('INVALID', `${what} must be a non-empty list of columns of this sheet`)
      }
      return list as string[]
    }
    const dateIn = opts.dateIn
    let dateCols: string[] = []
    if (dateIn !== undefined) {
      dateCols = names(dateIn?.columns, 'dateIn.columns')
      const r = dateIn.range
      if (!r || !isCalendarDate(r.start) || !isCalendarDate(r.end) || r.start > r.end) throw new WorkError('INVALID', 'dateIn.range needs { start, end } dates with start <= end')
      out = out.filter((row) => dateCols.some((c) => { const d = row.data[c]; return isCalendarDate(d) && r.start <= d && d <= r.end }))
    }
    const cols = opts.columns === undefined ? null : [...new Set([...names(opts.columns, 'columns'), ...dateCols])].sort()
    this.note(referenceId, 'rows', out.map((r) => r.id))
    this.noteCols(referenceId, out, cols)
    if (opts.watch && this.log) {
      const e = this.log.get(referenceId) ?? emptyReadEntry()
      const scope: ReferenceWatchScope = { sheetId, dateIn: { columns: [...dateCols].sort(), range: { start: dateIn!.range.start, end: dateIn!.range.end } } }
      e.scopes = e.scopes ?? new Map()
      e.scopes.set(stable(scope), scope)
      e.watched = e.watched ?? new Set()
      for (const row of out) e.watched.add(row.id)
      this.log.set(referenceId, e)
    }
    return cols ? out.map((r) => deepFreeze({ ...r, data: pickCols(r.data, cols) })) : out
  }

  private noteCols(referenceId: string, rows: readonly SheetRowView[], cols: readonly string[] | null): void {
    if (!this.log) return
    const e = this.log.get(referenceId) ?? emptyReadEntry()
    for (const r of rows) {
      const had = e.cols.get(r.id)
      if (cols === null || had === null) { e.cols.set(r.id, null); continue }
      e.cols.set(r.id, new Set([...(had ?? []), ...cols]))
    }
    this.log.set(referenceId, e)
  }

  pairs(referenceId: string): readonly ReferencePairView[] {
    const out = this.view(referenceId).pairs
    this.note(referenceId, 'pairs', out.map((p) => p.id))
    return out
  }

  periods(referenceId: string, range: DateRange): readonly ReferencePeriod[] {
    if (!range || typeof range.start !== 'string' || typeof range.end !== 'string' || range.start > range.end) {
      throw new WorkError('INVALID', 'periods needs a range { start, end } with start <= end')
    }
    const out = this.view(referenceId).periods.filter((p) => rangesOverlap(p, range))
    this.note(referenceId, 'tasks', out.map((p) => p.taskId))
    return out
  }

  private view(referenceId: string): ReferenceView {
    const v = this.byId.get(referenceId)
    if (!v) throw new WorkError('NOT_FOUND')
    return v
  }
}

export async function readProjectReferences(deps: WorkSheetDeps, q: { userId: string; projectId: string; workflowId?: string }): Promise<ReferenceReader> {
  validateTemplateRegistry(deps.templates)
  const p = await deps.db.workProject.findFirst({ where: { id: q.projectId, userId: q.userId }, select: { workflowId: true } })
  if (!p) throw new WorkError('NOT_FOUND')
  if (q.workflowId !== undefined && (!p.workflowId || p.workflowId !== q.workflowId)) throw new WorkError('FORBIDDEN')
  const key = await deps.dataKey(deps.db, q.userId)
  const refs = await deps.db.projectReference.findMany({ where: { fromProjectId: q.projectId, userId: q.userId }, orderBy: { id: 'asc' } })
  const views: ReferenceView[] = []
  for (const r of refs) views.push((await computeView(deps.db, key, deps.templates, q.userId, r)).view)
  return new ReferenceReader(views)
}

async function lockAccountForReferenceChange(tx: Tx, userId: string): Promise<void> {
  const u = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "user" WHERE id = ${userId} FOR NO KEY UPDATE`
  if (u.length === 0) throw new WorkError('NOT_FOUND')
}

async function lockReferenceEnds(tx: Tx, userId: string, fromProjectId: string, toProjectId: string): Promise<void> {
  const got = new Map<string, LockedProject>()
  for (const id of [fromProjectId, toProjectId].sort()) got.set(id, await lockProjectForShare(tx, userId, id))
  assertProjectWritable(got.get(fromProjectId)!)
}

async function normalizeSelectors(tx: Tx, templates: readonly SheetTemplate[], userId: string, toProjectId: string, input: unknown): Promise<string[]> {
  if (!Array.isArray(input) || input.length === 0) throw new WorkError('INVALID', 'choose at least one sheet')
  for (const s of input) if (typeof s !== 'string' || s === '' || s.length > 80) throw new WorkError('INVALID', 'bad sheet selector')
  const out = [...new Set(input as string[])].sort()
  if (out.length > MAX_SELECTORS) throw new WorkError('INVALID', `at most ${MAX_SELECTORS} sheets`)
  const families = new Set(templates.map((t) => t.family))
  const freeIds: string[] = []
  for (const s of out) {
    if (s.startsWith('sheet:')) freeIds.push(s.slice('sheet:'.length))
    else if (!families.has(s)) throw new WorkError('INVALID', `unknown template family ${s}`)
  }
  if (freeIds.length) {
    const n = await tx.dataSheet.count({ where: { id: { in: freeIds }, kind: 'project', projectId: toProjectId, userId, template: null } })
    if (n !== freeIds.length) throw new WorkError('NOT_FOUND')
  }
  return out as string[]
}

async function refEvent(tx: Tx, key: Buffer, e: { userId: string; projectId: string; action: string; detail: unknown; actor?: SheetActor }) {
  await tx.workEvent.create({
    data: { userId: e.userId, projectId: e.projectId, actor: actorLabel(e.actor ?? { type: 'human' }), action: e.action, payload: encryptJson(e.detail, key) },
  })
}

export async function createProjectReference(
  deps: WorkSheetDeps,
  input: { userId: string; fromProjectId: string; toProjectId: string; sheets: string[]; includeUnconfirmed?: boolean },
) {
  validateTemplateRegistry(deps.templates)
  if (input.fromProjectId === input.toProjectId) throw new WorkError('INVALID', 'a project cannot reference itself')
  const key = await deps.dataKey(deps.db, input.userId)
  return deps.db.$transaction(async (tx) => {
    await lockAccountForReferenceChange(tx, input.userId)
    await lockReferenceEnds(tx, input.userId, input.fromProjectId, input.toProjectId)
    const sheets = await normalizeSelectors(tx, deps.templates, input.userId, input.toProjectId, input.sheets)
    const edges = await tx.projectReference.findMany({ where: { userId: input.userId }, select: { fromProjectId: true, toProjectId: true } })
    if (closesLongCycle(edges, input.fromProjectId, input.toProjectId)) throw new WorkError('INVALID', 'references cannot form a cycle of three or more work apps')
    let ref
    try {
      ref = await tx.projectReference.create({
        data: { userId: input.userId, fromProjectId: input.fromProjectId, toProjectId: input.toProjectId, sheets, includeUnconfirmed: !!input.includeUnconfirmed },
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new WorkError('DUPLICATE', 'reference')
      throw e
    }
    await refEvent(tx, key, { userId: input.userId, projectId: input.fromProjectId, action: 'reference_create', detail: { referenceId: ref.id, to: input.toProjectId, sheets, includeUnconfirmed: ref.includeUnconfirmed } })
    return ref
  }, { timeout: TX_TIMEOUT_MS })
}

export async function updateProjectReference(
  deps: WorkSheetDeps,
  input: { userId: string; referenceId: string; sheets?: string[]; includeUnconfirmed?: boolean },
) {
  validateTemplateRegistry(deps.templates)
  const key = await deps.dataKey(deps.db, input.userId)
  return deps.db.$transaction(async (tx) => {
    await lockAccountForReferenceChange(tx, input.userId)
    const cur = await tx.projectReference.findFirst({ where: { id: input.referenceId, userId: input.userId } })
    if (!cur) throw new WorkError('NOT_FOUND')
    await lockReferenceEnds(tx, input.userId, cur.fromProjectId, cur.toProjectId)
    const sheets = input.sheets === undefined ? cur.sheets : await normalizeSelectors(tx, deps.templates, input.userId, cur.toProjectId, input.sheets)
    const includeUnconfirmed = input.includeUnconfirmed === undefined ? cur.includeUnconfirmed : !!input.includeUnconfirmed
    const ref = await tx.projectReference.update({ where: { id: cur.id }, data: { sheets, includeUnconfirmed } })
    await refEvent(tx, key, {
      userId: input.userId,
      projectId: cur.fromProjectId,
      action: 'reference_update',
      detail: { referenceId: cur.id, before: { sheets: cur.sheets, includeUnconfirmed: cur.includeUnconfirmed }, after: { sheets, includeUnconfirmed } },
    })
    return ref
  }, { timeout: TX_TIMEOUT_MS })
}

export async function deleteProjectReference(deps: WorkSheetDeps, input: { userId: string; referenceId: string }) {
  const key = await deps.dataKey(deps.db, input.userId)
  await deps.db.$transaction(async (tx) => {
    await lockAccountForReferenceChange(tx, input.userId)
    const cur = await tx.projectReference.findFirst({ where: { id: input.referenceId, userId: input.userId } })
    if (!cur) throw new WorkError('NOT_FOUND')
    await tx.projectReference.delete({ where: { id: cur.id } })
    await refEvent(tx, key, { userId: input.userId, projectId: cur.fromProjectId, action: 'reference_delete', detail: { referenceId: cur.id, to: cur.toProjectId, sheets: cur.sheets } })
  }, { timeout: TX_TIMEOUT_MS })
}

export async function lockForSubmit(tx: Tx, userId: string, projectId: string): Promise<{ project: LockedProject; references: ReferenceRow[] }> {
  const u = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "user" WHERE id = ${userId} FOR SHARE`
  if (u.length === 0) throw new WorkError('NOT_FOUND')
  const references = await tx.projectReference.findMany({ where: { fromProjectId: projectId, userId }, orderBy: { id: 'asc' } })
  let project: LockedProject | null = null
  for (const id of [...new Set([projectId, ...references.map((r) => r.toProjectId)])].sort()) {
    if (id === projectId) project = await lockProjectForWrite(tx, userId, id)
    else await lockProjectForShare(tx, userId, id)
  }
  return { project: project!, references }
}

export interface ReferenceSnapshot {
  referenceId: string
  sourceProjectId: string
  includeUnconfirmed: boolean
  selectors: string[]
  tasks: Array<{ id: string; status: string; number: number | null }>
  rows: Array<{ id: string; sheetId: string; fp: string; cols?: string[]; fragments?: Array<{ window: DateRange | null; range: DateRange }>; cf?: boolean | null }>
  scopes?: ReferenceWatchScope[]
  pairs: Array<{ id: string; fp: string }>
}

export interface ComputedReference {
  ref: ReferenceRow
  view: ReferenceView
  trace: ViewTrace
}

export async function computeReferenceViews(tx: Tx, key: Buffer, templates: readonly SheetTemplate[], userId: string, references: readonly ReferenceRow[]): Promise<ComputedReference[]> {
  const out: ComputedReference[] = []
  for (const ref of references) out.push({ ref, ...(await computeView(tx, key, templates, userId, ref)) })
  return out
}

export function snapshotsFrom(key: Buffer, computed: readonly ComputedReference[], read?: ReferenceReadLog): ReferenceSnapshot[] {
  return computed.map(({ ref, view, trace }) => {
    const log = read ? read.get(ref.id) ?? emptyReadEntry() : null
    const rows = log ? view.rows.filter((r) => log.rows.has(r.id)) : view.rows
    const rowIds = new Set(rows.map((r) => r.id))
    const taskIds = new Set([...rows.flatMap((r) => trace.rowTasks.get(r.id) ?? []), ...(log?.tasks ?? [])])
    const periodTasks = new Map(view.periods.map((p) => [p.taskId, { id: p.taskId, status: p.status, number: p.number }]))
    const known = new Map<string, { id: string; status: string; number: number | null }>([...periodTasks, ...trace.tasks])
    const pairs = log
      ? trace.touchingPairs.filter((p) => log.pairs.has(p.id) || rowIds.has(p.fromRowId) || rowIds.has(p.toRowId))
      : trace.touchingPairs
    return {
      referenceId: ref.id,
      sourceProjectId: ref.toProjectId,
      includeUnconfirmed: ref.includeUnconfirmed,
      selectors: [...ref.sheets],
      tasks: [...known.values()]
        .filter((t) => taskIds.has(t.id))
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .map((t) => ({ id: t.id, status: t.status, number: t.number })),
      rows: rows.map((r) => {
        const fr = trace.fragments.get(r.id)
        const picked = log?.cols.get(r.id)
        const cols = picked ? [...picked].sort() : undefined
        return { id: r.id, sheetId: r.sheetId, fp: snapRowFp(key, r, cols), ...(cols ? { cols } : {}), ...(fr ? { fragments: fr } : {}), ...(log?.watched?.has(r.id) ? { cf: r.confirmed ?? null } : {}) }
      }),
      pairs: pairs.map((p) => ({ id: p.id, fp: pairFp(key, p) })),
      ...(log?.scopes?.size ? { scopes: [...log.scopes.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, v]) => v) } : {}),
    }
  })
}

export async function buildReferenceSnapshots(tx: Tx, key: Buffer, templates: readonly SheetTemplate[], userId: string, references: readonly ReferenceRow[]): Promise<ReferenceSnapshot[]> {
  return snapshotsFrom(key, await computeReferenceViews(tx, key, templates, userId, references))
}

export type ReferenceChange =
  | { type: 'task'; referenceId: string; taskId: string; was: { status: string; number: number | null }; now: { status: string; number: number | null } | null }
  | { type: 'row'; referenceId: string; rowId: string; gone: boolean }
  | { type: 'pair'; referenceId: string; pairId: string; how: 'added' | 'removed' | 'changed' }
  | { type: 'row_added'; referenceId: string; rowId: string }

async function diffSnapshot(db: Db, key: Buffer, templates: readonly SheetTemplate[], userId: string, snap: ReferenceSnapshot): Promise<{ changes: ReferenceChange[]; state: unknown }> {
  const changes: ReferenceChange[] = []
  const nowTasks = await sourceTasks(db, userId, snap.sourceProjectId)
  const taskById = new Map(nowTasks.map((t) => [t.id, t]))
  const taskState: Record<string, unknown> = {}
  for (const t of snap.tasks) {
    const now = taskById.get(t.id)
    taskState[t.id] = now ? [now.status, now.number] : null
    if (!now || now.status !== t.status || now.number !== t.number) {
      changes.push({ type: 'task', referenceId: snap.referenceId, taskId: t.id, was: { status: t.status, number: t.number }, now: now ? { status: now.status, number: now.number } : null })
    }
  }

  const ids = snap.rows.map((r) => r.id)
  const raw = ids.length ? await db.dataSheetRow.findMany({ where: { id: { in: ids }, kind: 'project', projectId: snap.sourceProjectId, userId } }) : []
  const nowRows = new Map(raw.map((r) => [r.id, decodeRow(r, key)]))
  const effSheets = [...new Set(snap.rows.filter((r) => r.fragments).map((r) => r.sheetId))]
  const intervals = new Map<string, DateRange>()
  for (const sheetId of effSheets) {
    const s = await db.dataSheet.findFirst({ where: { id: sheetId, kind: 'project', projectId: snap.sourceProjectId, userId }, select: { id: true, schema: true, template: true, templateFamily: true } })
    if (!s) continue
    const meta = sheetMeta(s, templates)
    const col = meta.template?.effectiveFromColumn
    if (!col) continue
    const all = (await db.dataSheetRow.findMany({ where: { sheetId, kind: 'project', projectId: snap.sourceProjectId, userId } })).map((r) => decodeRow(r, key))
    for (const [id, iv] of effectiveIntervals(all.map((r) => ({ id: r.id, start: dateOf(meta, col, r.data) })))) intervals.set(id, iv)
  }
  const rowState: Record<string, unknown> = {}
  for (const r of snap.rows) {
    const now = nowRows.get(r.id)
    if (!now || now.sheetId !== r.sheetId) {
      rowState[r.id] = null
      changes.push({ type: 'row', referenceId: snap.referenceId, rowId: r.id, gone: true })
      continue
    }
    const fp = snapRowFp(key, now, r.cols)
    const iv = intervals.get(r.id)
    const frag = r.fragments?.map((f) => (iv ? (f.window ? clip(iv, f.window) : iv) : null))
    const watched = 'cf' in r
    const cfNow = now.confirmed ?? null
    rowState[r.id] = watched ? [fp, frag ?? null, cfNow] : frag ? [fp, frag] : fp
    const fragChanged = !!r.fragments && r.fragments.some((f, i) => stable(f.range) !== stable(frag![i]))
    if (fp !== r.fp || fragChanged || (watched && cfNow !== (r.cf ?? null))) changes.push({ type: 'row', referenceId: snap.referenceId, rowId: r.id, gone: false })
  }

  const pairsNow = ids.length
    ? await db.sheetRowPair.findMany({
        where: { projectId: snap.sourceProjectId, userId, OR: [{ fromRowId: { in: ids } }, { toRowId: { in: ids } }] },
        select: { id: true, fromRowId: true, toRowId: true, kind: true, confirmed: true },
      })
    : []
  const nowPairFp = new Map(pairsNow.map((p) => [p.id, pairFp(key, p)]))
  const snapPairFp = new Map(snap.pairs.map((p) => [p.id, p.fp]))
  for (const [id, fp] of snapPairFp) {
    const now = nowPairFp.get(id)
    if (now === undefined) changes.push({ type: 'pair', referenceId: snap.referenceId, pairId: id, how: 'removed' })
    else if (now !== fp) changes.push({ type: 'pair', referenceId: snap.referenceId, pairId: id, how: 'changed' })
  }
  for (const id of nowPairFp.keys()) if (!snapPairFp.has(id)) changes.push({ type: 'pair', referenceId: snap.referenceId, pairId: id, how: 'added' })
  const pairState = Object.fromEntries([...nowPairFp].sort(([a], [b]) => (a < b ? -1 : 1)))

  let addedState: Record<string, unknown> | undefined
  if (snap.scopes?.length) {
    addedState = {}
    const { view } = await computeView(db, key, templates, userId, { id: snap.referenceId, fromProjectId: '', toProjectId: snap.sourceProjectId, sheets: snap.selectors, includeUnconfirmed: snap.includeUnconfirmed })
    const had = new Set(snap.rows.filter((r) => 'cf' in r).map((r) => r.id))
    const seenAdded = new Set<string>()
    for (const sc of snap.scopes) {
      const added = view.rows
        .filter((row) => row.sheetId === sc.sheetId && !had.has(row.id) && sc.dateIn.columns.some((c) => { const d = row.data[c]; return isCalendarDate(d) && sc.dateIn.range.start <= d && d <= sc.dateIn.range.end }))
        .sort((a, b) => (a.id < b.id ? -1 : 1))
      for (const row of added) if (!seenAdded.has(row.id)) { seenAdded.add(row.id); changes.push({ type: 'row_added', referenceId: snap.referenceId, rowId: row.id }) }
      addedState[stable(sc)] = added.map((row) => [row.id, rowFp(key, row), row.confirmed ?? null])
    }
  }

  return { changes, state: { r: snap.referenceId, t: taskState, w: rowState, p: pairState, ...(addedState ? { a: addedState } : {}) } }
}

async function currentSubmissionOf(db: Db, userId: string, taskId: string) {
  const task = await db.workTask.findFirst({ where: { id: taskId, userId }, select: { status: true, currentSubmissionId: true } })
  if (!task) throw new WorkError('NOT_FOUND')
  if (task.status !== 'submitted' || !task.currentSubmissionId) return null
  return db.workSubmission.findUniqueOrThrow({ where: { id: task.currentSubmissionId } })
}

async function evaluate(db: Db, key: Buffer, templates: readonly SheetTemplate[], userId: string, sub: { result: Uint8Array }) {
  const body = decryptJson<{ references?: ReferenceSnapshot[] }>(sub.result, key)
  const snaps = body.references ?? []
  const changes: ReferenceChange[] = []
  const states: unknown[] = []
  for (const s of snaps) {
    const d = await diffSnapshot(db, key, templates, userId, s)
    changes.push(...d.changes)
    states.push(d.state)
  }
  return { snaps, changes, digest: fingerprint(key, 'ack', states) }
}

export interface ReferenceStatus {
  submissionId: string
  hasReferences: boolean
  differs: boolean
  flagged: boolean
  changes: ReferenceChange[]
  digest: string
}

export async function referenceStatus(deps: WorkSheetDeps, q: { userId: string; taskId: string }): Promise<ReferenceStatus | null> {
  validateTemplateRegistry(deps.templates)
  const key = await deps.dataKey(deps.db, q.userId)
  return deps.db.$transaction(async (tx) => {
    const sub = await currentSubmissionOf(tx, q.userId, q.taskId)
    if (!sub) return null
    const { snaps, changes, digest } = await evaluate(tx, key, deps.templates, q.userId, sub)
    const differs = changes.length > 0
    return { submissionId: sub.id, hasReferences: snaps.length > 0, differs, flagged: differs && sub.refAckDigest !== digest, changes, digest }
  }, { timeout: TX_TIMEOUT_MS, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
}

export async function acknowledgeReferenceChanges(deps: WorkSheetDeps, input: { userId: string; taskId: string; actor: SheetActor; seenDigest?: string }): Promise<void> {
  if (input.actor.type !== 'human') throw new WorkError('FORBIDDEN', 'only a person can acknowledge')
  validateTemplateRegistry(deps.templates)
  const t = await deps.db.workTask.findFirst({ where: { id: input.taskId, userId: input.userId }, select: { projectId: true } })
  if (!t) throw new WorkError('NOT_FOUND')
  const key = await deps.dataKey(deps.db, input.userId)
  await deps.db.$transaction(async (tx) => {
    const u = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "user" WHERE id = ${input.userId} FOR SHARE`
    if (u.length === 0) throw new WorkError('NOT_FOUND')
    const peek = await currentSubmissionOf(tx, input.userId, input.taskId)
    if (!peek) throw new WorkError('INVALID', 'the task is not submitted')
    const sources = (decryptJson<{ references?: ReferenceSnapshot[] }>(peek.result, key).references ?? []).map((r) => r.sourceProjectId)
    for (const id of [...new Set([t.projectId, ...sources])].sort()) {
      if (id === t.projectId) {
        if ((await lockProjectForWrite(tx, input.userId, id)).appClosed) throw new WorkError('APP_CLOSED')
      }
      else await tx.$queryRaw`SELECT id FROM work_project WHERE id = ${id} AND user_id = ${input.userId} FOR SHARE`
    }
    const sub = await currentSubmissionOf(tx, input.userId, input.taskId)
    if (!sub || sub.id !== peek.id) throw new WorkError('INVALID', 'the task changed — try again')
    const { snaps, changes, digest } = await evaluate(tx, key, deps.templates, input.userId, sub)
    if (snaps.length === 0) throw new WorkError('INVALID', 'the submission read no references')
    if (input.seenDigest !== undefined && input.seenDigest !== digest) throw new WorkError('STALE', 'the referenced data changed again — look again')
    if (sub.refAckDigest === digest) return
    await tx.workSubmission.update({ where: { id: sub.id }, data: { refAckDigest: digest } })
    await tx.workEvent.create({
      data: {
        userId: input.userId,
        projectId: t.projectId,
        taskId: input.taskId,
        submissionId: sub.id,
        actor: actorLabel(input.actor),
        action: 'reference_ack',
        payload: encryptJson({ changes }, key),
      },
    })
  }, { timeout: TX_TIMEOUT_MS })
}

export async function syncReferenceLinesLocked(
  tx: Tx,
  ctx: { key: Buffer; templates: readonly SheetTemplate[] },
  input: { userId: string; workflowId: string; workflowJson: unknown },
): Promise<void> {
  const hidden = await hiddenAppIds(tx, input.workflowId)
  const { lines, problems } = referenceLinesOf(input.workflowJson, (nodeId) => hidden.get(nodeId)?.workflowId)
  if (problems.length) throw new WorkError('INVALID', `reference line ${problems[0].edgeId}: ${problems[0].message}`)
  const owned = await tx.projectReference.findMany({ where: { userId: input.userId, createdByWorkflowId: input.workflowId } })
  if (!lines.length && !owned.length) return
  await lockAccountForReferenceChange(tx, input.userId)
  const by: SheetActor = { type: 'flow', workflowId: input.workflowId }

  const appProject = async (edgeId: string, wid: string): Promise<string> => {
    const w = await tx.workflow.findFirst({ where: { workflowId: wid, kind: { in: ['main', 'app'] }, agent: { userId: input.userId } }, select: { status: true, kind: true, workflowJson: true } })
    if (!w || !isWorkAppRow(w)) throw new WorkError('INVALID', `reference line ${edgeId}: the work app does not exist in this account`)
    if (w.status !== 'production') throw new WorkError('INVALID', `reference line ${edgeId}: deploy the work app first`)
    const p = await tx.workProject.findFirst({ where: { workflowId: wid, userId: input.userId }, select: { id: true } })
    if (!p) throw new WorkError('INVALID', `reference line ${edgeId}: open the work app once first`)
    return p.id
  }

  const resolved: Array<{ l: ReferenceLine; from: string; to: string }> = []
  for (const l of lines) resolved.push({ l, from: await appProject(l.edgeId, l.readerWorkflowId), to: await appProject(l.edgeId, l.sourceWorkflowId) })
  const wanted = new Set(resolved.map((x) => `${x.from}->${x.to}`))
  for (const r of owned) {
    if (wanted.has(`${r.fromProjectId}->${r.toProjectId}`)) continue
    await tx.projectReference.delete({ where: { id: r.id } })
    await refEvent(tx, ctx.key, { userId: input.userId, projectId: r.fromProjectId, action: 'reference_delete', detail: { referenceId: r.id, to: r.toProjectId, sheets: r.sheets, byWorkflow: input.workflowId }, actor: by })
  }

  for (const { l, from, to } of resolved) {
    await lockReferenceEnds(tx, input.userId, from, to)
    let sheets: string[]
    try {
      sheets = await normalizeSelectors(tx, ctx.templates, input.userId, to, l.sheets)
    } catch (e) {
      if (e instanceof WorkError) throw new WorkError('INVALID', `reference line ${l.edgeId}: ${e.detail || 'choose the sheets to read'}`)
      throw e
    }
    const cur = await tx.projectReference.findUnique({ where: { fromProjectId_toProjectId: { fromProjectId: from, toProjectId: to } } })
    if (!cur) {
      const all = await tx.projectReference.findMany({ where: { userId: input.userId }, select: { fromProjectId: true, toProjectId: true } })
      if (closesLongCycle(all, from, to)) throw new WorkError('INVALID', `reference line ${l.edgeId}: references cannot form a cycle of three or more work apps`)
      const ref = await tx.projectReference.create({ data: { userId: input.userId, fromProjectId: from, toProjectId: to, sheets, includeUnconfirmed: l.includeUnconfirmed, createdByWorkflowId: input.workflowId } })
      await refEvent(tx, ctx.key, { userId: input.userId, projectId: from, action: 'reference_create', detail: { referenceId: ref.id, to, sheets, includeUnconfirmed: ref.includeUnconfirmed, byWorkflow: input.workflowId }, actor: by })
      continue
    }
    if (cur.createdByWorkflowId === null) continue
    if (cur.createdByWorkflowId !== input.workflowId) {
      const owner = await tx.workflow.findUnique({ where: { workflowId: cur.createdByWorkflowId }, select: { status: true, name: true } })
      if (owner?.status === 'production') throw new WorkError('DUPLICATE', `reference line ${l.edgeId}: this pair is already connected by the workflow "${owner.name}"`)
    }
    const same = cur.createdByWorkflowId === input.workflowId && cur.includeUnconfirmed === l.includeUnconfirmed && cur.sheets.length === sheets.length && cur.sheets.every((x, i) => x === sheets[i])
    if (same) continue
    await tx.projectReference.update({ where: { id: cur.id }, data: { sheets, includeUnconfirmed: l.includeUnconfirmed, createdByWorkflowId: input.workflowId } })
    await refEvent(tx, ctx.key, { userId: input.userId, projectId: from, action: 'reference_update', detail: { referenceId: cur.id, before: { sheets: cur.sheets, includeUnconfirmed: cur.includeUnconfirmed, byWorkflow: cur.createdByWorkflowId }, after: { sheets, includeUnconfirmed: l.includeUnconfirmed, byWorkflow: input.workflowId } }, actor: by })
  }
}

export async function deleteOwnedReferencesLocked(tx: Tx, key: Buffer, input: { userId: string; workflowId: string }): Promise<number> {
  const owned = await tx.projectReference.findMany({ where: { userId: input.userId, createdByWorkflowId: input.workflowId } })
  if (!owned.length) return 0
  await lockAccountForReferenceChange(tx, input.userId)
  const by: SheetActor = { type: 'flow', workflowId: input.workflowId }
  for (const r of owned) {
    await tx.projectReference.delete({ where: { id: r.id } })
    await refEvent(tx, key, { userId: input.userId, projectId: r.fromProjectId, action: 'reference_delete', detail: { referenceId: r.id, to: r.toProjectId, sheets: r.sheets, byWorkflow: input.workflowId, reason: 'workflow_deleted' }, actor: by })
  }
  return owned.length
}
