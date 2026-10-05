
import { createHash } from 'crypto'
import type { Prisma, Workflow } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { safeLogToken, describeCaughtError } from '@/lib/log-mask'
import { validateTranslationTriggerModel } from '@/lib/workflow/validate-translation-model'
import { validateQuizGenerationModel } from '@/lib/workflow/validate-quiz-model'
import { validateQuizSignupNotice } from '@/lib/workflow/validate-quiz-notice'
import { inboundPstnNumbers } from '@/lib/call/pstn-inbound-routing'
import { validateWorkflowJson, type WorkflowValidationLevel } from '@/lib/workflow/validation'
import {
  SUB_WORKFLOW_KIND,
  collectSubWorkflowRefs,
  normalizeWorkflowKind,
  readSubWorkflowDefinition,
  subWorkflowToolFunctionName,
  withClonedSubWorkflowToolName,
  type WorkflowKind,
} from '@/lib/workflow/subworkflow'
import { assertWorkflowActivationAllowed } from '@/lib/entitlement'
import {
  parseBundleSpec,
  checkWiringBeforeSubstitution,
  checkWiringAfterSubstitution,
  checkResolvedIds,
  substituteBundleTokens,
  nextFreeDisplayName,
  nextFreeToolName,
  withBundleSubToolName,
  MAIN_GRAPH_KEY,
  type BundleGraphs,
  type BundleProblem,
  type ResolvedBundleIds,
} from './bundle'
import { createSchedule, updateSchedule, getScheduleByWorkflow } from '@/lib/schedule'
import { isSelfHosted } from '@/lib/edition'
import { SELF_HOSTED_POLICY } from '@/lib/selfhosted-policy'

// ========================================
// ========================================

export const VALID_WORKFLOW_STATUSES = ['draft', 'production', 'archived'] as const

export const MAX_WORKFLOW_VERSIONS = 10

export type WorkflowWriteSource = 'ui' | 'mcp' | 'ai-assistant' | 'restore' | 'pstn-number' | 'greeting'

const PRODUCTION_RESTORE_BLOCKED_MSG =
  'This workflow is live (production), so a previous version cannot be restored onto it. Switch it to draft first.'

const PRODUCTION_EDIT_BLOCKED_MSG =
  'This workflow is live (production). The AI Assistant does not edit live workflows — switch it to draft first, or edit it in the canvas.'

const BUNDLE_TX = { maxWait: 10_000, timeout: 30_000 } as const

const FREE_USER_MAX_WORKFLOWS = 10
const FREE_USER_MAX_PRODUCTION = 1

export interface WorkflowPlanLimits {
  isPaid: boolean
  maxWorkflows: number | null
  maxProduction: number
}

export function planLimitsFor(
  planType: string | null | undefined,
  subscriptionStatus: string | null | undefined,
): WorkflowPlanLimits {
  const isPaid = planType !== 'free' && subscriptionStatus === 'active'
  let maxProduction = FREE_USER_MAX_PRODUCTION
  if (isPaid) {
    const plan = planType || ''
    if (plan.includes('pro')) maxProduction = 40
    else if (plan.includes('growth')) maxProduction = 30
    else if (plan.includes('standard')) maxProduction = 20
    else maxProduction = 10 // starter
  }
  return { isPaid, maxWorkflows: isPaid ? null : FREE_USER_MAX_WORKFLOWS, maxProduction }
}

export function trafficWeightFor(status: string): number {
  return status === 'production' ? 100 : 0
}

export interface ScheduleDirective {
  enabled: boolean
  cronExpression?: string
  timezone: string
}

export function parseScheduleDirective(workflowJson: string): ScheduleDirective | null {
  try {
    const data = JSON.parse(workflowJson)
    const startNode = data.nodes?.find((node: any) => node.data?.nodeType === 'start')
    const cronExpression = startNode?.data?.cronExpression
    const enabled = startNode?.data?.scheduleEnabled === true && !!cronExpression
    const timezone = startNode?.data?.scheduleTimezone || 'UTC'
    return { enabled, cronExpression, timezone }
  } catch {
    return null
  }
}

export function generateWorkflowId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = 'wf_'
  for (let i = 0; i < 20; i++) {
    id += chars[Math.floor(Math.random() * chars.length)]
  }
  return id
}

// ========================================
// ========================================

export interface WorkflowServiceError {
  ok: false
  status: number
  code: string
  message: string
  meta?: Record<string, unknown>
}

export type WorkflowServiceResult<T> = ({ ok: true } & T) | WorkflowServiceError

function fail(status: number, code: string, message: string, meta?: Record<string, unknown>): WorkflowServiceError {
  return { ok: false, status, code, message, ...(meta ? { meta } : {}) }
}

function isServiceError(v: unknown): v is WorkflowServiceError {
  return typeof v === 'object' && v !== null && (v as { ok?: unknown }).ok === false
}

// ========================================
// ========================================

type OwnedWorkflow = Workflow & { agent: { userId: string; agentId: string } }

async function resolveOwnedWorkflow(
  userId: string,
  workflowId: string,
): Promise<WorkflowServiceResult<{ workflow: OwnedWorkflow }>> {
  const workflow = await prisma.workflow.findUnique({
    where: { workflowId },
    include: { agent: { select: { userId: true, agentId: true } } },
  })
  if (!workflow) return fail(404, 'NOT_FOUND', 'Workflow not found')
  if (workflow.agent.userId !== userId) return fail(403, 'FORBIDDEN', 'Forbidden')
  return { ok: true, workflow }
}

export async function getOwnedWorkflow(
  userId: string,
  workflowId: string,
): Promise<WorkflowServiceResult<{ workflow: OwnedWorkflow }>> {
  return resolveOwnedWorkflow(userId, workflowId)
}

async function getPlanLimits(userId: string): Promise<WorkflowPlanLimits> {
  if (isSelfHosted()) {
    return { isPaid: true, maxWorkflows: SELF_HOSTED_POLICY.maxWorkflows, maxProduction: SELF_HOSTED_POLICY.maxProduction }
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { subscription: { select: { status: true, planType: true } } },
  })
  return planLimitsFor(user?.subscription?.planType, user?.subscription?.status)
}

function assertWorkflowJsonValid(
  workflowJson: string,
  level: WorkflowValidationLevel,
  kind: WorkflowKind = 'main',
): WorkflowServiceError | null {
  const result = validateWorkflowJson(workflowJson, level, kind)
  if (result.valid) return null
  const code = level === 'deployable' ? 'WORKFLOW_NOT_DEPLOYABLE' : 'WORKFLOW_STRUCTURE_INVALID'
  const summary = result.issues.map(i => i.message).join('; ')
  return fail(400, code, `Workflow validation failed: ${summary}`, { issues: result.issues })
}

function assertQuizModelGuard(workflowJson: string): WorkflowServiceError | null {
  const guard = validateQuizGenerationModel(workflowJson)
  if (guard.ok) return null
  return fail(400, guard.code ?? 'QUIZ_MODEL_NOT_SUPPORTED', guard.error ?? 'Quiz model is not supported.')
}

function assertQuizNoticeGuard(workflowJson: string): WorkflowServiceError | null {
  const guard = validateQuizSignupNotice(workflowJson)
  if (guard.ok) return null
  return fail(400, guard.code, guard.error)
}

function assertTranslationGuard(workflowJson: string): WorkflowServiceError | null {
  const guard = validateTranslationTriggerModel(workflowJson, { failOnInvalidJson: true })
  if (guard.ok) return null
  return fail(400, guard.code ?? 'WORKFLOW_JSON_INVALID', guard.error ?? 'Workflow cannot be validated for production.')
}

async function lockPstnInboundScope(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(4202, hashtext(${userId}))`
}

function newlyInboundNumbers(nextJson: string, prev: { status: string; workflowJson: string }): string[] {
  const next = inboundPstnNumbers(nextJson)
  if (prev.status !== 'production') return next
  const before = new Set(inboundPstnNumbers(prev.workflowJson))
  return next.filter(n => !before.has(n))
}

async function assertPstnInboundFreeLocked(
  tx: Prisma.TransactionClient,
  args: { userId: string; workflowId: string | null; numbers: string[] },
): Promise<WorkflowServiceError | null> {
  if (args.numbers.length === 0) return null
  const others = await tx.workflow.findMany({
    where: {
      status: 'production',
      agent: { userId: args.userId },
      ...(args.workflowId ? { NOT: { workflowId: args.workflowId } } : {}),
    },
    select: { workflowId: true, name: true, workflowJson: true, agent: { select: { agentId: true, title: true } } },
    orderBy: { createdAt: 'asc' },
  })
  for (const w of others) {
    const taken = inboundPstnNumbers(w.workflowJson).find(n => args.numbers.includes(n))
    if (taken) {
      return fail(
        409,
        'PSTN_NUMBER_IN_USE',
        `Phone number ${taken} already receives calls in workflow "${w.name}" (agent "${w.agent.title}"). ` +
          `Set that workflow's phone number to "Not connected" (or switch it to outbound calls) first.`,
        { phoneNumber: taken, conflictWorkflowId: w.workflowId, conflictWorkflowName: w.name, conflictAgentId: w.agent.agentId },
      )
    }
  }
  return null
}

