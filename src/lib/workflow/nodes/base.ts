
import { WorkflowNode, WorkflowContext, WorkflowDebugChildEntry } from '../types'
import { PrismaClient } from '@prisma/client'

// ========================================
// ========================================

export interface NodeExecutionDebug {
  input?: any
  output?: any
  status?: 'success' | 'error'
  error?: string
  children?: WorkflowDebugChildEntry[]
}

export interface NodeExecutionResult {
  context: WorkflowContext
  debug?: NodeExecutionDebug
  shouldWait?: boolean
  streamResponse?: Response
}

// ========================================
// ========================================

export interface NodeExecutor {
  execute(
    node: WorkflowNode,
    context: WorkflowContext,
    prisma: PrismaClient
  ): Promise<NodeExecutionResult>
}

// ========================================
// ========================================

export abstract class BaseNodeExecutor implements NodeExecutor {
  abstract execute(
    node: WorkflowNode,
    context: WorkflowContext,
    prisma: PrismaClient
  ): Promise<NodeExecutionResult>

  protected createErrorResult(
    context: WorkflowContext,
    error: string,
    input?: any
  ): NodeExecutionResult {
    return {
      context,
      debug: {
        input,
        output: {},
        status: 'error',
        error
      }
    }
  }

  protected createSuccessResult(
    context: WorkflowContext,
    debug?: NodeExecutionDebug
  ): NodeExecutionResult {
    return {
      context,
      debug: {
        ...debug,
        status: 'success'
      }
    }
  }
}
