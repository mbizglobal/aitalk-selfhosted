
import { Prisma, type PrismaClient } from '@prisma/client'
import { WorkError } from './errors'
import { decodeRow, sheetMeta, type SheetMeta } from './sheet-gate'
import { calendarDateOf } from './sheet-columns'
import { dateInAny, effectiveIntervals, prevDay, rangesOverlap, type DateRange } from './sheet-periods'
import { ReferenceReader, type ComputedReference, type ReferenceReadLog } from './references'
import { templateId, type SheetTemplate } from './sheet-templates'
import type { SheetActor, WorkSheetDeps } from './sheet-gate'
import type { WorkFileDeps } from './files'
import type { WorkAppHandles, WorkAppScreenHandles } from './handles'
import type { LocaleText } from './app-template-features'

type Tx = Prisma.TransactionClient

export type WorkModuleKind = 'read' | 'prepare' | 'calc' | 'make' | 'check'
export type JsonSchema = Record<string, unknown>

interface WorkModuleBase {
  id: string
  version: number
  title: LocaleText
  description: LocaleText
  input: JsonSchema
  output: JsonSchema
  needs: string[]
  aiVia?: string
}

export interface CalcWorkModule extends WorkModuleBase {
  kind: 'calc'
  run(ctx: CalcModuleCtx, input: unknown): Promise<unknown>
  preview?(ctx: CalcModuleCtx, input: unknown): Promise<{ confirmed: unknown; draft: unknown | null; draftStopped?: PreviewStop; unconfirmed: number | null }>
  prepare?(db: PrismaClient, period: { start: string; end: string }): Promise<void>
}

export interface ActionWorkModule<Ctx = unknown> extends WorkModuleBase {
  kind: Exclude<WorkModuleKind, 'calc'>
  run(ctx: Ctx, input: unknown): Promise<unknown>
  screenRows?(ctx: ScreenRowsCtx): Promise<ScreenRows>
}

export interface ScreenRowsCtx extends WorkAppScreenHandles { deps: WorkSheetDeps; userId: string; projectId: string }

export interface ScreenRowResult { status: string; diff?: string; source?: string }
export interface ScreenRows {
  virtual: Array<{ key: string; data: Record<string, unknown> } & ScreenRowResult>
  notes: Record<string, ScreenRowResult>
}

export type WorkModule = CalcWorkModule | ActionWorkModule

export interface ModuleRunCtx extends WorkAppHandles {
  deps: WorkFileDeps
  userId: string
  projectId: string
  by: SheetActor
}

export const moduleLabel = (m: Pick<WorkModuleBase, 'id' | 'version'>) => `${m.id}@${m.version}`

export interface PreviewStop { code: string; params?: Record<string, string | number>; detail?: string }

import { moduleStop } from './module-stop'
export { moduleStop }

// ─────────────────────────────── needs ───────────────────────────────

export interface ModuleNeed { name: string; minVersion: number }

export function parseNeed(s: string): ModuleNeed {
  const m = /^([a-z0-9][a-z0-9.-]*)>=(\d+)$/.exec(s)
  if (!m) throw new WorkError('TEMPLATE_UNKNOWN', `bad module need ${s}`)
  return { name: m[1], minVersion: Number(m[2]) }
}

export function validateModuleRegistry(modules: readonly WorkModule[], templates: readonly SheetTemplate[]): void {
  const seen = new Set<string>()
  for (const m of modules) {
    if (!m.id || !Number.isInteger(m.version) || m.version < 1) throw new WorkError('TEMPLATE_UNKNOWN', `bad module header ${m.id}`)
    if (seen.has(m.id)) throw new WorkError('TEMPLATE_UNKNOWN', `module ${m.id} twice`)
    seen.add(m.id)
    for (const need of m.needs.map(parseNeed)) {
      if (!templates.some((t) => t.name === need.name && t.version >= need.minVersion)) {
        throw new WorkError('TEMPLATE_UNKNOWN', `${moduleLabel(m)} needs ${need.name}>=${need.minVersion}`)
      }
    }
  }
}

export interface ReadRow {
  id: string
  sheetId: string
  family: string
  data: Readonly<Record<string, unknown>>
  confirmed: boolean | null
}

export interface ReadPair {
  id: string
  fromRowId: string
  toRowId: string
  kind: string
  confirmed: boolean
}

