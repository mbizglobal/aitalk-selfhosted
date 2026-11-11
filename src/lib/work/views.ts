
import { isSelfHosted } from '@/lib/edition'
import { createHash } from 'crypto'
import { Prisma } from '@prisma/client'
import { COUNTRY_CODES } from './iso-countries'
import { decryptJson } from './sealed'
import { WorkError } from './errors'
import { decodeRow, isProjectDetached, projectMembersTx, readProjectSheet, sheetMeta, submittedPeriods, type SheetRowView, type WorkSheetDeps } from './sheet-gate'
import { calendarDateOf, type SheetSchema } from './sheet-columns'
import { anyOverlap, dateInAny, effectiveIntervals } from './sheet-periods'
import { appTemplateOf, taskRuleOf, type AppTemplateUi, type ChecklistItem, type TaskRule } from './app-templates'
import type { ProjectSettings } from './projects'
import { filtersOf, type FilterFrom, findTemplate, screenSchema, type DerivedColumn, type RowAction, type SearchDecl, type SheetAction, type SheetTemplate } from './sheet-templates'
import { searchReady } from './search-copy'
import { isCalendarDate } from './dates'
import { readFxTable, type ScreenChoices, type ScreenFilter, type ScreenRows, type ScreenRowsCtx, type UsedFx } from './modules'
import { appTemplates, packageCoreOfKind, packageCoreOfModule, workModules } from './registry'
import { entryCtx, screenHandles } from './handles'
import { v5Handles } from './v5-handles'
import { describeCaughtError } from '@/lib/log-mask'
import { memberCanUseWorkflow } from '@/lib/memberAccess'
import { currencyKey, FORM_FILE_COLUMN, FORM_MORE_FILES_COLUMN, MYFORMS_KIND, type FormView } from './myforms'
import { ASSEMBLED_KIND, accountToday, computeRow, computeSums, readAnyForms, readRefRows, docFileColumn, docFpColumn } from './assembled'

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
  setupIssues: Array<{ code: string; params?: Record<string, string | number> }>
  taskRule: TaskRule
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
  const forms = p.kind === MYFORMS_KIND || p.kind === ASSEMBLED_KIND ? new Map((await readAnyForms(deps.db, key, { userId: q.userId, projectId: p.id })).map((f, i) => [f.sheetId, { f, i }])) : null
  const sheets = p.sheets
    .filter((s) => !forms || forms.has(s.id))
    .map((s) => {
      const form = forms?.get(s.id)
      if (form) return { id: s.id, name: form.f.name, template: null, family: null, scope: 'global' as SheetSummary['scope'], confirmable: true, order: form.i }
      const meta = sheetMeta({ id: s.id, schema: s.schema, template: s.template, templateFamily: s.templateFamily }, deps.templates)
      const t = meta.template
      return {
        id: s.id,
        name: s.name,
        template: s.template,
        family: s.templateFamily,
        scope: (t?.dateColumn ? 'period' : t?.effectiveFromColumn ? 'effective' : 'global') as SheetSummary['scope'],
        confirmable: !!t?.confirm,
        order: undefined as number | undefined,
      }
    })
    .sort((a, b) => (a.order !== undefined && b.order !== undefined ? a.order - b.order : 0) || (order.get(a.template ?? '') ?? 999) - (order.get(b.template ?? '') ?? 999) || a.name.localeCompare(b.name))
    .map(({ order: _o, ...x }) => x)
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
    taskRule: taskRuleOf(appTemplate),
    setupIssues: appTemplate?.setupIssues ? appTemplate.setupIssues(settings, await projectMembersTx(deps.db, q.userId, p.id)) : [],
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
  choices: Record<string, Array<{ value: string; label?: string; hints?: string[] }>>
  choicesFollow: Readonly<Record<string, { from: string; fillEmpty?: true }>>
  hidden: readonly string[]
  manualRows: boolean
  moduleOnly: boolean
  select: NonNullable<NonNullable<SheetTemplate['ui']>['select']> | null
  hideCommon: ReadonlyArray<'confirm' | 'confirmAll' | 'edit' | 'delete' | 'add' | 'editConfirm' | 'rowFile'>
  sortBy: { column: string; dir: 'asc' | 'desc' } | null
  askButtons: ReadonlyArray<{ label: string; ask: string }>
  download: boolean
  viewOnly: readonly string[]
  pairDefs: Array<{ kind: string; toFamily: string }>
  exceptions: string[]
  fileColumn: string | null
  image: { column: string; help: string | null; mime: readonly string[] | null; maxBytes: number | null } | null
  fileRules: Record<string, { mime: readonly string[]; maxBytes: number }>
  form: { groups: ReadonlyArray<{ name: string; columns: readonly string[] }>; note: string | null } | null
  rowActions: ReadonlyArray<RowAction>
  sheetActions: ReadonlyArray<SheetAction>
  openFiles: ReadonlyArray<{ column: string; label: string }>
  moreFiles: string | null
  formId?: string
  details: { column: string; columns: readonly string[]; money?: readonly string[]; label: string; download?: boolean; sumOf?: string; sumTo?: string; newItem?: Readonly<Record<string, unknown>>; options?: Readonly<Record<string, readonly string[]>>; booleans?: readonly string[] } | null
  countryColumns: readonly string[]
  noFirst: readonly string[]
  confirmAs: 'approve' | null
  dotFrom: string | null
  dotWhyFrom: string | null
  closeActions: ReadonlyArray<{ column: string; kind: 'reason' | 'today'; label: string; when?: { cell: string; in: readonly string[] } }>
  hideWhen: string | null
  lockEditWhen: string | null
  lockEditOnly: { items: readonly string[]; label: string; exceptWhen: { cell: string; in: readonly string[] } | null } | null
  confirmWhen: { cell: string; in: readonly string[] } | null
  textButtons: boolean
  colLabels: Readonly<Record<string, string>>
  labels: Readonly<Record<string, string>>
  summary: readonly string[] | null
  fxShown: Record<string, { rate: string; unit: number; source: UsedFx['source']; validFor: string }>
  fxShownColumns: { rate: string; unit: string } | null
  screenRows: ScreenRows | null
  derived: { columns: ReadonlyArray<DerivedColumn & { after?: string | null }>; cells: Record<string, Record<string, string | number | null>> } | null
  help: string | null
  pairs: Array<{ id: string; fromRowId: string; toRowId: string; kind: string; confirmed: boolean; locked: boolean }>
  rows: SheetScreenRow[]
  paging: SheetPaging | null
  sums?: import('./assembled').SumView[] | null
  stageMoves?: { column: string; start: string; next: Record<string, string[]> } | null
  refRows?: import('./assembled').RefRows
  timeColumns?: string[]
  specDocs?: Array<{ key: string; label: string }>
  specAppSends?: Array<{ key: string; label: string; allowWhen?: { status?: string[]; confirmed?: true }; start?: string }>
  specHttpSends?: Array<{ key: string; label: string; allowWhen?: { status?: string[]; confirmed?: true }; start?: string; via?: 'calendar' | 'sms' }>
  calSentMarks?: Record<string, Record<string, { sendId: string; at: string }>>
  appSendMarks?: Record<string, Record<string, import('./assembled-send').AppSendMark>>
  fileHelp?: string | null
}

