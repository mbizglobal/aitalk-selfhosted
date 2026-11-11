
import type { PrismaClient } from '@prisma/client'
import { Prisma } from '@prisma/client'
import { WorkError } from './errors'
import { decryptJson, encryptJson } from './sealed'
import { workEventStart } from '@/lib/workflow/start-trigger'
import { APP_WORKFLOW_KIND, canvasEventEntries, doneRunGraph, eventRunGraph, handoffRoutesOf, hasDoneLine } from './app-canvas'
import type { HandoffDeps } from './handoff'

export const FLOW_RUN_LIMIT_MS = 15 * 60_000
export const FLOW_BLOCKED_LIMIT_MS = 24 * 60 * 60_000
const SIGNAL_BATCH = 20
const RUN_BATCH = 10

export interface WorkEventInfo {
  kind: string
  projectId: string
  taskId: string | null
  title: string
  periodStart: string | null
  periodEnd: string | null
  submissionNumber: number | null
  appWorkflowId: string
  rowId?: string
  family?: string
  fromWorkflowId?: string
  entryNodeId?: string
  lane?: 'done'
  onlyTo?: string
}

export interface FlowDeps {
  db: PrismaClient
  dataKey(db: PrismaClient, userId: string): Promise<Buffer>
  runEngine?(workflowJson: unknown, context: Record<string, unknown>, opts: { shouldContinue: () => Promise<boolean> }): Promise<{ nodeError?: { nodeId: string; error: string } | null }>
  entitlement?(userId: string): Promise<boolean>
  agentLocked?(agentId: string): Promise<boolean>
  now?(): Date
  onlyUserId?: string
  handoffDeps?: HandoffDeps
}

async function handoffDepsOf(d: FlowDeps): Promise<HandoffDeps> {
  if (d.handoffDeps) return d.handoffDeps
  const { defaultWorkSheetDeps } = await import('./sheet-gate')
  return { ...(await defaultWorkSheetDeps()), db: d.db, dataKey: d.dataKey }
}

const nowOf = (d: FlowDeps) => (d.now ? d.now() : new Date())

async function receivers(db: Prisma.TransactionClient | PrismaClient, userId: string, appWorkflowId: string, kind: string): Promise<Array<{ workflowId: string; entryNodeId?: string; lane?: 'done' }>> {
  const rows = await db.workflow.findMany({ where: { kind: 'main', status: 'production', agent: { userId } }, select: { workflowId: true, workflowJson: true } })
  const out: Array<{ workflowId: string; entryNodeId?: string; lane?: 'done' }> = rows.filter((w) => {
    const s = workEventStart(w.workflowJson)
    return !!s && s.appWorkflowId === appWorkflowId && s.events.includes(kind)
  }).map((w) => ({ workflowId: w.workflowId }))
  const app = await db.workflow.findFirst({ where: { workflowId: appWorkflowId, kind: APP_WORKFLOW_KIND, agent: { userId } }, select: { parentWorkflowId: true, parentNodeId: true } })
  if (app?.parentWorkflowId && app.parentNodeId) {
    const canvas = rows.find((w) => w.workflowId === app.parentWorkflowId)
    if (canvas && canvasEventEntries(canvas.workflowJson).some((e) => e.appNodeId === app.parentNodeId && e.kind === kind)) {
      out.push({ workflowId: canvas.workflowId, entryNodeId: app.parentNodeId })
    }
    if (canvas && (kind === 'sealed' || kind === 'resubmitted') && hasDoneLine(canvas.workflowJson, app.parentNodeId)) {
      out.push({ workflowId: canvas.workflowId, entryNodeId: app.parentNodeId, lane: 'done' })
    }
  }
  return out
}

