import type { PrismaClient } from '@prisma/client'
import type { WorkflowNode, WorkflowContext } from '@/lib/workflow/types'

const unavailable = (what: string): never => { throw new Error(`${what} is not part of this installation (self-hosted edition)`) }

export function isQuizExecution(_node: WorkflowNode, _context: WorkflowContext): boolean {
  return false
}
export async function createQuizAssignment(_node: WorkflowNode, _context: WorkflowContext, _prisma: PrismaClient): Promise<{ ok: boolean; errorMessage?: string }> {
  return unavailable('Mini app quiz')
}