interface ActivationPolicy {
  block: { code: string; message: string } | null
  limits: WorkflowPlanLimits
}

async function loadActivationPolicy(userId: string): Promise<ActivationPolicy> {
  const [block, limits] = await Promise.all([
    assertWorkflowActivationAllowed(userId),
    getPlanLimits(userId),
  ])
  return { block, limits }
}

async function assertActivationGate(
  policy: ActivationPolicy,
  agentId: string,
  client: Prisma.TransactionClient = prisma,
): Promise<WorkflowServiceError | null> {
  if (policy.block) return fail(403, policy.block.code, policy.block.message)

  const { limits } = policy
  const currentProductionCount = await client.workflow.count({
    where: { agentId, status: 'production' },
  })
  if (currentProductionCount >= limits.maxProduction) {
    return fail(
      400,
      limits.isPaid ? 'paid_limit_reached' : 'free_limit_reached',
      limits.isPaid
        ? `Production workflow limit reached (${limits.maxProduction}).`
        : `Free plan allows only ${limits.maxProduction} production workflow. Upgrade to deploy more.`,
      { maxProduction: limits.maxProduction },
    )
  }
  return null
}

const SUB_WORKFLOW_NOT_DEPLOYABLE = fail(
  400,
  'SUB_WORKFLOW_NOT_DEPLOYABLE',
  'A Sub-workflow cannot be deployed. It is called by reference from the workflows that attach it as an AI tool — its saved version is what they run.',
)

async function assertSubWorkflowRefsLocked(
  tx: Prisma.TransactionClient,
  input: { agentId: string; workflowJson: string; kind: WorkflowKind; selfWorkflowId?: string | null },
): Promise<WorkflowServiceError | null> {
  const refs = collectSubWorkflowRefs(input.workflowJson)
  if (refs.length > 0) {
    const rows = await tx.workflow.findMany({
      where: { workflowId: { in: refs }, agentId: input.agentId },
      select: { workflowId: true, kind: true, status: true },
    })
    const byId = new Map(rows.map((r) => [r.workflowId, r]))
    const bad: Array<{ subWorkflowId: string; reason: string }> = []
    for (const id of refs) {
      const row = byId.get(id)
      if (!row) bad.push({ subWorkflowId: id, reason: 'not found in this agent' })
      else if (normalizeWorkflowKind(row.kind) !== SUB_WORKFLOW_KIND) bad.push({ subWorkflowId: id, reason: 'not a Sub-workflow (kind is main)' })
      else if (row.status === 'archived') bad.push({ subWorkflowId: id, reason: 'archived' })
    }
    if (bad.length > 0) {
      return fail(
        400,
        'SUB_WORKFLOW_REF_INVALID',
        `Sub-workflow tool reference is invalid: ${bad.map((b) => `${b.subWorkflowId} (${b.reason})`).join('; ')}. Attach a Sub-workflow (kind "sub") of the same agent that is not archived.`,
        { refs: bad },
      )
    }
  }
  if (input.kind === SUB_WORKFLOW_KIND) {
    const def = readSubWorkflowDefinition(input.workflowJson)
    if (def.ok) {
      const siblings = await tx.workflow.findMany({
        where: {
          agentId: input.agentId,
          kind: SUB_WORKFLOW_KIND,
          ...(input.selfWorkflowId ? { workflowId: { not: input.selfWorkflowId } } : {}),
        },
        select: { workflowId: true, name: true, workflowJson: true },
      })
      for (const sib of siblings) {
        const other = readSubWorkflowDefinition(sib.workflowJson)
        if (other.ok && other.def.toolName === def.def.toolName) {
          return fail(
            400,
            'SUB_WORKFLOW_TOOL_NAME_TAKEN',
            `toolName "${def.def.toolName}" is already used by Sub-workflow "${sib.name}" (${sib.workflowId}) in this agent — pick another name.`,
            { toolName: def.def.toolName, takenBy: sib.workflowId },
          )
        }
      }
    }
  }
  return null
}

async function findSubWorkflowReferrers(
  db: Prisma.TransactionClient,
  input: { agentId: string; subWorkflowId: string; includeArchived: boolean },
): Promise<Array<{ workflowId: string; name: string; status: string }>> {
  const candidates = await db.workflow.findMany({
    where: {
      agentId: input.agentId,
      workflowId: { not: input.subWorkflowId },
      workflowJson: { contains: input.subWorkflowId },
      ...(input.includeArchived ? {} : { status: { not: 'archived' } }),
    },
    select: { workflowId: true, name: true, status: true, workflowJson: true },
  })
  return candidates
    .filter((c) => collectSubWorkflowRefs(c.workflowJson).includes(input.subWorkflowId))
    .map(({ workflowId, name, status }) => ({ workflowId, name, status }))
}

async function assertSubWorkflowNotReferencedLocked(
  tx: Prisma.TransactionClient,
  workflow: { workflowId: string; agentId: string; kind: string | null },
  action: 'archive' | 'delete',
): Promise<WorkflowServiceError | null> {
  if (normalizeWorkflowKind(workflow.kind) !== SUB_WORKFLOW_KIND) return null
  const referrers = await findSubWorkflowReferrers(tx, {
    agentId: workflow.agentId,
    subWorkflowId: workflow.workflowId,
    includeArchived: action === 'delete',
  })
  if (referrers.length === 0) return null
  const names = referrers.map((r) => `"${r.name}" (${r.workflowId}, ${r.status})`).join(', ')
  return fail(
    409,
    'SUB_WORKFLOW_IN_USE',
    `This Sub-workflow is still attached as an AI tool by ${referrers.length} workflow(s): ${names}. Remove the Sub-workflow tool from those workflows first, then ${action} it.`,
    { referrers },
  )
}

async function assertWorkflowCountLimit(
  limits: WorkflowPlanLimits,
  agentId: string,
  client: Prisma.TransactionClient,
): Promise<WorkflowServiceError | null> {
  if (limits.maxWorkflows == null) return null
  const count = await client.workflow.count({ where: { agentId } })
  if (count >= limits.maxWorkflows) {
    return fail(
      400,
      'workflow_limit_reached',
      `Workflow limit reached (${limits.maxWorkflows}). Upgrade your plan to create more workflows.`,
      { maxWorkflows: limits.maxWorkflows },
    )
  }
  return null
}

async function syncWorkflowSchedule(workflowId: string, agentId: string, workflowJson: string): Promise<void> {
  const directive = parseScheduleDirective(workflowJson)
  if (!directive) return

  try {
    await applyScheduleDirective(workflowId, agentId, directive)
  } catch (err) {
    console.error(`[WorkflowService] schedule sync failed for ${safeLogToken(workflowId)}:`, describeCaughtError(err))
  }
}

async function applyScheduleDirective(workflowId: string, agentId: string, directive: ScheduleDirective): Promise<void> {
  if (directive.enabled && directive.cronExpression) {
    const existingSchedule = await getScheduleByWorkflow(workflowId)
    if (existingSchedule) {
      await updateSchedule(existingSchedule.id, {
        cronExpression: directive.cronExpression,
        timezone: directive.timezone,
        enabled: true,
      })
    } else {
      await createSchedule(workflowId, agentId, directive.cronExpression, directive.timezone, true)
    }
  } else {
    await prisma.workflowSchedule.deleteMany({ where: { workflowId } })
  }
}

// ========================================
//
// ========================================

interface LockedWorkflowRow {
  id: number
  workflowId: string
  agentId: string
  name: string
  description: string | null
  status: string
  workflowJson: string
  version: number
  updatedAt: Date
  kind: string
}

class WorkflowWriteAbort extends Error {
  constructor(public readonly failure: WorkflowServiceError) {
    super(failure.message)
  }
}

async function runVersionedTx<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: { maxWait: number; timeout: number },
): Promise<T | WorkflowServiceError> {
  try {
    return await prisma.$transaction(fn, options)
  } catch (err) {
    if (err instanceof WorkflowWriteAbort) return err.failure
    throw err
  }
}

async function lockAgentRow(tx: Prisma.TransactionClient, agentId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ agentId: string }[]>`
    SELECT "agentId" FROM agents WHERE "agentId" = ${agentId} FOR UPDATE`
  return rows.length > 0
}