export interface SheetPageQuery {
  year?: number | 'all'
  period?: { start: string; end: string }
  sort?: { col: string; dir: 'asc' | 'desc' }
  showHidden?: boolean
  after?: string
  filters?: ReadonlyArray<string | null>
}

export interface SheetPaging {
  year: number | 'all' | null
  years: number[]
  period: { start: string; end: string } | null
  sort: { col: string; dir: 'asc' | 'desc' }
  sortable: string[]
  showHidden: boolean
  next: string | null
  matched: number
  matchedMore: boolean
  hidden: number
  unconfirmed: number
  unconfirmedMore: boolean
  total: number
  filters: Array<{ index: number; label: string; options: Array<{ value: string; label: string }>; value: string | null }>
}

async function familyRows(deps: WorkSheetDeps, q: { userId: string; projectId: string }, family: string) {
  const sheets = await deps.db.dataSheet.findMany({ where: { kind: 'project', projectId: q.projectId, userId: q.userId, templateFamily: family }, select: { id: true } })
  if (sheets.length === 0) return []
  return deps.db.dataSheetRow.findMany({ where: { sheetId: { in: sheets.map((s) => s.id) }, kind: 'project', projectId: q.projectId, userId: q.userId } })
}

async function refOptionsOf(
  deps: WorkSheetDeps,
  q: { userId: string; projectId: string },
  key: Buffer,
  refs: Readonly<Record<string, { family: string; column: string }>> | undefined,
): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {}
  for (const [col, ref] of Object.entries(refs ?? {})) {
    const rows = await familyRows(deps, q, ref.family)
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
  const methodRows = await familyRows(deps, q, spec.method.family)
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

export async function screenRowsOf(deps: WorkSheetDeps, q: { userId: string; projectId: string }, moduleId: string, narrow?: ReadonlySet<string>): Promise<ScreenRows | null> {
  const m = workModules().find((x) => x.id === moduleId)
  if (!m || m.kind === 'calc' || !m.screenRows) return null
  const p = await deps.db.workProject.findFirst({ where: { id: q.projectId, userId: q.userId }, select: { modules: true } })
  if (!p?.modules.includes(moduleId)) return null
  try {
    const all = screenHandles({ deps, userId: q.userId, projectId: q.projectId })
    const handles = narrow
      ? { ...all, sheets: { ...all.sheets, read: async (sheetId: string) => ({ rows: (await readProjectSheet(deps, { userId: q.userId, projectId: q.projectId, sheetId, rowIds: [...narrow] })).rows }) } }
      : all
    const core = packageCoreOfModule(moduleId)
    return await m.screenRows(entryCtx({ ...handles, ...v5Handles(core, { deps, userId: q.userId, projectId: q.projectId }) }, core, deps, { userId: q.userId, projectId: q.projectId }) as ScreenRowsCtx)
  } catch (e) {
    console.warn(`[work] screenRows ${moduleId}: ${describeCaughtError(e)}`)
    return null
  }
}

export async function screenFilterOf(deps: WorkSheetDeps, q: { userId: string; projectId: string }, moduleId: string): Promise<ScreenFilter | null> {
  const m = workModules().find((x) => x.id === moduleId)
  if (!m || m.kind === 'calc' || !m.screenFilter) return null
  const p = await deps.db.workProject.findFirst({ where: { id: q.projectId, userId: q.userId }, select: { modules: true } })
  if (!p?.modules.includes(moduleId)) return null
  try {
    const handles = screenHandles({ deps, userId: q.userId, projectId: q.projectId })
    const core = packageCoreOfModule(moduleId)
    const r = await m.screenFilter(entryCtx({ ...handles, ...v5Handles(core, { deps, userId: q.userId, projectId: q.projectId }) }, core, deps, { userId: q.userId, projectId: q.projectId }) as ScreenRowsCtx)
    const byValue = new Map<string, Set<string>>()
    for (const o of r?.options ?? []) {
      if (typeof o?.value !== 'string' || !o.value.trim() || o.value.length > 200 || !Array.isArray(o.rows)) continue
      const set = byValue.get(o.value) ?? new Set<string>()
      for (const id of o.rows) if (typeof id === 'string' && id) set.add(id)
      byValue.set(o.value, set)
    }
    const labels = new Map((r?.options ?? []).filter((o) => typeof o?.label === 'string' && o.label.trim()).map((o) => [o.value, o.label!.slice(0, 200)]))
    return { options: [...byValue].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).map(([value, rows]) => ({ value, label: labels.get(value) ?? value, rows: [...rows] })) }
  } catch (e) {
    console.warn(`[work] screenFilter ${moduleId}: ${describeCaughtError(e)}`)
    return null
  }
}

