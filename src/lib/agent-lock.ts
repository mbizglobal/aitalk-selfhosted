import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isSelfHosted } from '@/lib/edition'
import { SELF_HOSTED_POLICY } from '@/lib/selfhosted-policy'

export const AGENT_LOCKED_MESSAGE = 'This agent is locked because the plan limit was exceeded. Please upgrade your plan to use it.'
export const AGENT_LOCKED_CODE = 'AGENT_LOCKED'

async function agentLimitOf(userId: string, db: Prisma.TransactionClient = prisma): Promise<number> {
  if (isSelfHosted()) return SELF_HOSTED_POLICY.agentLimit
  const sub = await db.subscription.findUnique({ where: { id: userId }, select: { num_assistant: true } })
  return Math.max(0, sub?.num_assistant || 1)
}

export async function isAgentLocked(agentId: string | null | undefined, db: Prisma.TransactionClient = prisma): Promise<boolean> {
  if (!agentId || isSelfHosted()) return false
  const agent = await db.agent.findUnique({ where: { agentId }, select: { id: true, userId: true, createdAt: true } })
  if (!agent) return false
  const limit = await agentLimitOf(agent.userId, db)
  const before = await db.agent.count({
    where: {
      userId: agent.userId,
      OR: [{ createdAt: { lt: agent.createdAt } }, { createdAt: agent.createdAt, id: { lt: agent.id } }],
    },
  })
  return before >= limit
}

export async function lockedAgentIdsOf(userId: string): Promise<Set<string>> {
  if (isSelfHosted()) return new Set()
  const [limit, agents] = await Promise.all([
    agentLimitOf(userId),
    prisma.agent.findMany({ where: { userId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { agentId: true } }),
  ])
  return new Set(agents.slice(limit).map((a) => a.agentId))
}