async function lockWorkflowRow(tx: Prisma.TransactionClient, workflowId: string): Promise<LockedWorkflowRow | null> {
  const rows = await tx.$queryRaw<LockedWorkflowRow[]>`
    SELECT id, "workflowId", "agentId", name, description, status,
           workflow_json AS "workflowJson", version, updated_at AS "updatedAt", kind
    FROM workflows
    WHERE "workflowId" = ${workflowId}
    FOR UPDATE`
  return rows[0] ?? null
}

async function casWriteLocked(
  tx: Prisma.TransactionClient,
  cur: LockedWorkflowRow,
  input: {
    newJson: string
    metadata?: Record<string, unknown>
    source: WorkflowWriteSource
    createdById?: string | null
    note?: string | null
  },
): Promise<void> {
  const res = await tx.workflow.updateMany({
    where: { workflowId: cur.workflowId, version: cur.version },
    data: { ...(input.metadata ?? {}), workflowJson: input.newJson, version: cur.version + 1 },
  })
  if (res.count === 0) {
    throw new WorkflowWriteAbort(
      fail(409, 'STALE_CONFLICT', 'Workflow was modified by another session. Reload and retry.', {
        currentVersion: cur.version,
      }),
    )
  }
  if (input.newJson !== cur.workflowJson) {
    await tx.workflowVersion.create({
      data: {
        workflowId: cur.workflowId,
        version: cur.version,
        workflowJson: cur.workflowJson,
        name: cur.name,
        description: cur.description,
        source: input.source,
        createdById: input.createdById ?? null,
        note: input.note ?? null,
      },
    })
  }
  const keep = await tx.workflowVersion.findMany({
    where: { workflowId: cur.workflowId },
    orderBy: { version: 'desc' },
    take: MAX_WORKFLOW_VERSIONS,
    select: { id: true },
  })
  await tx.workflowVersion.deleteMany({
    where: { workflowId: cur.workflowId, id: { notIn: keep.map((k) => k.id) } },
  })
}

export async function patchWorkflowJsonNarrow(input: {
  workflowId: string
  mutate?: (currentJson: string) => string | null
  newJson?: string
  expectedUpdatedAt?: Date
  source: 'pstn-number' | 'greeting'
  createdById?: string
  note?: string
}): Promise<WorkflowServiceResult<{ workflow: Workflow; changed: boolean }>> {
  const ownerId = (
    await prisma.workflow.findUnique({
      where: { workflowId: input.workflowId },
      select: { agent: { select: { userId: true } } },
    })
  )?.agent.userId
  const lockInbound = !!ownerId && input.newJson !== undefined && inboundPstnNumbers(input.newJson).length > 0
  const result = await runVersionedTx(async (tx) => {
    if (lockInbound) await lockPstnInboundScope(tx, ownerId!)
    const cur = await lockWorkflowRow(tx, input.workflowId)
    if (!cur) throw new WorkflowWriteAbort(fail(404, 'NOT_FOUND', 'Workflow not found'))
    if (input.expectedUpdatedAt && cur.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) {
      throw new WorkflowWriteAbort(fail(409, 'STALE_CONFLICT', 'Workflow was modified. Reload and retry.'))
    }
    const effectiveJson = input.mutate ? input.mutate(cur.workflowJson) : input.newJson
    if (effectiveJson == null) {
      const wf = await tx.workflow.findUniqueOrThrow({ where: { workflowId: input.workflowId } })
      return { workflow: wf, changed: false }
    }
    if (cur.status === 'production' && ownerId) {
      const inboundError = await assertPstnInboundFreeLocked(tx, {
        userId: ownerId,
        workflowId: cur.workflowId,
        numbers: newlyInboundNumbers(effectiveJson, cur),
      })
      if (inboundError) throw new WorkflowWriteAbort(inboundError)
    }
    await casWriteLocked(tx, cur, {
      newJson: effectiveJson,
      source: input.source,
      createdById: input.createdById,
      note: input.note,
    })
    const wf = await tx.workflow.findUniqueOrThrow({ where: { workflowId: input.workflowId } })
    return { workflow: wf, changed: true }
  })
  if (isServiceError(result)) return result
  return { ok: true, workflow: result.workflow, changed: result.changed }
}

// ========================================
// Mutations
// ========================================

interface PreparedWorkflowCreate {
  name: string
  description: string | null
  workflowJson: string
  status: string
  kind: WorkflowKind
  templateBinding: string | null
}

export function prepareWorkflowCreate(input: {
  name: string
  description?: string | null
  workflowJson?: string
  status?: string
  templateBinding?: string
  kind?: WorkflowKind
}): WorkflowServiceError | PreparedWorkflowCreate {
  if (!input.name) return fail(400, 'NAME_REQUIRED', 'Name is required')

  const status = input.status || 'draft'
  if (!(VALID_WORKFLOW_STATUSES as readonly string[]).includes(status)) {
    return fail(400, 'INVALID_STATUS', `Invalid status. Must be one of: ${VALID_WORKFLOW_STATUSES.join(', ')}`)
  }
  const kind = normalizeWorkflowKind(input.kind)
  if (kind === SUB_WORKFLOW_KIND && status === 'production') return SUB_WORKFLOW_NOT_DEPLOYABLE

  const workflowJson = input.workflowJson || JSON.stringify({ nodes: [], edges: [] })

  const validationError = assertWorkflowJsonValid(workflowJson, status === 'production' ? 'deployable' : 'structural', kind)
  if (validationError) return validationError
  const quizGuardError = assertQuizModelGuard(workflowJson)
  if (quizGuardError) return quizGuardError
  const noticeGuardError = assertQuizNoticeGuard(workflowJson)
  if (noticeGuardError) return noticeGuardError

  return {
    name: input.name,
    description: input.description ?? null,
    workflowJson,
    status,
    kind,
    templateBinding: input.templateBinding ?? null,
  }
}

async function insertPreparedWorkflowTx(
  tx: Prisma.TransactionClient,
  args: { agentId: string; prepared: PreparedWorkflowCreate; workflowId?: string },
): Promise<Workflow> {
  const { agentId, prepared } = args
  const refError = await assertSubWorkflowRefsLocked(tx, {
    agentId,
    workflowJson: prepared.workflowJson,
    kind: prepared.kind,
  })
  if (refError) throw new WorkflowWriteAbort(refError)
  return tx.workflow.create({
    data: {
      workflowId: args.workflowId ?? generateWorkflowId(),
      agentId,
      name: prepared.name,
      description: prepared.description,
      workflowJson: prepared.workflowJson,
      status: prepared.status,
      trafficWeight: trafficWeightFor(prepared.status),
      templateBinding: prepared.templateBinding,
      kind: prepared.kind,
    },
  })
}

export async function createWorkflow(input: {
  userId: string
  agentId: string
  name: string
  description?: string | null
  workflowJson?: string
  status?: string
  templateBinding?: string
  kind?: WorkflowKind
}): Promise<WorkflowServiceResult<{ workflow: Workflow }>> {
  const agent = await prisma.agent.findFirst({
    where: { agentId: input.agentId, userId: input.userId },
    select: { agentId: true },
  })
  if (!agent) return fail(404, 'AGENT_NOT_FOUND', 'Agent not found')

  const prepared = prepareWorkflowCreate(input)
  if (isServiceError(prepared)) return prepared

  const limits = await getPlanLimits(input.userId)
  let policy: ActivationPolicy | null = null
  if (prepared.status === 'production') {
    const guardError = assertTranslationGuard(prepared.workflowJson)
    if (guardError) return guardError
    policy = await loadActivationPolicy(input.userId)
  }

  const newInbound = prepared.status === 'production' ? inboundPstnNumbers(prepared.workflowJson) : []
  const result = await runVersionedTx(async (tx) => {
    if (newInbound.length > 0) await lockPstnInboundScope(tx, input.userId)
    if (!(await lockAgentRow(tx, input.agentId))) {
      throw new WorkflowWriteAbort(fail(404, 'AGENT_NOT_FOUND', 'Agent not found'))
    }
    const countError = await assertWorkflowCountLimit(limits, input.agentId, tx)
    if (countError) throw new WorkflowWriteAbort(countError)
    if (policy) {
      const gateError = await assertActivationGate(policy, input.agentId, tx)
      if (gateError) throw new WorkflowWriteAbort(gateError)
    }
    const inboundError = await assertPstnInboundFreeLocked(tx, { userId: input.userId, workflowId: null, numbers: newInbound })
    if (inboundError) throw new WorkflowWriteAbort(inboundError)
    return insertPreparedWorkflowTx(tx, { agentId: input.agentId, prepared })
  })
  if (isServiceError(result)) return result
  await syncWorkflowSchedule(result.workflowId, input.agentId, prepared.workflowJson)
  return { ok: true, workflow: result }
}

