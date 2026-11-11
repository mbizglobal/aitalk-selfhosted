
import { createHash } from 'crypto'
import type { Prisma, SubscriptionPlan, Workflow } from '@prisma/client'
import { SYSTEM_APP_TEMPLATE_KINDS } from '@/lib/work/app-template-kinds'
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
import { hasManagedPlanTier, getManagedActiveWorkflowLimit } from '@/lib/invoice/subscription/utils'
import { SELF_HOSTED_POLICY } from '@/lib/selfhosted-policy'
import { isAgentLocked, AGENT_LOCKED_CODE, AGENT_LOCKED_MESSAGE } from '@/lib/agent-lock'
import { APP_WORKFLOW_KIND, appNodesOf, isAppCanvas } from '@/lib/work/app-canvas'
import { CompanyLimitError, assertCompanyRoom, companyLimitOf, lockCompanyScope } from '@/lib/work/company-limit'

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
  serviceVariant?: string | null,
): WorkflowPlanLimits {
  const isPaid = planType !== 'free' && subscriptionStatus === 'active'
  let maxProduction = FREE_USER_MAX_PRODUCTION
  if (isPaid) {
    const plan = planType || ''
    if (serviceVariant === 'managed' && hasManagedPlanTier(plan as SubscriptionPlan)) {
      maxProduction = getManagedActiveWorkflowLimit(plan as SubscriptionPlan)
    } else if (plan.includes('pro')) maxProduction = 40
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

type RefSyncCtx = { key: Buffer; templates: readonly import('@/lib/work/sheet-templates').SheetTemplate[] }
async function referenceSyncContext(userId: string): Promise<RefSyncCtx> {
  const { defaultWorkSheetDeps } = await import('@/lib/work/sheet-gate')
  const d = await defaultWorkSheetDeps()
  return { key: await d.dataKey(d.db, userId), templates: d.templates }
}
async function syncReferenceLinesOrAbort(tx: Prisma.TransactionClient, ctx: RefSyncCtx, input: { userId: string; agentId: string; workflowId: string; workflowJson: unknown }): Promise<AppNote[]> {
  let appNotes: AppNote[] = []
  const [{ syncReferenceLinesLocked }, { WorkError }, { inboxTargetProblems }, { syncAppNodesLocked, AppCanvasError }] = await Promise.all([import('@/lib/work/references'), import('@/lib/work/errors'), import('@/lib/work/inbox'), import('@/lib/work/app-canvas-sync')])
  try {
    appNotes = (await sharedInUseToAbort(() => syncAppNodesLocked(tx, { userId: input.userId, agentId: input.agentId, parentWorkflowId: input.workflowId, workflowJson: input.workflowJson, key: ctx.key, newWorkflowId: generateWorkflowId }))).notes
  } catch (e) {
    if (e instanceof AppCanvasError && e.code === 'APP_TEMPLATE_LOCKED') throw new WorkflowWriteAbort(fail(409, 'APP_TEMPLATE_LOCKED', e.detail))
    if (e instanceof AppCanvasError) throw new WorkflowWriteAbort(fail(409, 'WORK_APP_INVALID', e.detail || e.code))
    if (e instanceof WorkError && e.code === 'DUPLICATE') throw new WorkflowWriteAbort(fail(409, 'WORK_APP_INVALID', e.detail))
    throw e
  }
  const { linkTargetProblems } = await import('@/lib/work/shared-apps')
  const badLinks = await linkTargetProblems(tx, input.userId, input.workflowJson, input.workflowId)
  if (badLinks.length) {
    const code = badLinks.some((b) => b.code === 'LINK_TARGET_MISSING') ? 'LINK_TARGET_MISSING' : 'LINK_TARGET_INVALID'
    throw new WorkflowWriteAbort(fail(409, code, `Link node: ${badLinks.map((b) => `${b.nodeId} (${b.reason})`).join('; ')}`, { nodes: badLinks }))
  }
  try {
    await syncReferenceLinesLocked(tx, ctx, input)
  } catch (e) {
    if (e instanceof WorkError) throw new WorkflowWriteAbort(fail(409, 'REFERENCE_LINE_INVALID', e.detail || e.code))
    throw e
  }
  const { companyBookProblems } = await import('@/lib/work/shared-apps')
  const otherCompany = await companyBookProblems(tx, input.userId, input.workflowJson, input.workflowId)
  if (otherCompany.length) throw new WorkflowWriteAbort(fail(409, 'LINK_TARGET_INVALID', `Link node: ${otherCompany.map((b) => `${b.nodeId} (${b.reason})`).join('; ')}`, { nodes: otherCompany }))
  const bad = await inboxTargetProblems(tx, input.userId, input.workflowJson)
  if (bad.length) {
    throw new WorkflowWriteAbort(fail(409, 'INBOX_TARGET_INVALID', `Work inbox tool: ${bad.map((b) => `${b.nodeId} (${b.reason})`).join('; ')}`, { nodes: bad }))
  }
  const { sendLineProblems } = await import('@/lib/work/app-send')
  const badLines = await sendLineProblems(tx, input.userId, input.workflowJson, undefined, input.workflowId)
  if (badLines.length) {
    throw new WorkflowWriteAbort(fail(409, 'SEND_LINE_INVALID', `Send line: ${badLines.map((b) => `${b.edgeId} (${b.reason})`).join('; ')}`, { edges: badLines }))
  }
  const { handoffTargetProblems } = await import('@/lib/work/handoff')
  const badHandoffs = await handoffTargetProblems(tx, input.userId, input.workflowJson, input.workflowId)
  if (badHandoffs.length) {
    throw new WorkflowWriteAbort(fail(409, 'HANDOFF_TARGET_INVALID', `Handoff: ${badHandoffs.map((b) => `${b.nodeId} (${b.reason})`).join('; ')}`, { nodes: badHandoffs }))
  }
  return appNotes
}

async function sharedInUseToAbort<T>(fn: () => Promise<T>): Promise<T> {
  const { SharedAppInUseError } = await import('@/lib/work/shared-apps')
  try {
    return await fn()
  } catch (e) {
    if (e instanceof SharedAppInUseError) throw new WorkflowWriteAbort(fail(409, 'SHARED_APP_IN_USE', `This work app is used by another workflow: ${e.message}`, { canvases: e.canvases }))
    throw e
  }
}

export type AppNote = import('@/lib/work/app-canvas-sync').AppSyncNote

async function hasAppChildren(workflowId: string): Promise<boolean> {
  return (await prisma.workflow.count({ where: { parentWorkflowId: workflowId } })) > 0
}

async function closeCanvasAppsLocked(tx: Prisma.TransactionClient, userId: string, workflowId: string, status: string, workflowJson: string): Promise<void> {
  if (status !== 'draft' && status !== 'archived') return
  const { closeAppNodesLocked } = await import('@/lib/work/app-canvas-sync')
  await sharedInUseToAbort(() => closeAppNodesLocked(tx, { userId, parentWorkflowId: workflowId, status, workflowJson }))
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
  if (workflow.kind === APP_WORKFLOW_KIND) return fail(404, 'NOT_FOUND', 'Workflow not found')
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
    select: { subscription: { select: { status: true, planType: true, serviceVariant: true } } },
  })
  return planLimitsFor(user?.subscription?.planType, user?.subscription?.status, user?.subscription?.serviceVariant)
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

const COUNTED_WORKFLOWS = {
  kind: { not: APP_WORKFLOW_KIND },
  NOT: { appChildren: { some: { workProjects: { some: { kind: { in: [...SYSTEM_APP_TEMPLATE_KINDS] } } } } } },
} satisfies Prisma.WorkflowWhereInput

async function assertActivationGate(
  policy: ActivationPolicy,
  agentId: string,
  client: Prisma.TransactionClient = prisma,
): Promise<WorkflowServiceError | null> {
  if (policy.block) return fail(403, policy.block.code, policy.block.message)
  if (await isAgentLocked(agentId, client)) return fail(403, AGENT_LOCKED_CODE, AGENT_LOCKED_MESSAGE)

  const { limits } = policy
  const currentProductionCount = await client.workflow.count({
    where: { agentId, status: 'production', ...COUNTED_WORKFLOWS },
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
  const count = await client.workflow.count({ where: { agentId, ...COUNTED_WORKFLOWS } })
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
  return runCompanyTx(null, fn, options)
}

type CompanyCtx = { userId: string; limit: number | null }

async function companyCtx(userId: string): Promise<CompanyCtx> {
  return { userId, limit: await companyLimitOf(prisma, userId) }
}

async function runCompanyTx<T>(
  company: CompanyCtx | null,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: { maxWait: number; timeout: number },
): Promise<T | WorkflowServiceError> {
  try {
    return await prisma.$transaction(async (tx) => {
      const scope = company ? await lockCompanyScope(tx, company.userId, company.limit) : null
      const r = await fn(tx)
      if (scope) await assertCompanyRoom(tx, scope)
      return r
    }, options)
  } catch (err) {
    if (err instanceof WorkflowWriteAbort) return err.failure
    if (err instanceof CompanyLimitError) return fail(403, 'COMPANY_LIMIT', `Company limit reached (${err.used}/${err.limit})`, { used: err.used, limit: err.limit })
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
  const result = await runCompanyTx(ownerId ? await companyCtx(ownerId) : null, async (tx) => {
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
}): Promise<WorkflowServiceResult<{ workflow: Workflow; appLinks?: AppLinkNote[] }>> {
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
  const refSync = prepared.status === 'production' ? await referenceSyncContext(input.userId) : null
  const result = await runCompanyTx(await companyCtx(input.userId), async (tx) => {
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
    const created = await insertPreparedWorkflowTx(tx, { agentId: input.agentId, prepared })
    if (prepared.status === 'production') await syncReferenceLinesOrAbort(tx, refSync!, { userId: input.userId, agentId: input.agentId, workflowId: created.workflowId, workflowJson: prepared.workflowJson })
    return created
  })
  if (isServiceError(result)) return result
  await syncWorkflowSchedule(result.workflowId, input.agentId, prepared.workflowJson)
  if (prepared.status !== 'production' && hasAutoLinks(prepared.workflowJson)) {
    const linked = await linkTemplateApps({ userId: input.userId, agentId: input.agentId, workflowId: result.workflowId })
    return { ok: true, workflow: linked.workflow ?? result, appLinks: linked.notes }
  }
  return { ok: true, workflow: result }
}

export type AppLinkNote = {
  nodeId: string
  code: 'LINKED' | 'LINK_CREATED' | 'LINK_CHOOSE' | 'LINK_DRAFT_ONLY' | 'LINK_DETACHED_ONLY' | 'LINK_CANNOT_CREATE' | 'LINK_FAILED' | 'LINK_NEEDS_BOOK' | 'LINK_BOOK_UNUSABLE' | 'LINK_ATTACH'
  appWorkflowId?: string
  detail?: string
}

function hasAutoLinks(workflowJson: string): boolean {
  if (!workflowJson.includes('"workAppLink"')) return false
  try {
    const { nodes } = JSON.parse(workflowJson) as { nodes?: Array<{ data?: Record<string, unknown> }> }
    return (nodes ?? []).some((n) => n?.data?.nodeType === 'workAppLink' && n.data.autoLink === true && !n.data.linkedAppWorkflowId)
  } catch { return false }
}

async function findOrCreateSharedApp(input: { userId: string; agentId: string; appTemplate: string; excludeWorkflowId: string; mode: 'auto' | 'create'; book?: string }): Promise<{ appWorkflowId: string; created: boolean } | { note: Omit<AppLinkNote, 'nodeId'> }> {
  const { sharedAppLookup, resolveBook, decideBookLink, decideSoloLink } = await import('@/lib/work/shared-apps')
  const { soloWorkAppTemplate, bookLinkedWorkAppTemplate } = await import('@/lib/work/workflow-template-catalog')
  const { COMPANY_BOOK_KINDS } = await import('@/lib/work/app-template-kinds')
  const { appNodesOf, linkNodesOf } = await import('@/lib/work/app-canvas')
  const byBook = input.book !== undefined
  const tpl = byBook ? bookLinkedWorkAppTemplate(input.appTemplate, COMPANY_BOOK_KINDS) : soloWorkAppTemplate(input.appTemplate)
  const [limits, policy, refSync] = await Promise.all([getPlanLimits(input.userId), loadActivationPolicy(input.userId), referenceSyncContext(input.userId)])
  try {
    const r = await runCompanyTx(await companyCtx(input.userId), async (tx) => {
      const book = byBook ? await resolveBook(tx, input.userId, input.book!) : null
      if (byBook && !book) return { note: { code: 'LINK_BOOK_UNUSABLE' as const } }
      const lk = await sharedAppLookup(tx, input.userId, input.appTemplate, { excludeWorkflowId: input.excludeWorkflowId, ...(book ? { sameBookAs: book.projectId } : {}) })
      if (book && lk.byBook) {
        if (lk.byBook.same.length === 1) return { appWorkflowId: lk.byBook.same[0].appWorkflowId, created: false }
        if (lk.byBook.same.length > 1) return { note: { code: 'LINK_CHOOSE' as const } }
        if (input.mode === 'auto') {
          const d = decideBookLink(lk, lk.byBook)
          if ('link' in d) return { appWorkflowId: d.link.appWorkflowId, created: false }
          if ('note' in d) return { note: { code: d.note, ...(d.detail ? { detail: d.detail } : {}) } }
        }
      } else if (input.mode === 'auto') {
        const d = decideSoloLink(lk)
        if ('link' in d) return { appWorkflowId: d.link.appWorkflowId, created: false }
        if ('note' in d) return { note: { code: d.note, ...(d.detail ? { detail: d.detail } : {}) } }
      }
      if (!tpl) return { note: { code: 'LINK_CANNOT_CREATE' as const, detail: 'NO_TEMPLATE' } }
      let json = tpl.template.workflowJson
      if (book) {
        const g = JSON.parse(json) as { nodes: Array<{ id?: unknown; data?: Record<string, unknown> }> }
        const linkId = linkNodesOf(g)[0]?.id
        for (const n of g.nodes) if (n.id === linkId) { const { autoLink: _drop, ...rest } = n.data ?? {}; n.data = { ...rest, linkedAppWorkflowId: book.appWorkflowId } }
        json = JSON.stringify(g)
      }
      const kindNodeId = appNodesOf(json).find((n) => n.data?.appTemplate === input.appTemplate)?.id
      if (!kindNodeId) return { note: { code: 'LINK_CANNOT_CREATE' as const, detail: 'NO_TEMPLATE' } }
      if (!(await lockAgentRow(tx, input.agentId))) throw new WorkflowWriteAbort(fail(404, 'AGENT_NOT_FOUND', 'Agent not found'))
      const countError = await assertWorkflowCountLimit(limits, input.agentId, tx)
      if (countError) return { note: { code: 'LINK_CANNOT_CREATE' as const, detail: countError.code } }
      const gateError = await assertActivationGate(policy, input.agentId, tx)
      if (gateError) return { note: { code: 'LINK_CANNOT_CREATE' as const, detail: gateError.code } }
      const prepared = prepareWorkflowCreate({ name: tpl.template.name, workflowJson: json, status: 'production' })
      if (isServiceError(prepared)) return { note: { code: 'LINK_CANNOT_CREATE' as const, detail: prepared.code } }
      const created = await insertPreparedWorkflowTx(tx, { agentId: input.agentId, prepared })
      await syncReferenceLinesOrAbort(tx, refSync, { userId: input.userId, agentId: input.agentId, workflowId: created.workflowId, workflowJson: prepared.workflowJson })
      const hidden = await tx.workflow.findFirst({ where: { parentWorkflowId: created.workflowId, kind: APP_WORKFLOW_KIND, parentNodeId: kindNodeId }, select: { workflowId: true } })
      const proj = hidden ? await tx.workProject.findFirst({ where: { userId: input.userId, workflowId: hidden.workflowId, kind: input.appTemplate }, select: { id: true } }) : null
      if (!hidden || !proj) throw new WorkflowWriteAbort(fail(500, 'LINK_CREATE_FAILED', 'the shared work app was not created'))
      return { appWorkflowId: hidden.workflowId, created: true, canvasWorkflowId: created.workflowId, json: prepared.workflowJson }
    })
    if (isServiceError(r)) return { note: { code: 'LINK_CANNOT_CREATE', detail: r.code } }
    if ('canvasWorkflowId' in r && r.canvasWorkflowId && r.json) await syncWorkflowSchedule(r.canvasWorkflowId, input.agentId, r.json)
    return 'note' in r ? r : { appWorkflowId: r.appWorkflowId, created: r.created }
  } catch (e) {
    console.error('[shared-app] find or create failed:', describeCaughtError(e))
    return { note: { code: 'LINK_CANNOT_CREATE', detail: 'ERROR' } }
  }
}

export async function checkTemplateInstall(input: { userId: string; agentId: string; workflowJson: string }): Promise<{ ok: true } | { ok: false; kind: 'inactive' | 'limit' | 'web'; code: string }> {
  const { sharedAppLookup, resolveBook, decideBookLink, decideSoloLink } = await import('@/lib/work/shared-apps')
  const { linkNodesOf, linkTargetOf, appNodesOf } = await import('@/lib/work/app-canvas')
  const { isSharedAppTemplateKind, isCompanyBookKind, COMPANY_BOOK_KINDS } = await import('@/lib/work/app-template-kinds')
  const { isBookBoundKind, soloWorkAppTemplate, bookLinkedWorkAppTemplate } = await import('@/lib/work/workflow-template-catalog')
  const { companyLimitOf, countCompanyBooks } = await import('@/lib/work/company-limit')

  const policy = await loadActivationPolicy(input.userId)
  if (policy.block) return { ok: false, kind: 'inactive', code: policy.block.code }
  if (await isAgentLocked(input.agentId, prisma)) return { ok: false, kind: 'limit', code: AGENT_LOCKED_CODE }

  const web = (code: string) => ({ ok: false as const, kind: 'web' as const, code })
  const links = linkNodesOf(input.workflowJson)
  const isBook = (n: { data?: { appTemplate?: unknown } | null }) => isCompanyBookKind(n.data?.appTemplate)
  const todo = links.filter((n) => n.data?.autoLink === true && !linkTargetOf(n) && isSharedAppTemplateKind(n.data?.appTemplate)).sort((a, b) => Number(isBook(b)) - Number(isBook(a)))
  const bookNodes = [...links.filter(isBook), ...appNodesOf(input.workflowJson).filter(isBook)]
  const filled = new Map<string, string | 'new'>()
  const seenKinds = new Map<string, string | 'new'>()
  for (const n of todo) {
    const kind = n.data!.appTemplate as string
    let book: string | 'new' | undefined
    if (isBookBoundKind(kind, COMPANY_BOOK_KINDS) && bookNodes.length) {
      const only = bookNodes.length === 1 && links.includes(bookNodes[0]) ? bookNodes[0] : null
      book = only ? (filled.get(only.id) ?? linkTargetOf(only) ?? undefined) : undefined
      if (!book) return web('LINK_NEEDS_BOOK')
    }
    if (seenKinds.has(kind)) return web('LINK_CHOOSE')
    const resolved = book && book !== 'new' ? await resolveBook(prisma, input.userId, book) : null
    if (book && book !== 'new' && !resolved) return web('LINK_BOOK_UNUSABLE')
    const lk = await sharedAppLookup(prisma, input.userId, kind, book ? { sameBookAs: resolved?.projectId ?? 'new-book' } : {})
    const d = book && lk.byBook ? decideBookLink(lk, lk.byBook) : decideSoloLink(lk)
    if ('note' in d) return web(d.note)
    let target: string | 'new'
    if ('link' in d) target = d.link.appWorkflowId
    else {
      if (!(book ? bookLinkedWorkAppTemplate(kind, COMPANY_BOOK_KINDS) : soloWorkAppTemplate(kind))) return web('NO_TEMPLATE')
      target = 'new'
    }
    seenKinds.set(kind, target)
    filled.set(n.id, target)
  }
  if ([...filled.values()].some((v, i, xs) => v !== 'new' && xs.indexOf(v) !== i)) return web('LINK_CHOOSE')

  const adds = 1 + [...filled.values()].filter((v) => v === 'new').length
  const { limits } = policy
  const counted = await prisma.workflow.count({ where: { agentId: input.agentId, ...COUNTED_WORKFLOWS } })
  if (limits.maxWorkflows != null && counted + adds > limits.maxWorkflows) return { ok: false, kind: 'limit', code: 'workflow_limit_reached' }
  const live = await prisma.workflow.count({ where: { agentId: input.agentId, status: 'production', ...COUNTED_WORKFLOWS } })
  if (live + adds > limits.maxProduction) return { ok: false, kind: 'limit', code: limits.isPaid ? 'paid_limit_reached' : 'free_limit_reached' }
  const newBooks = appNodesOf(input.workflowJson).filter(isBook).length + todo.filter((n) => isBook(n) && filled.get(n.id) === 'new').length
  if (newBooks > 0) {
    const [used, limit] = await Promise.all([prisma.$transaction((tx) => countCompanyBooks(tx, input.userId)), companyLimitOf(prisma, input.userId)])
    if (limit !== null && used + newBooks > limit) return { ok: false, kind: 'limit', code: 'COMPANY_LIMIT' }
  }
  return { ok: true }
}

export async function linkTemplateApps(input: { userId: string; agentId: string; workflowId: string }): Promise<{ workflow: Workflow | null; notes: AppLinkNote[] }> {
  const { linkNodesOf, linkTargetOf, appNodesOf } = await import('@/lib/work/app-canvas')
  const { isSharedAppTemplateKind, isCompanyBookKind, COMPANY_BOOK_KINDS } = await import('@/lib/work/app-template-kinds')
  const { isBookBoundKind } = await import('@/lib/work/workflow-template-catalog')
  const wf = await prisma.workflow.findUnique({ where: { workflowId: input.workflowId } })
  if (!wf) return { workflow: null, notes: [] }
  const links = linkNodesOf(wf.workflowJson)
  const isBook = (n: { data?: { appTemplate?: unknown } | null }) => isCompanyBookKind(n.data?.appTemplate)
  const todo = links.filter((n) => n.data?.autoLink === true && !linkTargetOf(n) && isSharedAppTemplateKind(n.data?.appTemplate))
    .sort((a, b) => Number(isBook(b)) - Number(isBook(a)))
  if (!todo.length) return { workflow: null, notes: [] }
  const bookNodes = [...links.filter(isBook), ...appNodesOf(wf.workflowJson).filter(isBook)]
  const notes: AppLinkNote[] = []
  const fill = new Map<string, string>()
  const byKind = new Map<string, Awaited<ReturnType<typeof findOrCreateSharedApp>>>()
  for (const n of todo) {
    const kind = n.data!.appTemplate as string
    let book: string | undefined
    if (isBookBoundKind(kind, COMPANY_BOOK_KINDS) && bookNodes.length) {
      const only = bookNodes.length === 1 && links.includes(bookNodes[0]) ? bookNodes[0] : null
      book = only ? (fill.get(only.id) ?? linkTargetOf(only) ?? undefined) : undefined
      if (!book) { notes.push({ nodeId: n.id, code: 'LINK_NEEDS_BOOK' }); continue }
    }
    if (!byKind.has(kind)) byKind.set(kind, await findOrCreateSharedApp({ userId: input.userId, agentId: input.agentId, appTemplate: kind, excludeWorkflowId: input.workflowId, mode: 'auto', ...(book ? { book } : {}) }))
    const r = byKind.get(kind)!
    if ('note' in r) { notes.push({ nodeId: n.id, ...r.note }); continue }
    if ([...fill.values()].includes(r.appWorkflowId)) { notes.push({ nodeId: n.id, code: 'LINK_CHOOSE' }); continue }
    fill.set(n.id, r.appWorkflowId)
    notes.push({ nodeId: n.id, code: r.created ? 'LINK_CREATED' : 'LINKED', appWorkflowId: r.appWorkflowId })
  }
  if (!fill.size) return { workflow: null, notes }
  const g = JSON.parse(wf.workflowJson) as { nodes: Array<{ id?: unknown; data?: Record<string, unknown> }> }
  for (const n of g.nodes) if (typeof n.id === 'string' && fill.has(n.id)) n.data = { ...n.data, linkedAppWorkflowId: fill.get(n.id) }
  const w = await updateWorkflow({ userId: input.userId, workflowId: input.workflowId, patch: { workflowJson: JSON.stringify(g) }, expectedVersion: wf.version, note: 'linked shared work app' })
  if (!w.ok) {
    console.error('[shared-app] link write failed:', w.code, w.message)
    return { workflow: null, notes: notes.map((x) => (fill.has(x.nodeId) ? { nodeId: x.nodeId, code: 'LINK_FAILED' as const, appWorkflowId: x.appWorkflowId } : x)) }
  }
  return { workflow: w.workflow, notes }
}

export async function createSharedAppForLink(input: { userId: string; agentId: string; appTemplate: string; forWorkflowId: string; book?: string }): Promise<WorkflowServiceResult<{ appWorkflowId: string; book: string | null }>> {
  const { isSharedAppTemplateKind, COMPANY_BOOK_KINDS } = await import('@/lib/work/app-template-kinds')
  const { isBookBoundKind } = await import('@/lib/work/workflow-template-catalog')
  if (!isSharedAppTemplateKind(input.appTemplate)) return fail(400, 'INVALID', 'not a shared app template')
  const bound = isBookBoundKind(input.appTemplate, COMPANY_BOOK_KINDS)
  if (bound && !input.book) return fail(400, 'INVALID', 'choose the bank ledger of this workflow first')
  const agent = await prisma.agent.findFirst({ where: { agentId: input.agentId, userId: input.userId }, select: { agentId: true } })
  if (!agent) return fail(404, 'AGENT_NOT_FOUND', 'Agent not found')
  const book = bound ? input.book : undefined
  const r = await findOrCreateSharedApp({ userId: input.userId, agentId: input.agentId, appTemplate: input.appTemplate, excludeWorkflowId: input.forWorkflowId, mode: 'create', ...(book ? { book } : {}) })
  if ('note' in r) return fail(409, r.note.code, `The ${input.appTemplate} workflow could not be created (${r.note.detail ?? ''})`, { detail: r.note.detail })
  return { ok: true, appWorkflowId: r.appWorkflowId, book: book ?? null }
}

export async function findOrCreateDefaultLedger(input: { userId: string; agentId: string; forWorkflowId: string }): Promise<{ appWorkflowId: string } | { code: string }> {
  const r = await findOrCreateSharedApp({ userId: input.userId, agentId: input.agentId, appTemplate: 'ledger', excludeWorkflowId: input.forWorkflowId, mode: 'auto' })
  return 'note' in r ? { code: r.note.code } : { appWorkflowId: r.appWorkflowId }
}

export async function ensureMyFormsApp(input: { userId: string; lang: 'en' | 'de' | 'fr' | 'ko' }): Promise<{ projectId: string; appWorkflowId: string; created: boolean }> {
  const { WorkError } = await import('@/lib/work/errors')
  if (isSelfHosted()) throw new WorkError('UNAVAILABLE', 'my forms is a Cloud feature')
  const find = async (db: Prisma.TransactionClient | typeof prisma) => {
    const p = await db.workProject.findFirst({ where: { userId: input.userId, kind: 'myforms', status: 'active', workflowId: { not: null }, workflow: { kind: APP_WORKFLOW_KIND, status: 'production' } }, select: { id: true, workflowId: true }, orderBy: { createdAt: 'asc' } })
    return p ? { projectId: p.id, appWorkflowId: p.workflowId!, created: false } : null
  }
  const had = await find(prisma)
  if (had) return had
  const agent = await prisma.agent.findFirst({ where: { userId: input.userId }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }], select: { agentId: true } })
  if (!agent) throw new WorkError('NOT_FOUND', 'no agent')
  const { workKindLabel } = await import('@/lib/translations/work')
  const name = workKindLabel(input.lang, 'myforms')
  const json = JSON.stringify({
    nodes: [
      { id: 'start-1', type: 'custom', position: { x: 100, y: 300 }, data: { label: 'Start / App', icon: null, color: 'bg-green-500', showLeftHandle: false, nodeType: 'start', triggerType: 'app' } },
      { id: 'app-myforms', type: 'custom', position: { x: 450, y: 300 }, data: { label: name, icon: null, color: 'bg-amber-600', nodeType: 'workApp', ai: { model: 'gpt-6-sol', maxTokens: 4096, imageInput: true, pdfInput: true, includeChatHistory: true }, appTemplate: 'myforms' } },
      { id: 'end-1', type: 'custom', position: { x: 800, y: 300 }, data: { label: 'End', icon: null, color: 'bg-green-500', nodeType: 'end' } },
    ],
    edges: [
      { id: 'edge-start-app', source: 'start-1', target: 'app-myforms', type: 'default' },
      { id: 'edge-app-end', source: 'app-myforms', sourceHandle: 'done', target: 'end-1', type: 'default' },
    ],
  })
  const refSync = await referenceSyncContext(input.userId)
  const r = await runCompanyTx(await companyCtx(input.userId), async (tx) => {
    if (!(await lockAgentRow(tx, agent.agentId))) throw new WorkflowWriteAbort(fail(404, 'AGENT_NOT_FOUND', 'Agent not found'))
    await tx.$queryRaw`SELECT id FROM "user" WHERE id = ${input.userId} FOR NO KEY UPDATE`
    const again = await find(tx)
    if (again) return again
    const restored = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT p.id FROM work_project p WHERE p.user_id = ${input.userId} AND p.kind = 'myforms' AND p.status = 'active' AND p.workflow_id IS NULL
        AND EXISTS (SELECT 1 FROM work_event e WHERE e.project_id = p.id AND e.user_id = p.user_id AND e.action = 'backup_import') LIMIT 1`
    if (restored.length) throw new WorkError('STALE', 'MYFORMS_NOT_DEPLOYED')
    const prepared = prepareWorkflowCreate({ name, workflowJson: json, status: 'production' })
    if (isServiceError(prepared)) throw new WorkflowWriteAbort(prepared)
    const created = await insertPreparedWorkflowTx(tx, { agentId: agent.agentId, prepared })
    await syncReferenceLinesOrAbort(tx, refSync, { userId: input.userId, agentId: agent.agentId, workflowId: created.workflowId, workflowJson: prepared.workflowJson })
    const made = await find(tx)
    if (!made) throw new WorkflowWriteAbort(fail(500, 'MYFORMS_CREATE_FAILED', 'the my forms work app was not created'))
    return { ...made, created: true }
  })
  if (isServiceError(r)) throw new Error(`my forms app not created: ${r.code}`)
  return r
}

export async function createAssembledApp(input: { userId: string; agentId: string; spec: unknown }): Promise<
  | { ok: true; workflowId: string; appWorkflowId: string; workAppId: string; version: number }
  | { ok: false; issues: import('@/lib/work/assembled').SpecIssue[] }
  | WorkflowServiceError
> {
  const { validateSpec, applySpecTx, specRejectedToResult } = await import('@/lib/work/assembled')
  const first = validateSpec(input.spec)
  if (!first.ok) return first
  const agent = await prisma.agent.findFirst({ where: { agentId: input.agentId, userId: input.userId }, select: { agentId: true } })
  if (!agent) return fail(404, 'AGENT_NOT_FOUND', 'Agent not found')
  const name = first.spec.name
  const json = JSON.stringify({
    nodes: [
      { id: 'start-1', type: 'custom', position: { x: 100, y: 300 }, data: { label: 'Start / App', icon: null, color: 'bg-green-500', showLeftHandle: false, nodeType: 'start', triggerType: 'app' } },
      { id: 'app-assembled', type: 'custom', position: { x: 450, y: 300 }, data: { label: name, icon: null, color: 'bg-amber-600', nodeType: 'workApp', ai: { model: 'gpt-6-sol', maxTokens: 4096, imageInput: true, pdfInput: true, includeChatHistory: true }, appTemplate: 'assembled' } },
      { id: 'end-1', type: 'custom', position: { x: 800, y: 300 }, data: { label: 'End', icon: null, color: 'bg-green-500', nodeType: 'end' } },
    ],
    edges: [
      { id: 'edge-start-app', source: 'start-1', target: 'app-assembled', type: 'default' },
      { id: 'edge-app-end', source: 'app-assembled', sourceHandle: 'done', target: 'end-1', type: 'default' },
    ],
  })
  const prepared = prepareWorkflowCreate({ name, workflowJson: json, status: 'production' })
  if (isServiceError(prepared)) return prepared
  const [limits, policy, refSync] = await Promise.all([getPlanLimits(input.userId), loadActivationPolicy(input.userId), referenceSyncContext(input.userId)])
  const { ensureUserDataKey } = await import('@/lib/user-data-key')
  const key = await ensureUserDataKey(prisma, input.userId)
  try {
    const r = await runCompanyTx(await companyCtx(input.userId), async (tx) => {
      if (!(await lockAgentRow(tx, input.agentId))) throw new WorkflowWriteAbort(fail(404, 'AGENT_NOT_FOUND', 'Agent not found'))
      if (!(await tx.agent.findFirst({ where: { agentId: input.agentId, userId: input.userId }, select: { agentId: true } }))) throw new WorkflowWriteAbort(fail(404, 'AGENT_NOT_FOUND', 'Agent not found'))
      const countError = await assertWorkflowCountLimit(limits, input.agentId, tx)
      if (countError) throw new WorkflowWriteAbort(countError)
      const gateError = await assertActivationGate(policy, input.agentId, tx)
      if (gateError) throw new WorkflowWriteAbort(gateError)
      const created = await insertPreparedWorkflowTx(tx, { agentId: input.agentId, prepared })
      await syncReferenceLinesOrAbort(tx, refSync, { userId: input.userId, agentId: input.agentId, workflowId: created.workflowId, workflowJson: prepared.workflowJson })
      const p = await tx.workProject.findFirst({ where: { userId: input.userId, kind: 'assembled', workflow: { parentWorkflowId: created.workflowId } }, select: { id: true, workflowId: true } })
      if (!p?.workflowId) throw new WorkflowWriteAbort(fail(500, 'ASSEMBLED_CREATE_FAILED', 'the assembled work app was not created'))
      const v = await applySpecTx(tx, key, { userId: input.userId, isOwner: true, projectId: p.id, spec: input.spec, expectedVersion: 0 })
      return { ok: true as const, workflowId: created.workflowId, appWorkflowId: p.workflowId, workAppId: p.id, version: v.version }
    })
    if (isServiceError(r)) return r
    await syncWorkflowSchedule(r.workflowId, input.agentId, prepared.workflowJson)
    return r
  } catch (e) {
    const x = specRejectedToResult(e)
    return x.ok ? fail(500, 'ASSEMBLED_CREATE_FAILED', 'unexpected') : x
  }
}

export async function attachBookToApp(input: { userId: string; appWorkflowId: string; bookAppWorkflowId: string }): Promise<WorkflowServiceResult<{ appWorkflowId: string; book: string }>> {
  const { resolveBook, booksOf } = await import('@/lib/work/shared-apps')
  const { COMPANY_BOOK_KINDS, isCompanyBookKind } = await import('@/lib/work/app-template-kinds')
  const { bookLinkedWorkAppTemplate } = await import('@/lib/work/workflow-template-catalog')
  const { appNodesOf, linkNodesOf, linkTargetOf } = await import('@/lib/work/app-canvas')
  const hidden = await prisma.workflow.findFirst({
    where: { workflowId: input.appWorkflowId, kind: APP_WORKFLOW_KIND, status: 'production', agent: { userId: input.userId } },
    select: { workflowId: true, parentNodeId: true, parent: { select: { workflowId: true, kind: true, status: true, version: true, workflowJson: true } } },
  })
  const canvas = hidden?.parent
  if (!hidden || !canvas || !hidden.parentNodeId) return fail(404, 'NOT_FOUND', 'Work app not found')
  if (canvas.kind !== 'main' || canvas.status !== 'production') return fail(409, 'NOT_DEPLOYED', 'deploy the workflow of this work app first')
  const project = await prisma.workProject.findFirst({ where: { userId: input.userId, workflowId: hidden.workflowId, status: 'active' }, select: { id: true, kind: true } })
  const tpl = project ? bookLinkedWorkAppTemplate(project.kind, COMPANY_BOOK_KINDS) : null
  if (!project || !tpl || isCompanyBookKind(project.kind)) return fail(400, 'INVALID', 'this work app does not read a bank ledger')
  const book = await resolveBook(prisma, input.userId, input.bookAppWorkflowId)
  if (!book) return fail(409, 'LINK_BOOK_UNUSABLE', 'the bank ledger is not deployed or no longer exists')
  if ((await booksOf(prisma, input.userId, [project.id])).get(project.id)?.length) return fail(409, 'ALREADY_HAS_BOOK', 'this work app already reads a bank ledger')

  const tg = JSON.parse(tpl.template.workflowJson) as { nodes: Array<{ id: string; position?: { x: number; y: number }; data?: Record<string, unknown> }>; edges: Array<Record<string, unknown> & { id?: string; source?: string; target?: string; sourceHandle?: string }> }
  const tLink = linkNodesOf(tg)[0]
  const tApp = appNodesOf(tg).find((n) => n.data?.appTemplate === project.kind)
  if (!tLink || !tApp) return fail(400, 'INVALID', 'no template for this work app')
  const g = JSON.parse(canvas.workflowJson) as { nodes: Array<{ id?: unknown; position?: { x: number; y: number }; data?: Record<string, unknown> }>; edges?: Array<Record<string, unknown> & { source?: unknown; target?: unknown; sourceHandle?: unknown }> }
  const books = linkNodesOf(g).filter((n) => isCompanyBookKind(n.data?.appTemplate))
  if (appNodesOf(g).some((n) => isCompanyBookKind(n.data?.appTemplate))) return fail(409, 'BOOK_ON_CANVAS', 'this workflow has its own bank ledger — link the apps on its canvas')
  if (books.length > 1) return fail(409, 'LINK_CHOOSE', 'this workflow has more than one bank ledger node — choose on its canvas')
  let linkId: string
  if (books.length === 1) {
    if (linkTargetOf(books[0]) !== book.appWorkflowId) return fail(409, 'LINK_OTHER_BOOK', 'this workflow already has a bank ledger node for another or no ledger — choose on its canvas')
    linkId = books[0].id
  } else {
    const ids = new Set(g.nodes.map((n) => String(n.id)))
    linkId = tLink.id
    for (let i = 2; ids.has(linkId); i++) linkId = `${tLink.id}-${i}`
    const at = g.nodes.find((n) => n.id === hidden.parentNodeId)?.position ?? { x: 0, y: 0 }
    const { autoLink: _drop, ...data } = tLink.data ?? {}
    g.nodes.push({ id: linkId, type: 'custom', position: { x: at.x, y: at.y + 360 }, data: { ...data, linkedAppWorkflowId: book.appWorkflowId } } as (typeof g.nodes)[number])
  }
  const map = (id: unknown) => (id === tLink.id ? linkId : id === tApp.id ? hidden.parentNodeId : null)
  g.edges ??= []
  const edgeIds = new Set(g.edges.map((e) => String(e.id)))
  for (const e of tg.edges) {
    if (e.sourceHandle !== 'ref') continue
    const source = map(e.source), target = map(e.target)
    if (!source || !target) continue
    const have = g.edges.find((x) => x.sourceHandle === 'ref' && x.source === source && x.target === target)
    if (have) {
      const want = (e.data as { sheets?: unknown; includeUnconfirmed?: unknown } | undefined) ?? {}
      const cur = (have.data as { sheets?: unknown } | undefined) ?? {}
      const sheets = [...new Set([...(Array.isArray(cur.sheets) ? cur.sheets : []), ...(Array.isArray(want.sheets) ? want.sheets : [])].map(String))]
      have.data = { ...(have.data as Record<string, unknown> | undefined), sheets, ...(want.includeUnconfirmed === true ? { includeUnconfirmed: true } : {}) }
      continue
    }
    let id = String(e.id)
    for (let i = 2; edgeIds.has(id); i++) id = `${e.id}-${i}`
    edgeIds.add(id)
    g.edges.push({ ...e, id, source, target })
  }
  if (!g.edges.some((e) => e.sourceHandle === 'ref' && ((e.source === linkId && e.target === hidden.parentNodeId) || (e.source === hidden.parentNodeId && e.target === linkId)))) return fail(400, 'INVALID', 'no reference line between the ledger and this work app in its template')
  const w = await updateWorkflow({ userId: input.userId, workflowId: canvas.workflowId, patch: { workflowJson: JSON.stringify(g) }, expectedVersion: canvas.version, expectedStatus: 'production', note: 'linked bank ledger' })
  if (!w.ok) return w
  return { ok: true, appWorkflowId: hidden.workflowId, book: book.appWorkflowId }
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
   return runCompanyTx(await companyCtx(input.userId), async (tx) => {
    if (!(await lockAgentRow(tx, input.agentId))) {
      throw new WorkflowWriteAbort(fail(404, 'AGENT_NOT_FOUND', 'Agent not found'))
    }
    if (limits.maxWorkflows != null) {
      const count = await tx.workflow.count({ where: { agentId: input.agentId, ...COUNTED_WORKFLOWS } })
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

  const result = await runCompanyTx(await companyCtx(input.userId), async (tx) => {
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
    refSync: RefSyncCtx
  },
): Promise<{ workflow: Workflow; previousStatus: string; appNotes: AppNote[] }> {
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
  const appNotes = await syncReferenceLinesOrAbort(tx, input.refSync, { userId: input.userId, agentId: input.agentId, workflowId: input.workflowId, workflowJson: workflow.workflowJson })
  return { workflow, previousStatus: cur.status, appNotes }
}

async function assertActivationAllowedLocked(
  tx: Prisma.TransactionClient,
  cur: LockedWorkflowRow,
  policy: ActivationPolicy,
  guardWhenAlreadyProduction: boolean,
  userId: string,
): Promise<void> {
  if (normalizeWorkflowKind(cur.kind) === SUB_WORKFLOW_KIND) throw new WorkflowWriteAbort(SUB_WORKFLOW_NOT_DEPLOYABLE)
  if (cur.kind === APP_WORKFLOW_KIND) throw new WorkflowWriteAbort(fail(404, 'NOT_FOUND', 'Workflow not found'))
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
}): Promise<WorkflowServiceResult<{ workflow: Workflow; previousStatus?: string; appNotes?: AppNote[] }>> {
  if (!input.status || !(VALID_WORKFLOW_STATUSES as readonly string[]).includes(input.status)) {
    return fail(400, 'INVALID_STATUS', `Invalid status. Must be one of: ${VALID_WORKFLOW_STATUSES.join(', ')}`)
  }

  const resolved = await resolveOwnedWorkflow(input.userId, input.workflowId)
  if (!resolved.ok) return resolved
  const workflow = resolved.workflow

  let updated: Workflow
  let previousStatus: string | undefined
  let appNotes: AppNote[] = []

  if (input.status === 'production') {
    const policy = await loadActivationPolicy(input.userId)
    const refSync = await referenceSyncContext(input.userId)
    const result = await runCompanyTx(await companyCtx(input.userId), tx =>
      activateWorkflowLocked(tx, {
        workflowId: input.workflowId,
        agentId: workflow.agentId,
        userId: input.userId,
        policy,
        refSync,
        expectedVersion: input.expectedVersion,
        guardWhenAlreadyProduction: false,
      }),
    )
    if (isServiceError(result)) return result
    updated = result.workflow
    previousStatus = result.previousStatus
    appNotes = result.appNotes
  } else if (normalizeWorkflowKind(workflow.kind) !== SUB_WORKFLOW_KIND) {
    const result = await runCompanyTx(await companyCtx(input.userId), async (tx) => {
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
      const row = await tx.workflow.update({
        where: { workflowId: input.workflowId },
        data: { status: input.status, trafficWeight: trafficWeightFor(input.status) },
      })
      if (cur.kind === APP_WORKFLOW_KIND) throw new WorkflowWriteAbort(fail(404, 'NOT_FOUND', 'Workflow not found'))
      await closeCanvasAppsLocked(tx, input.userId, input.workflowId, input.status, cur.workflowJson)
      return { row, previousStatus: cur.status }
    })
    if (isServiceError(result)) return result
    updated = result.row
    previousStatus = result.previousStatus
  } else if (input.status === 'archived' && normalizeWorkflowKind(workflow.kind) === SUB_WORKFLOW_KIND) {
    const result = await runCompanyTx(await companyCtx(input.userId), async (tx) => {
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
    const result = await runCompanyTx(await companyCtx(input.userId), async (tx) => {
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
  return { ok: true, workflow: updated, previousStatus, ...(appNotes.length ? { appNotes } : {}) }
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
}): Promise<WorkflowServiceResult<{ workflow: Workflow; appNotes?: AppNote[] }>> {
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
  const refSync = await referenceSyncContext(input.userId)

  let updated: Workflow
  let appNotes: AppNote[] = []

  if (patch.workflowJson !== undefined) {
    const newJson = patch.workflowJson
    const needsSubRefCheck = kind === SUB_WORKFLOW_KIND || collectSubWorkflowRefs(newJson).length > 0
    const touchesInbound = inboundPstnNumbers(newJson).length > 0
    const touchesCanvas = isAppCanvas(newJson) || isAppCanvas(workflow.workflowJson) || (await hasAppChildren(workflow.workflowId))
    const result = await runCompanyTx(await companyCtx(input.userId), async (tx) => {
      if (touchesInbound) await lockPstnInboundScope(tx, input.userId)
      if ((activationPolicy || needsSubRefCheck || touchesCanvas) && !(await lockAgentRow(tx, workflow.agentId))) {
        throw new WorkflowWriteAbort(fail(404, 'AGENT_NOT_FOUND', 'Agent not found'))
      }
      const cur = await lockWorkflowRow(tx, input.workflowId)
      if (!cur) throw new WorkflowWriteAbort(fail(404, 'NOT_FOUND', 'Workflow not found'))
      if (cur.kind === APP_WORKFLOW_KIND) throw new WorkflowWriteAbort(fail(404, 'NOT_FOUND', 'Workflow not found'))
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

      {
        const { templateLockProblems, templateLockMessage } = await import('@/lib/work/app-template-lock')
        const locked = await templateLockProblems(tx, { userId: input.userId, workflowId: cur.workflowId, kind: cur.kind, workflowJson: newJson, savedJson: cur.workflowJson })
        if (locked.length) throw new WorkflowWriteAbort(fail(409, 'APP_TEMPLATE_LOCKED', templateLockMessage(locked), { nodes: locked }))
      }
      await casWriteLocked(tx, cur, {
        newJson,
        metadata,
        source: input.source ?? 'ui',
        createdById: input.createdById ?? input.userId,
        note: input.note,
      })
      let notes: AppNote[] = []
      if ((patch.status ?? cur.status) === 'production') {
        notes = await syncReferenceLinesOrAbort(tx, refSync!, { userId: input.userId, agentId: cur.agentId, workflowId: cur.workflowId, workflowJson: newJson })
      } else {
        await closeCanvasAppsLocked(tx, input.userId, cur.workflowId, (patch.status ?? cur.status) as string, newJson)
      }
      return { row: await tx.workflow.findUniqueOrThrow({ where: { workflowId: input.workflowId } }), notes }
    })
    if (isServiceError(result)) return result
    updated = result.row
    appNotes = result.notes
  } else if (isLockedActivation) {
    const result = await runCompanyTx(await companyCtx(input.userId), tx =>
      activateWorkflowLocked(tx, {
        workflowId: input.workflowId,
        agentId: workflow.agentId,
        userId: input.userId,
        policy: activationPolicy!,
        expectedVersion: input.expectedVersion,
        metadata,
        refSync: refSync!,
        guardWhenAlreadyProduction: true,
      }),
    )
    if (isServiceError(result)) return result
    updated = result.workflow
    appNotes = result.appNotes
  } else if (needsArchiveGuard) {
    if (Object.keys(metadata).length === 0) {
      return { ok: true, workflow }
    }
    const result = await runCompanyTx(await companyCtx(input.userId), async (tx) => {
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
  } else if (patch.status !== undefined && kind !== SUB_WORKFLOW_KIND) {
    const result = await runCompanyTx(await companyCtx(input.userId), async (tx) => {
      if (!(await lockAgentRow(tx, workflow.agentId))) {
        throw new WorkflowWriteAbort(fail(404, 'AGENT_NOT_FOUND', 'Agent not found'))
      }
      const cur = await lockWorkflowRow(tx, input.workflowId)
      if (!cur) throw new WorkflowWriteAbort(fail(404, 'NOT_FOUND', 'Workflow not found'))
      if (cur.kind === APP_WORKFLOW_KIND) throw new WorkflowWriteAbort(fail(404, 'NOT_FOUND', 'Workflow not found'))
      if (input.expectedVersion !== undefined && input.expectedVersion !== cur.version) {
        throw new WorkflowWriteAbort(fail(409, 'STALE_CONFLICT', 'Workflow was modified by another session. Reload and retry.', { currentVersion: cur.version }))
      }
      const row = await tx.workflow.update({ where: { workflowId: input.workflowId }, data: metadata })
      await closeCanvasAppsLocked(tx, input.userId, input.workflowId, patch.status as string, cur.workflowJson)
      return row
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
  return { ok: true, workflow: updated, ...(appNotes.length ? { appNotes } : {}) }
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
    const result = await runCompanyTx(await companyCtx(input.userId), async (tx) => {
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

  {
    const ownsRefs = (await prisma.projectReference.count({ where: { userId: input.userId, createdByWorkflowId: input.workflowId } })) > 0
    const refKey = ownsRefs ? (await referenceSyncContext(input.userId)).key : null
    const result = await runCompanyTx(await companyCtx(input.userId), async (tx) => {
      if (!(await lockAgentRow(tx, resolved.workflow.agentId))) {
        throw new WorkflowWriteAbort(fail(404, 'AGENT_NOT_FOUND', 'Agent not found'))
      }
      const cur = await lockWorkflowRow(tx, input.workflowId)
      if (!cur) throw new WorkflowWriteAbort(fail(404, 'NOT_FOUND', 'Workflow not found'))
      if (cur.kind === APP_WORKFLOW_KIND) throw new WorkflowWriteAbort(fail(404, 'NOT_FOUND', 'Workflow not found'))
      await tx.$queryRaw`SELECT id FROM "user" WHERE id = ${input.userId} FOR NO KEY UPDATE`
      const hidden = await tx.$queryRaw<Array<{ workflowId: string; status: string }>>`
        SELECT "workflowId", status FROM workflows WHERE parent_workflow_id = ${cur.workflowId} AND kind = ${APP_WORKFLOW_KIND} ORDER BY "workflowId" FOR UPDATE`
      const { workflowAppProjectIds } = await import('@/lib/work/workflow-apps')
      const apps = await workflowAppProjectIds(tx, input.userId, cur.workflowId)
      if (apps.length) throw new WorkflowWriteAbort(fail(409, 'HAS_WORK_APPS', 'This workflow still has work apps — delete them first (the workflow is deleted with its last app).', { projectIds: apps }))
      if (!refKey && (await tx.projectReference.count({ where: { userId: input.userId, createdByWorkflowId: cur.workflowId } })) > 0) {
        throw new WorkflowWriteAbort(fail(409, 'STALE_CONFLICT', 'This workflow changed meanwhile — try again.'))
      }
      if (hidden.length) {
        const { assertSharedAppsNotInUseLocked } = await import('@/lib/work/shared-apps')
        await sharedInUseToAbort(() => assertSharedAppsNotInUseLocked(tx, input.userId, hidden.filter((h) => h.status !== 'archived').map((h) => h.workflowId), cur.workflowId))
        await tx.workflow.deleteMany({ where: { workflowId: { in: hidden.map((h) => h.workflowId) }, kind: APP_WORKFLOW_KIND } })
      }
      if (refKey) {
        const { deleteOwnedReferencesLocked } = await import('@/lib/work/references')
        await deleteOwnedReferencesLocked(tx, refKey, { userId: input.userId, workflowId: cur.workflowId })
      }
      await tx.flowRun.deleteMany({ where: { workflowId: input.workflowId } })
      await tx.workflow.delete({ where: { workflowId: input.workflowId } })
      return true as const
    })
    if (isServiceError(result)) return result
    return { ok: true }
  }
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
    where: { agentId: input.agentId, kind: { not: APP_WORKFLOW_KIND } },
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

  const refSync = await referenceSyncContext(input.approverUserId)
  const result = await runCompanyTx(await companyCtx(input.approverUserId), async (tx) => {
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
      refSync,
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

// ========================================
// ========================================

async function workErrorToFail<T>(fn: () => Promise<T>): Promise<T> {
  const { WorkError } = await import('@/lib/work/errors')
  try {
    return await fn()
  } catch (e) {
    if (e instanceof WorkError) throw new WorkflowWriteAbort(fail(e.code === 'NOT_FOUND' ? 404 : 409, e.code, e.detail || e.code))
    throw e
  }
}

export async function restoreWorkAppCanvas(input: { userId: string; projectId: string; nodeData?: Record<string, unknown>; inTx?(tx: Prisma.TransactionClient): Promise<void> }): Promise<{ ok: true; workflowId: string; restoredApps: number } | WorkflowServiceError> {
  const p = await prisma.workProject.findFirst({ where: { id: input.projectId, userId: input.userId, status: 'active' }, select: { id: true, kind: true, agentId: true, workflowId: true } })
  if (!p) return fail(404, 'NOT_FOUND', 'Work app not found')
  if (p.workflowId) return fail(409, 'NOT_DETACHED', 'This work app still has a workflow — open it with Edit.')
  const h = await prisma.workflow.findFirst({ where: { kind: APP_WORKFLOW_KIND, appProjectId: p.id, agent: { userId: input.userId } }, select: { workflowId: true, agentId: true, parentWorkflowId: true } })
  if (h?.parentWorkflowId) return fail(409, 'CANVAS_EXISTS', 'This app was removed from a canvas that still exists — open that canvas with Edit.')
  const agentId = h?.agentId ?? p.agentId
  if (!agentId) return fail(409, 'NO_AGENT', 'The AI agent of this work app was deleted — it cannot be restored.')
  const [limits, ctx] = await Promise.all([getPlanLimits(input.userId), referenceSyncContext(input.userId)])
  const workflowId = generateWorkflowId()
  const result = await runCompanyTx(await companyCtx(input.userId), async (tx) => {
    if (!(await lockAgentRow(tx, agentId))) throw new WorkflowWriteAbort(fail(404, 'AGENT_NOT_FOUND', 'Agent not found'))
    if (input.inTx) await workErrorToFail(() => input.inTx!(tx))
    const limitError = await assertWorkflowCountLimit(limits, agentId, tx)
    if (limitError) throw new WorkflowWriteAbort(limitError)
    const { restoreCanvasLocked } = await import('@/lib/work/app-admin')
    const n = await workErrorToFail(() => restoreCanvasLocked(tx, ctx.key, { userId: input.userId, agentId, projectId: p.id, projectKind: p.kind, hiddenWorkflowId: h?.workflowId ?? null, newWorkflowId: workflowId, newHiddenWorkflowId: generateWorkflowId(), nodeData: input.nodeData }, async (c) => {
      await tx.workflow.create({ data: { workflowId, agentId, name: c.name || 'Work app', description: c.description, workflowJson: c.workflowJson, status: 'draft', trafficWeight: trafficWeightFor('draft'), kind: 'main' } })
    }))
    return n
  })
  if (isServiceError(result)) return result
  return { ok: true, workflowId, restoredApps: result }
}

export async function restoreWorkAppOriginalTx<T>(input: { userId: string; agentId: string; addsCanvas: boolean; body(tx: Prisma.TransactionClient): Promise<T> }): Promise<{ ok: true; value: T } | WorkflowServiceError> {
  const limits = input.addsCanvas ? await getPlanLimits(input.userId) : null
  const result = await runCompanyTx(await companyCtx(input.userId), async (tx) => {
    if (!(await lockAgentRow(tx, input.agentId))) throw new WorkflowWriteAbort(fail(404, 'AGENT_NOT_FOUND', 'Agent not found'))
    if (limits) {
      const limitError = await assertWorkflowCountLimit(limits, input.agentId, tx)
      if (limitError) throw new WorkflowWriteAbort(limitError)
    }
    return workErrorToFail(() => input.body(tx))
  }, { maxWait: 10_000, timeout: 300_000 })
  if (isServiceError(result)) return result
  return { ok: true, value: result }
}

export async function restoreWorkAppSetCanvas(input: { userId: string; agentId: string; name: string; description: string | null; workflowJson: string; apps: Array<{ projectId: string; nodeId: string; name: string }>; inTx?(tx: Prisma.TransactionClient): Promise<void> }): Promise<{ ok: true; workflowId: string } | WorkflowServiceError> {
  if (!input.apps.length) return fail(400, 'INVALID', 'No apps to restore')
  let graph: { nodes?: Array<{ id?: string; data?: Record<string, unknown> }> }
  try { graph = JSON.parse(input.workflowJson) } catch { return fail(400, 'INVALID', 'Canvas JSON is not valid') }
  const nodeOf = new Map((graph.nodes ?? []).filter((n) => typeof n.id === 'string').map((n) => [n.id as string, n]))
  if (input.apps.some((a) => nodeOf.get(a.nodeId)?.data?.nodeType !== 'workApp')) return fail(400, 'INVALID', 'Every app needs its Work app node on the canvas')
  const limits = await getPlanLimits(input.userId)
  const workflowId = generateWorkflowId()
  const result = await runCompanyTx(await companyCtx(input.userId), async (tx) => {
    if (!(await lockAgentRow(tx, input.agentId))) throw new WorkflowWriteAbort(fail(404, 'AGENT_NOT_FOUND', 'Agent not found'))
    if (input.inTx) await workErrorToFail(() => input.inTx!(tx))
    const limitError = await assertWorkflowCountLimit(limits, input.agentId, tx)
    if (limitError) throw new WorkflowWriteAbort(limitError)
    const ids = input.apps.map((a) => a.projectId)
    const ps = await tx.$queryRaw<Array<{ id: string; workflow_id: string | null }>>`
      SELECT id, workflow_id FROM work_project WHERE user_id = ${input.userId} AND id = ANY(${ids}::text[]) AND status = 'active' ORDER BY id FOR UPDATE`
    if (ps.length !== ids.length || ps.some((p) => p.workflow_id !== null)) throw new WorkflowWriteAbort(fail(409, 'NOT_DETACHED', 'These work apps are not waiting for a canvas'))
    if (await tx.workflow.count({ where: { appProjectId: { in: ids }, kind: APP_WORKFLOW_KIND } })) throw new WorkflowWriteAbort(fail(409, 'STALE_CONFLICT', 'These work apps already have a canvas'))
    await tx.workflow.create({ data: { workflowId, agentId: input.agentId, name: input.name || 'Work app', description: input.description, workflowJson: input.workflowJson, status: 'draft', trafficWeight: trafficWeightFor('draft'), kind: 'main' } })
    const { buildAppGraph } = await import('@/lib/work/app-canvas')
    for (const a of input.apps) {
      const node = nodeOf.get(a.nodeId)! as Parameters<typeof buildAppGraph>[1]
      await tx.workflow.create({
        data: { workflowId: generateWorkflowId(), agentId: input.agentId, name: a.name || 'Work app', workflowJson: buildAppGraph(workflowId, node), status: 'archived', trafficWeight: 0, kind: APP_WORKFLOW_KIND, parentWorkflowId: workflowId, parentNodeId: a.nodeId, appProjectId: a.projectId },
      })
    }
    return workflowId
  })
  if (isServiceError(result)) return result
  return { ok: true, workflowId }
}

export async function deleteWorkAppCompletely(input: { userId: string; projectId: string; confirmReferences?: boolean }): Promise<{ ok: true; canvasDeleted: boolean } | WorkflowServiceError> {
  const p = await prisma.workProject.findFirst({ where: { id: input.projectId, userId: input.userId }, select: { id: true, agentId: true, workflowId: true } })
  if (!p) return fail(404, 'NOT_FOUND', 'Work app not found')
  const sel = { workflowId: true, agentId: true, status: true, parentWorkflowId: true, parentNodeId: true, formerParentIds: true } as const
  const hidden = (p.workflowId ? await prisma.workflow.findFirst({ where: { workflowId: p.workflowId, kind: APP_WORKFLOW_KIND, agent: { userId: input.userId } }, select: sel }) : null)
    ?? (p.workflowId === null ? await prisma.workflow.findFirst({ where: { kind: APP_WORKFLOW_KIND, appProjectId: p.id, agent: { userId: input.userId } }, select: sel }) : null)
  const legacy = !hidden && p.workflowId ? await prisma.workflow.findFirst({ where: { workflowId: p.workflowId, kind: 'main', agent: { userId: input.userId } }, select: { workflowId: true, agentId: true } }) : null
  const canvas = hidden?.parentWorkflowId ? await prisma.workflow.findFirst({ where: { workflowId: hidden.parentWorkflowId, agent: { userId: input.userId } }, select: { workflowId: true, agentId: true } }) : null
  const trash = hidden && !canvas ? await prisma.workCanvasTrash.findFirst({ where: { userId: input.userId, apps: { array_contains: [{ workflowId: hidden.workflowId }] } }, select: { oldWorkflowId: true, agentId: true } }) : null
  const agentId = canvas?.agentId ?? legacy?.agentId ?? hidden?.agentId ?? trash?.agentId ?? p.agentId
  const ctx = await referenceSyncContext(input.userId)
  const result = await runCompanyTx(await companyCtx(input.userId), async (tx) => {
    if (agentId && !(await lockAgentRow(tx, agentId))) throw new WorkflowWriteAbort(fail(404, 'AGENT_NOT_FOUND', 'Agent not found'))
    let canvasDeleted = false
    const { stripNodes, purgeProjectLocked } = await import('@/lib/work/app-admin')
    if (canvas) await lockWorkflowRow(tx, canvas.workflowId)
    if (hidden) {
      const now = await tx.workflow.findUnique({ where: { workflowId: hidden.workflowId }, select: { parentWorkflowId: true, status: true } })
      if (!now || now.parentWorkflowId !== hidden.parentWorkflowId) throw new WorkflowWriteAbort(fail(409, 'STALE_CONFLICT', 'This work app changed meanwhile — reload and try again.'))
      if (now.status !== 'archived') {
        await tx.$queryRaw`SELECT id FROM "user" WHERE id = ${input.userId} FOR NO KEY UPDATE`
        const { assertSharedAppsNotInUseLocked } = await import('@/lib/work/shared-apps')
        await sharedInUseToAbort(() => assertSharedAppsNotInUseLocked(tx, input.userId, [hidden.workflowId], hidden.parentWorkflowId ?? ''))
      }
    }
    if (canvas && hidden) {
      const cur = await lockWorkflowRow(tx, canvas.workflowId)
      if (cur && cur.kind !== APP_WORKFLOW_KIND) {
        const gone = new Set(hidden.parentNodeId ? [hidden.parentNodeId] : [])
        const newJson = gone.size ? stripNodes(cur.workflowJson, gone) : cur.workflowJson
        const others = await tx.workflow.count({ where: { parentWorkflowId: cur.workflowId, kind: APP_WORKFLOW_KIND, workflowId: { not: hidden.workflowId } } })
        if (appNodesOf(newJson).length === 0 && others === 0) {
          const { deleteOwnedReferencesLocked } = await import('@/lib/work/references')
          await deleteOwnedReferencesLocked(tx, ctx.key, { userId: input.userId, workflowId: cur.workflowId })
          await tx.flowRun.deleteMany({ where: { workflowId: cur.workflowId } })
          await tx.workflow.delete({ where: { workflowId: cur.workflowId } })
          canvasDeleted = true
        } else {
          if (newJson !== cur.workflowJson) {
            await casWriteLocked(tx, cur, { newJson, source: 'ui', createdById: input.userId, note: 'work app deleted' })
            if (cur.status === 'production') await syncReferenceLinesOrAbort(tx, ctx, { userId: input.userId, agentId: cur.agentId, workflowId: cur.workflowId, workflowJson: newJson })
            else await closeCanvasAppsLocked(tx, input.userId, cur.workflowId, cur.status, newJson)
          }
          const versions = await tx.workflowVersion.findMany({ where: { workflowId: cur.workflowId }, select: { id: true, workflowJson: true } })
          for (const v of versions) {
            const j = stripNodes(v.workflowJson, gone)
            if (j !== v.workflowJson) await tx.workflowVersion.update({ where: { id: v.id }, data: { workflowJson: j } })
          }
        }
      }
    } else if (legacy) {
      const cur = await lockWorkflowRow(tx, legacy.workflowId)
      if (cur) {
        await tx.flowRun.deleteMany({ where: { workflowId: cur.workflowId } })
        await tx.workflow.delete({ where: { workflowId: cur.workflowId } })
        canvasDeleted = true
      }
    }
    const r = await workErrorToFail(() => purgeProjectLocked(tx, ctx.key, {
      userId: input.userId, projectId: p.id, hiddenWorkflowId: hidden?.workflowId ?? null,
      canvasWorkflowIds: [canvas?.workflowId, trash?.oldWorkflowId, ...(hidden?.formerParentIds ?? [])].filter((x): x is string => !!x), nodeId: hidden?.parentNodeId ?? null,
      confirmReferences: input.confirmReferences === true,
    }))
    if (r.referencedBy.length) throw new WorkflowWriteAbort(fail(409, 'REFERENCED', 'Other work apps read this app — confirm to delete those references too.', { referencedBy: r.referencedBy }))
    return canvasDeleted
  })
  if (isServiceError(result)) return result
  return { ok: true, canvasDeleted: result }
}
