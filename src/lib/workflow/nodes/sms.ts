import type { PrismaClient } from '@prisma/client'
import { BaseNodeExecutor, type NodeExecutionResult } from '@/lib/workflow/nodes/base'
import type { WorkflowNode, WorkflowContext } from '@/lib/workflow/types'

export class SmsNodeExecutor extends BaseNodeExecutor {
  async execute(_node: WorkflowNode, _context: WorkflowContext, _prisma: PrismaClient): Promise<NodeExecutionResult> {
    throw new Error('SMS nodes are not part of this installation (self-hosted edition)')
  }
}

export const smsNodeExecutor = new SmsNodeExecutor()
