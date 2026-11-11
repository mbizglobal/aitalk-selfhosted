
import { Prisma, type PrismaClient } from '@prisma/client'
import { createHash } from 'node:crypto'
import { WorkError } from './errors'
import { decryptJson, encryptJson } from './sealed'
import { appTemplateOf, type AppTemplate } from './app-templates'
import { periodContaining } from './dates'
import { createTaskLocked, readProjectSettingsTx, writeWorkEvent } from './projects'
import { isProjectDetached, lockProjectForWrite, openProjectSheetWriter, type WorkSheetDeps } from './sheet-gate'
import { writeInboxSignal } from './signals'
import { APP_WORKFLOW_KIND, handoffRoutesOf } from './app-canvas'
import { acceptsHandoff, HANDOFF_FAMILY, handoffFieldsProblem, hasPeriodRule, senderPeriodsWithin } from './handoff-core'

type Tx = Prisma.TransactionClient
const TX_TIMEOUT_MS = 30_000

export interface HandoffDeps extends WorkSheetDeps {
  appTemplates?: readonly AppTemplate[]
}

export const routeKeyOf = (fromWorkflowId: string, toWorkflowId: string) => `${fromWorkflowId}>${toWorkflowId}`
export const graphDigestOf = (workflowJson: string) => createHash('sha256').update(workflowJson).digest('hex')

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)
const tplOf = (deps: HandoffDeps, kind: string): AppTemplate | null => {
  try { return appTemplateOf(kind, deps.appTemplates) } catch { return null }
}

export interface HandoffHeader {
  fromApp: string
  company: string | null
  title: string
  periodStart: string | null
  periodEnd: string | null
  submission: number
  sealedAt: string
}

async function handoffPayload(tx: Tx | PrismaClient, deps: HandoffDeps, key: Buffer, a: { userId: string; fromWorkflowId: string; projectId: string; kind: string; task: { id: string; title: string; periodStart: Date | null; periodEnd: Date | null }; submission: { result: Uint8Array; number: number; submittedAt: Date } }): Promise<{ header: HandoffHeader; fields: Record<string, string | number> }> {
  const wf = await tx.workflow.findUnique({ where: { workflowId: a.fromWorkflowId }, select: { name: true } })
  const settings = await readProjectSettingsTx(tx, key, a.userId, a.projectId)
  const header: HandoffHeader = {
    fromApp: (wf?.name ?? 'Work app').slice(0, 200), company: typeof settings.name === 'string' && settings.name ? settings.name.slice(0, 200) : null,
    title: a.task.title, periodStart: day(a.task.periodStart), periodEnd: day(a.task.periodEnd), submission: a.submission.number, sealedAt: a.submission.submittedAt.toISOString(),
  }
  const tpl = tplOf(deps, a.kind)
  if (!tpl?.handoff) return { header, fields: {} }
  const body = decryptJson<{ result?: unknown }>(a.submission.result, key)
  const r = body.result as { module?: unknown; output?: unknown } | null | undefined
  const output = r && typeof r === 'object' && 'module' in r && 'output' in r ? r.output : body.result
  let fields: unknown
  try { fields = tpl.handoff.export(output) } catch (e) { throw new WorkError('INVALID', `the app template handoff export failed: ${e instanceof Error ? e.message.slice(0, 200) : 'error'}`) }
  const bad = handoffFieldsProblem(fields)
  if (bad) throw new WorkError('INVALID', `the app template handoff export: ${bad}`)
  return { header, fields: fields as Record<string, string | number> }
}

async function sealedSubmission(tx: Tx | PrismaClient, userId: string, taskId: string, submissionNumber: number) {
  const t = await tx.workTask.findFirst({ where: { id: taskId, userId }, select: { id: true, projectId: true, title: true, status: true, periodStart: true, periodEnd: true, currentSubmissionId: true } })
  if (!t || t.status !== 'submitted' || !t.currentSubmissionId) return null
  const sub = await tx.workSubmission.findUnique({ where: { id: t.currentSubmissionId }, select: { number: true, result: true, submittedAt: true } })
  if (!sub || sub.number !== submissionNumber) return null
  return { task: t, submission: sub }
}

export async function handoffContextFor(deps: HandoffDeps, a: { userId: string; fromWorkflowId: string; taskId: string; submissionNumber: number }): Promise<{ from: HandoffHeader; fields: Record<string, string | number> } | null> {
  const s = await sealedSubmission(deps.db, a.userId, a.taskId, a.submissionNumber)
  if (!s) return null
  const p = await deps.db.workProject.findFirst({ where: { id: s.task.projectId, userId: a.userId }, select: { kind: true } })
  if (!p) return null
  const key = await deps.dataKey(deps.db, a.userId)
  const { header, fields } = await handoffPayload(deps.db, deps, key, { userId: a.userId, fromWorkflowId: a.fromWorkflowId, projectId: s.task.projectId, kind: p.kind, task: s.task, submission: s.submission })
  return { from: header, fields }
}

export async function sourceStillSealed(db: Tx | PrismaClient, userId: string, taskId: string, submissionNumber: number): Promise<boolean> {
  return (await sealedSubmission(db, userId, taskId, submissionNumber)) !== null
}

