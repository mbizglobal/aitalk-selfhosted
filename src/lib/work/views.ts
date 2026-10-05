
import { decryptJson } from './sealed'
import { WorkError } from './errors'
import { decodeRow, isProjectDetached, sheetMeta, submittedPeriods, type SheetRowView, type WorkSheetDeps } from './sheet-gate'
import { calendarDateOf, type SheetSchema } from './sheet-columns'
import { anyOverlap, dateInAny, effectiveIntervals } from './sheet-periods'
import { appTemplateOf, type AppTemplateUi, type ChecklistItem } from './app-templates'
import type { ProjectSettings } from './projects'
import { screenSchema, type SheetTemplate } from './sheet-templates'
import { readFxTable, type ScreenRows, type UsedFx } from './modules'
import { appTemplates, workModules } from './registry'
import { describeCaughtError } from '@/lib/log-mask'

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)

export interface ProjectListItem {
  id: string
  name: string
  kind: string
  status: string
  agentId: string | null
  readOnly: boolean
  createdAt: Date
}

export async function listProjects(deps: WorkSheetDeps, q: { userId: string; agentId?: string }): Promise<ProjectListItem[]> {
  const rows = await deps.db.workProject.findMany({
    where: { userId: q.userId, ...(q.agentId !== undefined ? { agentId: q.agentId } : {}) },
    select: { id: true, kind: true, status: true, agentId: true, settings: true, workflowId: true, workflowLinkedAt: true, createdAt: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  if (rows.length === 0) return []
  const key = await deps.dataKey(deps.db, q.userId)
  return rows.map((p) => ({
    id: p.id,
    name: p.settings ? decryptJson<ProjectSettings>(p.settings, key).name : '',
    kind: p.kind,
    status: p.status,
    agentId: p.agentId,
    readOnly: p.status !== 'active' || isProjectDetached(p),
    createdAt: p.createdAt,
  }))
}

export interface AppTemplateScreen {
  kind: string
  hasCalc: boolean
  calcModuleId: string | null
  ui: AppTemplateUi
}

const appTemplateScreen = (kind: string): AppTemplateScreen | null => {
  const b = appTemplateOf(kind)
  return b ? { kind: b.kind, hasCalc: !!b.calcModule, calcModuleId: b.calcModule?.id ?? null, ui: b.ui } : null
}

export function creatableAppTemplates(): AppTemplateScreen[] {
  return appTemplates().map((b) => appTemplateScreen(b.kind)!)
}

export interface SheetSummary {
  id: string
  name: string
  template: string | null
  family: string | null
  scope: 'period' | 'effective' | 'global'
  confirmable: boolean
}

export interface TaskSummary {
  id: string
  title: string
  periodStart: string | null
  periodEnd: string | null
  status: string
  submittedAt: Date | null
}

export interface ProjectOverview extends ProjectListItem {
  settings: Record<string, unknown>
  modules: string[]
  appTemplate: AppTemplateScreen | null
  sheets: SheetSummary[]
  tasks: TaskSummary[]
  references: number
  revising: Array<{ sourceName: string; title: string; periodStart: string | null; periodEnd: string | null }>
}

export async function readProjectOverview(deps: WorkSheetDeps, q: { userId: string; projectId: string }): Promise<ProjectOverview> {
  const p = await deps.db.workProject.findFirst({
    where: { id: q.projectId, userId: q.userId },
    select: {
      id: true, kind: true, status: true, agentId: true, settings: true, workflowId: true, workflowLinkedAt: true, createdAt: true, modules: true,
      sheets: { where: { kind: 'project' }, select: { id: true, name: true, schema: true, template: true, templateFamily: true } },
      tasks: { select: { id: true, title: true, periodStart: true, periodEnd: true, status: true, submittedAt: true }, orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }] },
    },
  })
  if (!p) throw new WorkError('NOT_FOUND')
  const key = await deps.dataKey(deps.db, q.userId)
  const { name, ...settings } = p.settings ? decryptJson<ProjectSettings>(p.settings, key) : { name: '' }
  const refs = await deps.db.projectReference.findMany({ where: { fromProjectId: p.id, userId: q.userId }, select: { toProjectId: true, sheets: true } })
  const periodFamilies = new Set(deps.templates.filter((t) => t.dateColumn || t.effectiveFromColumn).map((t) => t.family))
  const dated = refs.filter((r) => r.sheets.some((s) => periodFamilies.has(s)))
  const sources = dated.length
    ? await deps.db.workProject.findMany({
        where: { id: { in: dated.map((r) => r.toProjectId) }, userId: q.userId },
        select: { id: true, settings: true, tasks: { where: { status: 'open', currentSubmissionId: { not: null } }, select: { title: true, periodStart: true, periodEnd: true }, orderBy: { periodStart: 'asc' } } },
        orderBy: { id: 'asc' },
      })
    : []
  const revising = sources.flatMap((src) => {
    const sourceName = src.settings ? decryptJson<ProjectSettings>(src.settings, key).name : ''
    return src.tasks.map((t) => ({ sourceName, title: t.title, periodStart: day(t.periodStart), periodEnd: day(t.periodEnd) }))
  })
  const appTemplate = appTemplateOf(p.kind)
  const order = new Map((appTemplate?.sheets ?? []).map((s, i) => [s.template, i]))
  const sheets = p.sheets
    .map((s) => {
      const meta = sheetMeta({ id: s.id, schema: s.schema, template: s.template, templateFamily: s.templateFamily }, deps.templates)
      const t = meta.template
      return {
        id: s.id,
        name: s.name,
        template: s.template,
        family: s.templateFamily,
        scope: (t?.dateColumn ? 'period' : t?.effectiveFromColumn ? 'effective' : 'global') as SheetSummary['scope'],
        confirmable: !!t?.confirm,
      }
    })
    .sort((a, b) => (order.get(a.template ?? '') ?? 999) - (order.get(b.template ?? '') ?? 999) || a.name.localeCompare(b.name))
  return {
    id: p.id,
    name,
    kind: p.kind,
    status: p.status,
    agentId: p.agentId,
    readOnly: p.status !== 'active' || isProjectDetached(p),
    createdAt: p.createdAt,
    settings,
    modules: p.modules,
    appTemplate: appTemplateScreen(p.kind),
    sheets,
    tasks: p.tasks.map((t) => ({ id: t.id, title: t.title, periodStart: day(t.periodStart), periodEnd: day(t.periodEnd), status: t.status, submittedAt: t.submittedAt })),
    references: refs.length,
    revising,
  }
}

export interface SheetScreenRow {
  id: string
  data: Record<string, unknown>
  confirmed: boolean | null
  confirmedByAi: boolean
  locked: boolean
  updatedAt: Date
}

export interface SheetScreen {
  id: string
  name: string
  schema: SheetSchema
  dateColumn: string | null
  effectiveFromColumn: string | null
  confirmable: boolean
  options: Record<string, readonly string[]>
  refOptions: Record<string, string[]>
  hidden: readonly string[]
  manualRows: boolean
  pairDefs: Array<{ kind: string; toFamily: string }>
  exceptions: string[]
  fileColumn: string | null
  summary: readonly string[] | null
  fxShown: Record<string, { rate: string; unit: number; source: UsedFx['source']; validFor: string }>
  fxShownColumns: { rate: string; unit: string } | null
  screenRows: ScreenRows | null
  help: string | null
  pairs: Array<{ id: string; fromRowId: string; toRowId: string; kind: string; confirmed: boolean; locked: boolean }>
  rows: SheetScreenRow[]
}

async function refOptionsOf(
  deps: WorkSheetDeps,
  q: { userId: string; projectId: string },
  key: Buffer,
  refs: Readonly<Record<string, { family: string; column: string }>> | undefined,
): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {}
  for (const [col, ref] of Object.entries(refs ?? {})) {
    const rows = await deps.db.dataSheetRow.findMany({ where: { kind: 'project', projectId: q.projectId, userId: q.userId, sheet: { templateFamily: ref.family } } })
    out[col] = [...new Set(rows.map((r) => decodeRow(r, key).data[ref.column]).filter((v): v is string => typeof v === 'string' && v !== ''))].sort()
  }
  return out
}

