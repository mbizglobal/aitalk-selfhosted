
import type { PrismaClient } from '@prisma/client'
import type { WorkflowContext, WorkflowNode } from '../types'
import { BaseNodeExecutor, type NodeExecutionResult } from './base'
import { isSaveAsKeyAllowed } from '@/lib/connection-scope'
import { markTemplateVar } from '../template-scope'

export function workAppStepDate(periodDate: unknown, ev: { periodStart?: string | null; periodEnd?: string | null } | undefined, today: () => string): string | null {
  const v = typeof periodDate === 'string' && periodDate ? periodDate : 'event_end'
  if (v === 'event_end') return ev?.periodEnd ?? null
  if (v === 'event_start') return ev?.periodStart ?? null
  if (v === 'today') return today()
  return v
}

export class WorkAppStepNodeExecutor extends BaseNodeExecutor {
  async execute(node: WorkflowNode, context: WorkflowContext, prisma: PrismaClient): Promise<NodeExecutionResult> {
    const d = (node.data ?? {}) as Record<string, unknown>
    const ctx = context as WorkflowContext & { workEvent?: { periodStart?: string | null; periodEnd?: string | null }; workflowId?: string }
    const { zurichToday } = await import('@/lib/work/dates')
    const date = workAppStepDate(d.periodDate, ctx.workEvent, zurichToday)
    const input = { action: d.action, targetWorkflowId: d.targetWorkflowId, ...(d.targetNodeId !== undefined ? { targetNodeId: d.targetNodeId } : {}), date }
    if (!date) return this.createErrorResult(context, 'Work app: no date — this run has no work app event; choose today or a fixed date', input)
    const key = typeof d.saveAs === 'string' && d.saveAs.trim() ? d.saveAs.trim() : 'workApp'
    if (!isSaveAsKeyAllowed(key)) return this.createErrorResult(context, `Work app: "${key}" is a reserved name — choose another result name (saveAs)`, input)
    try {
      const [{ runWorkAppStep, canvasAppTarget }, { defaultWorkSheetDeps }] = await Promise.all([import('@/lib/work/flow-step'), import('@/lib/work/sheet-gate')])
      const deps = await defaultWorkSheetDeps()
      const targetWorkflowId = d.targetNodeId !== undefined && d.targetNodeId !== null && d.targetNodeId !== ''
        ? await canvasAppTarget(deps.db, ctx.workflowId ?? '', d.targetNodeId)
        : d.targetWorkflowId
      const out = await runWorkAppStep(deps, {
        userId: context.userId, flowWorkflowId: ctx.workflowId ?? 'unknown', targetWorkflowId, action: d.action, date,
      })
      const next = { ...context, [key]: out }
      markTemplateVar(next, key)
      return this.createSuccessResult(next, { input, output: out })
    } catch (e) {
      const { WorkError } = await import('@/lib/work/errors')
      if (e instanceof WorkError) return this.createErrorResult(context, `Work app: ${e.code}${e.detail ? ` — ${e.detail}` : ''}`, input)
      console.error('[work-app-step]', e instanceof Error ? e.message.slice(0, 200) : 'error')
      return this.createErrorResult(context, 'Work app: failed', input)
    }
  }
}