export async function screenChoicesOf(deps: WorkSheetDeps, q: { userId: string; projectId: string }, spec: { module: string; columns: readonly string[] }): Promise<ScreenChoices> {
  const m = workModules().find((x) => x.id === spec.module)
  if (!m || m.kind === 'calc' || !m.screenChoices) return {}
  try {
    const p = await deps.db.workProject.findFirst({ where: { id: q.projectId, userId: q.userId }, select: { modules: true } })
    if (!p?.modules.includes(spec.module)) return {}
    const handles = screenHandles({ deps, userId: q.userId, projectId: q.projectId })
    const core = packageCoreOfModule(spec.module)
    const r = await m.screenChoices(entryCtx({ ...handles, ...v5Handles(core, { deps, userId: q.userId, projectId: q.projectId }) }, core, deps, { userId: q.userId, projectId: q.projectId }) as ScreenRowsCtx)
    const out: ScreenChoices = {}
    for (const col of spec.columns) {
      const list = Array.isArray(r?.[col]) ? r[col] : []
      const seen = new Set<string>()
      const clean = list.flatMap((o) => {
        if (typeof o?.value !== 'string' || !o.value.trim() || o.value.length > 200 || seen.has(o.value)) return []
        seen.add(o.value)
        const hints = Array.isArray(o.hints) ? o.hints.filter((h): h is string => typeof h === 'string' && h.length > 0 && h.length <= 120).slice(0, 20) : []
        return [{ value: o.value, label: typeof o.label === 'string' && o.label.trim() ? o.label.slice(0, 200) : o.value, ...(hints.length ? { hints } : {}) }]
      }).slice(0, 2000)
      if (clean.length) out[col] = clean
    }
    return out
  } catch (e) {
    console.warn(`[work] screenChoices ${spec.module}: ${describeCaughtError(e)}`)
    return {}
  }
}

export function derivedOf(t: SheetTemplate, r: ScreenRows | null, only?: ReadonlySet<string>): SheetScreen['derived'] {
  const spec = t.ui!.derivedFrom!
  if (!r) return null
  const names = spec.columns.map((c) => c.name)
  const cells: Record<string, Record<string, string | number | null>> = {}
  for (const [rowId, v] of Object.entries(r.cells ?? {})) {
    if (only && !only.has(rowId)) continue
    const out: Record<string, string | number | null> = {}
    for (const n of names) if (v && Object.hasOwn(v, n) && (typeof v[n] === 'string' || typeof v[n] === 'number' || v[n] === null)) out[n] = v[n]
    cells[rowId] = out
  }
  const order = t.ui?.order ?? []
  const rank = (n: string) => { const i = order.indexOf(n); return i < 0 ? order.length : i }
  const columns = [...spec.columns].sort((a, b) => rank(a.name) - rank(b.name))
  return { columns: columns.map((c) => ({ ...c, after: derivedAfter(t, c.name) })), cells }
}

function derivedAfter(t: SheetTemplate, name: string): string | null | undefined {
  const order = t.ui?.order ?? []
  const at = order.indexOf(name)
  if (at < 0) return undefined
  const stored = new Set(t.columns.map((c) => c.name))
  const skip = new Set([...(t.ui?.hidden ?? []), ...(t.ui?.derivedFrom?.columns ?? []).flatMap((c) => (c.replaces ? [c.replaces] : []))])
  for (let i = at - 1; i >= 0; i--) if (stored.has(order[i]) && !skip.has(order[i])) return order[i]
  return null
}