export async function createWorkflowBundle(input: {
  userId: string
  agentId: string
  template: unknown
  name?: string
  description?: string | null
  templateBinding?: string
}): Promise<WorkflowServiceResult<{
  workflow: Workflow
  subWorkflows: Workflow[]
  dataSheetIds: string[]
  groupId: string | null
}>> {
  const agent = await prisma.agent.findFirst({
    where: { agentId: input.agentId, userId: input.userId },
    select: { agentId: true },
  })
  if (!agent) return fail(404, 'AGENT_NOT_FOUND', 'Agent not found')

  const bundleFail = (code: string, problems: BundleProblem[]) =>
    fail(400, code, problems.map((p) => p.message).join('; '), { problems })
  const abortBundle: (code: string, problems: BundleProblem[]) => never = (code, problems) => {
    throw new WorkflowWriteAbort(bundleFail(code, problems))
  }

  const parsed = parseBundleSpec(input.template)
  if (parsed === null) return fail(400, 'BUNDLE_NOT_A_BUNDLE', 'This template is not a bundle template.')
  if (!parsed.ok) return bundleFail('BUNDLE_INVALID', parsed.problems)
  const spec = parsed.value

  const t = input.template as Record<string, unknown>
  const mainJsonRaw = typeof t.workflowJson === 'string' ? t.workflowJson : JSON.stringify(t.workflowJson ?? {})
  const mainName = input.name || (typeof t.name === 'string' ? t.name : '')

  const graphs: BundleGraphs = {}
  try {
    graphs[MAIN_GRAPH_KEY] = JSON.parse(mainJsonRaw)
    for (const sub of spec.subWorkflows) graphs[sub.key] = JSON.parse(sub.workflowJson)
  } catch {
    return fail(400, 'BUNDLE_JSON_INVALID', 'A workflow in this bundle is not valid JSON.')
  }
  if (!Array.isArray((graphs[MAIN_GRAPH_KEY] as { nodes?: unknown }).nodes) || (graphs[MAIN_GRAPH_KEY] as { nodes: unknown[] }).nodes.length === 0) {
    return fail(400, 'BUNDLE_MAIN_EMPTY', 'This bundle template has no main workflow graph.')
  }
  const beforeProblems = checkWiringBeforeSubstitution(graphs, spec)
  if (beforeProblems.length > 0) return bundleFail('BUNDLE_WIRING_INVALID', beforeProblems)

  const preparedSubs: Array<{ key: string; prepared: ReturnType<typeof prepareWorkflowCreate> }> = []
  for (const sub of spec.subWorkflows) {
    preparedSubs.push({
      key: sub.key,
      prepared: prepareWorkflowCreate({ name: sub.name, description: sub.description ?? null, workflowJson: sub.workflowJson, kind: SUB_WORKFLOW_KIND }),
    })
  }
  for (const { prepared } of preparedSubs) if (isServiceError(prepared)) return prepared
  const preparedMain = prepareWorkflowCreate({
    name: mainName,
    description: input.description ?? (typeof t.description === 'string' ? t.description : null),
    workflowJson: mainJsonRaw,
    templateBinding: input.templateBinding,
  })
  if (isServiceError(preparedMain)) return preparedMain

  const limits = await getPlanLimits(input.userId)
  const totalWorkflows = spec.subWorkflows.length + 1

  let result: Awaited<ReturnType<typeof runBundleTx>> | WorkflowServiceError
  try {
    result = await runBundleTx()
  } catch (e) {
    console.error('[WorkflowService] createWorkflowBundle 실패:', input.agentId, describeCaughtError(e))
    return fail(500, 'BUNDLE_CREATE_FAILED', 'Could not create the workflows for this template. Nothing was created — please try again.')
  }

  async function runBundleTx() {
   return runVersionedTx(async (tx) => {
    if (!(await lockAgentRow(tx, input.agentId))) {
      throw new WorkflowWriteAbort(fail(404, 'AGENT_NOT_FOUND', 'Agent not found'))
    }
    if (limits.maxWorkflows != null) {
      const count = await tx.workflow.count({ where: { agentId: input.agentId } })
      const free = limits.maxWorkflows - count
      if (free < totalWorkflows) {
        throw new WorkflowWriteAbort(fail(
          400,
          'workflow_limit_reached',
          `This template creates ${totalWorkflows} workflows but only ${Math.max(0, free)} slot(s) are left (limit ${limits.maxWorkflows}). Upgrade your plan or remove a workflow first.`,
          { maxWorkflows: limits.maxWorkflows, needed: totalWorkflows, free: Math.max(0, free) },
        ))
      }
    }
    const [existingSheets, existingGroups, siblingSubs] = await Promise.all([
      tx.dataSheet.findMany({ where: { agentId: input.agentId }, select: { name: true } }),
      tx.workflowGroup.findMany({ where: { agentId: input.agentId }, select: { name: true } }),
      tx.workflow.findMany({ where: { agentId: input.agentId, kind: SUB_WORKFLOW_KIND }, select: { workflowJson: true } }),
    ])
    const takenSheetNames = new Set(existingSheets.map((r) => r.name))
    const takenGroupNames = new Set(existingGroups.map((r) => r.name))
    const takenToolNames = new Set<string>()
    for (const row of siblingSubs) {
      const d = readSubWorkflowDefinition(row.workflowJson)
      if (d.ok) takenToolNames.add(d.def.toolName)
    }

    const sheetIds: Record<string, string> = {}
    const sheetNames: Record<string, string> = {}
    const sheetOwner = spec.dataSheets.length > 0
      ? (await tx.agent.findUniqueOrThrow({ where: { agentId: input.agentId }, select: { userId: true } })).userId
      : null
    for (const sheet of spec.dataSheets) {
      const finalName = nextFreeDisplayName(sheet.name, (n) => takenSheetNames.has(n))
      if (!finalName) abortBundle('BUNDLE_NAME_EXHAUSTED', [{ code: 'BUNDLE_NAME_EXHAUSTED', message: `Could not find a free name for the data sheet "${sheet.name}".` }])
      takenSheetNames.add(finalName)
      const created = await tx.dataSheet.create({
        data: {
          agentId: input.agentId,
          userId: sheetOwner,
          name: finalName,
          description: sheet.description ?? null,
          schema: JSON.stringify({ columns: sheet.columns }),
          sizeBytes: BigInt(0),
          rowCount: 0,
        },
      })
      sheetIds[sheet.key] = created.id
      sheetNames[sheet.key] = finalName
    }

    const subIds: Record<string, string> = {}
    const subToolNames: Record<string, string> = {}
    const finalSubJson: Record<string, string> = {}
    for (const sub of spec.subWorkflows) {
      const def = readSubWorkflowDefinition(sub.workflowJson)
      const base = def.ok ? def.def.toolName : ''
      const finalTool = nextFreeToolName(base, (n) => takenToolNames.has(n))
      if (!finalTool) abortBundle('BUNDLE_TOOL_NAME_EXHAUSTED', [{ code: 'BUNDLE_TOOL_NAME_EXHAUSTED', message: `Could not find a free tool name for the sub-workflow "${sub.name}".` }])
      takenToolNames.add(finalTool)
      subIds[sub.key] = generateWorkflowId()
      subToolNames[sub.key] = subWorkflowToolFunctionName(finalTool)
      if (finalTool === base) {
        finalSubJson[sub.key] = sub.workflowJson
      } else {
        const renamed = withBundleSubToolName(sub.workflowJson, finalTool)
        if (renamed === null) abortBundle('BUNDLE_TOOL_RENAME_FAILED', [{ code: 'BUNDLE_TOOL_RENAME_FAILED', message: `Could not rename the tool of sub-workflow "${sub.name}" — its Start node is not a single Sub-workflow start.` }])
        finalSubJson[sub.key] = renamed
      }
    }

    const ids: ResolvedBundleIds = { subIds, subToolNames, sheetIds, sheetNames }
    const resolvedProblems = checkResolvedIds(spec, ids)
    if (resolvedProblems.length > 0) abortBundle('BUNDLE_RESOLVE_FAILED', resolvedProblems)

    const finalGraphs: BundleGraphs = {}
    finalGraphs[MAIN_GRAPH_KEY] = JSON.parse(mainJsonRaw)
    for (const sub of spec.subWorkflows) finalGraphs[sub.key] = JSON.parse(finalSubJson[sub.key])
    const substituted = substituteBundleTokens(finalGraphs, spec, ids)

    const afterProblems = checkWiringAfterSubstitution(substituted, spec, ids)
    if (afterProblems.length > 0) abortBundle('BUNDLE_WIRING_UNRESOLVED', afterProblems)

    const revalidate = (
      key: string,
      base: PreparedWorkflowCreate,
      json: string,
    ): PreparedWorkflowCreate => {
      const again = prepareWorkflowCreate({
        name: base.name,
        description: base.description,
        workflowJson: json,
        status: base.status,
        kind: base.kind,
        ...(base.templateBinding === null ? {} : { templateBinding: base.templateBinding }),
      })
      if (isServiceError(again)) {
        throw new WorkflowWriteAbort({ ...again, message: `${key}: ${again.message}` })
      }
      return again
    }

    const createdSubs: Workflow[] = []
    for (const { key, prepared } of preparedSubs) {
      if (isServiceError(prepared)) throw new WorkflowWriteAbort(prepared)
      createdSubs.push(await insertPreparedWorkflowTx(tx, {
        agentId: input.agentId,
        prepared: revalidate(key, prepared, JSON.stringify(substituted[key])),
        workflowId: subIds[key],
      }))
    }
    if (isServiceError(preparedMain)) throw new WorkflowWriteAbort(preparedMain)
    const createdMain = await insertPreparedWorkflowTx(tx, {
      agentId: input.agentId,
      prepared: revalidate(MAIN_GRAPH_KEY, preparedMain, JSON.stringify(substituted[MAIN_GRAPH_KEY])),
    })

    let groupId: string | null = null
    if (spec.group) {
      const groupName = nextFreeDisplayName(spec.group.name, (n) => takenGroupNames.has(n))
      if (!groupName) abortBundle('BUNDLE_NAME_EXHAUSTED', [{ code: 'BUNDLE_NAME_EXHAUSTED', message: `Could not find a free name for the group "${spec.group.name}".` }])
      const group = await tx.workflowGroup.create({ data: { agentId: input.agentId, name: groupName } })
      groupId = group.id
      await tx.workflowGroupItem.createMany({
        data: [createdMain, ...createdSubs].map((wf, order) => ({ groupId: group.id, workflowId: wf.workflowId, order })),
      })
      const sheetIdList = Object.values(sheetIds)
      if (sheetIdList.length > 0) {
        await tx.workflowGroupDataSheet.createMany({ data: sheetIdList.map((sheetId) => ({ groupId: group.id, sheetId })) })
      }
    }

    return {
      workflow: createdMain,
      subWorkflows: createdSubs,
      dataSheetIds: Object.values(sheetIds),
      groupId,
      mainJson: JSON.stringify(substituted[MAIN_GRAPH_KEY]),
    }
   }, BUNDLE_TX)
  }
  if (isServiceError(result)) return result

  await syncWorkflowSchedule(result.workflow.workflowId, input.agentId, result.mainJson)

  return {
    ok: true,
    workflow: result.workflow,
    subWorkflows: result.subWorkflows,
    dataSheetIds: result.dataSheetIds,
    groupId: result.groupId,
  }
}