async function runnableGraph(db: Prisma.TransactionClient | PrismaClient, workflowId: string, workflowJson: string, ev: WorkEventInfo): Promise<string | null> {
  if (!ev.entryNodeId) {
    const st = workEventStart(workflowJson)
    return st && st.appWorkflowId === ev.appWorkflowId && st.events.includes(ev.kind) ? workflowJson : null
  }
  const app = await db.workflow.findFirst({ where: { parentWorkflowId: workflowId, parentNodeId: ev.entryNodeId, kind: APP_WORKFLOW_KIND }, select: { workflowId: true } })
  if (app?.workflowId !== ev.appWorkflowId) return null
  const g = ev.lane === 'done' ? doneRunGraph(workflowJson, ev.entryNodeId, ev.appWorkflowId, ev.onlyTo) : eventRunGraph(workflowJson, ev.entryNodeId, ev.kind, ev.appWorkflowId)
  return g ? JSON.stringify(g) : null
}

export async function claimSignals(d: FlowDeps): Promise<number> {
  return d.db.$transaction(async (tx) => {
    const sigs = d.onlyUserId
      ? await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM work_signal WHERE processed_at IS NULL AND kind NOT IN ('task_deleted', 'project_deleted', 'send_sent') AND user_id = ${d.onlyUserId} ORDER BY created_at ASC LIMIT ${SIGNAL_BATCH} FOR UPDATE SKIP LOCKED`
      : await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM work_signal WHERE processed_at IS NULL AND kind NOT IN ('task_deleted', 'project_deleted', 'send_sent') ORDER BY created_at ASC LIMIT ${SIGNAL_BATCH} FOR UPDATE SKIP LOCKED`
    let runs = 0
    for (const { id } of sigs) {
      const s = await tx.workSignal.findUniqueOrThrow({ where: { id } })
      const to = s.appWorkflowId ? await receivers(tx, s.userId, s.appWorkflowId, s.kind) : []
      if (to.length) {
        const key = await d.dataKey(d.db, s.userId)
        const p = (() => { try { return decryptJson<{ title?: string; rowId?: string; family?: string; fromWorkflowId?: string }>(s.payload, key) } catch { return {} } })()
        const event: WorkEventInfo = {
          kind: s.kind, projectId: s.projectId, taskId: s.taskId, title: p.title ?? '', periodStart: s.periodStart, periodEnd: s.periodEnd, submissionNumber: s.submissionNumber, appWorkflowId: s.appWorkflowId!,
          ...(s.kind === 'inbox_row' ? { rowId: p.rowId ?? '', family: p.family ?? '', ...(p.fromWorkflowId ? { fromWorkflowId: p.fromWorkflowId } : {}) } : {}),
        }
        const r = await tx.flowRun.createMany({
          data: to.map((t) => ({
            userId: s.userId, signalId: s.id, workflowId: t.workflowId, attempt: 1, status: 'queued', lane: t.lane ?? 'event', requestedBy: 'signal',
            event: encryptJson(t.entryNodeId ? { ...event, entryNodeId: t.entryNodeId, ...(t.lane ? { lane: t.lane } : {}) } : event, key),
          })),
          skipDuplicates: true,
        })
        runs += r.count
      }
      await tx.workSignal.update({ where: { id: s.id }, data: { processedAt: nowOf(d) } })
    }
    return runs
  }, { timeout: 30_000 })
}

export async function markInterruptedRuns(d: FlowDeps): Promise<number> {
  const r = await d.db.flowRun.updateMany({ where: { ...(d.onlyUserId ? { userId: d.onlyUserId } : {}), status: 'running', startedAt: { lt: new Date(nowOf(d).getTime() - FLOW_RUN_LIMIT_MS) } }, data: { status: 'interrupted', code: 'TIMEOUT', finishedAt: nowOf(d) } })
  return r.count
}

type Gate = { ok: true; agentId: string; workflowJson: string } | { ok: false; fail: string } | { ok: false; block: string }