export interface ArrivalInput {
  userId: string
  canvasWorkflowId: string
  canvasVersion: number
  canvasJson: string
  fromWorkflowId: string
  toWorkflowId: string
  toNodeId: string
  fromTaskId: string
  submissionNumber: number
  mode: 'delivered' | 'skipped'
  flowRunId?: string | null
  skipUnlessGather?: boolean
}

export type ArrivalResult =
  | { ok: true; wrote: 'new' | 'upgraded' | 'superseded' | 'none'; inList: boolean; gather: boolean; openedTaskId?: string | null }
  | { ok: false; code: 'SOURCE_CHANGED' | 'RECEIVER_GONE' }

class SourceChanged extends Error {}

async function hiddenAppsOf(tx: Tx, canvasWorkflowId: string): Promise<Map<string, string>> {
  const rows = await tx.workflow.findMany({ where: { parentWorkflowId: canvasWorkflowId, kind: APP_WORKFLOW_KIND }, select: { workflowId: true, parentNodeId: true } })
  return new Map(rows.filter((r) => r.parentNodeId).map((r) => [r.parentNodeId as string, r.workflowId]))
}

async function expectedSlots(tx: Tx, deps: HandoffDeps, a: { userId: string; canvasWorkflowId: string; canvasJson: string; toNodeId: string; recv: { start: string; end: string } }): Promise<Array<{ from: string; start: string; end: string }>> {
  const hidden = await hiddenAppsOf(tx, a.canvasWorkflowId)
  const out: Array<{ from: string; start: string; end: string }> = []
  for (const r of handoffRoutesOf(a.canvasJson).routes) {
    if (r.toNodeId !== a.toNodeId) continue
    const from = hidden.get(r.fromNodeId)
    if (!from) continue
    const p = await tx.workProject.findFirst({ where: { workflowId: from, userId: a.userId }, select: { kind: true } })
    const rule = p ? tplOf(deps, p.kind)?.ui.period : null
    if (!hasPeriodRule(rule)) continue
    for (const x of senderPeriodsWithin(periodContaining, rule, a.recv)) out.push({ from, start: x.start, end: x.end })
  }
  return out
}

async function handoffSheetOf(tx: Tx | PrismaClient, userId: string, projectId: string) {
  return tx.dataSheet.findFirst({ where: { kind: 'project', projectId, userId, templateFamily: HANDOFF_FAMILY }, select: { id: true, name: true }, orderBy: { id: 'asc' } })
}

export async function ensurePeriodTaskLocked(tx: Tx, key: Buffer, a: { userId: string; projectId: string; title: string; start: string; end: string; canvasWorkflowId: string }): Promise<{ id: string; created: boolean } | null> {
  const cur = await tx.workTask.findFirst({ where: { projectId: a.projectId, userId: a.userId, periodStart: new Date(a.start), periodEnd: new Date(a.end) }, select: { id: true } })
  if (cur) return { id: cur.id, created: false }
  try {
    const t = await createTaskLocked(tx, key, { userId: a.userId, projectId: a.projectId, title: a.title, periodStart: a.start, periodEnd: a.end, actor: { type: 'handoff', workflowId: a.canvasWorkflowId } })
    return { id: t.id, created: true }
  } catch (e) {
    if (e instanceof WorkError && e.code === 'INVALID') return null
    throw e
  }
}

async function handoffNote(tx: Tx, key: Buffer, a: { userId: string; projectId: string; taskId: string | null; kind: 'source' | 'todo'; text: string; canvasWorkflowId: string }) {
  const body = a.kind === 'todo' ? { text: a.text, done: false } : { text: a.text }
  const r = await tx.workNote.create({ data: { projectId: a.projectId, userId: a.userId, taskId: a.taskId, kind: a.kind, body: encryptJson(body, key) } })
  await writeWorkEvent(tx, key, { userId: a.userId, projectId: a.projectId, taskId: a.taskId ?? undefined, noteId: r.id, actor: { type: 'handoff', workflowId: a.canvasWorkflowId }, action: 'note_create', detail: { after: { kind: a.kind, ...body } } })
}

async function retireRowLocked(tx: Tx, deps: HandoffDeps, key: Buffer, a: { userId: string; projectId: string; sheetId: string; rowId: string; canvasWorkflowId: string; open: boolean; writer?: () => Promise<Awaited<ReturnType<typeof openProjectSheetWriter>>> }) {
  const row = await tx.dataSheetRow.findFirst({ where: { id: a.rowId, sheetId: a.sheetId, projectId: a.projectId, userId: a.userId }, select: { id: true, rowData: true } })
  if (!row) return
  const data = JSON.parse(row.rowData) as Record<string, unknown>
  if (data.current === false) return
  if (a.open) {
    const w = a.writer ? await a.writer() : await openProjectSheetWriter(tx, deps, key, { userId: a.userId, projectId: a.projectId, sheetIds: [a.sheetId], actor: { type: 'handoff', workflowId: a.canvasWorkflowId } })
    await w.update(a.sheetId, a.rowId, { current: false })
    return
  }
  const next = JSON.stringify({ ...data, current: false })
  await tx.dataSheetRow.update({ where: { id: row.id }, data: { rowData: next, fVer: 0 } })
  await tx.dataSheet.update({ where: { id: a.sheetId }, data: { sizeBytes: { increment: BigInt(Buffer.byteLength(next, 'utf8') - Buffer.byteLength(row.rowData, 'utf8')) } } })
  await tx.workEvent.create({ data: { userId: a.userId, projectId: a.projectId, sheetId: a.sheetId, rowId: row.id, actor: `handoff:${a.canvasWorkflowId}`, action: 'update', payload: encryptJson({ before: { current: data.current ?? null }, after: { current: false }, closedApp: true }, key) } })
}

