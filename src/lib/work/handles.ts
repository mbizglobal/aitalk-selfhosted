
import { WorkError } from './errors'
import { randomBytes } from 'crypto'
import { isPublicToken, publicLinkUrl } from './public-links'
import { Prisma } from '@prisma/client'
import { discardPreparedFile, prepareProjectFile, readProjectFile, type PreparedWorkFile, type WorkFileDeps } from './files'
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
import { assertScanWrite } from './scan-fence'

export interface WorkAppSheetInfo { id: string; name: string; template: string }
export interface WorkAppFileInfo { id: string; mimeType: string; originalName: string; sha256: string }
export interface WorkAppTaskInfo { id: string; period: DateRange | null }

export interface WorkAppSheetWriter {
  sheetsOfFamily(family: string): Promise<Array<{ id: string; template: string }>>
  rows(sheetId: string): Promise<SheetRowView[]>
  lockedPeriods(): readonly DateRange[]
  insert(sheetId: string, data: Record<string, unknown>): Promise<SheetRowView>
  update(sheetId: string, rowId: string, patch: Record<string, unknown>): Promise<SheetRowView>
  remove(sheetId: string, rowId: string): Promise<void>
  pair(fromRowId: string, toRowId: string, kind: string): Promise<{ id: string }>
  unpair(pairId: string): Promise<void>
  pairsFrom(fromRowIds: readonly string[] | null): Promise<Array<{ id: string; fromRowId: string; toRowId: string; kind: string; confirmed: boolean }>>
  addFile(prepared: WorkAppPreparedFile): Promise<{ id: string; sha256: string; created: boolean }>
  addPublicLink(input: { fileId: string; rowId: string; lastDay: string; expiresAt: Date }): Promise<{ token: string; url: string } | null>
  revokePublicLinks(rowId: string): Promise<number>
  discardSendsFor(rowId: string): Promise<number>
}

export interface WorkAppPreparedFile { readonly token: string; readonly sha256: string }

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
    sealed(taskId: string): Promise<WorkAppSealedInfo | null>
  }
}

export interface WorkAppSealedInfo { number: number; submittedAt: string; output: unknown }

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
  fileUpload: {
    prepare(input: { buffer: Buffer; mimeType: string; originalName: string; kind: 'report' | 'invoice' | 'other' }): Promise<{ existing: WorkAppFileInfo } | { prepared: WorkAppPreparedFile }>
    discard(prepared: WorkAppPreparedFile): Promise<void>
  }
  counters: { next(name: string, opts?: { max?: number }): Promise<number | null> }
  publicLinks: { url(token: string): string | null }
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
  writeIn?: (req: { sheetIds: string[]; taskId?: string; exception?: string }, actor: SheetActor) => Promise<ProjectSheetWriter>
  core?: number | null
}

const dayOf = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)
const periodOf = (s: Date | null, e: Date | null): DateRange | null => {
  const start = dayOf(s)
  const end = dayOf(e)
  return start && end ? { start, end } : null
}

function writerView(w: ProjectSheetWriter, prepared: ReadonlyMap<string, PreparedWorkFile>, core?: number | null): WorkAppSheetWriter {
  return {
    ...(core != null && core >= 7 ? { confirm: async (rowIds: readonly string[]) => ({ confirmed: (await w.confirmRows([...rowIds])).confirmed }) } : {}),
    sheetsOfFamily: (family) => w.sheetsOfFamily(family),
    rows: (sheetId) => w.rows(sheetId),
    lockedPeriods: () => w.lockedPeriods(),
    insert: (sheetId, data) => w.insert(sheetId, data),
    update: (sheetId, rowId, patch) => w.update(sheetId, rowId, patch),
    remove: (sheetId, rowId) => w.remove(sheetId, rowId),
    pair: (fromRowId, toRowId, kind) => w.pair(fromRowId, toRowId, kind),
    unpair: (pairId) => w.unpair(pairId),
    pairsFrom: (fromRowIds) => w.pairsFrom(fromRowIds),
    async addFile(p) {
      const real = prepared.get(p?.token)
      if (!real) throw new WorkError('NOT_FOUND', 'unknown prepared file')
      return w.addPreparedFile(real)
    },
    addPublicLink: (input) => w.addPublicLink(input),
    revokePublicLinks: (rowId) => w.revokePublicLinks(rowId),
    discardSendsFor: (rowId) => w.discardSendsFor(rowId),
  }
}

const COUNTER_NAME = /^[a-z0-9][a-z0-9.-]{0,59}$/
const PACKAGE_FILE_KINDS: ReadonlySet<string> = new Set(['report', 'invoice', 'other'])