export async function cloneWorkflow(input: {
  userId: string
  workflowId: string
  name?: string
}): Promise<WorkflowServiceResult<{ workflow: Workflow }>> {
  const resolved = await resolveOwnedWorkflow(input.userId, input.workflowId)
  if (!resolved.ok) return resolved
  const original = resolved.workflow
  const kind = normalizeWorkflowKind(original.kind)
  const validationError = assertWorkflowJsonValid(original.workflowJson, 'structural', kind)
  if (validationError) return validationError
  const quizGuardError = assertQuizModelGuard(original.workflowJson)
  if (quizGuardError) return quizGuardError
  const noticeGuardError = assertQuizNoticeGuard(original.workflowJson)
  if (noticeGuardError) return noticeGuardError

  const limits = await getPlanLimits(input.userId)

  const result = await runVersionedTx(async (tx) => {
    if (!(await lockAgentRow(tx, original.agentId))) {
      throw new WorkflowWriteAbort(fail(404, 'AGENT_NOT_FOUND', 'Agent not found'))
    }
    const countError = await assertWorkflowCountLimit(limits, original.agentId, tx)
    if (countError) throw new WorkflowWriteAbort(countError)
    let clonedJson = original.workflowJson
    if (kind === SUB_WORKFLOW_KIND) {
      const siblings = await tx.workflow.findMany({ where: { agentId: original.agentId, kind: SUB_WORKFLOW_KIND }, select: { workflowJson: true } })
      const taken = new Set<string>()
      for (const sib of siblings) { const d = readSubWorkflowDefinition(sib.workflowJson); if (d.ok) taken.add(d.def.toolName) }
      clonedJson = withClonedSubWorkflowToolName(original.workflowJson, (name) => taken.has(name))
    }
    const refError = await assertSubWorkflowRefsLocked(tx, { agentId: original.agentId, workflowJson: clonedJson, kind })
    if (refError) throw new WorkflowWriteAbort(refError)
    return tx.workflow.create({
      data: {
        workflowId: generateWorkflowId(),
        agentId: original.agentId,
        name: input.name || `${original.name} (Copy)`,
        description: original.description,
        workflowJson: clonedJson,
        status: 'draft',
        trafficWeight: 0,
        kind,
      },
    })
  })
  if (isServiceError(result)) return result
  return { ok: true, workflow: result }
}

export async function renameWorkflow(input: {
  userId: string
  workflowId: string
  name: string
}): Promise<WorkflowServiceResult<{ workflow: Workflow }>> {
  if (!input.name) return fail(400, 'NAME_REQUIRED', 'Name is required')
  const resolved = await resolveOwnedWorkflow(input.userId, input.workflowId)
  if (!resolved.ok) return resolved

  const workflow = await prisma.workflow.update({
    where: { workflowId: input.workflowId },
    data: { name: input.name },
  })
  return { ok: true, workflow }
}

async function activateWorkflowLocked(
  tx: Prisma.TransactionClient,
  input: {
    workflowId: string
    agentId: string
    userId: string
    policy: ActivationPolicy
    expectedVersion?: number
    metadata?: Record<string, unknown>
    guardWhenAlreadyProduction: boolean
  },
): Promise<{ workflow: Workflow; previousStatus: string }> {
  await lockPstnInboundScope(tx, input.userId)
  if (!(await lockAgentRow(tx, input.agentId))) {
    throw new WorkflowWriteAbort(fail(404, 'AGENT_NOT_FOUND', 'Agent not found'))
  }
  const cur = await lockWorkflowRow(tx, input.workflowId)
  if (!cur) throw new WorkflowWriteAbort(fail(404, 'NOT_FOUND', 'Workflow not found'))
  if (input.expectedVersion !== undefined && input.expectedVersion !== cur.version) {
    throw new WorkflowWriteAbort(
      fail(409, 'STALE_CONFLICT', 'Workflow was modified by another session. Reload and retry.', {
        currentVersion: cur.version,
      }),
    )
  }
  await assertActivationAllowedLocked(tx, cur, input.policy, input.guardWhenAlreadyProduction, input.userId)
  const workflow = await tx.workflow.update({
    where: { workflowId: input.workflowId },
    data: { ...(input.metadata ?? {}), status: 'production', trafficWeight: trafficWeightFor('production') },
  })
  return { workflow, previousStatus: cur.status }
}

async function assertActivationAllowedLocked(
  tx: Prisma.TransactionClient,
  cur: LockedWorkflowRow,
  policy: ActivationPolicy,
  guardWhenAlreadyProduction: boolean,
  userId: string,
): Promise<void> {
  if (normalizeWorkflowKind(cur.kind) === SUB_WORKFLOW_KIND) throw new WorkflowWriteAbort(SUB_WORKFLOW_NOT_DEPLOYABLE)
  if (cur.status === 'production') {
    if (guardWhenAlreadyProduction) {
      const guardError = assertTranslationGuard(cur.workflowJson)
      if (guardError) throw new WorkflowWriteAbort(guardError)
      const quizGuardError = assertQuizModelGuard(cur.workflowJson)
      if (quizGuardError) throw new WorkflowWriteAbort(quizGuardError)
      const noticeGuardError = assertQuizNoticeGuard(cur.workflowJson)
      if (noticeGuardError) throw new WorkflowWriteAbort(noticeGuardError)
    }
    return
  }
  const validationError = assertWorkflowJsonValid(cur.workflowJson, 'deployable')
  if (validationError) throw new WorkflowWriteAbort(validationError)
  const guardError = assertTranslationGuard(cur.workflowJson)
  if (guardError) throw new WorkflowWriteAbort(guardError)
  const quizGuardError = assertQuizModelGuard(cur.workflowJson)
  if (quizGuardError) throw new WorkflowWriteAbort(quizGuardError)
  const noticeGuardError = assertQuizNoticeGuard(cur.workflowJson)
  if (noticeGuardError) throw new WorkflowWriteAbort(noticeGuardError)
  const gateError = await assertActivationGate(policy, cur.agentId, tx)
  if (gateError) throw new WorkflowWriteAbort(gateError)
  const inboundError = await assertPstnInboundFreeLocked(tx, {
    userId,
    workflowId: cur.workflowId,
    numbers: newlyInboundNumbers(cur.workflowJson, cur),
  })
  if (inboundError) throw new WorkflowWriteAbort(inboundError)
}