async function gatherLocked(tx: Tx, key: Buffer, a: { userId: string; projectId: string; period: { id: string; expected: Array<{ from: string; start: string; end: string }>; start: string; end: string; title: string }; canvasWorkflowId: string; quiet?: boolean }): Promise<{ id: string | null; created: boolean } | null> {
  const p = a.period
  const rows = await tx.workHandoff.findMany({ where: { periodId: p.id, status: { in: ['delivered', 'skipped'] } }, select: { fromWorkflowId: true, fromPeriodStart: true, fromPeriodEnd: true } })
  const all = p.expected.length > 0 && p.expected.every((x) => rows.some((r) => r.fromWorkflowId === x.from && r.fromPeriodStart === x.start && r.fromPeriodEnd === x.end))
  if (!all) return null
  const got = await ensurePeriodTaskLocked(tx, key, { userId: a.userId, projectId: a.projectId, title: p.title, start: p.start, end: p.end, canvasWorkflowId: a.canvasWorkflowId })
  await tx.workHandoffPeriod.update({ where: { id: p.id }, data: got ? { status: 'opened', openedTaskId: got.id } : { status: 'manual', openedTaskId: null } })
  if (!got && !a.quiet) await handoffNote(tx, key, { userId: a.userId, projectId: a.projectId, taskId: null, kind: 'todo', text: `All handoffs for ${p.title} arrived, but the task could not be opened — its period overlaps another task. Open it yourself.`, canvasWorkflowId: a.canvasWorkflowId })
  return { id: got?.id ?? null, created: !!got?.created }
}

