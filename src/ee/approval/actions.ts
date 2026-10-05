import { Prisma } from '@prisma/client'
import { isEeFeatureEnabled } from '@/lib/license'
import { WorkError } from '@/lib/work/errors'
import { encryptJson, decryptJson } from '@/lib/work/sealed'
import { actorLabel, assertProjectWritable, lockProjectForWrite, lockTaskForWrite, type SheetActor, type WorkSheetDeps } from '@/lib/work/sheet-gate'
import { lockForSubmit } from '@/lib/work/references'
import { validateTemplateRegistry } from '@/lib/work/sheet-templates'
import { commitSeal, prepareCalc, prepareSeal, writeWorkEvent, type SealInput } from '@/lib/work/projects'
import { approvalApplies, eligibleApprovers, parseApprovalSettings, MAX_APPROVERS, type ApprovalSettings } from './rules'

const TX_TIMEOUT_MS = 30_000
const MAX_REASON = 1000

interface ApprovalRequest {
  by: string
  at: string
  input: SealInput
  digest: string
}

function assertHuman(actor: SheetActor): asserts actor is Extract<SheetActor, { type: 'human' }> {
  if (actor.type !== 'human') throw new WorkError('FORBIDDEN', 'only a person can do this')
}

async function taskProject(deps: WorkSheetDeps, userId: string, taskId: string): Promise<string> {
  const t = await deps.db.workTask.findFirst({ where: { id: taskId, userId }, select: { projectId: true } })
  if (!t) throw new WorkError('NOT_FOUND')
  return t.projectId
}

export async function requestApproval(deps: WorkSheetDeps, a: { userId: string; taskId: string; actor: SheetActor; input: SealInput }) {
  assertHuman(a.actor)
  const projectId = await taskProject(deps, a.userId, a.taskId)
  validateTemplateRegistry(deps.templates)
  await prepareCalc(deps, a.userId, a.taskId, projectId)
  const key = await deps.dataKey(deps.db, a.userId)
  return deps.db.$transaction(async (tx) => {
    const { project, references } = await lockForSubmit(tx, a.userId, projectId)
    assertProjectWritable(project)
    const task = await lockTaskForWrite(tx, a.userId, projectId, a.taskId)
    if (task.status === 'awaiting') throw new WorkError('ALREADY_REQUESTED')
    if (task.status !== 'open') throw new WorkError('LOCKED')
    if (!(await approvalApplies(tx, projectId))) throw new WorkError('INVALID', 'approval is not on for this work app — submit directly')
    const me = actorLabel(a.actor)
    const others = [...(await eligibleApprovers(tx, projectId))].filter((x) => x !== me)
    if (others.length === 0) throw new WorkError('NO_APPROVER', 'no active approver other than the requester')
    const { digest } = await prepareSeal(tx, deps, key, { userId: a.userId, projectId, taskId: a.taskId, references, input: a.input })
    const req: ApprovalRequest = { by: me, at: new Date().toISOString(), input: a.input, digest }
    await tx.workTask.update({ where: { id: a.taskId }, data: { status: 'awaiting', approvalRequest: encryptJson(req, key) } })
    await writeWorkEvent(tx, key, { userId: a.userId, projectId, taskId: a.taskId, actor: a.actor, action: 'approval_request', detail: { digest } })
    return { status: 'awaiting' as const }
  }, { timeout: TX_TIMEOUT_MS })
}

export async function approveTask(deps: WorkSheetDeps, a: { userId: string; taskId: string; actor: SheetActor }) {
  assertHuman(a.actor)
  const projectId = await taskProject(deps, a.userId, a.taskId)
  validateTemplateRegistry(deps.templates)
  await prepareCalc(deps, a.userId, a.taskId, projectId)
  const key = await deps.dataKey(deps.db, a.userId)
  return deps.db.$transaction(async (tx) => {
    const { project, references } = await lockForSubmit(tx, a.userId, projectId)
    assertProjectWritable(project)
    const task = await lockTaskForWrite(tx, a.userId, projectId, a.taskId)
    if (task.status !== 'awaiting') throw new WorkError('STALE', 'the task is not awaiting approval')
    if (!(await approvalApplies(tx, projectId))) throw new WorkError('FORBIDDEN', 'approval is off — cancel the request and submit directly')
    const req = await readRequest(tx, key, a.taskId)
    const me = actorLabel(a.actor)
    if (me === req.by) throw new WorkError('FORBIDDEN', 'the requester cannot approve their own request')
    if (!(await eligibleApprovers(tx, projectId)).has(me)) throw new WorkError('FORBIDDEN', 'only an approver can approve')
    const prep = await prepareSeal(tx, deps, key, { userId: a.userId, projectId, taskId: a.taskId, references, input: req.input })
    if (prep.digest !== req.digest) throw new WorkError('STALE', 'the content changed after the request — cancel and request again')
    return commitSeal(tx, key, { userId: a.userId, projectId, taskId: a.taskId, actor: a.actor, body: prep.body, snapshots: prep.snapshots, approval: { preparedBy: req.by, approvedBy: me } })
  }, { timeout: TX_TIMEOUT_MS })
}

