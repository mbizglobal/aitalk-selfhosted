
import { BaseNodeExecutor, NodeExecutionResult } from './base'
import { WorkflowNode, WorkflowContext } from '../types'
import { PrismaClient } from '@prisma/client'

export class StartNodeExecutor extends BaseNodeExecutor {
  async execute(
    node: WorkflowNode,
    context: WorkflowContext,
    prisma: PrismaClient
  ): Promise<NodeExecutionResult> {
    return this.createSuccessResult(context, {
      input: { message: context.message },
      output: { message: context.message }
    })
  }
}

// Singleton instance
export const startNodeExecutor = new StartNodeExecutor()