export async function recordArrival(deps: HandoffDeps, a: ArrivalInput): Promise<ArrivalResult> {
  const key = await deps.dataKey(deps.db, a.userId)
  const srcTask = await deps.db.workTask.findFirst({ where: { id: a.fromTaskId, userId: a.userId }, select: { projectId: true } })
  if (!srcTask) return { ok: false, code: 'SOURCE_CHANGED' }
  const recv = await deps.db.workProject.findFirst({ where: { workflowId: a.toWorkflowId, userId: a.userId }, select: { id: true } })
  if (!recv) return { ok: false, code: 'RECEIVER_GONE' }
  if (recv.id === srcTask.projectId) throw new WorkError('INVALID', 'a work app cannot hand off to itself')
  try {
    return await deps.db.$transaction(async (tx) => {
      let recvLocked: Awaited<ReturnType<typeof lockProjectForWrite>> | null = null
      let srcWorkflow: string | null = null
      for (const id of [srcTask.projectId, recv.id].sort()) {
        if (id === recv.id) {
          try { recvLocked = await lockProjectForWrite(tx, a.userId, id) } catch (e) {
            if (e instanceof WorkError && e.code === 'NOT_FOUND') return { ok: false as const, code: 'RECEIVER_GONE' as const }
            throw e
          }
        } else {
          const r = await tx.$queryRaw<Array<{ workflow_id: string | null }>>`SELECT workflow_id FROM work_project WHERE id = ${id} AND user_id = ${a.userId} FOR SHARE`
          if (!r.length) throw new SourceChanged()
          srcWorkflow = r[0].workflow_id
        }
      }
      const s = await sealedSubmission(tx, a.userId, a.fromTaskId, a.submissionNumber)
      if (!s || s.task.projectId !== srcTask.projectId || srcWorkflow !== a.fromWorkflowId) throw new SourceChanged()
      const srcProject = await tx.workProject.findUniqueOrThrow({ where: { id: srcTask.projectId }, select: { kind: true } })
      const rl = recvLocked!
      if (rl.workflowId !== a.toWorkflowId) throw new WorkError('UNAVAILABLE', 'the receiving work app is not open')
      const recvOpen = rl.status === 'active' && !isProjectDetached(rl) && !rl.appClosed
      if (!recvOpen && a.mode === 'delivered') throw new WorkError('UNAVAILABLE', 'the receiving work app is not open')
      const recvProject = await tx.workProject.findUniqueOrThrow({ where: { id: recv.id }, select: { kind: true } })
      const recvTpl = tplOf(deps, recvProject.kind)
      const sheet = await handoffSheetOf(tx, a.userId, recv.id)
      if (!acceptsHandoff(recvTpl) || (!sheet && a.mode === 'delivered')) throw new WorkError('UNAVAILABLE', 'HANDOFF_TARGET_INVALID — the receiving work app does not take handoffs — apply an app template that has the handoff sheet')
      const srcRule = tplOf(deps, srcProject.kind)?.ui.period
      const recvRule = recvTpl!.ui.period
      const fromStart = day(s.task.periodStart)
      const fromEnd = day(s.task.periodEnd)
      const gather = hasPeriodRule(srcRule) && hasPeriodRule(recvRule) && !!fromEnd
      if (a.mode === 'skipped' && a.skipUnlessGather && !gather) return { ok: true as const, wrote: 'none' as const, inList: true, gather: false }
      const routeKey = routeKeyOf(a.fromWorkflowId, a.toWorkflowId)
      const handoffActor = { type: 'handoff' as const, workflowId: a.canvasWorkflowId }
      let writer: Awaited<ReturnType<typeof openProjectSheetWriter>> | null = null
      const w = async () => (writer ??= await openProjectSheetWriter(tx, deps, key, { userId: a.userId, projectId: recv.id, sheetIds: [sheet!.id], actor: handoffActor }))
      const retire = async (rowId: string | null) => {
        if (!rowId || !sheet) return
        await retireRowLocked(tx, deps, key, { userId: a.userId, projectId: recv.id, sheetId: sheet.id, rowId, canvasWorkflowId: a.canvasWorkflowId, open: recvOpen, writer: w })
      }
      const insertRow = async (inList: boolean): Promise<string> => {
        const { header, fields } = await handoffPayload(tx, deps, key, { userId: a.userId, fromWorkflowId: a.fromWorkflowId, projectId: srcTask.projectId, kind: srcProject.kind, task: s.task, submission: s.submission })
        const r = await (await w()).insert(sheet!.id, {
          fromApp: header.fromApp, ...(header.company ? { company: header.company } : {}), title: header.title,
          ...(header.periodStart ? { periodStart: header.periodStart, periodEnd: header.periodEnd } : {}),
          submission: header.submission, sealedAt: header.sealedAt, fields, current: true, ...(inList ? {} : { memo: 'outside the waiting list' }),
        })
        await writeInboxSignal(tx, key, { userId: a.userId, projectId: recv.id, title: sheet!.name, rowId: r.id, family: HANDOFF_FAMILY, fromWorkflowId: a.fromWorkflowId })
        return r.id
      }

      let period: { id: string; status: string; expected: Array<{ from: string; start: string; end: string }>; start: string; end: string; title: string } | null = null
      if (gather) {
        const rp = periodContaining(recvRule, fromEnd!)!
        let row = await tx.workHandoffPeriod.findUnique({ where: { toProjectId_periodStart_periodEnd: { toProjectId: recv.id, periodStart: rp.periodStart, periodEnd: rp.periodEnd } } })
        if (!row) {
          const expected = await expectedSlots(tx, deps, { userId: a.userId, canvasWorkflowId: a.canvasWorkflowId, canvasJson: a.canvasJson, toNodeId: a.toNodeId, recv: { start: rp.periodStart, end: rp.periodEnd } })
          row = await tx.workHandoffPeriod.create({
            data: { userId: a.userId, toProjectId: recv.id, toWorkflowId: a.toWorkflowId, periodStart: rp.periodStart, periodEnd: rp.periodEnd, expected, canvasWorkflowId: a.canvasWorkflowId, canvasVersion: a.canvasVersion, graphDigest: graphDigestOf(a.canvasJson) },
          })
        }
        period = { id: row.id, status: row.status, expected: row.expected as Array<{ from: string; start: string; end: string }>, start: rp.periodStart, end: rp.periodEnd, title: rp.title }
      }
      const inList = !period || period.expected.some((x) => x.from === a.fromWorkflowId && x.start === fromStart && x.end === fromEnd)

      const withdrawRow = async (r: { id: string; inboxRowId: string | null }) => {
        await retire(r.inboxRowId)
        await tx.workHandoff.update({ where: { id: r.id }, data: { status: 'withdrawn' } })
      }
      let active = period
        ? await tx.workHandoff.findFirst({ where: { routeKey, periodId: period.id, fromPeriodStart: fromStart, status: { not: 'withdrawn' } } })
        : await tx.workHandoff.findFirst({ where: { routeKey, periodId: null, fromTaskId: a.fromTaskId, status: { not: 'withdrawn' } } })
      if (period && active && active.fromTaskId !== a.fromTaskId) {
        if (await tx.workTask.findUnique({ where: { id: active.fromTaskId }, select: { id: true } })) throw new WorkError('INVALID', 'another task of the same period is still handed off')
        await withdrawRow(active)
        active = null
      }
      if (!period && fromStart) {
        const others = await tx.workHandoff.findMany({ where: { routeKey, periodId: null, fromPeriodStart: fromStart, fromTaskId: { not: a.fromTaskId }, status: { not: 'withdrawn' } } })
        for (const o of others) await withdrawRow(o)
      }
      let wrote: 'new' | 'upgraded' | 'superseded' | 'none' = 'none'
      const base = { flowRunId: a.flowRunId ?? null, inList, canvasWorkflowId: a.canvasWorkflowId }
      if (!active) {
        const rowId = a.mode === 'delivered' ? await insertRow(inList) : null
        await tx.workHandoff.create({
          data: {
            userId: a.userId, toProjectId: recv.id, toWorkflowId: a.toWorkflowId, fromWorkflowId: a.fromWorkflowId, routeKey, periodId: period?.id ?? null,
            fromProjectId: srcTask.projectId, fromTaskId: a.fromTaskId, fromPeriodStart: fromStart, fromPeriodEnd: fromEnd, submissionNumber: a.submissionNumber,
            status: a.mode, inboxRowId: rowId, ...base,
          },
        })
        wrote = 'new'
      } else if (a.submissionNumber === active.submissionNumber) {
        if (active.status === 'skipped' && a.mode === 'delivered') {
          const rowId = await insertRow(inList)
          await tx.workHandoff.update({ where: { id: active.id }, data: { status: 'delivered', inboxRowId: rowId, ...base } })
          wrote = 'upgraded'
        }
      } else if (a.submissionNumber > active.submissionNumber) {
        await retire(active.inboxRowId)
        const rowId = a.mode === 'delivered' ? await insertRow(inList) : null
        await tx.workHandoff.update({ where: { id: active.id }, data: { status: a.mode, submissionNumber: a.submissionNumber, inboxRowId: rowId, fromPeriodEnd: fromEnd, ...base } })
        wrote = 'superseded'
      }

      let openedTaskId: string | null | undefined
      let createdNow = false
      if (period && period.status === 'waiting' && recvOpen) {
        const got = await gatherLocked(tx, key, { userId: a.userId, projectId: recv.id, period, canvasWorkflowId: a.canvasWorkflowId })
        if (got) { openedTaskId = got.id; createdNow = got.created }
      }
      if (period && wrote !== 'none' && !createdNow && recvOpen) {
        const t = await tx.workTask.findFirst({ where: { projectId: recv.id, userId: a.userId, periodStart: new Date(period.start), periodEnd: new Date(period.end) }, select: { id: true, status: true } })
        const what = `${s.task.title} · version ${a.submissionNumber}${a.mode === 'skipped' ? ' (skipped by the flow)' : ''}`
        const from = (await tx.workflow.findUnique({ where: { workflowId: a.fromWorkflowId }, select: { name: true } }))?.name ?? 'Work app'
        if (t?.status === 'open') await handoffNote(tx, key, { userId: a.userId, projectId: recv.id, taskId: t.id, kind: 'source', text: `New handoff arrived from ${from}: ${what}.`, canvasWorkflowId: a.canvasWorkflowId })
        else if (t) await handoffNote(tx, key, { userId: a.userId, projectId: recv.id, taskId: null, kind: 'todo', text: `A new version arrived after ${period.title} was closed — from ${from}: ${what}. Decide whether to unlock ${period.title}.`, canvasWorkflowId: a.canvasWorkflowId })
      }
      return { ok: true as const, wrote, inList, gather: !!period, ...(openedTaskId !== undefined ? { openedTaskId } : {}) }
    }, { timeout: TX_TIMEOUT_MS })
  } catch (e) {
    if (e instanceof SourceChanged) return { ok: false, code: 'SOURCE_CHANGED' }
    throw e
  }
}