export async function setWorkflowStatus(input: {
  userId: string
  workflowId: string
  status: string
  expectedVersion?: number
  expectedCurrentStatus?: string
}): Promise<WorkflowServiceResult<{ workflow: Workflow; previousStatus?: string }>> {
  if (!input.status || !(VALID_WORKFLOW_STATUSES as readonly string[]).includes(input.status)) {
    return fail(400, 'INVALID_STATUS', `Invalid status. Must be one of: ${VALID_WORKFLOW_STATUSES.join(', ')}`)
  }

  const resolved = await resolveOwnedWorkflow(input.userId, input.workflowId)
  if (!resolved.ok) return resolved
  const workflow = resolved.workflow

  let updated: Workflow
  let previousStatus: string | undefined

  if (input.status === 'production') {
    const policy = await loadActivationPolicy(input.userId)
    const result = await runVersionedTx(tx =>
      activateWorkflowLocked(tx, {
        workflowId: input.workflowId,
        agentId: workflow.agentId,
        userId: input.userId,
        policy,
        expectedVersion: input.expectedVersion,
        guardWhenAlreadyProduction: false,
      }),
    )
    if (isServiceError(result)) return result
    updated = result.workflow
    previousStatus = result.previousStatus
  } else if (input.status === 'archived' && normalizeWorkflowKind(workflow.kind) === SUB_WORKFLOW_KIND) {
    const result = await runVersionedTx(async (tx) => {
      if (!(await lockAgentRow(tx, workflow.agentId))) {
        throw new WorkflowWriteAbort(fail(404, 'AGENT_NOT_FOUND', 'Agent not found'))
      }
      const cur = await lockWorkflowRow(tx, input.workflowId)
      if (!cur) throw new WorkflowWriteAbort(fail(404, 'NOT_FOUND', 'Workflow not found'))
      if (input.expectedCurrentStatus !== undefined && cur.status !== input.expectedCurrentStatus) {
        throw new WorkflowWriteAbort(
          fail(409, 'STATUS_CHANGED', `Workflow is no longer ${input.expectedCurrentStatus}.`, { currentStatus: cur.status }),
        )
      }
      const inUse = await assertSubWorkflowNotReferencedLocked(tx, cur, 'archive')
      if (inUse) throw new WorkflowWriteAbort(inUse)
      const row = await tx.workflow.update({
        where: { workflowId: input.workflowId },
        data: { status: 'archived', trafficWeight: trafficWeightFor('archived') },
      })
      return { row, previousStatus: cur.status }
    })
    if (isServiceError(result)) return result
    updated = result.row
    previousStatus = result.previousStatus
  } else if (input.expectedCurrentStatus !== undefined) {
    const result = await runVersionedTx(async (tx) => {
      const cur = await lockWorkflowRow(tx, input.workflowId)
      if (!cur) throw new WorkflowWriteAbort(fail(404, 'NOT_FOUND', 'Workflow not found'))
      if (cur.status !== input.expectedCurrentStatus) {
        throw new WorkflowWriteAbort(
          fail(409, 'STATUS_CHANGED', `Workflow is no longer ${input.expectedCurrentStatus}.`, {
            currentStatus: cur.status,
          }),
        )
      }
      return tx.workflow.update({
        where: { workflowId: input.workflowId },
        data: { status: input.status, trafficWeight: trafficWeightFor(input.status) },
      })
    })
    if (isServiceError(result)) return result
    updated = result
    previousStatus = input.expectedCurrentStatus
  } else {
    updated = await prisma.workflow.update({
      where: { workflowId: input.workflowId },
      data: { status: input.status, trafficWeight: trafficWeightFor(input.status) },
    })
  }

  await syncWorkflowSchedule(input.workflowId, workflow.agentId, updated.workflowJson)
  return { ok: true, workflow: updated, previousStatus }
}

