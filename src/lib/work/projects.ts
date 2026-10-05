
import { createHash } from 'crypto'
import { Prisma } from '@prisma/client'
import { encryptJson, decryptJson } from './sealed'
import { WorkError } from './errors'
import { assertAiMayWrite, assertProjectWritable, isProjectDetached, lockProjectForWrite, lockTaskForWrite, type SheetActor, actorLabel, type WorkSheetDeps } from './sheet-gate'
import { rangesOverlap } from './sheet-periods'
import { computeReferenceViews, fingerprint, lockForSubmit, pairFp, rowFp, snapshotsFrom, type ReferenceSnapshot } from './references'
import { findTemplate, templateId, templateSchema, validateTemplateRegistry } from './sheet-templates'
import { appTemplateOf } from './app-templates'
import { CALC_TIMEOUT_MS, SubmitReadCtx, findUnconfirmed, loadProjectSnapshot, moduleLabel, moduleStop, runWithTimeout, type UsedFx } from './modules'
import { isCalendarDate } from './dates'
import { describeCaughtError } from '@/lib/log-mask'
import { noteDigests } from './notes'
import { isAppWorkflow } from '@/lib/workflow/start-trigger'
import { isAppTemplateKind } from './app-template-kinds'
import { approvalApplies, assertMayUnlockSeal } from '@/ee'

const TX_TIMEOUT_MS = 30_000

export interface ProjectSettings {
  name: string
  [k: string]: unknown
}

type Tx = Prisma.TransactionClient

async function event(tx: Tx, key: Buffer, e: { userId: string; projectId: string; taskId?: string; submissionId?: string; fileId?: string; noteId?: string; actor: SheetActor; action: string; detail?: unknown }) {
  await tx.workEvent.create({
    data: {
      userId: e.userId,
      projectId: e.projectId,
      taskId: e.taskId ?? null,
      submissionId: e.submissionId ?? null,
      fileId: e.fileId ?? null,
      noteId: e.noteId ?? null,
      actor: actorLabel(e.actor),
      action: e.action,
      payload: e.detail === undefined ? null : encryptJson(e.detail, key),
    },
  })
}
export { event as writeWorkEvent }