export async function withdrawHandoffs(deps: HandoffDeps, a: { userId: string; taskId?: string; projectId?: string }): Promise<number> {
  const where = { userId: a.userId, status: { not: 'withdrawn' }, ...(a.taskId ? { fromTaskId: a.taskId } : { fromProjectId: a.projectId! }) }
  const receivers = [...new Set((await deps.db.workHandoff.findMany({ where, select: { toProjectId: true } })).map((r) => r.toProjectId))]
  if (!receivers.length) return 0
  const key = await deps.dataKey(deps.db, a.userId)
  let n = 0
  for (const toProjectId of receivers) {
    n += await deps.db.$transaction(async (tx) => {
      let locked
      try { locked = await lockProjectForWrite(tx, a.userId, toProjectId) } catch (e) {
        if (e instanceof WorkError && e.code === 'NOT_FOUND') return 0
        throw e
      }
      const gone = a.taskId
        ? !(await tx.workTask.findUnique({ where: { id: a.taskId }, select: { id: true } }))
        : !(await tx.workProject.findUnique({ where: { id: a.projectId! }, select: { id: true } }))
      if (!gone) return 0
      const rows = await tx.workHandoff.findMany({ where: { ...where, toProjectId } })
      const writable = locked.status === 'active' && !isProjectDetached(locked) && !locked.appClosed
      const sheet = await handoffSheetOf(tx, a.userId, toProjectId)
      for (const r of rows) {
        if (sheet && r.inboxRowId) {
          await retireRowLocked(tx, deps, key, { userId: a.userId, projectId: toProjectId, sheetId: sheet.id, rowId: r.inboxRowId, canvasWorkflowId: r.canvasWorkflowId, open: writable })
        }
        await tx.workHandoff.update({ where: { id: r.id }, data: { status: 'withdrawn' } })
      }
      return rows.length
    }, { timeout: TX_TIMEOUT_MS })
  }
  return n
}