export async function readSheetScreen(deps: WorkSheetDeps, q: { userId: string; projectId: string; sheetId: string; page?: SheetPageQuery }): Promise<SheetScreen> {
  const sheet = await deps.db.dataSheet.findFirst({
    where: { id: q.sheetId, kind: 'project', projectId: q.projectId, userId: q.userId },
    select: { id: true, name: true, schema: true, template: true, templateFamily: true, rowCount: true },
  })
  if (!sheet) throw new WorkError('NOT_FOUND')
  const meta = sheetMeta(sheet, deps.templates)
  const t = meta.template
  const form = t ? null : (await readAnyForms(deps.db, await deps.dataKey(deps.db, q.userId), { userId: q.userId, sheetIds: [sheet.id], deleted: true }))[0] ?? null
  if (form?.deletedAt) throw new WorkError('NOT_FOUND')
  const decl = q.page && t && pageable(t) && (await searchReady(deps.db, deps.templates, sheet.id)) ? t.search! : null
  const filters = decl && t ? (await Promise.all(filtersOf(t).map((spec, i) => pageFilterOf(deps, { ...q, sheetId: sheet.id }, decl, spec, i, q.page?.filters?.[i] ?? undefined)))).filter((x): x is PageFilter => x !== null) : []
  const [key, periods, read, project] = await Promise.all([
    deps.dataKey(deps.db, q.userId),
    submittedPeriods(deps.db, q.userId, q.projectId),
    decl
      ? readPage(deps, q, t!, decl, q.page!, sheet.rowCount, filters)
      : deps.db.dataSheetRow.findMany({ where: { sheetId: q.sheetId, kind: 'project', projectId: q.projectId, userId: q.userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }).then((dbRows) => ({ dbRows, paging: null })),
    t?.ui?.rowActions?.length || t?.ui?.sheetActions?.length || t?.ui?.select ? deps.db.workProject.findFirst({ where: { id: q.projectId, userId: q.userId }, select: { modules: true, settings: true } }) : Promise.resolve(null),
  ])
  const { dbRows, paging } = read
  const projectModules = project?.modules ?? []
  const projectSettings: Readonly<Record<string, unknown>> = t?.ui?.sheetActions?.some((a) => a.setting) && project?.settings ? decryptJson<Record<string, unknown>>(project.settings, key) : {}
  const rows = dbRows.map((r) => decodeRow(r, key))
  const pageIds = paging ? new Set(rows.map((r) => r.id)) : undefined
  const narrow = paging && t?.ui?.derivedFrom?.rowScope === 'linked' ? await linkedClosure(deps, q, [...pageIds!]) : null
  const screenRowsCache = new Map<string, Promise<ScreenRows | null>>()
  const screenRowsFor = (id: string) => { let p = screenRowsCache.get(id); if (!p) screenRowsCache.set(id, (p = screenRowsOf(deps, q, id, narrow ?? undefined))); return p }
  let lockedOf: (r: (typeof rows)[number]) => boolean = () => false
  if (t?.dateColumn) {
    const col = meta.byName.get(t.dateColumn)!
    lockedOf = (r) => { const d = calendarDateOf(col, r.data[t.dateColumn!]); return d !== null && dateInAny(d, periods) }
  } else if (t?.effectiveFromColumn) {
    const intervals = effectiveIntervals(rows.map((r) => ({ id: r.id, start: String(r.data[t.effectiveFromColumn!]) })))
    lockedOf = (r) => { const iv = intervals.get(r.id); return !!iv && anyOverlap([iv], periods) }
  }
  const out: SheetScreen = {
    id: sheet.id,
    name: sheet.name,
    schema: screenSchema(meta.schema, t),
    dateColumn: t?.dateColumn ?? null,
    effectiveFromColumn: t?.effectiveFromColumn ?? null,
    confirmable: !!t?.confirm,
    options: { ...(t?.ui?.options ?? {}), ...Object.fromEntries((t?.ui?.countryColumns ?? []).map((c) => [c, COUNTRY_CODES])) },
    refOptions: await refOptionsOf(deps, q, key, t?.ui?.refs),
    choices: t?.ui?.choicesFrom ? await screenChoicesOf(deps, q, t.ui.choicesFrom) : {},
    choicesFollow: t?.ui?.choicesFrom?.follow ?? {},
    hidden: t?.ui?.hidden ?? [],
    manualRows: !t?.ui?.noManualRows,
    moduleOnly: !!t?.moduleOnly,
    pairDefs: (t?.pairs ?? []).map((p) => ({ kind: p.kind, toFamily: p.toFamily })),
    exceptions: Object.keys(t?.exceptions ?? {}),
    summary: t?.ui?.summary ?? null,
    fileColumn: t?.ui?.file ?? null,
    rowActions: (t?.ui?.rowActions ?? []).filter((a) => projectModules.includes(a.module)),
    sheetActions: (t?.ui?.sheetActions ?? []).filter((a) => projectModules.includes(a.module) && (!a.setting || projectSettings[a.setting] === true)),
    select: t?.ui?.select && projectModules.includes(t.ui.select.module) ? t.ui.select : null,
    hideCommon: t?.ui?.hideCommon ?? [],
    sortBy: t?.ui?.sortBy ?? null,
    askButtons: t?.ui?.askButtons ?? [],
    download: !!t?.ui?.download,
    viewOnly: t?.ui?.viewOnly ?? [],
    openFiles: t?.ui?.openFiles ?? [],
    details: t?.ui?.details ?? null,
    moreFiles: t?.ui?.moreFiles ?? null,
    countryColumns: t?.ui?.countryColumns ?? [],
    noFirst: t?.ui?.noFirst ?? [],
    confirmAs: t?.ui?.confirmAs ?? null,
    dotFrom: t?.ui?.dotFrom ?? null,
    dotWhyFrom: t?.ui?.dotWhyFrom ?? null,
    closeActions: t?.ui?.closeActions ?? [],
    hideWhen: t?.ui?.hideWhen ?? null,
    lockEditWhen: typeof t?.ui?.lockEditWhen === 'object' ? t.ui.lockEditWhen.column : t?.ui?.lockEditWhen ?? null,
    lockEditOnly: typeof t?.ui?.lockEditWhen === 'object' && t.ui.lockEditWhen.onlyItems?.length ? { items: t.ui.lockEditWhen.onlyItems, label: t.ui.lockEditWhen.label ?? 'edit', exceptWhen: t.ui.lockEditWhen.exceptWhen ?? null } : null,
    confirmWhen: t?.ui?.confirmWhen ?? null,
    textButtons: t?.ui?.textButtons ?? false,
    colLabels: t?.ui?.colLabels ?? {},
    fileRules: Object.fromEntries(Object.entries(t?.fileRules ?? {}).map(([c, r]) => [c, { mime: r.mime, maxBytes: r.maxBytes }])),
    image: t?.ui?.image ? { column: t.ui.image.column, help: t.ui.image.help ?? null, mime: t.fileRules?.[t.ui.image.column]?.mime ?? null, maxBytes: t.fileRules?.[t.ui.image.column]?.maxBytes ?? null } : null,
    fxShown: t?.ui?.fxShown ? await fxShownOf(deps, q, key, t.ui.fxShown, rows) : {},
    fxShownColumns: t?.ui?.fxShown ? { rate: t.ui.fxShown.rate, unit: t.ui.fxShown.unit } : null,
    screenRows: t?.ui?.screenRowsFrom ? await screenRowsFor(t.ui.screenRowsFrom) : null,
    derived: t?.ui?.derivedFrom ? derivedOf(t, await screenRowsFor(t.ui.derivedFrom.module), pageIds) : null,
    help: t?.ui?.help ?? null,
    form: t?.ui?.form ? { groups: t.ui.form.groups, note: t.ui.form.note ?? null } : null,
    pairs: await pairsOfRows(deps, q, rows, t, lockedOf),
    rows: rows.map((r) => ({ id: r.id, data: r.data, confirmed: r.confirmed, confirmedByAi: !!r.confirmed && !!r.confirmedBy?.startsWith('ai:'), locked: lockedOf(r), updatedAt: r.updatedAt })),
    paging,
    labels: {},
  }
  if (!form) return out
  const fs = formScreen(out, form)
  if (!form.assembled) return fs
  let scr = assembledScreen(fs, form.assembled.table, await accountToday(deps.db, q.userId), await readRefRows(deps.db, key, q, form.assembled.table))
  const at = form.assembled.table
  const sp = await (await import('./assembled')).readSpec(deps.db, key, q)
  const specAppSends = (sp?.spec.appSends ?? []).filter((x) => x.table === at.key && !x.hidden).map((x) => ({ key: x.key, label: x.label, ...(x.allowWhen ? { allowWhen: x.allowWhen } : {}), ...(at.status ? { start: at.status.start } : {}) }))
  const specHttpSends = (sp?.spec.sends ?? []).filter((x) => x.table === at.key && (x.via === 'http' || ((x.via === 'calendar' || x.via === 'sms') && !isSelfHosted()))).map((x) => {
    const aw = x.allowWhen?.status || x.allowWhen?.confirmed ? { ...(x.allowWhen.status ? { status: x.allowWhen.status } : {}), ...(x.allowWhen.confirmed ? { confirmed: true as const } : {}) } : undefined
    return { key: x.key, label: x.label, ...(aw ? { allowWhen: aw } : {}), ...(at.status ? { start: at.status.start } : {}), ...(x.via === 'calendar' ? { via: 'calendar' as const } : x.via === 'sms' ? { via: 'sms' as const } : {}) }
  })
  let calSentMarks: SheetScreen['calSentMarks']
  if (specHttpSends.some((x) => 'via' in x && x.via === 'calendar') && scr.rows.length) {
    const sent = await deps.db.workSend.findMany({ where: { userId: q.userId, projectId: q.projectId, kind: 'calendar', status: 'sent', ref: { in: scr.rows.map((r) => r.id) }, declared: { startsWith: 'assembled.calendar:' } }, select: { id: true, ref: true, declared: true, createdAt: true } })
    calSentMarks = {}
    for (const x of sent) { const k = x.declared!.slice('assembled.calendar:'.length); (calSentMarks[x.ref!] ??= {})[k] = { sendId: x.id, at: x.createdAt.toISOString() } }
  }
  if (calSentMarks) scr = { ...scr, calSentMarks }
  if (!specAppSends.length) return specHttpSends.length ? { ...scr, specHttpSends } : scr
  const marks = await (await import('./assembled-send')).appSendMarks(deps.db, key, { userId: q.userId, projectId: q.projectId, rowIds: scr.rows.map((r) => r.id) })
  return { ...scr, specAppSends, appSendMarks: Object.fromEntries(marks), ...(specHttpSends.length ? { specHttpSends } : {}) }
}

function assembledScreen(out: SheetScreen, t: import('./assembled').SpecTable, today: string, refRows: import('./assembled').RefRows): SheetScreen {
  const comp = t.columns.filter((c) => c.kind === 'computed' && !c.hidden)
  let derived = out.derived
  if (comp.length) {
    const cells: Record<string, Record<string, string | number | null>> = {}
    for (const r of out.rows) cells[r.id] = computeRow(t, r.data, today)
    const after = (key: string): string | null => {
      const i = t.columns.findIndex((c) => c.key === key)
      for (let j = i - 1; j >= 0; j--) if (t.columns[j].kind !== 'computed' && !t.columns[j].hidden) return t.columns[j].key
      return null
    }
    derived = { columns: comp.map((c) => ({ name: c.key, label: c.label, type: 'text' as const, after: after(c.key) })), cells }
  }
  const sums = t.sums?.length ? computeSums(t, out.rows.map((r) => r.data), refRows) : null
  const st = t.status
  const stageMoves = st ? { column: 'status', start: st.start, next: Object.fromEntries(st.values.map((v) => [v, st.moves.filter((m) => m.from === v).map((m) => m.to)])) } : null
  const timeColumns = t.columns.filter((c) => c.kind === 'time' && !c.hidden).map((c) => c.key)
  const specDocs = (t.docs ?? []).filter((d) => !d.hidden).map((d) => ({ key: d.key, label: d.label }))
  const docCols = (t.docs ?? []).flatMap((d) => [docFileColumn(d.key), docFpColumn(d.key)])
  return { ...out, hidden: [...out.hidden, ...docCols], viewOnly: [...out.viewOnly, ...docCols], ...(specDocs.length ? { specDocs } : {}), derived, labels: { ...out.labels, ...Object.fromEntries(comp.map((c) => [c.key, c.label])) }, sums, stageMoves, ...(Object.keys(refRows).length ? { refRows } : {}), ...(timeColumns.length ? { timeColumns } : {}) }
}

function formScreen(out: SheetScreen, f: FormView): SheetScreen {
  const labels: Record<string, string> = {}
  const options: Record<string, readonly string[]> = {}
  const hidden: string[] = [FORM_FILE_COLUMN, FORM_MORE_FILES_COLUMN]
  let details: SheetScreen['details'] = null
  for (const c of f.info.columns) {
    labels[c.key] = c.label
    if (c.hidden) hidden.push(c.key, ...(c.kind === 'money' ? [currencyKey(c.key)] : []))
    if (c.kind === 'choice' && c.options) options[c.key] = c.options
    if (c.kind === 'person') options[c.key] = f.info.people
    if (c.kind === 'money' && c.options) options[currencyKey(c.key)] = c.options
    if (c.kind === 'items' && c.items) {
      for (const it of c.items) labels[it.key] = it.label
      details = {
        column: c.key,
        columns: c.items.map((it) => it.key),
        money: c.items.filter((it) => it.kind === 'money').map((it) => it.key),
        label: c.key,
        download: true,
        options: Object.fromEntries(c.items.filter((it) => it.kind === 'choice' && it.options).map((it) => [it.key, it.options!])),
        booleans: c.items.filter((it) => it.kind === 'yesno').map((it) => it.key),
      }
    }
  }
  return {
    ...out,
    name: f.name,
    confirmable: true,
    options,
    hidden,
    labels,
    colLabels: { [FORM_FILE_COLUMN]: 'form_file', ...Object.fromEntries(f.info.columns.filter((c) => c.kind === 'money').map((c) => [currencyKey(c.key), 'form_currency'])) },
    fileColumn: FORM_FILE_COLUMN,
    moreFiles: FORM_MORE_FILES_COLUMN,
    viewOnly: [...out.viewOnly, ...f.info.columns.filter((c) => c.readOnly).map((c) => c.key)],
    download: true,
    details,
    formId: f.id,
    fileHelp: 'file_help_form',
  }
}

const PAGE_ROWS = 50
const COUNT_CAP = 10_000
const CLOSURE_CAP = 5_000
const DATE_SLOTS = ['fDate1', 'fDate2', 'fDate3', 'fDate4'] as const
const AMT_SLOTS = ['fAmt1', 'fAmt2'] as const
const KEY_SLOTS = ['fKey1', 'fKey2', 'fKey3', 'fKey4'] as const
type SlotField = (typeof DATE_SLOTS)[number] | (typeof AMT_SLOTS)[number] | (typeof KEY_SLOTS)[number]
const SLOT_COLUMN: Record<SlotField, string> = {
  fDate1: 'f_date1', fDate2: 'f_date2', fDate3: 'f_date3', fDate4: 'f_date4', fAmt1: 'f_amt1', fAmt2: 'f_amt2',
  fKey1: 'f_key1', fKey2: 'f_key2', fKey3: 'f_key3', fKey4: 'f_key4',
}

function slotOf(d: SearchDecl, col: string): { field: SlotField; kind: 'date' | 'amount' | 'key' } | null {
  const i = d.dates?.indexOf(col) ?? -1
  if (i >= 0) return { field: DATE_SLOTS[i], kind: 'date' }
  const j = d.amounts?.indexOf(col) ?? -1
  if (j >= 0) return { field: AMT_SLOTS[j], kind: 'amount' }
  const k = d.keys?.indexOf(col) ?? -1
  return k >= 0 ? { field: KEY_SLOTS[k], kind: 'key' } : null
}

function pageable(t: SheetTemplate): boolean {
  const d = t.search
  if (!d || !t.dateColumn || d.dates?.[0] !== t.dateColumn || t.ui?.screenRowsFrom || t.ui?.form) return false
  if (!t.columns.find((c) => c.name === t.dateColumn)?.required) return false
  if (t.ui?.hideWhen) { const h = slotOf(d, t.ui.hideWhen); if (!h || h.kind === 'amount') return false }
  return true
}

const utcDay = (s: string) => new Date(`${s}T00:00:00.000Z`)
const slotText = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString().slice(0, 10) : v instanceof Prisma.Decimal ? v.toFixed() : String(v))