export async function createProject(deps: WorkSheetDeps, input: { userId: string; name: string; kind?: string; settings?: unknown; agentId?: string }) {
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name) throw new WorkError('INVALID', 'name is required')
  const kind = input.kind ?? 'free'
  const appTemplate = appTemplateOf(kind)
  if (!appTemplate && input.settings !== undefined) throw new WorkError('INVALID', 'a free project has no appTemplate settings')
  const extra = appTemplate ? appTemplate.parseSettings(input.settings) : {}
  const sheets = appTemplate ? appTemplate.sheets.map((s) => ({ ...s, t: findTemplate(deps.templates, s.template) })) : []
  if (appTemplate) validateTemplateRegistry(deps.templates)
  const key = await deps.dataKey(deps.db, input.userId)
  return deps.db.$transaction(async (tx) => {
    const u = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "user" WHERE id = ${input.userId} FOR SHARE`
    if (u.length === 0) throw new WorkError('NOT_FOUND')
    if (input.agentId !== undefined) await assertOwnAgent(tx, input.userId, input.agentId)
    const project = await tx.workProject.create({
      data: {
        userId: input.userId,
        kind,
        modules: appTemplate ? [...appTemplate.modules] : [],
        settings: encryptJson({ ...extra, name } satisfies ProjectSettings, key),
        agentId: input.agentId ?? null,
      },
    }).catch((e: unknown) => {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') throw new WorkError('NOT_FOUND')
      throw e
    })
    await createTemplateSheets(tx, input.userId, project.id, sheets)
    return project
  }, { timeout: TX_TIMEOUT_MS })
}

async function createTemplateSheets(tx: Tx, userId: string, projectId: string, sheets: ReadonlyArray<{ name: string; t: ReturnType<typeof findTemplate> }>) {
  for (const s of sheets) {
    await tx.dataSheet.create({
      data: {
        kind: 'project',
        userId,
        projectId,
        name: s.name,
        schema: JSON.stringify(templateSchema(s.t)),
        template: templateId(s.t),
        templateFamily: s.t.family,
      },
    })
  }
}

export async function readProjectSettings(deps: WorkSheetDeps, userId: string, projectId: string): Promise<ProjectSettings> {
  const p = await deps.db.workProject.findFirst({ where: { id: projectId, userId }, select: { settings: true } })
  if (!p) throw new WorkError('NOT_FOUND')
  if (!p.settings) return { name: '' }
  return decryptJson<ProjectSettings>(p.settings, await deps.dataKey(deps.db, userId))
}

async function assertOwnAgent(tx: Tx, userId: string, agentId: string) {
  const a = await tx.agent.findFirst({ where: { agentId, userId }, select: { id: true } })
  if (!a) throw new WorkError('NOT_FOUND')
}

export async function setProjectStatus(deps: WorkSheetDeps, input: { userId: string; projectId: string; status: 'active' | 'archived' }) {
  await deps.db.$transaction(async (tx) => {
    await lockProjectForWrite(tx, input.userId, input.projectId)
    await tx.workProject.update({ where: { id: input.projectId }, data: { status: input.status } })
  }, { timeout: TX_TIMEOUT_MS })
}

export async function linkProjectWorkflow(deps: WorkSheetDeps, input: { userId: string; projectId: string; workflowId: string }) {
  await deps.db.$transaction(async (tx) => {
    const p = await lockProjectForWrite(tx, input.userId, input.projectId)
    const wf = await tx.$queryRaw<Array<{ status: string; workflow_json: string | null }>>`
      SELECT w.status, w.workflow_json FROM workflows w JOIN agents a ON a."agentId" = w."agentId"
      WHERE w."workflowId" = ${input.workflowId} AND w.kind = 'main' AND a."userId" = ${input.userId}`
    if (wf.length === 0) throw new WorkError('NOT_FOUND')
    if (wf[0].status === 'archived') throw new WorkError('INVALID', 'an archived workflow cannot be linked')
    if (p.workflowId === input.workflowId) return
    if (p.status !== 'active') throw new WorkError('READ_ONLY')
    const proj = await tx.workProject.findUniqueOrThrow({ where: { id: input.projectId }, select: { kind: true } })
    const appTemplate = appTemplateOf(proj.kind)
    if (appTemplate && !isAppWorkflow(wf[0].workflow_json)) {
      throw new WorkError('INVALID', `a ${appTemplate.kind} project links only a work app workflow (Start / App)`)
    }
    if (p.workflowId && !isProjectDetached(p) && p.workflowId !== input.workflowId) {
      throw new WorkError('INVALID', 'the project is already linked to another workflow')
    }
    try {
      await tx.workProject.update({ where: { id: input.projectId }, data: { workflowId: input.workflowId, workflowLinkedAt: new Date() } })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new WorkError('DUPLICATE', 'workflow already has a project')
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') throw new WorkError('NOT_FOUND')
      throw e
    }
  }, { timeout: TX_TIMEOUT_MS })
}

export async function ensureAppProject(deps: WorkSheetDeps, input: { userId: string; workflowId: string }): Promise<{ id: string; created: boolean }> {
  const found = async () => deps.db.workProject.findFirst({ where: { workflowId: input.workflowId, userId: input.userId }, select: { id: true } })
  const wf = await deps.db.workflow.findFirst({
    where: { workflowId: input.workflowId, kind: 'main', agent: { userId: input.userId } },
    select: { status: true, workflowJson: true, name: true, agentId: true },
  })
  if (!wf) throw new WorkError('NOT_FOUND')
  if (!isAppWorkflow(wf.workflowJson)) throw new WorkError('INVALID', 'not a work app workflow (Start / App)')
  const existing = await found()
  if (existing) return { id: existing.id, created: false }
  if (wf.status === 'archived') throw new WorkError('READ_ONLY')
  const key = await deps.dataKey(deps.db, input.userId)
  try {
    const project = await deps.db.$transaction(async (tx) => {
      const u = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "user" WHERE id = ${input.userId} FOR SHARE`
      if (u.length === 0) throw new WorkError('NOT_FOUND')
      const now = await tx.$queryRaw<Array<{ status: string; workflow_json: string | null; name: string; agentId: string }>>`
        SELECT w.status, w.workflow_json, w.name, w."agentId" FROM workflows w JOIN agents a ON a."agentId" = w."agentId"
        WHERE w."workflowId" = ${input.workflowId} AND w.kind = 'main' AND a."userId" = ${input.userId} FOR SHARE OF w`
      if (now.length === 0) throw new WorkError('NOT_FOUND')
      if (!isAppWorkflow(now[0].workflow_json)) throw new WorkError('INVALID', 'not a work app workflow (Start / App)')
      if (now[0].status === 'archived') throw new WorkError('READ_ONLY')
      return tx.workProject.create({
        data: {
          userId: input.userId,
          kind: 'free',
          modules: [],
          settings: encryptJson({ name: now[0].name || 'Work app' } satisfies ProjectSettings, key),
          agentId: now[0].agentId,
          workflowId: input.workflowId,
          workflowLinkedAt: new Date(),
        },
        select: { id: true },
      })
    }, { timeout: TX_TIMEOUT_MS })
    return { id: project.id, created: true }
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const again = await found()
      if (again) return { id: again.id, created: false }
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') throw new WorkError('NOT_FOUND')
    throw e
  }
}