export async function sweepOrphanHandoffs(deps: HandoffDeps, onlyUserId?: string): Promise<number> {
  const rows = onlyUserId
    ? await deps.db.$queryRaw<Array<{ user_id: string; from_task_id: string }>>`
        SELECT DISTINCT h.user_id, h.from_task_id FROM work_handoff h LEFT JOIN work_task t ON t.id = h.from_task_id
        WHERE h.status <> 'withdrawn' AND t.id IS NULL AND h.user_id = ${onlyUserId} LIMIT 20`
    : await deps.db.$queryRaw<Array<{ user_id: string; from_task_id: string }>>`
        SELECT DISTINCT h.user_id, h.from_task_id FROM work_handoff h LEFT JOIN work_task t ON t.id = h.from_task_id
        WHERE h.status <> 'withdrawn' AND t.id IS NULL LIMIT 20`
  let n = 0
  for (const r of rows) {
    try { n += await withdrawHandoffs(deps, { userId: r.user_id, taskId: r.from_task_id }) } catch (e) {
      console.error('[handoff] 주기 철회 실패 — 다음 주기에 다시:', e instanceof Error ? e.message.slice(0, 200) : 'error')
    }
  }
  return n
}

export async function processDeletionSignals(deps: HandoffDeps, onlyUserId?: string): Promise<number> {
  const sigs = await deps.db.workSignal.findMany({
    where: { processedAt: null, kind: { in: ['task_deleted', 'project_deleted'] }, ...(onlyUserId ? { userId: onlyUserId } : {}) },
    orderBy: { createdAt: 'asc' }, take: 20, select: { id: true, userId: true, projectId: true, taskId: true, kind: true },
  })
  let n = 0
  for (const s of sigs) {
    try {
      await withdrawHandoffs(deps, s.kind === 'task_deleted' ? { userId: s.userId, taskId: s.taskId! } : { userId: s.userId, projectId: s.projectId })
      await deps.db.workSignal.updateMany({ where: { id: s.id, processedAt: null }, data: { processedAt: new Date() } })
      n++
    } catch (e) {
      console.error(`[handoff] 철회 실패 — 다음 주기에 다시 (${s.id}):`, e instanceof Error ? e.message.slice(0, 200) : 'error')
    }
  }
  return n
}

export async function handoffTargetProblems(tx: Tx, userId: string, workflowJson: unknown, parentWorkflowId: string, appTemplates?: readonly AppTemplate[]): Promise<Array<{ nodeId: string; reason: string }>> {
  const routes = handoffRoutesOf(workflowJson).routes
  if (!routes.length) return []
  const hidden = await hiddenAppsOf(tx, parentWorkflowId)
  const out: Array<{ nodeId: string; reason: string }> = []
  for (const toNodeId of [...new Set(routes.map((r) => r.toNodeId))]) {
    const p = await receiverProblem(tx, userId, hidden.get(toNodeId), appTemplates)
    if (p) out.push({ nodeId: toNodeId, reason: p.reason })
  }
  return out
}

export type ReceiverProblemCode = 'not_set_up' | 'no_template' | 'no_handoff' | 'no_sheet'

export async function receiverProblem(tx: Tx | PrismaClient, userId: string, hiddenWorkflowId: string | undefined, appTemplates?: readonly AppTemplate[]): Promise<{ code: ReceiverProblemCode; reason: string } | null> {
  const p = hiddenWorkflowId ? await tx.workProject.findFirst({ where: { workflowId: hiddenWorkflowId, userId }, select: { id: true, kind: true } }) : null
  if (!p) return { code: 'not_set_up', reason: 'the receiving work app is not set up yet — deploy it once, apply an app template that takes handoffs, then draw the line' }
  if (p.kind === 'free') return { code: 'no_template', reason: 'apply an app template to the receiving work app first' }
  let tpl: AppTemplate | null = null
  try { tpl = appTemplateOf(p.kind, appTemplates) } catch { tpl = null }
  if (!acceptsHandoff(tpl)) return { code: 'no_handoff', reason: `the app template "${p.kind}" does not take handoffs` }
  if (!(await handoffSheetOf(tx, userId, p.id))) return { code: 'no_sheet', reason: 'the receiving work app has no handoff sheet — apply its app template again' }
  return null
}

export interface HandoffPanelView {
  routes: Array<{ fromNodeId: string; fromName: string }>
  periods: Array<{
    start: string; end: string; status: string; openedTaskId: string | null
    slots: Array<{ fromName: string; start: string; end: string; state: 'waiting' | 'delivered' | 'skipped'; submission: number | null; rowRemoved: boolean }>
    outsideList: number
  }>
  stuck: number
  passes: Array<{ fromName: string; start: string | null; end: string | null; state: string; submission: number; rowRemoved: boolean }>
}