async function gate(d: FlowDeps, run: { userId: string; workflowId: string }, ev: WorkEventInfo): Promise<Gate> {
  const w = await d.db.workflow.findFirst({ where: { workflowId: run.workflowId, kind: 'main', agent: { userId: run.userId } }, select: { status: true, workflowJson: true, agentId: true } })
  if (!w) return { ok: false, fail: 'WORKFLOW_GONE' }
  if (w.status !== 'production') return { ok: false, fail: 'NOT_DEPLOYED' }
  if (!(await runnableGraph(d.db, run.workflowId, w.workflowJson, ev))) return { ok: false, fail: 'TRIGGER_CHANGED' }
  let allowed: boolean
  if (d.entitlement) allowed = await d.entitlement(run.userId)
  else {
    const { assertServiceEntitlement } = await import('@/lib/entitlement')
    allowed = (await assertServiceEntitlement(run.userId)).allowed
  }
  if (!allowed) return { ok: false, block: 'ENTITLEMENT' }
  let locked: boolean
  if (d.agentLocked) locked = await d.agentLocked(w.agentId)
  else {
    const { isAgentLocked } = await import('@/lib/agent-lock')
    locked = await isAgentLocked(w.agentId)
  }
  if (locked) return { ok: false, block: 'AGENT_LOCKED' }
  return { ok: true, agentId: w.agentId, workflowJson: w.workflowJson as string }
}

const failQueued = (d: FlowDeps, id: string, code: string) =>
  code === 'WORKFLOW_GONE'
    ? d.db.flowRun.deleteMany({ where: { id, status: 'queued' } })
    : d.db.flowRun.updateMany({ where: { id, status: 'queued' }, data: { status: 'failed', code, finishedAt: nowOf(d) } })

async function blockQueued(d: FlowDeps, id: string, code: string, blockedSince: Date | null): Promise<void> {
  const now = nowOf(d)
  if (blockedSince && now.getTime() - blockedSince.getTime() > FLOW_BLOCKED_LIMIT_MS) {
    await failQueued(d, id, 'BLOCKED_EXPIRED')
    return
  }
  await d.db.flowRun.updateMany({ where: { id, status: 'queued', blockedSince: null }, data: { blockedSince: now } })
  await d.db.flowRun.updateMany({ where: { id, status: 'queued' }, data: { code } })
}