export async function applyAppTemplate(deps: WorkSheetDeps, input: { userId: string; projectId: string; kind: string; settings?: unknown; modules?: unknown; actor: SheetActor }) {
  if (input.actor.type !== 'human') throw new WorkError('FORBIDDEN', 'only a person applies an app template')
  if (!isAppTemplateKind(input.kind)) throw new WorkError('INVALID', 'kind must be an app template')
  const appTemplate = appTemplateOf(input.kind)!
  const extra = appTemplate.parseSettings(input.settings)
  let modules = [...appTemplate.modules]
  if (input.modules !== undefined) {
    if (!Array.isArray(input.modules) || input.modules.some((m) => typeof m !== 'string' || !appTemplate.modules.includes(m))) throw new WorkError('INVALID', 'modules must be modules of the app template')
    const calcId = appTemplate.calcModule?.id
    modules = appTemplate.modules.filter((m) => m === calcId || (input.modules as string[]).includes(m))
  }
  const sheets = appTemplate.sheets.map((s) => ({ ...s, t: findTemplate(deps.templates, s.template) }))
  validateTemplateRegistry(deps.templates)
  const key = await deps.dataKey(deps.db, input.userId)
  await deps.db.$transaction(async (tx) => {
    const p = await lockProjectForWrite(tx, input.userId, input.projectId)
    assertProjectWritable(p)
    const proj = await tx.workProject.findUniqueOrThrow({ where: { id: input.projectId }, select: { kind: true, settings: true } })
    if (proj.kind !== 'free') throw new WorkError('INVALID', 'the project already uses an app template')
    const [sheetCount, taskCount] = await Promise.all([
      tx.dataSheet.count({ where: { projectId: input.projectId } }),
      tx.workTask.count({ where: { projectId: input.projectId } }),
    ])
    if (sheetCount > 0 || taskCount > 0) throw new WorkError('INVALID', 'an app template applies only to an empty project')
    if (p.workflowId) {
      const wf = await tx.workflow.findUnique({ where: { workflowId: p.workflowId }, select: { workflowJson: true } })
      if (!wf || !isAppWorkflow(wf.workflowJson)) throw new WorkError('INVALID', `a ${appTemplate.kind} project links only a work app workflow (Start / App)`)
    }
    const name = proj.settings ? decryptJson<ProjectSettings>(proj.settings, key).name : ''
    await createTemplateSheets(tx, input.userId, input.projectId, sheets)
    await tx.workProject.update({
      where: { id: input.projectId },
      data: { kind: appTemplate.kind, modules, settings: encryptJson({ ...extra, name } satisfies ProjectSettings, key) },
    })
    await event(tx, key, { userId: input.userId, projectId: input.projectId, actor: input.actor, action: 'template_apply', detail: { kind: appTemplate.kind, modules } })
  }, { timeout: TX_TIMEOUT_MS })
}