function encodeCursor(k: string | null, id: string, f: string): string {
  return Buffer.from(JSON.stringify({ k, id, f })).toString('base64url')
}
function decodeCursor(s: string | undefined, f: string): { k: string | null; id: string } | null {
  if (!s) return null
  try {
    const c = JSON.parse(Buffer.from(s, 'base64url').toString('utf8')) as { k?: unknown; id?: unknown; f?: unknown }
    if (c.f !== f || typeof c.id !== 'string' || (c.k !== null && typeof c.k !== 'string')) return null
    return { k: c.k, id: c.id }
  } catch {
    return null
  }
}

interface PageFilter { index: number; label: string; options: Array<{ value: string; label: string }>; value: string | null; where: Prisma.DataSheetRowWhereInput | null; sql: Prisma.Sql | null }
const FILTER_OPTIONS_MAX = 200
const FILTER_ROWS_MAX = 10_000
async function pageFilterOf(deps: WorkSheetDeps, q: { userId: string; projectId: string; sheetId: string }, d: SearchDecl, spec: FilterFrom, index: number, chosen: string | undefined): Promise<PageFilter | null> {
  if ('column' in spec) {
    const slot = slotOf(d, spec.column)
    if (!slot || slot.kind !== 'key') return null
    const col = Prisma.raw(SLOT_COLUMN[slot.field])
    const vals = await deps.db.$queryRaw<Array<{ v: string }>>`SELECT DISTINCT ${col} AS v FROM data_sheet_rows WHERE sheet_id = ${q.sheetId} AND user_id = ${q.userId} AND ${col} IS NOT NULL AND char_length(${col}) <= 200 ORDER BY v LIMIT ${FILTER_OPTIONS_MAX}`
    const options = vals.map((r) => ({ value: r.v, label: r.v }))
    const value = chosen !== undefined && options.some((o) => o.value === chosen) ? chosen : null
    return { index, label: spec.label, options, value, where: value === null ? null : { [slot.field]: value }, sql: value === null ? null : Prisma.sql` AND ${col} = ${value}` }
  }
  const sf = await screenFilterOf(deps, q, spec.module)
  if (!sf) return null
  const hit = sf.options.find((o) => o.value === chosen) ?? null
  if (hit && hit.rows.length > FILTER_ROWS_MAX) throw new WorkError('INVALID', `this picker value has more than ${FILTER_ROWS_MAX} lines — not supported yet`)
  const sql = !hit ? null : hit.rows.length ? Prisma.sql` AND id = ANY(${hit.rows}::text[])` : Prisma.sql` AND false`
  return { index, label: spec.label, options: sf.options.map((o) => ({ value: o.value, label: o.label ?? o.value })), value: hit?.value ?? null, where: hit ? { id: { in: hit.rows } } : null, sql }
}

