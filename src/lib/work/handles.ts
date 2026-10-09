
import { WorkError } from './errors'
import { readProjectFile, type WorkFileDeps } from './files'
import { decryptJson } from './sealed'
import {
  createProjectSheet,
  readProjectSheet,
  submittedPeriods,
  withProjectSheetWrite,
  type ProjectSheetWriter,
  type SheetActor,
  type SheetRowView,
  type WorkSheetDeps,
} from './sheet-gate'
import type { SheetSchema } from './sheet-columns'
import type { DateRange } from './sheet-periods'
import { findTemplate, templateSchema } from './sheet-templates'
import { recordWorkAppProposal, type WorkAppProposal } from './app-scope'

export interface WorkAppSheetInfo { id: string; name: string; template: string }
export interface WorkAppFileInfo { id: string; mimeType: string; originalName: string; sha256: string }
export interface WorkAppTaskInfo { id: string; period: DateRange | null }

export interface WorkAppSheetWriter {
  sheetsOfFamily(family: string): Promise<Array<{ id: string; template: string }>>
  rows(sheetId: string): Promise<SheetRowView[]>
  lockedPeriods(): readonly DateRange[]
  insert(sheetId: string, data: Record<string, unknown>): Promise<SheetRowView>
  update(sheetId: string, rowId: string, patch: Record<string, unknown>): Promise<SheetRowView>
}

export interface WorkAppReadHandles {
  sheets: {
    list(family: string): Promise<WorkAppSheetInfo[]>
    read(sheetId: string): Promise<{ rows: SheetRowView[] }>
    submittedPeriods(): Promise<DateRange[]>
    schema(template: string): SheetSchema
  }
  files: {
    info(fileId: string): Promise<WorkAppFileInfo | null>
    read(fileId: string): Promise<{ id: string; sha256: string; buffer: Buffer; originalName: string }>
  }
  tasks: {
    list(): Promise<WorkAppTaskInfo[]>
    get(taskId: string): Promise<WorkAppTaskInfo | null>
  }
}

export interface WorkAppScreenHandles {
  sheets: Pick<WorkAppReadHandles['sheets'], 'list' | 'read' | 'submittedPeriods' | 'schema'>
  tasks: WorkAppReadHandles['tasks']
}

export interface WorkAppHandles extends WorkAppReadHandles {
  sheets: WorkAppReadHandles['sheets'] & {
    create(input: { name: string; template: string }): Promise<{ id: string }>
    write<T>(req: { sheetIds: string[]; taskId?: string; exception?: string }, fn: (w: WorkAppSheetWriter) => Promise<T>): Promise<T>
  }
  modules: { run(moduleId: string, input: unknown): Promise<unknown> }
}

export interface WorkAppToolHandles extends WorkAppHandles {
  propose(p: WorkAppProposal): boolean
}

export interface HandleScope {
  deps: WorkFileDeps
  userId: string
  projectId: string
  caller: SheetActor
  writeAs: SheetActor
  readAsWorkflow?: string
}

const dayOf = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)
const periodOf = (s: Date | null, e: Date | null): DateRange | null => {
  const start = dayOf(s)
  const end = dayOf(e)
  return start && end ? { start, end } : null
}

function writerView(w: ProjectSheetWriter): WorkAppSheetWriter {
  return {
    sheetsOfFamily: (family) => w.sheetsOfFamily(family),
    rows: (sheetId) => w.rows(sheetId),
    lockedPeriods: () => w.lockedPeriods(),
    insert: (sheetId, data) => w.insert(sheetId, data),
    update: (sheetId, rowId, patch) => w.update(sheetId, rowId, patch),
  }
}

export const frozenActor = (a: SheetActor): SheetActor => Object.freeze({ ...a })

export function entryCtx<H extends object, F extends object, D>(handles: H, core: number | null, deps: D, fields: F): H & F & { deps?: D } {
  return { ...handles, ...(core === 1 ? { deps } : {}), ...fields }
}

