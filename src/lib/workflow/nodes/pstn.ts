import type { PrismaClient } from '@prisma/client'
import { BaseNodeExecutor, type NodeExecutionResult } from '@/lib/workflow/nodes/base'
import type { WorkflowNode, WorkflowContext } from '@/lib/workflow/types'

export class PstnNodeExecutor extends BaseNodeExecutor {
  async execute(_node: WorkflowNode, _context: WorkflowContext, _prisma: PrismaClient): Promise<NodeExecutionResult> {
    throw new Error('PSTN nodes are not part of this installation (self-hosted edition)')
  }
}