async function readPage(
  deps: WorkSheetDeps, q: { userId: string; projectId: string; sheetId: string }, t: SheetTemplate, d: SearchDecl, page: SheetPageQuery, total: number,
  filters: readonly PageFilter[],
) {
  const chosen = filters.filter((x) => x.where)
  const base: Prisma.DataSheetRowWhereInput = { sheetId: q.sheetId, kind: 'project', projectId: q.projectId, userId: q.userId, ...(chosen.length ? { AND: chosen.map((x) => x.where!) } : {}) }
  const filterSql = chosen.length ? Prisma.join(chosen.map((x) => x.sql!), '') : Prisma.empty
  const where = Prisma.sql`sheet_id = ${q.sheetId} AND user_id = ${q.userId}${filterSql}`
  const yrs = await deps.db.$queryRaw<Array<{ y: number }>>`
    WITH b AS (SELECT extract(year FROM min(f_date1))::int lo, extract(year FROM max(f_date1))::int hi FROM data_sheet_rows WHERE ${where})
    SELECT y FROM b, generate_series(b.hi, b.lo, -1) y
    WHERE y IN (b.lo, b.hi) OR EXISTS (SELECT 1 FROM data_sheet_rows WHERE ${where} AND f_date1 BETWEEN make_date(y, 1, 1) AND make_date(y, 12, 31))
    ORDER BY y DESC`
  const years = yrs.map((r) => Number(r.y))
  const hi = years[0] ?? null
  const thisYear = new Date().getUTCFullYear()
  const period = page.period ?? null
  const year: SheetPaging['year'] = period ? null : page.year ?? (hi === null || years.includes(thisYear) ? thisYear : hi)
  const y4 = typeof year === 'number' ? String(year).padStart(4, '0') : null
  const range = period ? { gte: utcDay(period.start), lte: utcDay(period.end) } : y4 ? { gte: utcDay(`${y4}-01-01`), lte: utcDay(`${y4}-12-31`) } : null
  const ranged: Prisma.DataSheetRowWhereInput = range ? { ...base, fDate1: range } : base
  const hide = t.ui?.hideWhen ? slotOf(d, t.ui.hideWhen)!.field : null
  const showHidden = !!page.showHidden
  const shown: Prisma.DataSheetRowWhereInput = hide && !showHidden ? { ...ranged, [hide]: null } : ranged
  const sortable = [...(d.dates ?? []), ...(d.amounts ?? [])]
  const sort = page.sort && sortable.includes(page.sort.col) ? page.sort : { col: t.dateColumn!, dir: 'desc' as const }
  const field = slotOf(d, sort.col)!.field
  const isDate = slotOf(d, sort.col)!.kind === 'date'
  const asValue = (k: string) => (isDate ? utcDay(k) : new Prisma.Decimal(k))
  const f = createHash('sha256').update(JSON.stringify({ year, period, sort, showHidden, filters: filters.map((x) => x.value) })).digest('base64url').slice(0, 16)
  const decoded = decodeCursor(page.after, f)
  const cur = decoded && (decoded.k === null || (isDate ? isCalendarDate(decoded.k) : /^-?\d{1,65}(\.\d{1,30})?$/.test(decoded.k))) ? decoded : null
  const lt = sort.dir === 'desc'
  const idAfter = lt ? { lt: cur?.id } : { gt: cur?.id }
  const after: Prisma.DataSheetRowWhereInput | null = !cur ? null
    : cur.k === null
      ? (lt ? { OR: [{ [field]: null, id: idAfter }, { [field]: { not: null } }] } : { [field]: null, id: idAfter })
      : { OR: [{ [field]: lt ? { lt: asValue(cur.k) } : { gt: asValue(cur.k) } }, { [field]: asValue(cur.k), id: idAfter }, ...(lt ? [] : [{ [field]: null }])] }
  const capped = (n: number) => Math.min(n, COUNT_CAP)
  const rangeSql = range ? Prisma.sql`AND f_date1 BETWEEN ${(period?.start ?? `${y4}-01-01`)}::date AND ${(period?.end ?? `${y4}-12-31`)}::date` : Prisma.empty
  const hideCol = hide ? Prisma.raw(SLOT_COLUMN[hide]) : null
  const shownSql = hideCol && !showHidden ? Prisma.sql`${rangeSql} AND ${hideCol} IS NULL` : rangeSql
  const capN = (cond: Prisma.Sql) => Prisma.sql`(SELECT count(*)::int FROM (SELECT 1 FROM data_sheet_rows WHERE ${where} ${cond} LIMIT ${COUNT_CAP + 1}) x)`
  const [dbRows, counts] = await Promise.all([
    deps.db.dataSheetRow.findMany({
      where: after ? { AND: [shown, after] } : shown,
      orderBy: [{ [field]: { sort: sort.dir, nulls: lt ? 'first' : 'last' } }, { id: sort.dir }],
      take: PAGE_ROWS + 1,
    }),
    deps.db.$queryRaw<Array<{ matched: number; hidden: number; unconfirmed: number }>>`SELECT
      ${capN(shownSql)} AS matched,
      ${hideCol ? capN(Prisma.sql`${rangeSql} AND ${hideCol} IS NOT NULL`) : Prisma.sql`0`} AS hidden,
      ${t.confirm ? capN(Prisma.sql`${shownSql} AND confirmed = false`) : Prisma.sql`0`} AS unconfirmed`,
  ])
  const matched = Number(counts[0].matched), hidden = Number(counts[0].hidden), unconfirmed = Number(counts[0].unconfirmed)
  const more = dbRows.length > PAGE_ROWS
  const pageRows = more ? dbRows.slice(0, PAGE_ROWS) : dbRows
  const last = pageRows[pageRows.length - 1]
  const paging: SheetPaging = {
    year, years, period, sort, sortable, showHidden,
    next: more && last ? encodeCursor(slotText(last[field]), last.id, f) : null,
    matched: capped(matched), matchedMore: matched > COUNT_CAP, hidden: capped(hidden), unconfirmed: capped(unconfirmed), unconfirmedMore: unconfirmed > COUNT_CAP, total,
    filters: filters.map((x) => ({ index: x.index, label: x.label, options: x.options, value: x.value })),
  }
  return { dbRows: pageRows, paging }
}