export interface UsedFx {
  currency: string
  date: string
  source: 'estv-monthly' | 'estv-daily' | 'manual'
  validFor: string
  version: number | null
  rate: string
  unit: number
  rowId: string
}

export interface FxQuoteLike { rate: string; unit: number }

export interface FxTable {
  lookup(currency: string, date: string, method: 'monthly' | 'daily'): FxQuoteLike | null
}

export interface CalcModuleCtx {
  readonly project: { readonly id: string; readonly kind: string; readonly settings: Readonly<Record<string, unknown>> }
  readonly task: { readonly id: string; readonly period: DateRange | null }
  periodRows(family: string): readonly ReadRow[]
  effectiveRows(family: string): readonly ReadRow[]
  effectiveRowAt(family: string, date: string): ReadRow | null
  globalRows(family: string): readonly ReadRow[]
  pairsFrom(rowIds: readonly string[], kind: string): readonly ReadPair[]
  pairsTo(rowIds: readonly string[], kind: string, where?: PairSourceFilter): readonly ReadPair[]
  row(id: string): ReadRow
  references(): ReferenceReader
  loadFx(q: { currencies: readonly string[]; from: string; to: string }): Promise<FxTable>
}

export interface PairSourceFilter {
  dateUpTo?: string
  equals?: Readonly<Record<string, string>>
}

interface SnapRow extends ReadRow { meta: SheetMeta }

export interface ProjectSnapshot {
  rows: ReadonlyMap<string, SnapRow>
  pairs: readonly ReadPair[]
  sheets: readonly SheetMeta[]
}