export async function updateWorkflow(input: {
  userId: string
  workflowId: string
  patch: {
    name?: string
    description?: string | null
    workflowJson?: string
    status?: string
    templateBinding?: string | null
  }
  expectedVersion?: number
  source?: WorkflowWriteSource
  createdById?: string
  note?: string
  requireDraft?: boolean
  forbidArchived?: boolean
  forbidProduction?: boolean
  expectedStatus?: string
}): Promise<WorkflowServiceResult<{ workflow: Workflow }>> {
  const { patch } = input

  if (patch.status !== undefined && !(VALID_WORKFLOW_STATUSES as readonly string[]).includes(patch.status)) {
    return fail(400, 'INVALID_STATUS', `Invalid status. Must be one of: ${VALID_WORKFLOW_STATUSES.join(', ')}`)
  }

  const resolved = await resolveOwnedWorkflow(input.userId, input.workflowId)
  if (!resolved.ok) return resolved
  const workflow = resolved.workflow
  const kind = normalizeWorkflowKind(workflow.kind)
  if (patch.status === 'production' && kind === SUB_WORKFLOW_KIND) return SUB_WORKFLOW_NOT_DEPLOYABLE
  const needsArchiveGuard = patch.status === 'archived' && kind === SUB_WORKFLOW_KIND

  //
  const forbidProduction = input.forbidProduction === true || input.source === 'ai-assistant'
  if (patch.workflowJson !== undefined && forbidProduction && workflow.status === 'production') {
    return fail(409, 'PRODUCTION_EDIT_BLOCKED', PRODUCTION_EDIT_BLOCKED_MSG)
  }

  const targetsProduction = patch.status === 'production'
  const isLockedActivation = targetsProduction && patch.workflowJson === undefined
  const effectiveStatus = patch.status ?? workflow.status
  const effectiveJson = patch.workflowJson ?? workflow.workflowJson

  if (patch.workflowJson !== undefined) {
    const level: WorkflowValidationLevel = targetsProduction ? 'deployable' : 'structural'
    const quizGuardError = assertQuizModelGuard(patch.workflowJson)
    if (quizGuardError) return quizGuardError
    const noticeGuardError = assertQuizNoticeGuard(patch.workflowJson)
    if (noticeGuardError) return noticeGuardError
    const validationError = assertWorkflowJsonValid(patch.workflowJson, level, kind)
    if (validationError) return validationError
  }

  const translationGuardCheckedPreLock = effectiveStatus === 'production' && !isLockedActivation
  if (translationGuardCheckedPreLock) {
    const guardError = assertTranslationGuard(effectiveJson)
    if (guardError) return guardError
  }

  if (patch.workflowJson !== undefined && input.expectedVersion === undefined) {
    return fail(400, 'VERSION_REQUIRED', 'expectedVersion is required when saving workflowJson. Reload the workflow to get its current version.')
  }

  const metadata: Record<string, unknown> = {}
  if (patch.name !== undefined) metadata.name = patch.name
  if (patch.description !== undefined) metadata.description = patch.description
  if (patch.templateBinding !== undefined) metadata.templateBinding = patch.templateBinding
  if (patch.status !== undefined) {
    metadata.status = patch.status
    metadata.trafficWeight = trafficWeightFor(patch.status)
  }

  const activationPolicy = targetsProduction ? await loadActivationPolicy(input.userId) : null

  let updated: Workflow

  if (patch.workflowJson !== undefined) {
    const newJson = patch.workflowJson
    const needsSubRefCheck = kind === SUB_WORKFLOW_KIND || collectSubWorkflowRefs(newJson).length > 0
    const touchesInbound = inboundPstnNumbers(newJson).length > 0
    const result = await runVersionedTx(async (tx) => {
      if (touchesInbound) await lockPstnInboundScope(tx, input.userId)
      if ((activationPolicy || needsSubRefCheck) && !(await lockAgentRow(tx, workflow.agentId))) {
        throw new WorkflowWriteAbort(fail(404, 'AGENT_NOT_FOUND', 'Agent not found'))
      }
      const cur = await lockWorkflowRow(tx, input.workflowId)
      if (!cur) throw new WorkflowWriteAbort(fail(404, 'NOT_FOUND', 'Workflow not found'))
      if (targetsProduction && normalizeWorkflowKind(cur.kind) === SUB_WORKFLOW_KIND) {
        throw new WorkflowWriteAbort(SUB_WORKFLOW_NOT_DEPLOYABLE)
      }
      if (input.requireDraft && cur.status !== 'draft') {
        throw new WorkflowWriteAbort(
          cur.status === 'production'
            ? fail(409, 'PRODUCTION_RESTORE_BLOCKED', PRODUCTION_RESTORE_BLOCKED_MSG)
            : fail(409, 'RESTORE_REQUIRES_DRAFT', 'A previous version can only be restored on a draft workflow. Switch it to draft first.'),
        )
      }
      if (input.forbidArchived && cur.status === 'archived') {
        throw new WorkflowWriteAbort(
          fail(409, 'DRAFT_REQUIRED', 'This workflow is archived. Switch it to draft or production before editing.'),
        )
      }
      if (forbidProduction && cur.status === 'production') {
        throw new WorkflowWriteAbort(fail(409, 'PRODUCTION_EDIT_BLOCKED', PRODUCTION_EDIT_BLOCKED_MSG))
      }

      if (input.expectedVersion !== cur.version) {
        throw new WorkflowWriteAbort(
          fail(409, 'STALE_CONFLICT', 'Workflow was modified by another session. Reload and retry.', {
            currentVersion: cur.version,
          }),
        )
      }

      if (input.expectedStatus !== undefined && cur.status !== input.expectedStatus) {
        throw new WorkflowWriteAbort(
          fail(409, 'STATUS_CHANGED', 'This workflow was activated or deactivated in another session. Reload and retry.', {
            currentStatus: cur.status,
          }),
        )
      }

      if (needsArchiveGuard) {
        const inUse = await assertSubWorkflowNotReferencedLocked(tx, cur, 'archive')
        if (inUse) throw new WorkflowWriteAbort(inUse)
      }

      if (!translationGuardCheckedPreLock && (patch.status ?? cur.status) === 'production') {
        const lateGuardError = assertTranslationGuard(newJson)
        if (lateGuardError) throw new WorkflowWriteAbort(lateGuardError)
      }

      if (activationPolicy && cur.status !== 'production') {
        const gateError = await assertActivationGate(activationPolicy, cur.agentId, tx)
        if (gateError) throw new WorkflowWriteAbort(gateError)
      }

      if (touchesInbound && (patch.status ?? cur.status) === 'production') {
        const inboundError = await assertPstnInboundFreeLocked(tx, {
          userId: input.userId,
          workflowId: cur.workflowId,
          numbers: newlyInboundNumbers(newJson, cur),
        })
        if (inboundError) throw new WorkflowWriteAbort(inboundError)
      }

      if (needsSubRefCheck) {
        const refError = await assertSubWorkflowRefsLocked(tx, {
          agentId: cur.agentId,
          workflowJson: newJson,
          kind: normalizeWorkflowKind(cur.kind),
          selfWorkflowId: cur.workflowId,
        })
        if (refError) throw new WorkflowWriteAbort(refError)
      }

      await casWriteLocked(tx, cur, {
        newJson,
        metadata,
        source: input.source ?? 'ui',
        createdById: input.createdById ?? input.userId,
        note: input.note,
      })
      return tx.workflow.findUniqueOrThrow({ where: { workflowId: input.workflowId } })
    })
    if (isServiceError(result)) return result
    updated = result
  } else if (isLockedActivation) {
    const result = await runVersionedTx(tx =>
      activateWorkflowLocked(tx, {
        workflowId: input.workflowId,
        agentId: workflow.agentId,
        userId: input.userId,
        policy: activationPolicy!,
        expectedVersion: input.expectedVersion,
        metadata,
        guardWhenAlreadyProduction: true,
      }),
    )
    if (isServiceError(result)) return result
    updated = result.workflow
  } else if (needsArchiveGuard) {
    if (Object.keys(metadata).length === 0) {
      return { ok: true, workflow }
    }
    const result = await runVersionedTx(async (tx) => {
      if (!(await lockAgentRow(tx, workflow.agentId))) {
        throw new WorkflowWriteAbort(fail(404, 'AGENT_NOT_FOUND', 'Agent not found'))
      }
      const cur = await lockWorkflowRow(tx, input.workflowId)
      if (!cur) throw new WorkflowWriteAbort(fail(404, 'NOT_FOUND', 'Workflow not found'))
      if (input.expectedVersion !== undefined && input.expectedVersion !== cur.version) {
        throw new WorkflowWriteAbort(fail(409, 'STALE_CONFLICT', 'Workflow was modified by another session. Reload and retry.', { currentVersion: cur.version }))
      }
      const inUse = await assertSubWorkflowNotReferencedLocked(tx, cur, 'archive')
      if (inUse) throw new WorkflowWriteAbort(inUse)
      return tx.workflow.update({ where: { workflowId: input.workflowId }, data: metadata })
    })
    if (isServiceError(result)) return result
    updated = result
  } else {
    if (Object.keys(metadata).length === 0) {
      return { ok: true, workflow }
    }
    if (input.expectedVersion !== undefined) {
      const res = await prisma.workflow.updateMany({
        where: { workflowId: input.workflowId, version: input.expectedVersion },
        data: metadata,
      })
      if (res.count === 0) {
        return fail(409, 'STALE_CONFLICT', 'Workflow was modified by another session. Reload and retry.')
      }
      updated = await prisma.workflow.findUniqueOrThrow({ where: { workflowId: input.workflowId } })
    } else {
      updated = await prisma.workflow.update({
        where: { workflowId: input.workflowId },
        data: metadata,
      })
    }
  }

  if (patch.workflowJson !== undefined || patch.status !== undefined) {
    await syncWorkflowSchedule(input.workflowId, workflow.agentId, updated.workflowJson)
  }
  return { ok: true, workflow: updated }
}

export async function restoreWorkflow(input: {
  userId: string
  workflowId: string
  targetVersion: number
  expectedVersion: number
  source?: WorkflowWriteSource
  createdById?: string
}): Promise<WorkflowServiceResult<{ workflow: Workflow }>> {
  const resolved = await resolveOwnedWorkflow(input.userId, input.workflowId)
  if (!resolved.ok) return resolved

  if (resolved.workflow.status === 'production') {
    return fail(409, 'PRODUCTION_RESTORE_BLOCKED', PRODUCTION_RESTORE_BLOCKED_MSG)
  }
  if (resolved.workflow.status !== 'draft') {
    return fail(409, 'RESTORE_REQUIRES_DRAFT', 'A previous version can only be restored on a draft workflow. Switch it to draft first.')
  }

  const target = await prisma.workflowVersion.findUnique({
    where: { workflowId_version: { workflowId: input.workflowId, version: input.targetVersion } },
  })
  if (!target) return fail(404, 'VERSION_NOT_FOUND', `Version ${input.targetVersion} not found for this workflow.`)

  return updateWorkflow({
    userId: input.userId,
    workflowId: input.workflowId,
    patch: { workflowJson: target.workflowJson },
    expectedVersion: input.expectedVersion,
    source: input.source ?? 'restore',
    createdById: input.createdById,
    note: `restored from v${input.targetVersion}`,
    requireDraft: true,
  })
}

export async function deleteWorkflow(input: {
  userId: string
  workflowId: string
}): Promise<{ ok: true } | WorkflowServiceError> {
  const resolved = await resolveOwnedWorkflow(input.userId, input.workflowId)
  if (!resolved.ok) return resolved

  if (normalizeWorkflowKind(resolved.workflow.kind) === SUB_WORKFLOW_KIND) {
    const result = await runVersionedTx(async (tx) => {
      if (!(await lockAgentRow(tx, resolved.workflow.agentId))) {
        throw new WorkflowWriteAbort(fail(404, 'AGENT_NOT_FOUND', 'Agent not found'))
      }
      const cur = await lockWorkflowRow(tx, input.workflowId)
      if (!cur) throw new WorkflowWriteAbort(fail(404, 'NOT_FOUND', 'Workflow not found'))
      const inUse = await assertSubWorkflowNotReferencedLocked(tx, cur, 'delete')
      if (inUse) throw new WorkflowWriteAbort(inUse)
      await tx.workflow.delete({ where: { workflowId: input.workflowId } })
      return true as const
    })
    if (isServiceError(result)) return result
    return { ok: true }
  }

  await prisma.workflow.delete({ where: { workflowId: input.workflowId } })
  return { ok: true }
}

// ========================================
// Reads
// ========================================

export interface WorkflowSummary {
  id: number
  workflowId: string
  name: string
  description: string | null
  status: string
  trafficWeight: number
  version: number
  createdAt: Date
  updatedAt: Date
  kind: string
}

export async function listWorkflows(input: {
  userId: string
  agentId: string
}): Promise<WorkflowServiceResult<{ workflows: WorkflowSummary[] }>> {
  const agent = await prisma.agent.findFirst({
    where: { agentId: input.agentId, userId: input.userId },
    select: { agentId: true },
  })
  if (!agent) return fail(404, 'AGENT_NOT_FOUND', 'Agent not found')

  const workflows = await prisma.workflow.findMany({
    where: { agentId: input.agentId },
    orderBy: [
      { status: 'desc' },
      { updatedAt: 'desc' },
    ],
    select: {
      id: true,
      workflowId: true,
      name: true,
      description: true,
      status: true,
      trafficWeight: true,
      version: true,
      createdAt: true,
      updatedAt: true,
      kind: true,
    },
  })
  return { ok: true, workflows }
}