export async function linkedClosure(deps: WorkSheetDeps, q: { userId: string; projectId: string }, seeds: readonly string[]): Promise<ReadonlySet<string> | null> {
  const sheets = await deps.db.dataSheet.findMany({ where: { kind: 'project', projectId: q.projectId, userId: q.userId, template: { not: null } }, select: { id: true, template: true }, orderBy: { id: 'asc' } })
  const linkSheets: string[] = []
  for (const s of sheets) {
    let link: string | undefined
    try { link = findTemplate(deps.templates, s.template!).search?.link } catch { return null }
    if (!link) continue
    if (!(await searchReady(deps.db, deps.templates, s.id))) return null
    linkSheets.push(s.id)
  }
  const all = new Set(seeds)
  let frontier = [...seeds]
  while (frontier.length > 0) {
    const found = await deps.db.dataSheetRow.findMany({
      where: { kind: 'project', projectId: q.projectId, userId: q.userId, OR: [{ id: { in: frontier } }, { sheetId: { in: linkSheets }, fLink: { in: frontier } }] },
      select: { id: true, sheetId: true, fLink: true },
    })
    frontier = []
    for (const r of found) for (const x of [r.id, linkSheets.includes(r.sheetId) ? r.fLink : null]) if (x && !all.has(x)) { all.add(x); frontier.push(x) }
    if (all.size > CLOSURE_CAP) return null
  }
  return all
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
  const p = await deps.db.workProject.findFirst({ where: { id: q.projectId, userId: q.userId }, select: { kind: true, modules: true, settings: true } })
  if (!p) throw new WorkError('NOT_FOUND')
  const tpl = appTemplateOf(p.kind)
  if (!tpl?.checklist || !task.periodStart || !task.periodEnd) return { items: [] }
  const handles = screenHandles({ deps, userId: q.userId, projectId: q.projectId })
  const settings: Readonly<Record<string, unknown>> = p.settings ? decryptJson<ProjectSettings>(p.settings, await deps.dataKey(deps.db, q.userId)) : {}
  const core = packageCoreOfKind(p.kind)
  const ctx = entryCtx({ ...handles, ...v5Handles(core, { deps, userId: q.userId, projectId: q.projectId }) }, core, deps, { userId: q.userId, projectId: q.projectId, modules: p.modules, settings }) as ScreenRowsCtx & { modules: readonly string[]; settings: Readonly<Record<string, unknown>> }
  const items = await tpl.checklist(ctx, { start: task.periodStart.toISOString().slice(0, 10), end: task.periodEnd.toISOString().slice(0, 10) })
  const proposed = await deps.db.workNote.count({ where: { taskId: q.taskId, projectId: q.projectId, status: 'proposed' } })
  if (proposed > 0) items.push({ id: 'notes_proposed', state: 'todo', params: { n: proposed }, goto: 'notes' })
  return { items }
}

