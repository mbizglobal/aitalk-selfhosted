
import { decryptJson } from './sealed'
import { WorkError } from './errors'
import { sheetMeta, type WorkSheetDeps } from './sheet-gate'
import { readProjectReferences, referenceStatus, type ReferenceChange } from './references'
import type { ProjectSettings } from './projects'
import type { SheetSchema } from './sheet-columns'
import { findTemplate, screenSchema } from './sheet-templates'
import { derivedOf, screenRowsOf, type SheetScreen } from './views'
import { assembledSourceSheets, type AssembledSourceSheet } from './assembled-source'
import type { ScreenRows } from './modules'

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)

export async function projectNames(deps: WorkSheetDeps, userId: string, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const rows = await deps.db.workProject.findMany({ where: { id: { in: [...new Set(ids)] }, userId }, select: { id: true, settings: true } })
  const key = await deps.dataKey(deps.db, userId)
  return new Map(rows.map((p) => [p.id, p.settings ? decryptJson<ProjectSettings>(p.settings, key).name : '']))
}

export interface ReferenceSettingItem {
  id: string
  toProjectId: string
  toName: string
  sheets: string[]
  includeUnconfirmed: boolean
}

export interface ReferenceSourceOption {
  id: string
  name: string
  kind: string
  sheets: Array<{ selector: string; family: string | null; name: string }>
}

export interface ReferenceSettings {
  references: ReferenceSettingItem[]
  sources: ReferenceSourceOption[]
}