export interface WorkflowVersionSummary {
  version: number
  name: string
  source: string
  note: string | null
  createdAt: Date
}

export async function listWorkflowVersions(input: {
  userId: string
  workflowId: string
}): Promise<WorkflowServiceResult<{ versions: WorkflowVersionSummary[]; currentVersion: number; status: string }>> {
  const resolved = await resolveOwnedWorkflow(input.userId, input.workflowId)
  if (!resolved.ok) return resolved

  const versions = await prisma.workflowVersion.findMany({
    where: { workflowId: input.workflowId },
    orderBy: { version: 'desc' },
    select: { version: true, name: true, source: true, note: true, createdAt: true },
  })
  return { ok: true, versions, currentVersion: resolved.workflow.version, status: resolved.workflow.status }
}

export async function getWorkflowVersion(input: {
  userId: string
  workflowId: string
  version: number
}): Promise<WorkflowServiceResult<{ version: { version: number; workflowJson: string; name: string; description: string | null; source: string; note: string | null; createdAt: Date } }>> {
  const resolved = await resolveOwnedWorkflow(input.userId, input.workflowId)
  if (!resolved.ok) return resolved

  const version = await prisma.workflowVersion.findUnique({
    where: { workflowId_version: { workflowId: input.workflowId, version: input.version } },
    select: { version: true, workflowJson: true, name: true, description: true, source: true, note: true, createdAt: true },
  })
  if (!version) return fail(404, 'VERSION_NOT_FOUND', `Version ${input.version} not found for this workflow.`)
  return { ok: true, version }
}

// ========================================
//
//
// ========================================

export const DEPLOY_REQUEST_TTL_MS = 15 * 60 * 1000

export interface DeployRequestView {
  id: string
  userId: string
  tokenId: string
  workflowId: string
  agentId: string
  targetVersion: number
  targetJsonHash: string
  status: string
  expiresAt: Date
  consumedAt: Date | null
  approvedAt: Date | null
  createdAt: Date
}

const DEPLOY_REQUEST_SELECT = {
  id: true, userId: true, tokenId: true, workflowId: true, agentId: true,
  targetVersion: true, targetJsonHash: true, status: true, expiresAt: true,
  consumedAt: true, approvedAt: true, createdAt: true,
} as const

function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

export async function createDeployRequest(input: {
  userId: string
  tokenId: string
  workflowId: string
  ttlMs?: number
}): Promise<WorkflowServiceResult<{ request: DeployRequestView }>> {
  const resolved = await resolveOwnedWorkflow(input.userId, input.workflowId)
  if (!resolved.ok) return resolved
  const wf = resolved.workflow

  if (normalizeWorkflowKind(wf.kind) === SUB_WORKFLOW_KIND) return SUB_WORKFLOW_NOT_DEPLOYABLE

  if (wf.status === 'production') {
    return fail(409, 'ALREADY_PRODUCTION', 'This workflow is already live (production). No deploy needed.')
  }
  if (wf.status !== 'draft') {
    return fail(409, 'DEPLOY_REQUIRES_DRAFT', `Only a draft workflow can be deployed (this one is ${wf.status}). Switch it to draft first.`)
  }

  const validationError = assertWorkflowJsonValid(wf.workflowJson, 'deployable', normalizeWorkflowKind(wf.kind))
  if (validationError) return validationError

  const expiresAt = new Date(Date.now() + (input.ttlMs ?? DEPLOY_REQUEST_TTL_MS))
  const request = await prisma.mcpDeployRequest.create({
    data: {
      userId: input.userId,
      tokenId: input.tokenId,
      workflowId: wf.workflowId,
      agentId: wf.agentId,
      targetVersion: wf.version,
      targetJsonHash: sha256Hex(wf.workflowJson),
      expiresAt,
    },
    select: DEPLOY_REQUEST_SELECT,
  })
  return { ok: true, request }
}

async function lockDeployRequestRow(tx: Prisma.TransactionClient, requestId: string): Promise<DeployRequestView | null> {
  const rows = await tx.$queryRaw<DeployRequestView[]>`
    SELECT id, user_id AS "userId", token_id AS "tokenId", workflow_id AS "workflowId",
           agent_id AS "agentId", target_version AS "targetVersion", target_json_hash AS "targetJsonHash",
           status, expires_at AS "expiresAt", consumed_at AS "consumedAt",
           approved_at AS "approvedAt", created_at AS "createdAt"
    FROM mcp_deploy_request
    WHERE id = ${requestId}
    FOR UPDATE`
  return rows[0] ?? null
}

export async function approveDeployRequest(input: {
  requestId: string
  approverUserId: string
}): Promise<WorkflowServiceResult<{ workflow: Workflow }>> {
  const policy = await loadActivationPolicy(input.approverUserId)

  const result = await runVersionedTx(async (tx) => {
    const req = await lockDeployRequestRow(tx, input.requestId)
    if (!req || req.userId !== input.approverUserId) {
      throw new WorkflowWriteAbort(fail(404, 'DEPLOY_REQUEST_NOT_FOUND', 'Deploy request not found.'))
    }
    if (req.consumedAt || req.status !== 'pending') {
      throw new WorkflowWriteAbort(fail(409, 'DEPLOY_REQUEST_USED', 'This deploy request was already used or canceled. Ask the assistant to request deployment again.'))
    }
    if (req.expiresAt.getTime() < Date.now()) {
      throw new WorkflowWriteAbort(fail(410, 'DEPLOY_REQUEST_EXPIRED', 'This deploy request has expired. Ask the assistant to request deployment again.'))
    }

    const consumed = await tx.mcpDeployRequest.updateMany({
      where: { id: req.id, consumedAt: null },
      data: { consumedAt: new Date(), status: 'approved', approvedById: input.approverUserId, approvedAt: new Date() },
    })
    if (consumed.count === 0) {
      throw new WorkflowWriteAbort(fail(409, 'DEPLOY_REQUEST_USED', 'This deploy request was already used. Request deployment again.'))
    }

    const { workflow } = await activateWorkflowLocked(tx, {
      workflowId: req.workflowId,
      agentId: req.agentId,
      userId: req.userId,
      policy,
      expectedVersion: req.targetVersion,
      guardWhenAlreadyProduction: false,
    })
    return workflow
  })
  if (isServiceError(result)) return result

  await syncWorkflowSchedule(result.workflowId, result.agentId, result.workflowJson)
  return { ok: true, workflow: result }
}

export async function cancelDeployRequest(input: {
  userId: string
  requestId: string
}): Promise<WorkflowServiceResult<{ canceled: boolean }>> {
  const res = await prisma.mcpDeployRequest.updateMany({
    where: { id: input.requestId, userId: input.userId, status: 'pending', consumedAt: null },
    data: { status: 'canceled' },
  })
  return { ok: true, canceled: res.count > 0 }
}

export type DeployRequestDerivedState = 'pending' | 'expired' | 'deployed' | 'off' | 'canceled' | 'stale' | 'wrong_status'

export async function getDeployRequestForOwner(input: {
  userId: string
  requestId: string
}): Promise<WorkflowServiceResult<{
  request: DeployRequestView
  workflow: { workflowId: string; agentId: string; name: string; status: string; version: number; workflowJson: string }
  derivedState: DeployRequestDerivedState
}>> {
  const request = await prisma.mcpDeployRequest.findUnique({
    where: { id: input.requestId },
    select: DEPLOY_REQUEST_SELECT,
  })
  if (!request || request.userId !== input.userId) {
    return fail(404, 'DEPLOY_REQUEST_NOT_FOUND', 'Deploy request not found.')
  }

  const wf = await prisma.workflow.findUnique({
    where: { workflowId: request.workflowId },
    select: { workflowId: true, agentId: true, name: true, status: true, version: true, workflowJson: true },
  })
  if (!wf) return fail(404, 'NOT_FOUND', 'Workflow not found.')

  let derivedState: DeployRequestDerivedState = 'pending'
  if (wf.status === 'production') derivedState = 'deployed'
  else if (wf.status !== 'draft') derivedState = 'wrong_status'
  else if (request.consumedAt || request.status === 'approved') derivedState = 'off'
  else if (request.status === 'canceled') derivedState = 'canceled'
  else if (request.expiresAt.getTime() < Date.now()) derivedState = 'expired'
  else if (wf.version !== request.targetVersion) derivedState = 'stale'

  return { ok: true, request, workflow: wf, derivedState }
}
