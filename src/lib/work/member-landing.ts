import type { PrismaClient } from '@prisma/client'
import { listWorkApps } from '@/lib/work/app-chat'
import { memberCanUseWorkflow } from '@/lib/memberAccess'
import { describeCaughtError } from '@/lib/log-mask'

export async function memberLandingPath(
  db: PrismaClient,
  q: { agentId: string; ownerUserId: string; workflowId: string | null; memberId?: number },
): Promise<string> {
  const agent = encodeURIComponent(q.agentId)
  const pick = q.workflowId && (q.memberId === undefined || (await memberCanUseWorkflow(db, q.agentId, q.memberId, q.workflowId).catch(() => false))) ? q.workflowId : null
  const team = `/chat/${agent}/team${pick ? `?workflowId=${encodeURIComponent(pick)}` : ''}`
  try {
    const apps = await listWorkApps(db, { userId: q.ownerUserId, agentId: q.agentId, ...(q.memberId !== undefined ? { memberId: q.memberId } : {}) })
    if (pick && apps.some((a) => a.workflowId === pick)) return `/chat/${agent}/app?workflowId=${encodeURIComponent(pick)}`
    if (pick) return team
    return apps.length > 0 ? `/chat/${agent}/app` : team
  } catch (e) {
    console.error('[member-landing] failed:', describeCaughtError(e))
    return team
  }
}