export async function deleteProject(
  deps: WorkSheetDeps & { deleteProjectBlobs(regionId: string, userId: string, projectId: string): Promise<void> },
  input: { userId: string; projectId: string },
): Promise<{ blobErrors: number }> {
  const regions = await deps.db.$transaction(async (tx) => {
    await lockProjectForWrite(tx, input.userId, input.projectId)
    if ((await tx.projectReference.count({ where: { toProjectId: input.projectId, userId: input.userId } })) > 0) throw new WorkError('REFERENCED')
    if ((await tx.workTask.count({ where: { projectId: input.projectId, userId: input.userId, status: 'awaiting' } })) > 0) throw new WorkError('AWAITING_APPROVAL')
    const r = await tx.workFile.findMany({ where: { projectId: input.projectId }, distinct: ['blobRegion'], select: { blobRegion: true } })
    await tx.workProject.delete({ where: { id: input.projectId } })
    return r.map((x) => x.blobRegion)
  }, { timeout: TX_TIMEOUT_MS })
  let blobErrors = 0
  for (const region of regions) {
    try {
      await deps.deleteProjectBlobs(region, input.userId, input.projectId)
    } catch (e) {
      blobErrors++
      console.error(`[work] 프로젝트 Blob 삭제 실패 region=${region}:`, describeCaughtError(e))
    }
  }
  return { blobErrors }
}

function toRange(t: { periodStart: Date | null; periodEnd: Date | null }) {
  return t.periodStart && t.periodEnd ? { start: t.periodStart.toISOString().slice(0, 10), end: t.periodEnd.toISOString().slice(0, 10) } : null
}

export async function createTask(deps: WorkSheetDeps, input: { userId: string; projectId: string; title: string; periodStart?: string | null; periodEnd?: string | null; actor?: SheetActor }) {
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  if (!title || title.length > 120) throw new WorkError('INVALID', 'title must be 1–120 characters')
  const s = input.periodStart ?? null
  const e = input.periodEnd ?? null
  if ((s === null) !== (e === null)) throw new WorkError('INVALID', 'a period needs both start and end')
  if (s !== null && (!isCalendarDate(s) || !isCalendarDate(e) || s > e!)) throw new WorkError('INVALID', 'period must be calendar dates with start ≤ end')
  const key = await deps.dataKey(deps.db, input.userId)
  return deps.db.$transaction(async (tx) => {
    const project = await lockProjectForWrite(tx, input.userId, input.projectId)
    assertProjectWritable(project)
    await assertAiMayWrite(tx, project, input.actor ?? { type: 'human' })
    if (s !== null) {
      const mine = { start: s, end: e! }
      const others = await tx.workTask.findMany({ where: { projectId: input.projectId, periodStart: { not: null } }, select: { periodStart: true, periodEnd: true } })
      if (others.some((o) => { const r = toRange(o); return r !== null && rangesOverlap(r, mine) })) throw new WorkError('INVALID', 'the period overlaps another task')
    }
    const task = await tx.workTask.create({
      data: { projectId: input.projectId, userId: input.userId, title, periodStart: s ? new Date(s) : null, periodEnd: e ? new Date(e) : null },
    })
    await event(tx, key, { userId: input.userId, projectId: input.projectId, taskId: task.id, actor: input.actor ?? { type: 'human' }, action: 'task_create', detail: { title, periodStart: s, periodEnd: e } })
    return task
  }, { timeout: TX_TIMEOUT_MS })
}

export async function deleteTask(deps: WorkSheetDeps, input: { userId: string; taskId: string; actor?: SheetActor }) {
  const t = await deps.db.workTask.findFirst({ where: { id: input.taskId, userId: input.userId }, select: { projectId: true, title: true } })
  if (!t) throw new WorkError('NOT_FOUND')
  const key = await deps.dataKey(deps.db, input.userId)
  await deps.db.$transaction(async (tx) => {
    assertProjectWritable(await lockProjectForWrite(tx, input.userId, t.projectId))
    const task = await lockTaskForWrite(tx, input.userId, t.projectId, input.taskId)
    if (task.status !== 'open') throw new WorkError('LOCKED')
    if ((await tx.workSubmissionFile.count({ where: { submission: { taskId: input.taskId } } })) > 0) throw new WorkError('LOCKED')
    if ((await tx.workSubmissionSource.count({ where: { sourceTaskId: input.taskId, userId: input.userId } })) > 0) throw new WorkError('REFERENCED')
    await tx.workTask.delete({ where: { id: input.taskId } })
    await event(tx, key, { userId: input.userId, projectId: t.projectId, taskId: input.taskId, actor: input.actor ?? { type: 'human' }, action: 'task_delete', detail: { title: t.title } })
  }, { timeout: TX_TIMEOUT_MS })
}

