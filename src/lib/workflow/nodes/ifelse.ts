
import { BaseNodeExecutor, NodeExecutionResult } from './base'
import { WorkflowNode, WorkflowContext } from '../types'
import { evaluateCondition } from '../utils'
import { PrismaClient } from '@prisma/client'

export class IfElseNodeExecutor extends BaseNodeExecutor {
  async execute(
    node: WorkflowNode,
    context: WorkflowContext,
    prisma: PrismaClient
  ): Promise<NodeExecutionResult> {
    const conditions = node.data?.conditions || [
      { id: 'if-0', type: 'if', condition: '', caseName: '' }
    ]

    let matchedCondition: any = null
    let matchedHandle: string | null = null

    for (const cond of conditions) {
      if (cond.type === 'else') {
        matchedCondition = cond
        matchedHandle = 'else'
        break
      }

      const conditionResult = evaluateCondition(context, cond)

      if (conditionResult) {
        matchedCondition = cond
        matchedHandle = cond.id
        break
      }
    }

    if (!matchedCondition) {
      console.warn('[Workflow] If/Else: No condition matched and no Else branch exists')
      return this.createSuccessResult(
        {
          ...context,
          ifElseResult: undefined
        },
        {
          input: { conditions: conditions.map((c: any) => c.caseName || c.id) },
          output: { matched: false, matchedHandle: null }
        }
      )
    }

    return this.createSuccessResult(
      {
        ...context,
        ifElseResult: {
          matchedCondition: matchedCondition.caseName || matchedCondition.id,
          matchedHandle,
          conditionType: matchedCondition.type
        }
      },
      {
        input: { conditions: conditions.map((c: any) => c.caseName || c.id) },
        output: {
          matched: true,
          matchedCondition: matchedCondition.caseName || matchedCondition.id,
          matchedHandle
        }
      }
    )
  }
}

// Singleton instance
export const ifElseNodeExecutor = new IfElseNodeExecutor()