export async function handoffPanel(db: PrismaClient, q: { userId: string; canvasWorkflowId: string; toNodeId: string }): Promise<HandoffPanelView | null> {
  const canvas = await db.workflow.findFirst({ where: { workflowId: q.canvasWorkflowId, kind: 'main', agent: { userId: q.userId } }, select: { workflowJson: true } })
  if (!canvas) return null
  const nodes = (() => { try { return (JSON.parse(canvas.workflowJson) as { nodes?: Array<{ id?: unknown; data?: { label?: unknown } }> }).nodes ?? [] } catch { return [] } })()
  const labelOf = (id: string) => { const n = nodes.find((x) => x.id === id); return typeof n?.data?.label === 'string' && n.data.label ? n.data.label : 'Work app' }
  const routes = handoffRoutesOf(canvas.workflowJson).routes.filter((r) => r.toNodeId === q.toNodeId).map((r) => ({ fromNodeId: r.fromNodeId, fromName: labelOf(r.fromNodeId) }))
  const apps = await db.workflow.findMany({ where: { parentWorkflowId: q.canvasWorkflowId, kind: APP_WORKFLOW_KIND }, select: { workflowId: true, parentNodeId: true, name: true } })
  const nameOf = (wf: string) => { const a = apps.find((x) => x.workflowId === wf); return a?.parentNodeId ? labelOf(a.parentNodeId) : a?.name ?? 'Work app' }
  const to = apps.find((a) => a.parentNodeId === q.toNodeId)
  const project = to ? await db.workProject.findFirst({ where: { workflowId: to.workflowId, userId: q.userId }, select: { id: true } }) : null
  const stuck = await db.flowRun.count({ where: { userId: q.userId, workflowId: q.canvasWorkflowId, status: 'finishing', finishAttempts: { gte: 3 }, pendingSkips: { array_contains: [{ toNodeId: q.toNodeId }] } } })
  if (!project) return { routes, periods: [], passes: [], stuck }
  const periodRows = await db.workHandoffPeriod.findMany({ where: { toProjectId: project.id, userId: q.userId }, orderBy: { periodStart: 'desc' }, take: 8 })
  const hand = await db.workHandoff.findMany({ where: { toProjectId: project.id, userId: q.userId, status: { not: 'withdrawn' }, OR: [{ periodId: { in: periodRows.map((p) => p.id) } }, { periodId: null }] }, orderBy: { updatedAt: 'desc' }, take: 200 })
  const rowIds = hand.map((h) => h.inboxRowId).filter((x): x is string => !!x)
  const existing = new Set((await db.dataSheetRow.findMany({ where: { id: { in: rowIds } }, select: { id: true } })).map((r) => r.id))
  const removed = new Set(rowIds.filter((id) => !existing.has(id)))
  return {
    routes,
    stuck,
    periods: periodRows.map((p) => {
      const mine = hand.filter((h) => h.periodId === p.id)
      const expected = (p.expected as Array<{ from: string; start: string; end: string }>) ?? []
      return {
        start: p.periodStart, end: p.periodEnd, status: p.status, openedTaskId: p.openedTaskId,
        slots: expected.map((x) => {
          const h = mine.find((r) => r.fromWorkflowId === x.from && r.fromPeriodStart === x.start && r.fromPeriodEnd === x.end)
          return { fromName: nameOf(x.from), start: x.start, end: x.end, state: (h?.status as 'delivered' | 'skipped' | undefined) ?? 'waiting', submission: h?.submissionNumber ?? null, rowRemoved: !!h?.inboxRowId && removed.has(h.inboxRowId) }
        }),
        outsideList: mine.filter((h) => !h.inList).length,
      }
    }),
    passes: hand.filter((h) => h.periodId === null).slice(0, 10).map((h) => ({ fromName: nameOf(h.fromWorkflowId), start: h.fromPeriodStart, end: h.fromPeriodEnd, state: h.status, submission: h.submissionNumber, rowRemoved: !!h.inboxRowId && removed.has(h.inboxRowId) })),
  }
}

