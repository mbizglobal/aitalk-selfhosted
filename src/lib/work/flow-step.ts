
import type { PrismaClient } from '@prisma/client'
import { WorkError } from './errors'
import { appTemplateOf } from './app-templates'
import { periodContaining } from './dates'
import { createTask } from './projects'
import { APP_WORKFLOW_KIND, isWorkAppRow } from './app-canvas'
import type { WorkSheetDeps } from './sheet-gate'

export type WorkAppStepAction = 'open_task' | 'read_status'

export interface WorkAppStepResult {
  projectId: string
  taskId: string | null
  title: string
  periodStart: string
  periodEnd: string
  status: string | null
  submissionNumber: number | null
  created: boolean
}

async function findTask(db: PrismaClient, projectId: string, userId: string, start: string, end: string) {
  const t = await db.workTask.findFirst({
    where: { projectId, userId, periodStart: new Date(start), periodEnd: new Date(end) },
    select: { id: true, status: true, currentSubmissionId: true },
  })
  if (!t) return null
  const sub = t.currentSubmissionId ? await db.workSubmission.findUnique({ where: { id: t.currentSubmissionId }, select: { number: true } }) : null
  return { id: t.id, status: t.status, submissionNumber: sub?.number ?? null }
}

export async function canvasAppTarget(db: PrismaClient, canvasWorkflowId: string, targetNodeId: unknown): Promise<string> {
  if (typeof targetNodeId !== 'string' || !targetNodeId) throw new WorkError('INVALID', 'no work app chosen')
  const w = await db.workflow.findFirst({ where: { parentWorkflowId: canvasWorkflowId, parentNodeId: targetNodeId, kind: APP_WORKFLOW_KIND }, select: { workflowId: true } })
  if (!w) throw new WorkError('NOT_FOUND', 'the work app node is not deployed yet')
  return w.workflowId
}

export async function workAppTarget(db: PrismaClient, userId: string, targetWorkflowId: unknown) {
  if (typeof targetWorkflowId !== 'string' || !targetWorkflowId) throw new WorkError('INVALID', 'no work app chosen')
  const w = await db.workflow.findFirst({ where: { workflowId: targetWorkflowId, kind: { in: ['main', APP_WORKFLOW_KIND] }, agent: { userId } }, select: { status: true, kind: true, workflowJson: true } })
  if (!w || !isWorkAppRow(w)) throw new WorkError('NOT_FOUND', 'the work app does not exist')
  if (w.status !== 'production') throw new WorkError('UNAVAILABLE', 'the work app is not deployed')
  const p = await db.workProject.findFirst({ where: { workflowId: targetWorkflowId, userId }, select: { id: true, kind: true } })
  if (!p) throw new WorkError('NOT_FOUND', 'the work app has not been opened yet — open it once first')
  return p
}

export async function runWorkAppStep(
  deps: WorkSheetDeps,
  input: { userId: string; flowWorkflowId: string; targetWorkflowId: unknown; action: unknown; date: unknown },
): Promise<WorkAppStepResult> {
  if (input.action !== 'open_task' && input.action !== 'read_status') throw new WorkError('INVALID', 'action must be open_task or read_status')
  const p = await workAppTarget(deps.db, input.userId, input.targetWorkflowId)
  const tpl = appTemplateOf(p.kind)
  if (!tpl) throw new WorkError('INVALID', 'this work app has no app template — it has no period rule')
  const period = periodContaining(tpl.ui.period, input.date)
  if (!period) throw new WorkError('INVALID', tpl.ui.period === 'custom' ? 'this app template has no fixed period rule' : 'the date is not a calendar date (YYYY-MM-DD)')

  const base = { projectId: p.id, title: period.title, periodStart: period.periodStart, periodEnd: period.periodEnd }
  const cur = await findTask(deps.db, p.id, input.userId, period.periodStart, period.periodEnd)
  if (cur || input.action === 'read_status') {
    return { ...base, taskId: cur?.id ?? null, status: cur?.status ?? null, submissionNumber: cur?.submissionNumber ?? null, created: false }
  }
  try {
    const t = await createTask(deps, { userId: input.userId, projectId: p.id, title: period.title, periodStart: period.periodStart, periodEnd: period.periodEnd, actor: { type: 'flow', workflowId: input.flowWorkflowId } })
    return { ...base, taskId: t.id, status: t.status, submissionNumber: null, created: true }
  } catch (e) {
    if (e instanceof WorkError && e.code === 'INVALID') {
      const again = await findTask(deps.db, p.id, input.userId, period.periodStart, period.periodEnd)
      if (again) return { ...base, taskId: again.id, status: again.status, submissionNumber: again.submissionNumber, created: false }
    }
    throw e
  }
}