export interface SubmissionBody {
  result: unknown
  reads?: { rows: Array<{ id: string; sheetId: string; fp: string }>; pairs: Array<{ id: string; fp: string }>; fx: UsedFx[]; digest: string }
  files: Array<{ fileId: string; sha256: string }>
  references: ReferenceSnapshot[]
  notes?: { task: Array<{ id: string; fp: string }>; project: Array<{ id: string; fp: string }> }
}

async function runAppTemplateCalc(
  tx: Tx,
  deps: WorkSheetDeps,
  key: Buffer,
  a: {
    userId: string
    projectId: string
    taskId: string
    task: { periodStart: Date | null; periodEnd: Date | null }
    proj: { kind: string; modules: string[]; settings: Uint8Array | null }
    computed: Awaited<ReturnType<typeof computeReferenceViews>>
    moduleInput: unknown
  },
  mode: 'submit' | 'preview' = 'submit',
) {
  const appTemplate = appTemplateOf(a.proj.kind)!
  const calc = appTemplate.calcModule!
  if (!a.proj.modules.includes(calc.id)) throw moduleStop('module_disabled', `${calc.id} is not enabled in this project`, { module: calc.id })
  const period = toRange(a.task)
  const snapshot = await loadProjectSnapshot(tx, key, deps.templates, a.userId, a.projectId)
  const ctx = new SubmitReadCtx({
    tx,
    userId: a.userId,
    project: { id: a.projectId, kind: a.proj.kind, settings: a.proj.settings ? decryptJson<ProjectSettings>(a.proj.settings, key) : { name: '' } },
    task: { id: a.taskId, period },
    snapshot,
    module: calc,
    globalFamilies: appTemplate.globalFamilies,
    references: a.computed,
    templates: deps.templates,
  })
  const output = await runWithTimeout(mode === 'preview' && calc.preview ? calc.preview(ctx, a.moduleInput) : calc.run(ctx, a.moduleInput), CALC_TIMEOUT_MS, calc.id)
  const reads = ctx.reads()
  return { output, reads, unconfirmed: findUnconfirmed(snapshot, period, reads), referenceLog: ctx.referenceLog }
}

const MAX_SUBMIT_WARNINGS = 200

async function submitWarnings(tx: Prisma.TransactionClient, deps: WorkSheetDeps, rows: ReadonlyArray<{ id: string; sheetId: string; data: Readonly<Record<string, unknown>> }>) {
  const uniq = [...new Map(rows.map((r) => [r.id, r])).values()]
  const sheetIds = [...new Set(uniq.map((r) => r.sheetId))]
  if (!sheetIds.length) return { list: [], total: 0 }
  const sheets = await tx.dataSheet.findMany({ where: { id: { in: sheetIds } }, select: { id: true, template: true } })
  const tplOf = new Map(sheets.map((sh) => [sh.id, sh.template ? findTemplate(deps.templates, sh.template) : null]))
  const out: Array<{ rowId: string; sheetId: string; code: string; summary: Record<string, unknown> }> = []
  for (const r of uniq) {
    const tpl = tplOf.get(r.sheetId)
    const code = tpl?.submitWarning?.(r.data)
    if (!code) continue
    out.push({ rowId: r.id, sheetId: r.sheetId, code, summary: Object.fromEntries((tpl!.ui?.summary ?? []).map((c) => [c, r.data[c]])) })
  }
  const dateOf = (w: (typeof out)[number]) => String(w.summary.date ?? '')
  return { list: out.sort((a, b) => dateOf(a).localeCompare(dateOf(b))), total: out.length }
}

function warningsDigest(list: ReadonlyArray<{ rowId: string; code: string }>): string | null {
  if (!list.length) return null
  return createHash('sha256').update([...new Set(list.map((w) => `${w.rowId}:${w.code}`))].sort().join('\n')).digest('hex')
}