export async function startQueuedRuns(d: FlowDeps): Promise<Promise<void>[]> {
  const scope = d.onlyUserId ? { userId: d.onlyUserId } : {}
  const fresh = await d.db.flowRun.findMany({ where: { ...scope, status: 'queued', blockedSince: null }, orderBy: { createdAt: 'asc' }, take: RUN_BATCH })
  const blocked = await d.db.flowRun.findMany({ where: { ...scope, status: 'queued', blockedSince: { not: null } }, orderBy: { updatedAt: 'asc' }, take: RUN_BATCH })
  const rows = [...fresh, ...blocked]
  const started: Promise<void>[] = []
  for (const r of rows) {
    let ev: WorkEventInfo
    try {
      ev = decryptJson<WorkEventInfo>(r.event, await d.dataKey(d.db, r.userId))
    } catch {
      await failQueued(d, r.id, 'EVENT_UNREADABLE')
      continue
    }
    const g = await gate(d, r, ev)
    if (!g.ok) {
      if ('fail' in g) await failQueued(d, r.id, g.fail)
      else await blockQueued(d, r.id, g.block, r.blockedSince)
      continue
    }
    let claim: { json: string; canvas?: { json: string; version: number } } | { fail: 'WORKFLOW_GONE' | 'NOT_DEPLOYED' | 'TRIGGER_CHANGED' } | { sourceChanged: true } | null
    try {
     claim = await d.db.$transaction(async (tx) => {
      const w = (await tx.$queryRaw<Array<{ status: string; workflow_json: string; version: number }>>`
        SELECT status, workflow_json, version FROM workflows WHERE "workflowId" = ${r.workflowId} FOR SHARE`)[0]
      if (!w) return { fail: 'WORKFLOW_GONE' as const }
      if (w.status !== 'production') return { fail: 'NOT_DEPLOYED' as const }
      const graph = await runnableGraph(tx, r.workflowId, w.workflow_json, ev)
      if (!graph) return { fail: 'TRIGGER_CHANGED' as const }
      if (ev.lane === 'done') {
        const { sourceStillSealed, graphDigestOf } = await import('./handoff')
        await tx.$queryRaw`SELECT id FROM work_project WHERE id = ${ev.projectId} AND user_id = ${r.userId} FOR SHARE`
        if (!ev.taskId || !ev.submissionNumber || !(await sourceStillSealed(tx, r.userId, ev.taskId, ev.submissionNumber))) {
          const x = await tx.flowRun.updateMany({ where: { id: r.id, status: 'queued' }, data: { status: 'done', code: 'SOURCE_CHANGED', finishedAt: nowOf(d), blockedSince: null } })
          return x.count === 1 ? { sourceChanged: true as const } : null
        }
        const c = await tx.flowRun.updateMany({ where: { id: r.id, status: 'queued' }, data: { status: 'running', startedAt: nowOf(d), blockedSince: null, code: null, canvasVersion: w.version, graphDigest: graphDigestOf(w.workflow_json), canvasJson: w.workflow_json } })
        return c.count === 1 ? { json: graph, canvas: { json: w.workflow_json, version: w.version } } : null
      }
      const c = await tx.flowRun.updateMany({ where: { id: r.id, status: 'queued' }, data: { status: 'running', startedAt: nowOf(d), blockedSince: null, code: null } })
      return c.count === 1 ? { json: graph } : null
     }, { timeout: 15_000, maxWait: 15_000 })
    } catch (e) {
      console.error(`[flow-run] 시작 확보 실패 — 다음 주기에 다시 (${r.id}):`, e instanceof Error ? e.message.slice(0, 200) : 'error')
      continue
    }
    if (!claim || 'sourceChanged' in claim) continue
    if ('fail' in claim) { await failQueued(d, r.id, claim.fail!); continue }
    started.push(runOne(d, { id: r.id, userId: r.userId, workflowId: r.workflowId, agentId: g.agentId, workflowJson: claim.json, canvas: claim.canvas }, ev).catch((e) => {
      console.error(`[flow-run] 실행 기록 실패 (${r.id}):`, e instanceof Error ? e.message.slice(0, 200) : 'error')
    }))
  }
  return started
}

async function runOne(d: FlowDeps, r: { id: string; userId: string; workflowId: string; agentId: string; workflowJson: string; canvas?: { json: string; version: number } }, ev: WorkEventInfo): Promise<void> {
  const shouldContinue = async () => (await d.db.flowRun.findUnique({ where: { id: r.id }, select: { status: true } }))?.status === 'running'
  let result: { nodeError?: { nodeId: string; error: string } | null }
  const hs: HandoffRunState | null = ev.lane === 'done' && r.canvas && ev.entryNodeId && ev.taskId && ev.submissionNumber
    ? { d, userId: r.userId, canvasWorkflowId: r.workflowId, canvasJson: r.canvas.json, canvasVersion: r.canvas.version, fromNodeId: ev.entryNodeId, fromWorkflowId: ev.appWorkflowId, taskId: ev.taskId, submissionNumber: ev.submissionNumber, onlyTo: ev.onlyTo, delivered: [], sourceChanged: false }
    : null
  if (hs) handoffRuns.set(r.id, hs)
  try {
    const context = await contextFor(r, ev, hs ? await handoffDepsOf(d) : null)
    result = d.runEngine ? await d.runEngine(JSON.parse(r.workflowJson), context, { shouldContinue }) : await defaultEngine(r.workflowJson, context, shouldContinue)
  } catch (e) {
    console.error('[flow-run] 실행 실패:', e instanceof Error ? e.message.slice(0, 200) : 'error')
    await d.db.flowRun.updateMany({ where: { id: r.id, status: 'running' }, data: { status: 'failed', code: 'RUN_ERROR', finishedAt: nowOf(d), ...(hs ? { handoffs: hs.delivered } : {}) } })
    handoffRuns.delete(r.id)
    return
  }
  handoffRuns.delete(r.id)
  let finishing = false
  const data = hs?.sourceChanged
    ? { status: 'done', code: 'SOURCE_CHANGED', finishedAt: nowOf(d), handoffs: hs.delivered }
    : result.nodeError
      ? { status: 'failed', code: 'NODE_ERROR', failedNode: result.nodeError.nodeId.slice(0, 100), finishedAt: nowOf(d), ...(hs ? { handoffs: hs.delivered } : {}) }
      : hs
        ? (finishing = true, { status: 'finishing', handoffs: hs.delivered, pendingSkips: await pendingSkipsOf(hs) })
        : { status: 'done', finishedAt: nowOf(d) }
  for (let attempt = 1; ; attempt++) {
    try {
      const u = await d.db.flowRun.updateMany({ where: { id: r.id, status: 'running' }, data })
      if (finishing && u.count === 1) await finishRun(d, r.id)
      return
    } catch (e) {
      if (attempt >= 3) throw e
      await new Promise((res) => setTimeout(res, 1000 * attempt))
    }
  }
}

