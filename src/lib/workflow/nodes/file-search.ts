
import { BaseNodeExecutor, NodeExecutionResult } from './base'
import { WorkflowNode, WorkflowContext } from '../types'
import { PrismaClient } from '@prisma/client'

export class FileSearchNodeExecutor extends BaseNodeExecutor {
  async execute(
    node: WorkflowNode,
    context: WorkflowContext,
    prisma: PrismaClient
  ): Promise<NodeExecutionResult> {
    const { vectorStoreId } = node.data

    if (!vectorStoreId) {
      console.warn('[Workflow] File search node has no vectorStoreId')
      return this.createSuccessResult(context, {
        input: {},
        output: {}
      })
    }

    return this.createSuccessResult(
      {
        ...context,
        vectorStoreId
      },
      {
        input: { previousVectorStoreId: context.vectorStoreId },
        output: { vectorStoreId }
      }
    )
  }
}

// Singleton instance
export const fileSearchNodeExecutor = new FileSearchNodeExecutor()
