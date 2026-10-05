
import { decryptJson } from './sealed'
import { WorkError } from './errors'
import { sheetMeta, type WorkSheetDeps } from './sheet-gate'
import { readProjectReferences, referenceStatus, type ReferenceChange } from './references'
import type { ProjectSettings } from './projects'
import type { SheetSchema } from './sheet-columns'
import { findTemplate, screenSchema } from './sheet-templates'

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)

async function projectNames(deps: WorkSheetDeps, userId: string, ids: readonly string[]): Promise<Map<string, string>> {
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
  dateColumn: string | null
  rows: Array<{ id: string; data: Record<string, unknown>; confirmed: boolean | null }>
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
  return list.map((r) => ({
    referenceId: r.referenceId,
    sourceProjectId: r.sourceProjectId,
    sourceName: names.get(r.sourceProjectId) ?? '',
    includeUnconfirmed: r.includeUnconfirmed,
    revising: r.revising.flatMap((id) => {
      const t = taskById.get(id)
      return t ? [{ taskId: t.id, title: t.title, periodStart: day(t.periodStart), periodEnd: day(t.periodEnd) }] : []
    }),
    sheets: reader.sheets(r.referenceId).map((s) => {
      const t = s.template ? findTemplate(deps.templates, s.template) : null
      return {
        id: s.id,
        name: s.name,
        family: s.family,
        template: s.template,
        schema: screenSchema(s.schema, t),
        options: { ...(t?.ui?.options ?? {}) },
        hidden: t?.ui?.hidden ?? [],
        dateColumn: t?.dateColumn ?? null,
        rows: reader.rows(r.referenceId, s.id).map((x) => ({ id: x.id, data: x.data, confirmed: x.confirmed })),
      }
    }),
  }))
}

export interface TaskReferenceStatus {
  hasReferences: boolean
  differs: boolean
  flagged: boolean
  tasks: Array<{ sourceName: string; title: string | null; was: { status: string; number: number | null }; now: { status: string; number: number | null } | null }>
  rowsChanged: number
  rowsGone: number
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
    pairsChanged: st.changes.filter((c) => c.type === 'pair').length,
    digest: st.digest,
  }
}