async function readRequest(tx: Prisma.TransactionClient, key: Buffer, taskId: string): Promise<ApprovalRequest> {
  const t = await tx.workTask.findUniqueOrThrow({ where: { id: taskId }, select: { approvalRequest: true } })
  if (!t.approvalRequest) throw new WorkError('STALE', 'the approval request is missing')
  return decryptJson<ApprovalRequest>(t.approvalRequest, key)
}

async function closeRequest(
  deps: WorkSheetDeps,
  a: { userId: string; taskId: string; actor: SheetActor; reason?: string },
  kind: 'reject' | 'cancel',
) {
  assertHuman(a.actor)
  const projectId = await taskProject(deps, a.userId, a.taskId)
  const reason = typeof a.reason === 'string' ? a.reason.trim() : ''
  if (reason.length > MAX_REASON) throw new WorkError('INVALID', `reason must be up to ${MAX_REASON} characters`)
  if (kind === 'reject' && !reason) throw new WorkError('INVALID', 'a reason is required to reject')
  const key = await deps.dataKey(deps.db, a.userId)
  await deps.db.$transaction(async (tx) => {
    await lockProjectForWrite(tx, a.userId, projectId)
    const task = await lockTaskForWrite(tx, a.userId, projectId, a.taskId)
    if (task.status !== 'awaiting') throw new WorkError('STALE', 'the task is not awaiting approval')
    const applies = await approvalApplies(tx, projectId)
    const me = actorLabel(a.actor)
    const req = await readRequest(tx, key, a.taskId)
    let why: string
    if (kind === 'reject') {
      if (!applies) throw new WorkError('FORBIDDEN', 'approval is off — cancel the request instead')
      if (me === req.by) throw new WorkError('FORBIDDEN', 'the requester cannot reject their own request — cancel it')
      if (!(await eligibleApprovers(tx, projectId)).has(me)) throw new WorkError('FORBIDDEN', 'only an approver can reject')
      why = 'rejected'
    } else if (applies) {
      const isOwner = a.actor.type === 'human' && a.actor.memberId === undefined
      if (me !== req.by && !isOwner) throw new WorkError('FORBIDDEN', 'only the requester or the owner can cancel')
      why = me === req.by ? 'requester' : 'owner'
    } else {
      why = isEeFeatureEnabled('approval') ? 'disabled' : 'license_off'
    }
    await tx.workTask.update({ where: { id: a.taskId }, data: { status: 'open', approvalRequest: null } })
    await writeWorkEvent(tx, key, {
      userId: a.userId, projectId, taskId: a.taskId, actor: a.actor,
      action: kind === 'reject' ? 'approval_reject' : 'approval_cancel',
      detail: { requestedBy: req.by, why, ...(reason ? { reason } : {}) },
    })
  }, { timeout: TX_TIMEOUT_MS })
  return { status: 'open' as const }
}

export const rejectApproval = (deps: WorkSheetDeps, a: { userId: string; taskId: string; actor: SheetActor; reason?: string }) => closeRequest(deps, a, 'reject')
export const cancelApproval = (deps: WorkSheetDeps, a: { userId: string; taskId: string; actor: SheetActor; reason?: string }) => closeRequest(deps, a, 'cancel')

export async function readApprovalState(deps: WorkSheetDeps, a: { userId: string; projectId: string }) {
  const p = await deps.db.workProject.findFirst({ where: { id: a.projectId, userId: a.userId }, select: { agentId: true, approvalSettings: true } })
  if (!p) throw new WorkError('NOT_FOUND')
  const settings = parseApprovalSettings(p.approvalSettings) ?? { enabled: false, owner: false, members: [] }
  const licensed = isEeFeatureEnabled('approval')
  return { licensed, settings, applies: licensed && settings.enabled }
}