async function fxShownOf(
  deps: WorkSheetDeps,
  q: { userId: string; projectId: string },
  key: Buffer,
  spec: NonNullable<NonNullable<SheetTemplate['ui']>['fxShown']>,
  rows: Array<{ id: string; data: Record<string, unknown> }>,
): Promise<SheetScreen['fxShown']> {
  const dayOf = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null)
  const targets = rows.flatMap((r) => {
    const currency = r.data[spec.currency]
    const date = dayOf(r.data[spec.date])
    return r.data[spec.rate] == null && typeof currency === 'string' && currency !== 'CHF' && date ? [{ id: r.id, currency, date }] : []
  })
  if (targets.length === 0) return {}
  const fromCol = deps.templates.find((x) => x.family === spec.method.family)?.effectiveFromColumn
  if (!fromCol) return {}
  const methodRows = await deps.db.dataSheetRow.findMany({ where: { kind: 'project', projectId: q.projectId, userId: q.userId, sheet: { templateFamily: spec.method.family } } })
  const methods = methodRows.map((r) => decodeRow(r, key).data)
    .flatMap((d) => { const from = dayOf(d[fromCol]); const m = d[spec.method.column]; return from && (m === 'monthly' || m === 'daily') ? [{ from, method: m as 'monthly' | 'daily' }] : [] })
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))
  const methodAt = (date: string) => methods.filter((m) => m.from <= date).pop()?.method ?? null
  const dates = targets.map((x) => x.date).sort()
  const used = new Map<string, UsedFx>()
  const table = await readFxTable(deps.db, q.userId, targets.map((x) => x.currency), dates[0], dates[dates.length - 1], used)
  const out: SheetScreen['fxShown'] = {}
  for (const x of targets) {
    const m = methodAt(x.date)
    if (!m || !table.lookup(x.currency, x.date, m)) continue
    const u = used.get(`${x.currency}|${x.date}`)!
    out[x.id] = { rate: u.rate, unit: u.unit, source: u.source, validFor: u.validFor }
  }
  return out
}