export async function queueClosedHandoffs(deps: HandoffDeps, q: { userId: string; canvasWorkflowId: string; toNodeId: string; periodStart: string; periodEnd: string; resetManual?: boolean; requestedBy: string }): Promise<{ queued: number }> {
  const canvas = await deps.db.workflow.findFirst({ where: { workflowId: q.canvasWorkflowId, kind: 'main', status: 'production', agent: { userId: q.userId } }, select: { workflowJson: true } })
  if (!canvas) throw new WorkError('NOT_FOUND', 'the workflow is not deployed')
  const routes = handoffRoutesOf(canvas.workflowJson).routes.filter((r) => r.toNodeId === q.toNodeId)
  if (!routes.length) throw new WorkError('INVALID', 'no "done" line leads into this work app')
  const apps = await deps.db.workflow.findMany({ where: { parentWorkflowId: q.canvasWorkflowId, kind: APP_WORKFLOW_KIND, status: 'production' }, select: { workflowId: true, parentNodeId: true } })
  const to = apps.find((a) => a.parentNodeId === q.toNodeId)
  const toProject = to ? await deps.db.workProject.findFirst({ where: { workflowId: to.workflowId, userId: q.userId }, select: { id: true } }) : null
  if (!toProject) throw new WorkError('NOT_FOUND', 'the receiving work app is not set up yet')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(q.periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(q.periodEnd) || q.periodStart > q.periodEnd) throw new WorkError('INVALID', 'period must be calendar dates')
  const key = await deps.dataKey(deps.db, q.userId)
  if (q.resetManual) {
    await deps.db.$transaction(async (tx) => {
      const locked = await lockProjectForWrite(tx, q.userId, toProject.id)
      const row = await tx.workHandoffPeriod.findFirst({ where: { toProjectId: toProject.id, userId: q.userId, periodStart: q.periodStart, periodEnd: q.periodEnd, status: { in: ['manual', 'waiting'] } } })
      if (!row) return
      if (row.status === 'manual') await tx.workHandoffPeriod.update({ where: { id: row.id }, data: { status: 'waiting' } })
      if (locked.status !== 'active' || isProjectDetached(locked) || locked.appClosed) return
      const proj = await tx.workProject.findUniqueOrThrow({ where: { id: toProject.id }, select: { kind: true } })
      const rule = tplOf(deps, proj.kind)?.ui.period
      const title = hasPeriodRule(rule) ? periodContaining(rule, row.periodEnd)?.title ?? row.periodStart : row.periodStart
      await gatherLocked(tx, key, { userId: q.userId, projectId: toProject.id, period: { id: row.id, expected: row.expected as Array<{ from: string; start: string; end: string }>, start: row.periodStart, end: row.periodEnd, title }, canvasWorkflowId: q.canvasWorkflowId, quiet: true })
    }, { timeout: TX_TIMEOUT_MS })
  }
  let queued = 0
  for (const r of routes) {
    const from = apps.find((a) => a.parentNodeId === r.fromNodeId)
    const fromProject = from ? await deps.db.workProject.findFirst({ where: { workflowId: from.workflowId, userId: q.userId }, select: { id: true } }) : null
    if (!from || !fromProject) continue
    const tasks = await deps.db.workTask.findMany({
      where: { projectId: fromProject.id, userId: q.userId, status: 'submitted', periodEnd: { gte: new Date(q.periodStart), lte: new Date(q.periodEnd) } },
      select: { id: true, title: true, periodStart: true, periodEnd: true, currentSubmissionId: true },
    })
    for (const t of tasks) {
      const sub = t.currentSubmissionId ? await deps.db.workSubmission.findUnique({ where: { id: t.currentSubmissionId }, select: { number: true } }) : null
      if (!sub) continue
      await deps.db.$transaction(async (tx) => {
        const sig = await tx.workSignal.create({
          data: {
            userId: q.userId, projectId: fromProject.id, taskId: t.id, appWorkflowId: from.workflowId, kind: sub.number > 1 ? 'resubmitted' : 'sealed', submissionNumber: sub.number,
            periodStart: day(t.periodStart), periodEnd: day(t.periodEnd), payload: encryptJson({ title: t.title }, key), processedAt: new Date(),
          },
        })
        const event = {
          kind: sig.kind, projectId: fromProject.id, taskId: t.id, title: t.title, periodStart: sig.periodStart, periodEnd: sig.periodEnd, submissionNumber: sub.number,
          appWorkflowId: from.workflowId, entryNodeId: r.fromNodeId, lane: 'done', onlyTo: q.toNodeId,
        }
        await tx.flowRun.create({ data: { userId: q.userId, signalId: sig.id, workflowId: q.canvasWorkflowId, lane: 'done', attempt: 1, status: 'queued', event: encryptJson(event, key), requestedBy: q.requestedBy } })
      })
      queued++
    }
  }
  return { queued }
}

export async function sweepCompletePeriods(deps: HandoffDeps, onlyUserId?: string): Promise<number> {
  const cand = await deps.db.$queryRaw<Array<{ id: string; user_id: string; to_project_id: string; canvas_workflow_id: string }>>`
    SELECT p.id, p.user_id, p.to_project_id, p.canvas_workflow_id FROM work_handoff_period p
      JOIN work_project wp ON wp.id = p.to_project_id
      JOIN workflows w ON w."workflowId" = wp.workflow_id
    -- 열 수 있는 앱만 고른다 — 닫힌 앱의 기간이 앞자리를 계속 차지해 뒤를 굶기지 않게(코드 리뷰 R2 grok). 잠금 안에서 다시 본다
    WHERE p.status = 'waiting' AND wp.status = 'active' AND (w.kind <> 'app' OR w.status = 'production') ${onlyUserId ? Prisma.sql`AND p.user_id = ${onlyUserId}` : Prisma.empty}
      AND jsonb_array_length(p.expected) > 0
      AND jsonb_array_length(p.expected) <= (SELECT count(*) FROM work_handoff h WHERE h.period_id = p.id AND h.status IN ('delivered', 'skipped') AND h.in_list)
    ORDER BY p.updated_at LIMIT 10`
  let n = 0
  for (const c of cand) {
    try {
      const key = await deps.dataKey(deps.db, c.user_id)
      const opened = await deps.db.$transaction(async (tx) => {
        const locked = await lockProjectForWrite(tx, c.user_id, c.to_project_id)
        if (locked.status !== 'active' || isProjectDetached(locked) || locked.appClosed) return false
        const row = await tx.workHandoffPeriod.findFirst({ where: { id: c.id, status: 'waiting' } })
        if (!row) return false
        const proj = await tx.workProject.findUniqueOrThrow({ where: { id: c.to_project_id }, select: { kind: true } })
        const rule = tplOf(deps, proj.kind)?.ui.period
        const title = hasPeriodRule(rule) ? periodContaining(rule, row.periodEnd)?.title ?? row.periodStart : row.periodStart
        return !!(await gatherLocked(tx, key, { userId: c.user_id, projectId: c.to_project_id, period: { id: row.id, expected: row.expected as Array<{ from: string; start: string; end: string }>, start: row.periodStart, end: row.periodEnd, title }, canvasWorkflowId: c.canvas_workflow_id }))
      }, { timeout: TX_TIMEOUT_MS })
      if (opened) n++
    } catch (e) {
      console.error('[handoff] 모이기 점검 실패 — 다음 주기에 다시:', e instanceof Error ? e.message.slice(0, 200) : 'error')
    }
  }
  return n
}