export async function setApprovalSettings(deps: WorkSheetDeps, a: { userId: string; projectId: string; actor: SheetActor; settings: unknown }) {
  assertHuman(a.actor)
  const next = parseApprovalSettings(a.settings)
  if (!next) throw new WorkError('INVALID', `settings must be { enabled: boolean, owner: boolean, members: positive integer ids (up to ${MAX_APPROVERS}) }`)
  if (next.enabled && !isEeFeatureEnabled('approval')) throw new WorkError('FORBIDDEN', 'an Enterprise license with approval is required')
  const key = await deps.dataKey(deps.db, a.userId)
  await deps.db.$transaction(async (tx) => {
    const project = await lockProjectForWrite(tx, a.userId, a.projectId)
    assertProjectWritable(project)
    const p = await tx.workProject.findUniqueOrThrow({ where: { id: a.projectId }, select: { agentId: true } })
    const members = p.agentId && next.members.length
      ? await tx.agentMember.findMany({ where: { id: { in: next.members }, agentAgentId: p.agentId }, select: { id: true, status: true } })
      : []
    if (members.length !== next.members.length) throw new WorkError('INVALID', 'every approver must be a member of this work app team')
    if (next.enabled) {
      const active = members.filter((m) => m.status === 'active').length
      if (next.owner ? active < 1 : active < 2) throw new WorkError('NO_APPROVER', 'approval needs at least two possible approvers so that someone other than the requester can approve')
    }
    await tx.workProject.update({ where: { id: a.projectId }, data: { approvalSettings: next as unknown as Prisma.InputJsonValue } })
    await writeWorkEvent(tx, key, { userId: a.userId, projectId: a.projectId, actor: a.actor, action: 'approval_settings', detail: next })
  }, { timeout: TX_TIMEOUT_MS })
  return next satisfies ApprovalSettings
}

async function nameOf(deps: WorkSheetDeps, label: string | null): Promise<string | null> {
  const m = label?.match(/^member:(\d+)$/)
  if (!m) return null
  const r = await deps.db.agentMember.findUnique({ where: { id: Number(m[1]) }, select: { displayName: true, email: true } })
  return r ? (r.displayName || r.email) : `#${m[1]}`
}

export async function readTaskApproval(deps: WorkSheetDeps, a: { userId: string; taskId: string; actor: SheetActor }) {
  const t = await deps.db.workTask.findFirst({
    where: { id: a.taskId, userId: a.userId },
    select: { projectId: true, status: true, approvalRequest: true, currentSubmissionId: true },
  })
  if (!t) throw new WorkError('NOT_FOUND')
  const me = actorLabel(a.actor)
  const isOwner = a.actor.type === 'human' && a.actor.memberId === undefined
  const { applies, approvers } = await deps.db.$transaction(async (tx) => ({
    applies: await approvalApplies(tx, t.projectId),
    approvers: await eligibleApprovers(tx, t.projectId),
  }))
  const key = t.approvalRequest || t.currentSubmissionId ? await deps.dataKey(deps.db, a.userId) : null
  const req = t.status === 'awaiting' && t.approvalRequest ? decryptJson<ApprovalRequest>(t.approvalRequest, key!) : null
  const seal = t.status === 'submitted' && t.currentSubmissionId
    ? await deps.db.workSubmission.findUnique({ where: { id: t.currentSubmissionId }, select: { preparedBy: true, approvedBy: true } })
    : null
  const human = a.actor.type === 'human'
  return {
    applies,
    status: t.status,
    request: req ? { byOwner: req.by === 'human', byName: await nameOf(deps, req.by), mine: req.by === me, at: req.at } : null,
    seal: seal?.approvedBy
      ? { preparedByOwner: seal.preparedBy === 'human', preparedBy: await nameOf(deps, seal.preparedBy), approvedByOwner: seal.approvedBy === 'human', approvedBy: await nameOf(deps, seal.approvedBy) }
      : null,
    can: {
      request: human && applies && t.status === 'open',
      approve: human && applies && !!req && req.by !== me && approvers.has(me),
      reject: human && applies && !!req && req.by !== me && approvers.has(me),
      cancel: human && !!req && (!applies || req.by === me || isOwner),
      unlock: human && t.status === 'submitted' && (!seal?.approvedBy || (seal.preparedBy !== me && approvers.has(me))),
    },
  }
}

export async function listApprovalCandidates(deps: WorkSheetDeps, a: { userId: string; projectId: string }) {
  const p = await deps.db.workProject.findFirst({ where: { id: a.projectId, userId: a.userId }, select: { agentId: true } })
  if (!p) throw new WorkError('NOT_FOUND')
  if (!p.agentId) return []
  const rows = await deps.db.agentMember.findMany({ where: { agentAgentId: p.agentId }, select: { id: true, displayName: true, email: true, status: true }, orderBy: { id: 'asc' } })
  return rows.map((r) => ({ id: r.id, name: r.displayName || r.email, active: r.status === 'active' }))
}