async function screenRowsOf(deps: WorkSheetDeps, q: { userId: string; projectId: string }, moduleId: string): Promise<ScreenRows | null> {
  const m = workModules().find((x) => x.id === moduleId)
  if (!m || m.kind === 'calc' || !m.screenRows) return null
  const p = await deps.db.workProject.findFirst({ where: { id: q.projectId, userId: q.userId }, select: { modules: true } })
  if (!p?.modules.includes(moduleId)) return null
  try {
    return await m.screenRows({ deps, userId: q.userId, projectId: q.projectId })
  } catch (e) {
    console.warn(`[work] screenRows ${moduleId}: ${describeCaughtError(e)}`)
    return null
  }
}

export async function readSheetScreen(deps: WorkSheetDeps, q: { userId: string; projectId: string; sheetId: string }): Promise<SheetScreen> {
  const sheet = await deps.db.dataSheet.findFirst({
    where: { id: q.sheetId, kind: 'project', projectId: q.projectId, userId: q.userId },
    select: { id: true, name: true, schema: true, template: true, templateFamily: true },
  })
  if (!sheet) throw new WorkError('NOT_FOUND')
  const meta = sheetMeta(sheet, deps.templates)
  const t = meta.template
  const [key, periods, dbRows] = await Promise.all([
    deps.dataKey(deps.db, q.userId),
    submittedPeriods(deps.db, q.userId, q.projectId),
    deps.db.dataSheetRow.findMany({ where: { sheetId: q.sheetId, kind: 'project', projectId: q.projectId, userId: q.userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
  ])
  const rows = dbRows.map((r) => decodeRow(r, key))
  let lockedOf: (r: (typeof rows)[number]) => boolean = () => false
  if (t?.dateColumn) {
    const col = meta.byName.get(t.dateColumn)!
    lockedOf = (r) => { const d = calendarDateOf(col, r.data[t.dateColumn!]); return d !== null && dateInAny(d, periods) }
  } else if (t?.effectiveFromColumn) {
    const intervals = effectiveIntervals(rows.map((r) => ({ id: r.id, start: String(r.data[t.effectiveFromColumn!]) })))
    lockedOf = (r) => { const iv = intervals.get(r.id); return !!iv && anyOverlap([iv], periods) }
  }
  return {
    id: sheet.id,
    name: sheet.name,
    schema: screenSchema(meta.schema, t),
    dateColumn: t?.dateColumn ?? null,
    effectiveFromColumn: t?.effectiveFromColumn ?? null,
    confirmable: !!t?.confirm,
    options: { ...(t?.ui?.options ?? {}) },
    refOptions: await refOptionsOf(deps, q, key, t?.ui?.refs),
    hidden: t?.ui?.hidden ?? [],
    manualRows: !t?.ui?.noManualRows,
    pairDefs: (t?.pairs ?? []).map((p) => ({ kind: p.kind, toFamily: p.toFamily })),
    exceptions: Object.keys(t?.exceptions ?? {}),
    summary: t?.ui?.summary ?? null,
    fileColumn: t?.ui?.file ?? null,
    fxShown: t?.ui?.fxShown ? await fxShownOf(deps, q, key, t.ui.fxShown, rows) : {},
    fxShownColumns: t?.ui?.fxShown ? { rate: t.ui.fxShown.rate, unit: t.ui.fxShown.unit } : null,
    screenRows: t?.ui?.screenRowsFrom ? await screenRowsOf(deps, q, t.ui.screenRowsFrom) : null,
    help: t?.ui?.help ?? null,
    pairs: await pairsOfRows(deps, q, rows, t, lockedOf),
    rows: rows.map((r) => ({ id: r.id, data: r.data, confirmed: r.confirmed, confirmedByAi: !!r.confirmed && !!r.confirmedBy?.startsWith('ai:'), locked: lockedOf(r), updatedAt: r.updatedAt })),
  }
}

async function pairsOfRows(
  deps: WorkSheetDeps,
  q: { userId: string; projectId: string },
  rows: readonly SheetRowView[],
  t: SheetTemplate | null,
  lockedOf: (r: SheetRowView) => boolean,
): Promise<SheetScreen['pairs']> {
  if (!t?.pairs?.length || rows.length === 0) return []
  const byId = new Map(rows.map((r) => [r.id, r]))
  const list = await deps.db.sheetRowPair.findMany({
    where: { projectId: q.projectId, userId: q.userId, fromRowId: { in: [...byId.keys()] } },
    select: { id: true, fromRowId: true, toRowId: true, kind: true, confirmed: true },
    orderBy: { id: 'asc' },
  })
  const toIds = list.filter((p) => t.pairs!.find((d) => d.kind === p.kind)?.periodSide === 'to').map((p) => p.toRowId)
  const toLocked = new Map<string, boolean>()
  if (toIds.length) {
    const [key, periods, targets] = await Promise.all([
      deps.dataKey(deps.db, q.userId),
      submittedPeriods(deps.db, q.userId, q.projectId),
      deps.db.dataSheetRow.findMany({ where: { id: { in: toIds }, kind: 'project', projectId: q.projectId, userId: q.userId }, include: { sheet: { select: { id: true, schema: true, template: true, templateFamily: true } } } }),
    ])
    for (const r of targets) {
      const meta = sheetMeta(r.sheet, deps.templates)
      const col = meta.template?.dateColumn
      const d = col ? calendarDateOf(meta.byName.get(col)!, decodeRow(r, key).data[col]) : null
      toLocked.set(r.id, d !== null && dateInAny(d, periods))
    }
  }
  return list.map((p) => {
    const side = t.pairs!.find((d) => d.kind === p.kind)?.periodSide
    return { ...p, locked: side === 'from' ? lockedOf(byId.get(p.fromRowId)!) : toLocked.get(p.toRowId) ?? false }
  })
}

export interface PairTargetRow { id: string; summary: Array<[string, unknown]>; locked: boolean; confirmed: boolean | null }

export async function readPairTargets(deps: WorkSheetDeps, q: { userId: string; projectId: string; family: string }): Promise<PairTargetRow[]> {
  const sheets = await deps.db.dataSheet.findMany({
    where: { kind: 'project', projectId: q.projectId, userId: q.userId, templateFamily: q.family },
    select: { id: true },
    orderBy: { id: 'asc' },
  })
  if (sheets.length === 0) throw new WorkError('NOT_FOUND')
  const out: PairTargetRow[] = []
  for (const s of sheets) {
    const screen = await readSheetScreen(deps, { ...q, sheetId: s.id })
    const summaryCols = screen.summary ?? screen.schema.columns.filter((c) => !screen.hidden.includes(c.name)).slice(0, 4).map((c) => c.name)
    for (const r of screen.rows) out.push({ id: r.id, summary: summaryCols.map((c) => [c, r.data[c]]), locked: r.locked, confirmed: r.confirmed })
  }
  return out.sort((a, b) => String(b.summary[0]?.[1] ?? '').localeCompare(String(a.summary[0]?.[1] ?? '')))
}

export async function readTaskChecklist(deps: WorkSheetDeps, q: { userId: string; projectId: string; taskId: string }): Promise<{ items: ChecklistItem[] }> {
  const task = await deps.db.workTask.findFirst({ where: { id: q.taskId, projectId: q.projectId, userId: q.userId }, select: { periodStart: true, periodEnd: true } })
  if (!task) throw new WorkError('NOT_FOUND')
  const p = await deps.db.workProject.findFirst({ where: { id: q.projectId, userId: q.userId }, select: { kind: true, modules: true } })
  if (!p) throw new WorkError('NOT_FOUND')
  const tpl = appTemplateOf(p.kind)
  if (!tpl?.checklist || !task.periodStart || !task.periodEnd) return { items: [] }
  const items = await tpl.checklist({ deps, userId: q.userId, projectId: q.projectId, modules: p.modules }, { start: task.periodStart.toISOString().slice(0, 10), end: task.periodEnd.toISOString().slice(0, 10) })
  const proposed = await deps.db.workNote.count({ where: { taskId: q.taskId, projectId: q.projectId, status: 'proposed' } })
  if (proposed > 0) items.push({ id: 'notes_proposed', state: 'todo', params: { n: proposed }, goto: 'notes' })
  return { items }
}