export async function readAttention(deps: WorkSheetDeps, q: { userId: string; projectId: string; viewer: { owner: boolean; memberId?: number } }): Promise<{ items: import('./app-templates').AttentionItem[] }> {
  const p = await deps.db.workProject.findFirst({ where: { id: q.projectId, userId: q.userId }, select: { kind: true, modules: true, settings: true, status: true } })
  if (!p) throw new WorkError('NOT_FOUND')
  const tpl = appTemplateOf(p.kind)
  if (!tpl?.attention || p.status !== 'active') return { items: [] }
  const handles = screenHandles({ deps, userId: q.userId, projectId: q.projectId })
  const { name: _name, ...settings } = p.settings ? decryptJson<ProjectSettings>(p.settings, await deps.dataKey(deps.db, q.userId)) : { name: '' }
  void _name
  const core = packageCoreOfKind(p.kind)
  const ctx = entryCtx({ ...handles, ...v5Handles(core, { deps, userId: q.userId, projectId: q.projectId }) }, core, deps, { userId: q.userId, projectId: q.projectId, modules: p.modules, settings }) as import('./app-templates').AttentionCtx
  try {
    return { items: await linkApps(deps, q, await tpl.attention({ ...ctx, settings }, q.viewer)) }
  } catch (e) {
    console.error('[work] attention:', describeCaughtError(e))
    return { items: [] }
  }
}

async function linkApps(deps: WorkSheetDeps, q: { userId: string; projectId: string; viewer: { owner: boolean; memberId?: number } }, items: import('./app-templates').AttentionItem[]) {
  if (!items.some((x) => x.linked)) return items
  const refs = await deps.db.projectReference.findMany({ where: { fromProjectId: q.projectId, userId: q.userId }, select: { toProjectId: true, sheets: true } })
  const out: import('./app-templates').AttentionItem[] = []
  for (const x of items) {
    if (!x.linked) { out.push(x); continue }
    const to = refs.filter((r) => r.sheets.includes(x.linked!.family)).map((r) => r.toProjectId)
    let app: { agentId: string; workflowId: string; name: string } | null = null
    if (to.length === 1) {
      const p = await deps.db.workProject.findFirst({ where: { id: to[0], userId: q.userId, status: 'active' }, select: { workflowId: true } })
      const wf = p?.workflowId ? await deps.db.workflow.findFirst({ where: { workflowId: p.workflowId, status: 'production', agent: { userId: q.userId } }, select: { workflowId: true, agentId: true, name: true } }) : null
      if (wf && (q.viewer.memberId === undefined || await memberCanUseWorkflow(deps.db, wf.agentId, q.viewer.memberId, wf.workflowId))) app = { agentId: wf.agentId, workflowId: wf.workflowId, name: wf.name }
    }
    out.push(app ? { ...x, linkedApp: app } : x)
  }
  return out
}
