
import type { PrismaClient } from '@prisma/client'
import type { WorkflowContext, WorkflowNode } from '../types'
import { BaseNodeExecutor, type NodeExecutionResult } from './base'

export class WorkHandoffNodeExecutor extends BaseNodeExecutor {
  async execute(node: WorkflowNode, context: WorkflowContext, _prisma: PrismaClient): Promise<NodeExecutionResult> {
    const d = (node.data ?? {}) as Record<string, unknown>
    const runId = (context as WorkflowContext & { flowRunId?: string }).flowRunId
    const input = { toNodeId: d.toNodeId }
    if (typeof runId !== 'string' || !runId) return this.createErrorResult(context, 'Work app handoff: runs only in a work app "done" flow', input)
    const { runHandoffNode } = await import('@/lib/work/flow-runs')
    const r = await runHandoffNode(runId, d.toNodeId)
    if (!r.ok) return this.createErrorResult(context, r.error, input)
    return this.createSuccessResult(context, { input, output: { handedOff: r.wrote } })
  }
}