export async function loadProjectSnapshot(tx: Tx, key: Buffer, templates: readonly SheetTemplate[], userId: string, projectId: string): Promise<ProjectSnapshot> {
  const sheets = await tx.dataSheet.findMany({
    where: { kind: 'project', projectId, userId },
    select: { id: true, schema: true, template: true, templateFamily: true },
    orderBy: { id: 'asc' },
  })
  const metas = sheets.map((s) => sheetMeta(s, templates))
  const byId = new Map(metas.map((m) => [m.id, m]))
  const raw = await tx.dataSheetRow.findMany({ where: { kind: 'project', projectId, userId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
  const rows = new Map<string, SnapRow>()
  for (const r of raw) {
    const meta = byId.get(r.sheetId)
    if (!meta) continue
    const v = decodeRow(r, key)
    rows.set(r.id, { id: r.id, sheetId: r.sheetId, family: meta.family, data: Object.freeze({ ...v.data }), confirmed: v.confirmed, meta })
  }
  const pairs = (await tx.sheetRowPair.findMany({
    where: { projectId, userId },
    select: { id: true, fromRowId: true, toRowId: true, kind: true, confirmed: true },
    orderBy: { id: 'asc' },
  })).map((p) => Object.freeze({ ...p }))
  return { rows, pairs, sheets: metas }
}

function rowDate(meta: SheetMeta, column: string, data: Readonly<Record<string, unknown>>): string {
  const d = calendarDateOf(meta.byName.get(column)!, data[column])
  if (!d) throw moduleStop('row_date_missing', `${column} must be a date`, { column })
  return d
}

function effectiveOf(snap: ProjectSnapshot, meta: SheetMeta): Map<string, DateRange> {
  const col = meta.template!.effectiveFromColumn!
  const mine = [...snap.rows.values()].filter((r) => r.sheetId === meta.id)
  try {
    return effectiveIntervals(mine.map((r) => ({ id: r.id, start: rowDate(meta, col, r.data) })))
  } catch {
    throw moduleStop('effective_same_day', `two ${meta.family} rows start on the same day`, { sheet: meta.family })
  }
}

const strip = (r: SnapRow): ReadRow => ({ id: r.id, sheetId: r.sheetId, family: r.family, data: r.data, confirmed: r.confirmed })

export interface CalcCtxOptions {
  tx: Tx
  userId: string
  project: { id: string; kind: string; settings: Record<string, unknown> }
  task: { id: string; period: DateRange | null }
  snapshot: ProjectSnapshot
  module: CalcWorkModule
  globalFamilies: readonly string[]
  references: readonly ComputedReference[]
  templates: readonly SheetTemplate[]
}

export class SubmitReadCtx implements CalcModuleCtx {
  readonly project: CalcModuleCtx['project']
  readonly task: CalcModuleCtx['task']
  private readonly allowed: ReadonlySet<string>
  private readonly readRows = new Map<string, ReadRow>()
  private readonly readPairs = new Map<string, ReadPair>()
  readonly referenceLog: ReferenceReadLog = new Map()
  private readonly usedFx = new Map<string, UsedFx>()
  private fxLoaded = false
  private refReader: ReferenceReader | null = null

  constructor(private readonly o: CalcCtxOptions) {
    this.project = Object.freeze({ id: o.project.id, kind: o.project.kind, settings: Object.freeze({ ...o.project.settings }) })
    this.task = Object.freeze({ id: o.task.id, period: o.task.period ? Object.freeze({ ...o.task.period }) : null })
    const fams = new Set<string>()
    for (const need of o.module.needs.map(parseNeed)) {
      const t = o.templates.find((x) => x.name === need.name)
      if (t) fams.add(t.family)
    }
    this.allowed = fams
  }

  private sheetsOf(family: string): SheetMeta[] {
    if (!this.allowed.has(family)) throw moduleStop('module_internal', `the module did not declare ${family}`)
    const list = this.o.snapshot.sheets.filter((s) => s.family === family && s.template)
    for (const s of list) {
      const need = this.o.module.needs.map(parseNeed).find((n) => n.name === s.template!.name)
      if (need && s.template!.version < need.minVersion) throw moduleStop('template_too_old', `${templateId(s.template!)} is older than the module needs`, { sheet: family })
    }
    return list
  }

  private give(rows: SnapRow[]): readonly ReadRow[] {
    return rows.map((r) => {
      const hit = this.readRows.get(r.id)
      if (hit) return hit
      const out = Object.freeze(strip(r))
      this.readRows.set(r.id, out)
      return out
    })
  }

  periodRows(family: string): readonly ReadRow[] {
    const p = this.task.period
    const out: SnapRow[] = []
    for (const meta of this.sheetsOf(family)) {
      const col = meta.template!.dateColumn
      if (!col) throw moduleStop('module_internal', `${family} is not a dated sheet`)
      if (!p) continue
      for (const r of this.o.snapshot.rows.values()) {
        if (r.sheetId === meta.id && dateInAny(rowDate(meta, col, r.data), [p])) out.push(r)
      }
    }
    return this.give(out)
  }

  effectiveRows(family: string): readonly ReadRow[] {
    const p = this.task.period
    const out: SnapRow[] = []
    for (const meta of this.sheetsOf(family)) {
      if (!meta.template!.effectiveFromColumn) throw moduleStop('module_internal', `${family} is not an effective-dated sheet`)
      if (!p) continue
      const iv = effectiveOf(this.o.snapshot, meta)
      for (const r of this.o.snapshot.rows.values()) {
        const range = iv.get(r.id)
        if (r.sheetId === meta.id && range && rangesOverlap(range, p)) out.push(r)
      }
    }
    return this.give(out)
  }

  effectiveRowAt(family: string, date: string): ReadRow | null {
    const hits: SnapRow[] = []
    for (const meta of this.sheetsOf(family)) {
      if (!meta.template!.effectiveFromColumn) throw moduleStop('module_internal', `${family} is not an effective-dated sheet`)
      for (const [id, iv] of effectiveOf(this.o.snapshot, meta)) if (iv.start <= date && date <= iv.end) hits.push(this.o.snapshot.rows.get(id)!)
    }
    if (hits.length > 1) throw moduleStop('effective_same_day', `two ${family} rows are in effect on the same day`, { sheet: family })
    return hits.length ? this.give(hits)[0] : null
  }

  globalRows(family: string): readonly ReadRow[] {
    if (!this.o.globalFamilies.includes(family)) throw moduleStop('module_internal', `${family} is not a global sheet of this appTemplate`)
    const out: SnapRow[] = []
    for (const meta of this.sheetsOf(family)) {
      if (meta.template!.dateColumn || meta.template!.effectiveFromColumn) throw moduleStop('module_internal', `${family} is not a global sheet`)
      for (const r of this.o.snapshot.rows.values()) if (r.sheetId === meta.id) out.push(r)
    }
    return this.give(out)
  }

  pairsFrom(rowIds: readonly string[], kind: string): readonly ReadPair[] {
    const ids = new Set(rowIds)
    for (const id of ids) this.row(id)
    return this.follow(this.o.snapshot.pairs.filter((p) => p.kind === kind && ids.has(p.fromRowId)), 'to')
  }

  pairsTo(rowIds: readonly string[], kind: string, where: PairSourceFilter = {}): readonly ReadPair[] {
    const ids = new Set(rowIds)
    for (const id of ids) this.row(id)
    const hits = this.o.snapshot.pairs.filter((p) => {
      if (p.kind !== kind || !ids.has(p.toRowId)) return false
      const from = this.o.snapshot.rows.get(p.fromRowId)
      if (!from) throw moduleStop('module_internal', 'a pair points to a missing row')
      if (where.dateUpTo !== undefined) {
        const col = from.meta.template?.dateColumn
        if (!col) throw moduleStop('module_internal', `${from.family} is not a dated sheet`)
        if (rowDate(from.meta, col, from.data) > where.dateUpTo) return false
      }
      for (const [c, v] of Object.entries(where.equals ?? {})) {
        const def = from.meta.byName.get(c)
        if (!def || def.encrypted) throw moduleStop('module_internal', `cannot filter on ${from.family}.${c}`)
        if (from.data[c] !== v) return false
      }
      return true
    })
    return this.follow(hits, 'from')
  }

  private follow(pairs: readonly ReadPair[], side: 'from' | 'to'): readonly ReadPair[] {
    const other: SnapRow[] = []
    for (const p of pairs) {
      const r = this.o.snapshot.rows.get(side === 'to' ? p.toRowId : p.fromRowId)
      if (!r) throw moduleStop('module_internal', 'a pair points to a missing row')
      if (!this.allowed.has(r.family)) throw moduleStop('module_internal', `the module did not declare ${r.family}`)
      other.push(r)
      this.readPairs.set(p.id, p)
    }
    this.give(other)
    return pairs
  }

  row(id: string): ReadRow {
    const r = this.readRows.get(id)
    if (!r) throw moduleStop('module_internal', 'the module asked for a row it was not given')
    return r
  }

  references(): ReferenceReader {
    this.refReader ??= new ReferenceReader(this.o.references.map((c) => c.view), this.referenceLog)
    return this.refReader
  }

  async loadFx(q: { currencies: readonly string[]; from: string; to: string }): Promise<FxTable> {
    if (this.fxLoaded) throw moduleStop('module_internal', 'exchange rates are read once per submission')
    this.fxLoaded = true
    const currencies = [...new Set(q.currencies)].filter((c) => c !== 'CHF').sort()
    const rows = currencies.length ? await readFxRows(this.o.tx, this.o.userId, currencies, q.from, q.to) : { common: [], manual: [] }
    return new RecordingFxTable(rows, this.usedFx)
  }

  reads(): { rows: ReadRow[]; pairs: ReadPair[]; fx: UsedFx[] } {
    const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    return {
      rows: [...this.readRows.values()].sort(byId),
      pairs: [...this.readPairs.values()].sort(byId),
      fx: [...this.usedFx.values()].sort((a, b) => (a.currency + a.date < b.currency + b.date ? -1 : 1)),
    }
  }
}

export const DAILY_FALLBACK_DAYS = 7

interface FxRowData { id: string; kind: string; validFor: string; currency: string; rate: string; unit: number; version: number }
interface ManualRowData { id: string; date: string; currency: string; rate: string }

const isoDay = (d: Date) => d.toISOString().slice(0, 10)
const monthStart = (d: string) => `${d.slice(0, 7)}-01`
function minusDays(d: string, n: number): string {
  let x = d
  for (let i = 0; i < n; i++) x = prevDay(x)
  return x
}

async function readFxRows(tx: Tx, userId: string, currencies: string[], from: string, to: string): Promise<{ common: FxRowData[]; manual: ManualRowData[] }> {
  const lo = [monthStart(from), minusDays(from, DAILY_FALLBACK_DAYS)].sort()[0]
  const common = await tx.vatFxRate.findMany({
    where: { currency: { in: currencies }, validFor: { gte: new Date(`${lo}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } },
    orderBy: [{ id: 'asc' }],
  })
  const manual = await tx.vatFxRateManual.findMany({
    where: { userId, currency: { in: currencies }, date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } },
    orderBy: [{ id: 'asc' }],
  })
  return {
    common: common.map((r) => ({ id: r.id, kind: r.kind, validFor: isoDay(r.validFor), currency: r.currency, rate: r.rate.toFixed(6), unit: r.unit, version: r.version })),
    manual: manual.map((r) => ({ id: r.id, date: isoDay(r.date), currency: r.currency, rate: r.rate.toFixed(6) })),
  }
}

export async function readFxTable(db: Tx | PrismaClient, userId: string, currencies: readonly string[], from: string, to: string, used: Map<string, UsedFx>): Promise<FxTable> {
  const list = [...new Set(currencies)].filter((c) => c !== 'CHF').sort()
  const rows = list.length ? await readFxRows(db as Tx, userId, list, from, to) : { common: [], manual: [] }
  return new RecordingFxTable(rows, used)
}

class RecordingFxTable implements FxTable {
  constructor(private readonly rows: { common: FxRowData[]; manual: ManualRowData[] }, private readonly used: Map<string, UsedFx>) {}

  lookup(currency: string, date: string, method: 'monthly' | 'daily'): FxQuoteLike | null {
    const hit = this.find(currency, date, method)
    if (!hit) return null
    this.used.set(`${currency}|${date}`, hit)
    return { rate: hit.rate, unit: hit.unit }
  }

  private find(currency: string, date: string, method: 'monthly' | 'daily'): UsedFx | null {
    const mine = this.rows.common.filter((r) => r.currency === currency)
    if (mine.length === 0) {
      const m = this.rows.manual.find((r) => r.currency === currency && r.date === date)
      return m ? { currency, date, source: 'manual', validFor: m.date, version: null, rate: m.rate, unit: 1, rowId: m.id } : null
    }
    const best = (list: FxRowData[]) => list.sort((a, b) => b.version - a.version)[0] ?? null
    if (method === 'monthly') {
      const r = best(mine.filter((x) => x.kind === 'monthly' && x.validFor === monthStart(date)))
      return r ? { currency, date, source: 'estv-monthly', validFor: r.validFor, version: r.version, rate: r.rate, unit: r.unit, rowId: r.id } : null
    }
    const lo = minusDays(date, DAILY_FALLBACK_DAYS)
    const days = mine.filter((x) => x.kind === 'daily' && lo <= x.validFor && x.validFor <= date)
    if (days.length === 0) return null
    const day = days.map((x) => x.validFor).sort().pop()!
    const r = best(days.filter((x) => x.validFor === day))!
    return { currency, date, source: 'estv-daily', validFor: r.validFor, version: r.version, rate: r.rate, unit: r.unit, rowId: r.id }
  }
}

export interface UnconfirmedItem { type: 'row' | 'pair'; id: string }

export function findUnconfirmed(snap: ProjectSnapshot, period: DateRange | null, reads: { rows: readonly ReadRow[]; pairs: readonly ReadPair[] }): UnconfirmedItem[] {
  const out = new Map<string, UnconfirmedItem>()
  const inPeriodRow = new Set<string>()
  if (period) {
    for (const meta of snap.sheets) {
      const t = meta.template
      if (!t) continue
      if (t.dateColumn) {
        for (const r of snap.rows.values()) if (r.sheetId === meta.id && dateInAny(rowDate(meta, t.dateColumn, r.data), [period])) inPeriodRow.add(r.id)
      } else if (t.effectiveFromColumn) {
        for (const [id, iv] of effectiveOf(snap, meta)) if (rangesOverlap(iv, period)) inPeriodRow.add(id)
      }
    }
  }
  for (const id of [...inPeriodRow, ...reads.rows.map((r) => r.id)]) {
    const r = snap.rows.get(id)
    if (!r || r.confirmed !== false) continue
    if (!r.meta.template?.dateColumn && !r.meta.template?.effectiveFromColumn) continue
    out.set(`row:${id}`, { type: 'row', id })
  }
  const readPairIds = new Set(reads.pairs.map((p) => p.id))
  for (const p of snap.pairs) {
    if (p.confirmed) continue
    let hit = readPairIds.has(p.id)
    if (!hit && period) {
      const from = snap.rows.get(p.fromRowId)
      const def = from?.meta.template?.pairs?.find((d) => d.kind === p.kind)
      const side = def ? snap.rows.get(def.periodSide === 'from' ? p.fromRowId : p.toRowId) : undefined
      const col = side?.meta.template?.dateColumn
      hit = !!side && !!col && dateInAny(rowDate(side.meta, col, side.data), [period])
    }
    if (hit) out.set(`pair:${p.id}`, { type: 'pair', id: p.id })
  }
  return [...out.values()]
}

export const CALC_TIMEOUT_MS = 10_000

export async function runWithTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([p, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(moduleStop('calc_timeout', `${what} took longer than ${ms} ms`, { seconds: Math.round(ms / 1000) })), ms) })])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