export async function prepareCalc(deps: WorkSheetDeps, userId: string, taskId: string, projectId: string) {
  const [proj, task] = await Promise.all([
    deps.db.workProject.findFirst({ where: { id: projectId, userId }, select: { kind: true } }),
    deps.db.workTask.findFirst({ where: { id: taskId, userId }, select: { periodStart: true, periodEnd: true } }),
  ])
  const prepare = proj ? appTemplateOf(proj.kind)?.calcModule?.prepare : undefined
  if (!prepare || !task?.periodStart || !task.periodEnd) return
  const day = (d: Date) => d.toISOString().slice(0, 10)
  try {
    await prepare(deps.db, { start: day(task.periodStart), end: day(task.periodEnd) })
  } catch (e) {
    console.warn('[work] calc prepare failed', describeCaughtError(e))
  }
}

export async function previewTask(deps: WorkSheetDeps, input: { userId: string; taskId: string; moduleInput: unknown }) {
  const t = await deps.db.workTask.findFirst({ where: { id: input.taskId, userId: input.userId }, select: { projectId: true } })
  if (!t) throw new WorkError('NOT_FOUND')
  validateTemplateRegistry(deps.templates)
  await prepareCalc(deps, input.userId, input.taskId, t.projectId)
  const key = await deps.dataKey(deps.db, input.userId)
  return deps.db.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`
    const task = await tx.workTask.findUniqueOrThrow({ where: { id: input.taskId }, select: { status: true, periodStart: true, periodEnd: true } })
    const proj = await tx.workProject.findUniqueOrThrow({ where: { id: t.projectId }, select: { kind: true, modules: true, settings: true } })
    if (!appTemplateOf(proj.kind)?.calcModule) throw new WorkError('INVALID', 'this project has no calculation module')
    const references = await tx.projectReference.findMany({ where: { fromProjectId: t.projectId, userId: input.userId }, orderBy: { id: 'asc' } })
    const computed = await computeReferenceViews(tx, key, deps.templates, input.userId, references)
    const run = await runAppTemplateCalc(tx, deps, key, { userId: input.userId, projectId: t.projectId, taskId: input.taskId, task, proj, computed, moduleInput: input.moduleInput }, 'preview')
    const coreUnconfirmed = (run.output as { unconfirmed?: number | null } | null)?.unconfirmed ?? 0
    const readIds = [...new Set(run.reads.rows.map((r) => r.id))]
    const aiConfirmed = readIds.length ? await tx.dataSheetRow.count({ where: { id: { in: readIds }, confirmed: true, confirmedBy: { startsWith: 'ai:' } } }) : 0
    const all = await submitWarnings(tx, deps, run.reads.rows)
    const warnings = all.list.slice(0, MAX_SUBMIT_WARNINGS)
    const warningsTotal = all.total
    return { output: run.output, twoWay: !!appTemplateOf(proj.kind)?.calcModule?.preview, unconfirmedCount: Math.max(run.unconfirmed.length, coreUnconfirmed ?? 0), unconfirmed: run.unconfirmed, aiConfirmed, warnings, warningsTotal, warningsDigest: warningsDigest(all.list), reads: { rows: run.reads.rows.length, pairs: run.reads.pairs.length, fx: run.reads.fx.length } }
  }, { timeout: TX_TIMEOUT_MS, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
}

export interface SealInput {
  result?: unknown
  moduleInput?: unknown
  seenWarningsDigest?: string | null
}

export async function prepareSeal(
  tx: Tx,
  deps: WorkSheetDeps,
  key: Buffer,
  a: { userId: string; projectId: string; taskId: string; references: Awaited<ReturnType<typeof lockForSubmit>>['references']; input: SealInput },
): Promise<{ body: SubmissionBody; snapshots: ReferenceSnapshot[]; digest: string }> {
  const { userId, projectId, taskId, input } = a
  const task = await tx.workTask.findUniqueOrThrow({ where: { id: taskId }, select: { periodStart: true, periodEnd: true } })
  const proposed = await tx.workNote.count({ where: { taskId, projectId, status: 'proposed' } })
  if (proposed > 0) throw new WorkError('UNCONFIRMED', `${proposed} proposed notes`)
  const proj = await tx.workProject.findUniqueOrThrow({ where: { id: projectId }, select: { kind: true, modules: true, settings: true } })
  const appTemplate = appTemplateOf(proj.kind)
  const calc = appTemplate?.calcModule ?? null
  const computed = await computeReferenceViews(tx, key, deps.templates, userId, a.references)

  let result: unknown
  let reads: SubmissionBody['reads']
  let snapshots: ReferenceSnapshot[]
  if (calc) {
    if (input.result !== undefined) throw new WorkError('INVALID', 'a appTemplate project computes its result — pass moduleInput')
    const run = await runAppTemplateCalc(tx, deps, key, { userId, projectId, taskId, task, proj, computed, moduleInput: input.moduleInput })
    if (run.unconfirmed.length > 0) throw new WorkError('UNCONFIRMED', `${run.unconfirmed.length} unconfirmed rows or links`)
    const now = warningsDigest((await submitWarnings(tx, deps, run.reads.rows)).list)
    if (now !== (input.seenWarningsDigest ?? null)) throw new WorkError('STALE', 'submit warnings changed')
    result = { module: moduleLabel(calc), input: input.moduleInput ?? null, output: run.output }
    const rows = run.reads.rows.map((r) => ({ id: r.id, sheetId: r.sheetId, fp: rowFp(key, r) }))
    const pairs = run.reads.pairs.map((p) => ({ id: p.id, fp: pairFp(key, p) }))
    reads = { rows, pairs, fx: run.reads.fx, digest: fingerprint(key, 'reads', { rows, pairs, fx: run.reads.fx }) }
    snapshots = snapshotsFrom(key, computed, run.referenceLog)
  } else {
    if (input.moduleInput !== undefined) throw new WorkError('INVALID', 'this project has no calculation module')
    result = input.result ?? null
    snapshots = snapshotsFrom(key, computed)
  }

  const files = await tx.workTaskFile.findMany({ where: { taskId }, select: { fileId: true, file: { select: { sha256: true } } }, orderBy: { fileId: 'asc' } })
  const body: SubmissionBody = {
    result,
    ...(reads ? { reads } : {}),
    files: files.map((f) => ({ fileId: f.fileId, sha256: f.file.sha256 })),
    references: snapshots,
    notes: await noteDigests(tx, key, { userId, projectId, taskId }),
  }
  return { body, snapshots, digest: fingerprint(key, 'seal', { body, kind: proj.kind, modules: [...proj.modules].sort() }) }
}

export async function commitSeal(
  tx: Tx,
  key: Buffer,
  a: { userId: string; projectId: string; taskId: string; actor: SheetActor; body: SubmissionBody; snapshots: ReferenceSnapshot[]; approval?: { preparedBy: string; approvedBy: string } },
) {
  const { userId, projectId, taskId } = a
  const last = await tx.workSubmission.findFirst({ where: { taskId }, orderBy: { number: 'desc' }, select: { number: true } })
  const sub = await tx.workSubmission.create({
    data: {
      taskId, projectId, userId, number: (last?.number ?? 0) + 1, result: encryptJson(a.body, key),
      ...(a.approval ? { preparedBy: a.approval.preparedBy, approvedBy: a.approval.approvedBy } : {}),
    },
  })
  const sources = a.snapshots.flatMap((sn) => sn.tasks.map((x) => ({ sourceProjectId: sn.sourceProjectId, sourceTaskId: x.id })))
  if (sources.length) {
    await tx.workSubmissionSource.createMany({
      data: sources.map((x) => ({ submissionId: sub.id, projectId, userId, ...x })),
      skipDuplicates: true,
    })
  }
  await tx.workTask.update({ where: { id: taskId }, data: { status: 'submitted', submittedAt: sub.submittedAt, currentSubmissionId: sub.id, approvalRequest: null } })
  await event(tx, key, {
    userId, projectId, taskId, submissionId: sub.id, actor: a.actor,
    action: a.approval ? 'approval_approve' : 'task_submit',
    detail: a.approval ? { number: sub.number, preparedBy: a.approval.preparedBy } : { number: sub.number },
  })
  return sub
}

export async function submitTask(deps: WorkSheetDeps, input: { userId: string; taskId: string; actor: SheetActor } & SealInput) {
  if (input.actor.type !== 'human') throw new WorkError('FORBIDDEN', 'only a person can submit')
  const t = await deps.db.workTask.findFirst({ where: { id: input.taskId, userId: input.userId }, select: { projectId: true } })
  if (!t) throw new WorkError('NOT_FOUND')
  validateTemplateRegistry(deps.templates)
  await prepareCalc(deps, input.userId, input.taskId, t.projectId)
  const key = await deps.dataKey(deps.db, input.userId)
  return deps.db.$transaction(async (tx) => {
    const { project, references } = await lockForSubmit(tx, input.userId, t.projectId)
    assertProjectWritable(project)
    const task = await lockTaskForWrite(tx, input.userId, t.projectId, input.taskId)
    if (task.status !== 'open') throw new WorkError('LOCKED')
    if (await approvalApplies(tx, t.projectId)) throw new WorkError('APPROVAL_REQUIRED', 'this work app requires approval — request it instead')
    const { body, snapshots } = await prepareSeal(tx, deps, key, { userId: input.userId, projectId: t.projectId, taskId: input.taskId, references, input })
    return commitSeal(tx, key, { userId: input.userId, projectId: t.projectId, taskId: input.taskId, actor: input.actor, body, snapshots })
  }, { timeout: TX_TIMEOUT_MS })
}

export async function unlockTask(deps: WorkSheetDeps, input: { userId: string; taskId: string; actor: SheetActor; reason?: string }) {
  if (input.actor.type !== 'human') throw new WorkError('FORBIDDEN', 'only a person can unlock')
  const t = await deps.db.workTask.findFirst({ where: { id: input.taskId, userId: input.userId }, select: { projectId: true } })
  if (!t) throw new WorkError('NOT_FOUND')
  const key = await deps.dataKey(deps.db, input.userId)
  await deps.db.$transaction(async (tx) => {
    assertProjectWritable(await lockProjectForWrite(tx, input.userId, t.projectId))
    const task = await lockTaskForWrite(tx, input.userId, t.projectId, input.taskId)
    if (task.status !== 'submitted') throw new WorkError('INVALID', 'the task is not submitted')
    const cur = await tx.workTask.findUniqueOrThrow({ where: { id: input.taskId }, select: { currentSubmissionId: true } })
    const seal = cur.currentSubmissionId ? await tx.workSubmission.findUnique({ where: { id: cur.currentSubmissionId }, select: { preparedBy: true, approvedBy: true } }) : null
    await assertMayUnlockSeal(tx, t.projectId, input.actor, seal)
    await tx.workTask.update({ where: { id: input.taskId }, data: { status: 'open' } })
    await event(tx, key, { userId: input.userId, projectId: t.projectId, taskId: input.taskId, actor: input.actor, action: 'task_unlock', detail: { reason: input.reason ?? null } })
  }, { timeout: TX_TIMEOUT_MS })
}

export async function readSubmission(deps: WorkSheetDeps, userId: string, submissionId: string) {
  const s = await deps.db.workSubmission.findFirst({ where: { id: submissionId, userId } })
  if (!s) throw new WorkError('NOT_FOUND')
  const body = decryptJson<Partial<SubmissionBody> & Pick<SubmissionBody, 'result' | 'files'>>(s.result, await deps.dataKey(deps.db, userId))
  return { number: s.number, submittedAt: s.submittedAt, taskId: s.taskId, ...body, references: body.references ?? [] }
}

export async function listSubmissions(deps: WorkSheetDeps, q: { userId: string; taskId: string }) {
  const subs = await deps.db.workSubmission.findMany({
    where: { taskId: q.taskId, userId: q.userId },
    select: { id: true, number: true, submittedAt: true, proofs: { select: { fileId: true, file: { select: { payload: true } } }, orderBy: { attachedAt: 'asc' } } },
    orderBy: { number: 'desc' },
  })
  const key = subs.some((s) => s.proofs.length) ? await deps.dataKey(deps.db, q.userId) : null
  return subs.map((s) => ({
    id: s.id, number: s.number, submittedAt: s.submittedAt,
    proofs: s.proofs.map((p) => ({ fileId: p.fileId, name: decryptJson<{ originalName: string }>(p.file.payload, key!).originalName })),
  }))
}