interface HandoffRunState {
  d: FlowDeps
  userId: string
  canvasWorkflowId: string
  canvasJson: string
  canvasVersion: number
  fromNodeId: string
  fromWorkflowId: string
  taskId: string
  submissionNumber: number
  onlyTo?: string
  delivered: Array<{ toNodeId: string; to: string; wrote: string }>
  sourceChanged: boolean
}
const handoffRuns = new Map<string, HandoffRunState>()

type PendingSkip = { toNodeId: string }

async function pendingSkipsOf(hs: HandoffRunState): Promise<PendingSkip[]> {
  const done = new Set(hs.delivered.map((x) => x.toNodeId))
  return handoffRoutesOf(hs.canvasJson).routes
    .filter((r) => r.fromNodeId === hs.fromNodeId && (hs.onlyTo === undefined || r.toNodeId === hs.onlyTo) && !done.has(r.toNodeId))
    .map((r) => ({ toNodeId: r.toNodeId }))
}

export async function runHandoffNode(flowRunId: string, toNodeId: unknown): Promise<{ ok: true; wrote: string } | { ok: false; error: string; stop?: boolean }> {
  const hs = handoffRuns.get(flowRunId)
  if (!hs) return { ok: false, error: 'Work app handoff: this run is not a handoff run' }
  if (typeof toNodeId !== 'string' || !toNodeId) return { ok: false, error: 'Work app handoff: no receiving work app' }
  const { recordArrival } = await import('./handoff')
  const deps = await handoffDepsOf(hs.d)
  const to = await deps.db.workflow.findFirst({ where: { parentWorkflowId: hs.canvasWorkflowId, parentNodeId: toNodeId, kind: APP_WORKFLOW_KIND }, select: { workflowId: true } })
  if (!to) return { ok: false, error: 'Work app handoff: the receiving work app is not deployed' }
  try {
    const r = await recordArrival(deps, {
      userId: hs.userId, canvasWorkflowId: hs.canvasWorkflowId, canvasVersion: hs.canvasVersion, canvasJson: hs.canvasJson,
      fromWorkflowId: hs.fromWorkflowId, toWorkflowId: to.workflowId, toNodeId, fromTaskId: hs.taskId, submissionNumber: hs.submissionNumber, mode: 'delivered', flowRunId,
    })
    if (!r.ok && r.code === 'SOURCE_CHANGED') { hs.sourceChanged = true; return { ok: false, error: 'Work app handoff: the sending task changed (unlocked or submitted again) — the newer version runs on its own', stop: true } }
    const wrote = r.ok ? r.wrote : 'receiver_gone'
    hs.delivered.push({ toNodeId, to: to.workflowId, wrote })
    return { ok: true, wrote }
  } catch (e) {
    const { WorkError } = await import('./errors')
    if (e instanceof WorkError) return { ok: false, error: `Work app handoff: ${e.code}${e.detail ? ` — ${e.detail}` : ''}` }
    console.error('[handoff] 넘기기 실패:', e instanceof Error ? e.message.slice(0, 200) : 'error')
    return { ok: false, error: 'Work app handoff: failed' }
  }
}