export function readHandles(scope: HandleScope): WorkAppReadHandles {
  const s: HandleScope = { ...scope, caller: frozenActor(scope.caller), writeAs: frozenActor(scope.writeAs) }
  const { deps, userId, projectId } = s
  return {
    sheets: {
      async list(family) {
        const list = await deps.db.dataSheet.findMany({
          where: { kind: 'project', projectId, userId, templateFamily: family },
          select: { id: true, name: true, template: true },
          orderBy: { id: 'asc' },
        })
        return list.map((x) => {
          if (!x.template) throw new WorkError('INTEGRITY', `sheet ${x.id} has a family but no template`)
          return { id: x.id, name: x.name, template: x.template }
        })
      },
      async read(sheetId) {
        const { rows } = await readProjectSheet(deps, { userId, projectId, sheetId, ...(s.readAsWorkflow !== undefined ? { workflowId: s.readAsWorkflow } : {}) })
        return { rows }
      },
      submittedPeriods: () => submittedPeriods(deps.db, userId, projectId),
      schema: (template) => templateSchema(findTemplate(deps.templates, template)),
    },
    files: {
      async info(fileId) {
        const f = await deps.db.workFile.findFirst({ where: { id: fileId, projectId, userId }, select: { id: true, mimeType: true, sha256: true, payload: true } })
        if (!f) return null
        const { originalName } = decryptJson<{ originalName: string }>(f.payload, await deps.dataKey(deps.db, userId))
        return { id: f.id, mimeType: f.mimeType, originalName, sha256: f.sha256 }
      },
      async read(fileId) {
        const f = await deps.db.workFile.findFirst({ where: { id: fileId, projectId, userId }, select: { id: true } })
        if (!f) throw new WorkError('NOT_FOUND')
        const { file, buffer, originalName } = await readProjectFile(deps, { userId, fileId, actor: s.caller })
        return { id: file.id, sha256: file.sha256, buffer, originalName }
      },
    },
    tasks: {
      async list() {
        const list = await deps.db.workTask.findMany({
          where: { projectId, userId },
          select: { id: true, periodStart: true, periodEnd: true },
          orderBy: [{ periodStart: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
        })
        return list.map((t) => ({ id: t.id, period: periodOf(t.periodStart, t.periodEnd) }))
      },
      async get(taskId) {
        const t = await deps.db.workTask.findFirst({ where: { id: taskId, projectId, userId }, select: { id: true, periodStart: true, periodEnd: true } })
        return t ? { id: t.id, period: periodOf(t.periodStart, t.periodEnd) } : null
      },
    },
  }
}

export function screenHandles(s: { deps: WorkSheetDeps; userId: string; projectId: string }): WorkAppScreenHandles {
  const r = readHandles({ ...s, deps: s.deps as WorkFileDeps, caller: { type: 'human' }, writeAs: { type: 'human' } })
  return { sheets: r.sheets, tasks: r.tasks }
}

export function moduleHandles(scope: HandleScope, runModule: (moduleId: string, input: unknown, caller: SheetActor) => Promise<unknown>): WorkAppHandles {
  const s: HandleScope = { ...scope, caller: frozenActor(scope.caller), writeAs: frozenActor(scope.writeAs) }
  const r = readHandles(s)
  const { deps, userId, projectId } = s
  return {
    ...r,
    sheets: {
      ...r.sheets,
      async create(input) {
        const sheet = await createProjectSheet(deps, { userId, projectId, name: input.name, template: input.template })
        return { id: sheet.id }
      },
      write: (req, fn) =>
        withProjectSheetWrite(deps, { userId, projectId, sheetIds: req.sheetIds, actor: s.writeAs, taskId: req.taskId, exception: req.exception }, (w) => fn(writerView(w))),
    },
    tasks: r.tasks,
    files: r.files,
    modules: { run: (moduleId, input) => runModule(moduleId, input, s.caller) },
  }
}

export function toolHandles(s: HandleScope, runId: string, runModule: (moduleId: string, input: unknown, caller: SheetActor) => Promise<unknown>): WorkAppToolHandles {
  return { ...moduleHandles(s, runModule), propose: (p) => recordWorkAppProposal(runId, p) }
}