export const frozenActor = (a: SheetActor): SheetActor => Object.freeze(a.type === 'module' && a.person ? { ...a, person: Object.freeze({ ...a.person }) } : { ...a })

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
        await assertScanWrite(null, [], [fileId])
        const f = await deps.db.workFile.findFirst({ where: { id: fileId, projectId, userId }, select: { id: true, mimeType: true, sha256: true, payload: true } })
        if (!f) return null
        const { originalName } = decryptJson<{ originalName: string }>(f.payload, await deps.dataKey(deps.db, userId))
        return { id: f.id, mimeType: f.mimeType, originalName, sha256: f.sha256 }
      },
      async read(fileId) {
        await assertScanWrite(null, [], [fileId])
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
      async sealed(taskId) {
        const t = await deps.db.workTask.findFirst({ where: { id: taskId, projectId, userId }, select: { status: true, currentSubmissionId: true } })
        if (!t || t.status !== 'submitted' || !t.currentSubmissionId) return null
        const sub = await deps.db.workSubmission.findFirst({ where: { id: t.currentSubmissionId, taskId, projectId, userId }, select: { number: true, submittedAt: true, result: true } })
        if (!sub) return null
        const body = decryptJson<{ result?: unknown }>(sub.result, await deps.dataKey(deps.db, userId))
        const r = body.result
        return { number: sub.number, submittedAt: sub.submittedAt.toISOString(), output: r && typeof r === 'object' && 'output' in r ? (r as { output: unknown }).output : null }
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
  const prepared = new Map<string, PreparedWorkFile>()
  return {
    ...r,
    sheets: {
      ...r.sheets,
      async create(input) {
        const sheet = await createProjectSheet(deps, { userId, projectId, name: input.name, template: input.template })
        return { id: sheet.id }
      },
      write: async (req, fn) => {
        if (s.writeIn) return fn(writerView(await s.writeIn({ sheetIds: req.sheetIds, taskId: req.taskId, exception: req.exception }, s.writeAs), prepared, s.core))
        return withProjectSheetWrite(deps, { userId, projectId, sheetIds: req.sheetIds, actor: s.writeAs, taskId: req.taskId, exception: req.exception }, (w) => fn(writerView(w, prepared, s.core)))
      },
    },
    tasks: r.tasks,
    files: r.files,
    modules: { run: (moduleId, input) => runModule(moduleId, input, s.caller) },
    fileUpload: {
      async prepare(input) {
        if (!PACKAGE_FILE_KINDS.has(input.kind)) throw new WorkError('INVALID', 'unknown file kind')
        const out = await prepareProjectFile(deps, { userId, projectId, kind: input.kind, originalName: input.originalName, mimeType: input.mimeType, buffer: input.buffer, actor: s.writeAs })
        if ('existing' in out) {
          const f = out.existing
          const { originalName } = decryptJson<{ originalName: string }>(f.payload, await deps.dataKey(deps.db, userId))
          return { existing: { id: f.id, mimeType: f.mimeType, originalName, sha256: f.sha256 } }
        }
        const token = randomBytes(18).toString('base64url')
        prepared.set(token, out.prepared)
        return { prepared: Object.freeze({ token, sha256: out.prepared.sha256 }) }
      },
      async discard(p) {
        const real = prepared.get(p?.token)
        if (!real) return
        prepared.delete(p.token)
        await discardPreparedFile(deps, real)
      },
    },
    publicLinks: { url: (token) => (isPublicToken(token) ? publicLinkUrl(token) : null) },
    counters: {
      async next(name, opts) {
        if (typeof name !== 'string' || !COUNTER_NAME.test(name)) throw new WorkError('INVALID', 'counter name')
        const max = opts?.max ?? 2_147_483_647
        if (!Number.isInteger(max) || max < 1) throw new WorkError('INVALID', 'counter max')
        const rows = await deps.db.$queryRaw<Array<{ value: number }>>(Prisma.sql`
          INSERT INTO work_counter (user_id, name, value) VALUES (${userId}, ${name}, 1)
          ON CONFLICT (user_id, name) DO UPDATE SET value = work_counter.value + 1 WHERE work_counter.value < ${max}
          RETURNING value`)
        return rows.length ? Number(rows[0].value) : null
      },
    },
  }
}

export function toolHandles(s: HandleScope, runId: string, runModule: (moduleId: string, input: unknown, caller: SheetActor) => Promise<unknown>): WorkAppToolHandles {
  return {
    ...moduleHandles(s, runModule),
    propose: (p) => {
      if (p.type === 'confirm_rows') throw new WorkError('INVALID', 'confirm cards are made with proposeConfirm')
      if (p.type === 'ledger_link') throw new WorkError('INVALID', 'bank link cards are made with proposeLedgerLink')
      if (p.type === 'ledger_files') throw new WorkError('INVALID', 'statement cards are made by the core')
      if (p.type === 'ledger_statement') throw new WorkError('INVALID', 'statement import cards are made with proposeLedgerStatement')
      return recordWorkAppProposal(runId, p)
    },
  }
}
