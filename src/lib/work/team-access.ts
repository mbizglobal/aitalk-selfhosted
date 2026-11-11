
import type { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { extractBearerToken } from '@/lib/agentAccess'
import { verifyActiveAgentMemberToken } from '@/lib/teamMemberCache'
import { resolveAppWorkAccess } from './app-access'
import { memberCanUseWorkflow } from '@/lib/memberAccess'
import { WorkError } from './errors'
import type { SheetActor } from './sheet-gate'

export interface WorkTeamAccess {
  userId: string
  agentId: string
  isOwner: boolean
  actor: Extract<SheetActor, { type: 'human' }>
}

export async function resolveWorkTeamAccess(request: NextRequest, agentId: string): Promise<WorkTeamAccess | null> {
  const agent = await prisma.agent.findUnique({ where: { agentId }, select: { userId: true } })
  if (!agent) return null
  const ownerId = await resolveWorkOwner()
  if (ownerId && ownerId === agent.userId) {
    return { userId: agent.userId, agentId, isOwner: true, actor: { type: 'human' } }
  }
  const token = extractBearerToken(request)
  if (!token) return null
  const payload = await verifyActiveAgentMemberToken(prisma, token, agentId)
  if (payload) return { userId: agent.userId, agentId, isOwner: false, actor: { type: 'human', memberId: payload.memberId } }
  const app = await resolveAppWorkAccess(request, { agentId, userId: agent.userId })
  if (!app) return null
  return app.isOwner
    ? { userId: agent.userId, agentId, isOwner: true, actor: { type: 'human' } }
    : { userId: agent.userId, agentId, isOwner: false, actor: { type: 'human', memberId: app.memberId } }
}

export async function resolveWorkOwner(): Promise<string | null> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  return session?.user?.id ?? null
}

export async function assertTeamProject(access: WorkTeamAccess, projectId: string): Promise<void> {
  const p = await prisma.workProject.findFirst({ where: { id: projectId, userId: access.userId, agentId: access.agentId }, select: { id: true, workflowId: true, workflowLinkedAt: true } })
  if (!p) throw new WorkError('NOT_FOUND')
  if (access.isOwner) return
  const ok = p.workflowId ? await memberMay(access, p.workflowId) : false
  if (!ok) throw new WorkError('NOT_FOUND')
}

export const memberOf = (access: WorkTeamAccess): { memberId?: number } => (access.isOwner ? {} : { memberId: access.actor.memberId ?? -1 })

export async function memberMay(access: WorkTeamAccess, workflowId: string): Promise<boolean> {
  if (access.isOwner) return true
  return access.actor.memberId !== undefined && memberCanUseWorkflow(prisma, access.agentId, access.actor.memberId, workflowId)
}

export async function assertTeamTask(access: WorkTeamAccess, projectId: string, taskId: string): Promise<void> {
  await assertTeamProject(access, projectId)
  const t = await prisma.workTask.findFirst({ where: { id: taskId, projectId, userId: access.userId }, select: { id: true } })
  if (!t) throw new WorkError('NOT_FOUND')
}

export function assertOwner(access: WorkTeamAccess): void {
  if (!access.isOwner) throw new WorkError('FORBIDDEN', 'only the account owner can do this')
}