const finishBackoffMs = (n: number) => Math.min(30_000 * 2 ** Math.max(0, n - 1), 60 * 60_000)
export const FINISH_STUCK_AFTER = 3
const finishingNow = new Set<string>()

export async function finishRun(d: FlowDeps, runId: string): Promise<'done' | 'pending' | 'skip'> {
  if (finishingNow.has(runId)) return 'skip'
  finishingNow.add(runId)
  try {
    const run = await d.db.flowRun.findUnique({ where: { id: runId } })
    if (!run || run.status !== 'finishing') return 'skip'
    const key = await d.dataKey(d.db, run.userId)
    let ev: WorkEventInfo
    try { ev = decryptJson<WorkEventInfo>(run.event, key) } catch {
      await d.db.flowRun.updateMany({ where: { id: runId, status: 'finishing' }, data: { status: 'failed', code: 'EVENT_UNREADABLE', finishedAt: nowOf(d) } })
      return 'done'
    }
    const pending = (Array.isArray(run.pendingSkips) ? run.pendingSkips : []) as PendingSkip[]
    const canvas = run.canvasJson && run.canvasVersion !== null ? { workflowJson: run.canvasJson, version: run.canvasVersion } : null
    const deps = await handoffDepsOf(d)
    const { recordArrival } = await import('./handoff')
    const left: PendingSkip[] = []
    for (const p of pending) {
      try {
        const to = await d.db.workflow.findFirst({ where: { parentWorkflowId: run.workflowId, parentNodeId: p.toNodeId, kind: APP_WORKFLOW_KIND }, select: { workflowId: true } })
        if (!to || !canvas || !ev.taskId || !ev.submissionNumber) continue
        const r = await recordArrival(deps, {
          userId: run.userId, canvasWorkflowId: run.workflowId, canvasVersion: canvas.version, canvasJson: canvas.workflowJson,
          fromWorkflowId: ev.appWorkflowId, toWorkflowId: to.workflowId, toNodeId: p.toNodeId, fromTaskId: ev.taskId, submissionNumber: ev.submissionNumber, mode: 'skipped', flowRunId: runId, skipUnlessGather: true,
        })
        if (!r.ok && r.code === 'SOURCE_CHANGED') {
          await d.db.flowRun.updateMany({ where: { id: runId, status: 'finishing' }, data: { status: 'done', code: 'SOURCE_CHANGED', finishedAt: nowOf(d), pendingSkips: Prisma.DbNull } })
          return 'done'
        }
      } catch (e) {
        console.error(`[handoff] 건너뜀 기록 실패 — 다음에 다시 (${runId}):`, e instanceof Error ? e.message.slice(0, 200) : 'error')
        left.push(p)
      }
    }
    if (!left.length) {
      await d.db.flowRun.updateMany({ where: { id: runId, status: 'finishing' }, data: { status: 'done', finishedAt: nowOf(d), pendingSkips: Prisma.DbNull, nextFinishAt: null } })
      return 'done'
    }
    const n = run.finishAttempts + 1
    await d.db.flowRun.updateMany({ where: { id: runId, status: 'finishing' }, data: { pendingSkips: left, finishAttempts: n, nextFinishAt: new Date(nowOf(d).getTime() + finishBackoffMs(n)) } })
    return 'pending'
  } finally {
    finishingNow.delete(runId)
  }
}

