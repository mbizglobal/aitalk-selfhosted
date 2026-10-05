
import { createHmac } from 'crypto'
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
import { validateTemplateRegistry, type SheetTemplate } from './sheet-templates'

const TX_TIMEOUT_MS = 30_000
const MAX_SELECTORS = 50
type Tx = Prisma.TransactionClient
type Db = PrismaClient | Tx

function stable(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null)
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`
}

export function fingerprint(key: Buffer, label: string, v: unknown): string {
  return createHmac('sha256', key).update(`work.reference.${label}\0`).update(stable(v)).digest('hex')
}
export const rowFp = (key: Buffer, r: { sheetId: string; data: Readonly<Record<string, unknown>> }) => fingerprint(key, 'row', { s: r.sheetId, d: r.data })
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
      for (const r of all) { rows.push(r); trace.rowTasks.set(r.id, []) }
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

export type ReferenceReadLog = Map<string, { rows: Set<string>; pairs: Set<string> }>

export class ReferenceReader {
  private readonly byId: ReadonlyMap<string, ReferenceView>

  constructor(views: readonly ReferenceView[], private readonly log?: ReferenceReadLog) {
    this.byId = new Map(views.map((v) => [v.referenceId, deepFreeze(v)]))
  }

  private note(referenceId: string, what: 'rows' | 'pairs', ids: readonly string[]): void {
    if (!this.log) return
    const e = this.log.get(referenceId) ?? { rows: new Set<string>(), pairs: new Set<string>() }
    for (const id of ids) e[what].add(id)
    this.log.set(referenceId, e)
  }

  references(): Array<{ referenceId: string; sourceProjectId: string; includeUnconfirmed: boolean; selectors: readonly string[]; revising: readonly string[] }> {
    return [...this.byId.values()].map((v) => ({
      referenceId: v.referenceId,
      sourceProjectId: v.sourceProjectId,
      includeUnconfirmed: v.includeUnconfirmed,
      selectors: v.selectors,
      revising: v.revising,
    }))
  }

  sheets(referenceId: string): readonly ReferenceSheetView[] {
    return this.view(referenceId).sheets
  }

  rows(referenceId: string, sheetId: string): readonly SheetRowView[] {
    const v = this.view(referenceId)
    if (!v.sheets.some((s) => s.id === sheetId)) throw new WorkError('NOT_FOUND')
    const out = v.rows.filter((r) => r.sheetId === sheetId)
    this.note(referenceId, 'rows', out.map((r) => r.id))
    return out
  }

  pairs(referenceId: string): readonly ReferencePairView[] {
    const out = this.view(referenceId).pairs
    this.note(referenceId, 'pairs', out.map((p) => p.id))
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

function makesCycle(edges: ReadonlyArray<{ fromProjectId: string; toProjectId: string }>, from: string, to: string): boolean {
  const next = new Map<string, string[]>()
  for (const e of edges) next.set(e.fromProjectId, [...(next.get(e.fromProjectId) ?? []), e.toProjectId])
  const seen = new Set<string>()
  const stack = [to]
  while (stack.length) {
    const cur = stack.pop()!
    if (cur === from) return true
    if (seen.has(cur)) continue
    seen.add(cur)
    stack.push(...(next.get(cur) ?? []))
  }
  return false
}

async function refEvent(tx: Tx, key: Buffer, e: { userId: string; projectId: string; action: string; detail: unknown }) {
  await tx.workEvent.create({
    data: { userId: e.userId, projectId: e.projectId, actor: actorLabel({ type: 'human' }), action: e.action, payload: encryptJson(e.detail, key) },
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
    if (makesCycle(edges, input.fromProjectId, input.toProjectId)) throw new WorkError('INVALID', 'references cannot form a cycle')
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
  rows: Array<{ id: string; sheetId: string; fp: string; fragments?: Array<{ window: DateRange | null; range: DateRange }> }>
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
    const log = read ? read.get(ref.id) ?? { rows: new Set<string>(), pairs: new Set<string>() } : null
    const rows = log ? view.rows.filter((r) => log.rows.has(r.id)) : view.rows
    const rowIds = new Set(rows.map((r) => r.id))
    const taskIds = new Set(rows.flatMap((r) => trace.rowTasks.get(r.id) ?? []))
    const pairs = log
      ? trace.touchingPairs.filter((p) => log.pairs.has(p.id) || rowIds.has(p.fromRowId) || rowIds.has(p.toRowId))
      : trace.touchingPairs
    return {
      referenceId: ref.id,
      sourceProjectId: ref.toProjectId,
      includeUnconfirmed: ref.includeUnconfirmed,
      selectors: [...ref.sheets],
      tasks: [...trace.tasks.values()]
        .filter((t) => taskIds.has(t.id))
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .map((t) => ({ id: t.id, status: t.status, number: t.number })),
      rows: rows.map((r) => {
        const fr = trace.fragments.get(r.id)
        return fr ? { id: r.id, sheetId: r.sheetId, fp: rowFp(key, r), fragments: fr } : { id: r.id, sheetId: r.sheetId, fp: rowFp(key, r) }
      }),
      pairs: pairs.map((p) => ({ id: p.id, fp: pairFp(key, p) })),
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
    const fp = rowFp(key, now)
    const iv = intervals.get(r.id)
    const frag = r.fragments?.map((f) => (iv ? (f.window ? clip(iv, f.window) : iv) : null))
    rowState[r.id] = frag ? [fp, frag] : fp
    const fragChanged = !!r.fragments && r.fragments.some((f, i) => stable(f.range) !== stable(frag![i]))
    if (fp !== r.fp || fragChanged) changes.push({ type: 'row', referenceId: snap.referenceId, rowId: r.id, gone: false })
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

  return { changes, state: { r: snap.referenceId, t: taskState, w: rowState, p: pairState } }
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
      if (id === t.projectId) await lockProjectForWrite(tx, input.userId, id)
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