export async function readReferenceSettings(deps: WorkSheetDeps, q: { userId: string; projectId: string }): Promise<ReferenceSettings> {
  const self = await deps.db.workProject.findFirst({ where: { id: q.projectId, userId: q.userId }, select: { id: true } })
  if (!self) throw new WorkError('NOT_FOUND')
  const [refs, others] = await Promise.all([
    deps.db.projectReference.findMany({ where: { fromProjectId: q.projectId, userId: q.userId }, orderBy: { id: 'asc' } }),
    deps.db.workProject.findMany({
      where: { userId: q.userId, id: { not: q.projectId } },
      select: { id: true, kind: true, settings: true, sheets: { where: { kind: 'project' }, select: { id: true, name: true, schema: true, template: true, templateFamily: true }, orderBy: { id: 'asc' } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
  ])
  const key = await deps.dataKey(deps.db, q.userId)
  const nameOf = new Map(others.map((p) => [p.id, p.settings ? decryptJson<ProjectSettings>(p.settings, key).name : '']))
  return {
    references: refs.map((r) => ({ id: r.id, toProjectId: r.toProjectId, toName: nameOf.get(r.toProjectId) ?? '', sheets: r.sheets, includeUnconfirmed: r.includeUnconfirmed })),
    sources: others.map((p) => {
      const seen = new Set<string>()
      const sheets: ReferenceSourceOption['sheets'] = []
      for (const s of p.sheets) {
        const family = sheetMeta(s, deps.templates).family
        if (seen.has(family)) continue
        seen.add(family)
        sheets.push({ selector: family, family: s.template ? family : null, name: s.name })
      }
      return { id: p.id, name: nameOf.get(p.id) ?? '', kind: p.kind, sheets }
    }),
  }
}

export interface ReferenceScreenSheet {
  id: string
  name: string
  family: string
  template: string | null
  schema: SheetSchema
  options: Record<string, readonly string[]>
  hidden: readonly string[]
  derived: SheetScreen['derived']
  dateColumn: string | null
  rows: Array<{ id: string; data: Record<string, unknown>; confirmed: boolean | null }>
  labels?: Record<string, string>
  refRows?: Record<string, import('./assembled').RefItem[]>
}

export interface ReferenceScreenItem {
  referenceId: string
  sourceProjectId: string
  sourceName: string
  includeUnconfirmed: boolean
  revising: Array<{ taskId: string; title: string; periodStart: string | null; periodEnd: string | null }>
  sheets: ReferenceScreenSheet[]
}

export async function readReferenceScreen(deps: WorkSheetDeps, q: { userId: string; projectId: string }): Promise<ReferenceScreenItem[]> {
  const reader = await readProjectReferences(deps, q)
  const list = reader.references()
  if (list.length === 0) return []
  const names = await projectNames(deps, q.userId, list.map((r) => r.sourceProjectId))
  const revisingIds = list.flatMap((r) => r.revising)
  const revisingTasks = revisingIds.length
    ? await deps.db.workTask.findMany({ where: { id: { in: revisingIds }, userId: q.userId }, select: { id: true, title: true, periodStart: true, periodEnd: true } })
    : []
  const taskById = new Map(revisingTasks.map((t) => [t.id, t]))
  const derivedCache = new Map<string, ReturnType<typeof screenRowsOf>>()
  const key = await deps.dataKey(deps.db, q.userId)
  return Promise.all(list.map(async (r) => {
    const asm = await assembledSourceSheets(deps.db, key, { userId: q.userId, sourceProjectId: r.sourceProjectId, sheets: reader.sheets(r.referenceId), rowsOf: (id) => reader.rows(r.referenceId, id) })
    return ({
    referenceId: r.referenceId,
    sourceProjectId: r.sourceProjectId,
    sourceName: names.get(r.sourceProjectId) ?? '',
    includeUnconfirmed: r.includeUnconfirmed,
    revising: r.revising.flatMap((id) => {
      const t = taskById.get(id)
      return t ? [{ taskId: t.id, title: t.title, periodStart: day(t.periodStart), periodEnd: day(t.periodEnd) }] : []
    }),
    sheets: asm ? [...asm].map(([id, a]) => assembledScreenSheet(id, a)) : await Promise.all([...reader.sheets(r.referenceId)].map((s, i) => ({ s, i, o: (s.template ? findTemplate(deps.templates, s.template)?.ui?.referenceOrder : undefined) ?? Number.POSITIVE_INFINITY })).sort((a, b) => a.o - b.o || a.i - b.i).map(({ s }) => s).map(async (s) => {
      const t = s.template ? findTemplate(deps.templates, s.template) : null
      const rows = reader.rows(r.referenceId, s.id)
      let derived: SheetScreen['derived'] = null
      if (t?.ui?.derivedFrom && r.includeUnconfirmed) {
        const k = `${r.sourceProjectId}|${t.ui.derivedFrom.module}`
        if (!derivedCache.has(k)) derivedCache.set(k, screenRowsOf(deps, { userId: q.userId, projectId: r.sourceProjectId }, t.ui.derivedFrom.module))
        const d = derivedOf(t, await derivedCache.get(k)!)
        if (d) { const shown = new Set(rows.map((x) => x.id)); derived = { columns: d.columns, cells: Object.fromEntries(Object.entries(d.cells).filter(([id]) => shown.has(id))) } }
      }
      return {
        id: s.id,
        name: s.name,
        family: s.family,
        template: s.template,
        schema: screenSchema(s.schema, t),
        options: { ...(t?.ui?.options ?? {}) },
        hidden: t?.ui?.hidden ?? [],
        dateColumn: t?.dateColumn ?? null,
        derived,
        rows: rows.map((x) => ({ id: x.id, data: x.data, confirmed: x.confirmed })),
      }
    })),
  })
  }))
}

function assembledScreenSheet(id: string, a: AssembledSourceSheet): ReferenceScreenSheet {
  const type = (k: string): SheetSchema['columns'][number]['type'] => (k === 'money' ? 'text' : k === 'number' ? 'number' : k === 'date' ? 'date' : 'string')
  const money = new Set(a.columns.filter((c) => c.kind === 'money').map((c) => c.key))
  return {
    id, name: a.name, family: 'assembled', template: null,
    schema: { columns: a.columns.map((c) => ({ name: c.key, type: type(c.kind) })) },
    options: {}, hidden: [], dateColumn: null, derived: null,
    labels: Object.fromEntries(a.columns.map((c) => [c.key, c.label])),
    refRows: a.refRows,
    rows: a.rows.map((r) => ({ id: r.id, confirmed: r.confirmed, data: Object.fromEntries(Object.entries(r.data).filter(([k]) => !k.endsWith('_cur') || !money.has(k.slice(0, -4))).map(([k, v]) => [k, money.has(k) && v !== null && v !== '' && r.data[`${k}_cur`] ? `${String(r.data[`${k}_cur`])} ${String(v)}` : v])) })),
  }
}

export async function referencedCells(deps: WorkSheetDeps, q: { userId: string; projectId: string; workflowId?: string }, family: string): Promise<Map<string, Readonly<Record<string, string | number | null>>>> {
  const reader = await readProjectReferences(deps, q)
  const out = new Map<string, Readonly<Record<string, string | number | null>>>()
  const cache = new Map<string, Promise<ScreenRows | null>>()
  for (const r of reader.references()) {
    if (!r.includeUnconfirmed || !r.selectors.includes(family)) continue
    for (const s of reader.sheets(r.referenceId)) {
      if (s.family !== family) continue
      const t = s.template ? findTemplate(deps.templates, s.template) : null
      if (!t?.ui?.derivedFrom) continue
      const k = `${r.sourceProjectId}|${t.ui.derivedFrom.module}`
      if (!cache.has(k)) cache.set(k, screenRowsOf(deps, { userId: q.userId, projectId: r.sourceProjectId }, t.ui.derivedFrom.module))
      const d = derivedOf(t, await cache.get(k)!)
      if (!d) continue
      const shown = new Set(reader.rows(r.referenceId, s.id).map((x) => x.id))
      for (const [id, cells] of Object.entries(d.cells)) if (shown.has(id)) out.set(id, Object.freeze({ ...cells }))
    }
  }
  return out
}

export interface TaskReferenceStatus {
  hasReferences: boolean
  differs: boolean
  flagged: boolean
  tasks: Array<{ sourceName: string; title: string | null; was: { status: string; number: number | null }; now: { status: string; number: number | null } | null }>
  rowsChanged: number
  rowsGone: number
  rowsAdded: number
  pairsChanged: number
  digest: string
}

export async function readTaskReferenceStatus(deps: WorkSheetDeps, q: { userId: string; taskId: string }): Promise<TaskReferenceStatus | null> {
  const st = await referenceStatus(deps, q)
  if (!st) return null
  const taskChanges = st.changes.filter((c): c is Extract<ReferenceChange, { type: 'task' }> => c.type === 'task')
  const [tasks, refs] = await Promise.all([
    taskChanges.length
      ? deps.db.workTask.findMany({ where: { id: { in: taskChanges.map((c) => c.taskId) }, userId: q.userId }, select: { id: true, title: true, projectId: true } })
      : Promise.resolve([]),
    deps.db.projectReference.findMany({ where: { id: { in: [...new Set(taskChanges.map((c) => c.referenceId))] }, userId: q.userId }, select: { id: true, toProjectId: true } }),
  ])
  const taskById = new Map(tasks.map((t) => [t.id, t]))
  const refTo = new Map(refs.map((r) => [r.id, r.toProjectId]))
  const names = await projectNames(deps, q.userId, [...tasks.map((t) => t.projectId), ...refs.map((r) => r.toProjectId)])
  return {
    hasReferences: st.hasReferences,
    differs: st.differs,
    flagged: st.flagged,
    tasks: taskChanges.map((c) => {
      const t = taskById.get(c.taskId)
      const projectId = t?.projectId ?? refTo.get(c.referenceId)
      return { sourceName: (projectId && names.get(projectId)) || '', title: t?.title ?? null, was: c.was, now: c.now }
    }),
    rowsChanged: st.changes.filter((c) => c.type === 'row' && !c.gone).length,
    rowsGone: st.changes.filter((c) => c.type === 'row' && c.gone).length,
    rowsAdded: st.changes.filter((c) => c.type === 'row_added').length,
    pairsChanged: st.changes.filter((c) => c.type === 'pair').length,
    digest: st.digest,
  }
}