export async function resumeFinishingRuns(d: FlowDeps): Promise<number> {
  const rows = await d.db.flowRun.findMany({
    where: { ...(d.onlyUserId ? { userId: d.onlyUserId } : {}), status: 'finishing', OR: [{ nextFinishAt: null }, { nextFinishAt: { lte: nowOf(d) } }] },
    orderBy: { updatedAt: 'asc' }, take: RUN_BATCH, select: { id: true },
  })
  let n = 0
  for (const r of rows) {
    try { if ((await finishRun(d, r.id)) === 'done') n++ } catch (e) {
      console.error(`[handoff] 끝내기 실패 — 다음 주기에 다시 (${r.id}):`, e instanceof Error ? e.message.slice(0, 200) : 'error')
    }
  }
  return n
}

async function contextFor(r: { id: string; userId: string; workflowId: string; agentId: string }, ev: WorkEventInfo, handoffDeps: HandoffDeps | null = null): Promise<Record<string, unknown>> {
  const { isSelfHosted } = await import('@/lib/edition')
  const { prisma } = await import('@/lib/prisma')
  const sub = isSelfHosted() ? null : await prisma.subscription.findUnique({ where: { id: r.userId }, select: { serviceVariant: true, managedRegion: true } })
  return {
    message: '[Work app event]',
    conversationId: `work-event-${r.id}`,
    agentId: r.agentId,
    userId: r.userId,
    workflowId: r.workflowId,
    isWorkEventTrigger: true,
    workEvent: ev,
    flowRunId: r.id,
    isManaged: sub?.serviceVariant === 'managed',
    managedRegion: sub?.managedRegion || undefined,
    ...(handoffDeps && ev.taskId && ev.submissionNumber
      ? { handoff: await (await import('./handoff')).handoffContextFor(handoffDeps, { userId: r.userId, fromWorkflowId: ev.appWorkflowId, taskId: ev.taskId, submissionNumber: ev.submissionNumber }) }
      : {}),
  }
}

async function defaultEngine(workflowJson: string, context: Record<string, unknown>, shouldContinue: () => Promise<boolean>) {
  const { WorkflowEngine } = await import('@/lib/workflow/engine')
  const res = await new WorkflowEngine().execute(JSON.parse(workflowJson), context as never, { shouldContinue })
  return { nodeError: res.nodeError ?? null }
}

let claiming = false
export async function processWorkSignals(d: FlowDeps): Promise<{ claimed: number; interrupted: number; started: Promise<void>[] }> {
  if (claiming) return { claimed: 0, interrupted: 0, started: [] }
  claiming = true
  try {
    const claimed = await claimSignals(d)
    const interrupted = await markInterruptedRuns(d)
    const started = await startQueuedRuns(d)
    await resumeFinishingRuns(d).catch((e) => console.error('[handoff] 끝내기 주기 실패:', e instanceof Error ? e.message.slice(0, 200) : 'error'))
    try {
      const h = await import('./handoff')
      const deps = await handoffDepsOf(d)
      await h.processDeletionSignals(deps, d.onlyUserId)
      await h.sweepOrphanHandoffs(deps, d.onlyUserId)
      await h.sweepCompletePeriods(deps, d.onlyUserId)
    } catch (e) {
      console.error('[handoff] 철회 주기 실패:', e instanceof Error ? e.message.slice(0, 200) : 'error')
    }
    try {
      const { processSendSignals } = await import('./send-refs')
      const { defaultWorkFileDeps } = await import('./files')
      await processSendSignals({ ...(await defaultWorkFileDeps()), db: d.db, dataKey: d.dataKey }, { onlyUserId: d.onlyUserId })
    } catch (e) {
      console.error('[send-refs] 보낸 뒤 주기 실패:', e instanceof Error ? e.message.slice(0, 200) : 'error')
    }
    return { claimed, interrupted, started }
  } finally {
    claiming = false
  }
}

export interface FlowRunView {
  id: string
  signalId: string
  attempt: number
  status: string
  code: string | null
  failedNode: string | null
  requestedBy: string
  event: Pick<WorkEventInfo, 'kind' | 'title' | 'periodStart' | 'periodEnd' | 'submissionNumber'> | null
  createdAt: Date
  startedAt: Date | null
  finishedAt: Date | null
  blockedSince: Date | null
  canRerun: boolean
  lane: 'event' | 'done'
  stuck: boolean
  handoffs: Array<{ toNodeId: string; wrote: string }>
}

export async function listFlowRuns(d: Pick<FlowDeps, 'db' | 'dataKey'>, q: { userId: string; workflowId: string; limit?: number }): Promise<FlowRunView[]> {
  const rows = await d.db.flowRun.findMany({ where: { userId: q.userId, workflowId: q.workflowId }, orderBy: { createdAt: 'desc' }, take: Math.min(q.limit ?? 30, 100) })
  if (!rows.length) return []
  const key = await d.dataKey(d.db, q.userId)
  const sk = (r: { signalId: string; lane: string }) => `${r.signalId}\0${r.lane}`
  const live = new Set(rows.filter((r) => r.status === 'queued' || r.status === 'running' || r.status === 'finishing').map(sk))
  const latest = new Map<string, number>()
  for (const r of rows) latest.set(sk(r), Math.max(latest.get(sk(r)) ?? 0, r.attempt))
  return rows.map((r) => {
    let ev: WorkEventInfo | null = null
    try { ev = decryptJson<WorkEventInfo>(r.event, key) } catch { ev = null }
    return {
      id: r.id, signalId: r.signalId, attempt: r.attempt, status: r.status, code: r.code, failedNode: r.failedNode, requestedBy: r.requestedBy,
      lane: r.lane === 'done' ? 'done' : 'event', stuck: r.status === 'finishing' && r.finishAttempts >= FINISH_STUCK_AFTER,
      handoffs: Array.isArray(r.handoffs) ? (r.handoffs as Array<{ toNodeId: string; wrote: string }>).map((h) => ({ toNodeId: String(h.toNodeId), wrote: String(h.wrote) })) : [],
      event: ev ? { kind: ev.kind, title: ev.title, periodStart: ev.periodStart, periodEnd: ev.periodEnd, submissionNumber: ev.submissionNumber } : null,
      createdAt: r.createdAt, startedAt: r.startedAt, finishedAt: r.finishedAt, blockedSince: r.blockedSince,
      canRerun: (r.status === 'failed' || r.status === 'interrupted') && !live.has(sk(r)) && latest.get(sk(r)) === r.attempt,
    }
  })
}

export async function rerunFlowRun(d: Pick<FlowDeps, 'db'>, q: { userId: string; runId: string; requestedBy: string }): Promise<{ id: string }> {
  return d.db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string; signal_id: string; workflow_id: string; status: string; lane: string }>>`
      SELECT id, signal_id, workflow_id, status, lane FROM flow_run WHERE id = ${q.runId} AND user_id = ${q.userId} FOR UPDATE`
    const r = rows[0]
    if (!r) throw new WorkError('NOT_FOUND')
    if (r.status !== 'failed' && r.status !== 'interrupted') throw new WorkError('STALE', `cannot rerun a ${r.status} run`)
    const siblings = await tx.flowRun.findMany({ where: { signalId: r.signal_id, workflowId: r.workflow_id, lane: r.lane, userId: q.userId }, select: { attempt: true, status: true, event: true } })
    if (siblings.some((x) => x.status === 'queued' || x.status === 'running' || x.status === 'finishing')) throw new WorkError('STALE', 'this run is already queued or running again')
    const top = siblings.reduce((m, x) => (x.attempt > m.attempt ? x : m))
    try {
      const created = await tx.flowRun.create({
        data: { userId: q.userId, signalId: r.signal_id, workflowId: r.workflow_id, lane: r.lane, attempt: top.attempt + 1, status: 'queued', event: top.event, requestedBy: q.requestedBy },
        select: { id: true },
      })
      return created
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new WorkError('STALE', 'already rerun')
      throw e
    }
  })
}
