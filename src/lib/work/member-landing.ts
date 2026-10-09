import type { PrismaClient } from '@prisma/client'
import { listWorkApps } from '@/lib/work/app-chat'
import { describeCaughtError } from '@/lib/log-mask'

export async function memberLandingPath(
  db: PrismaClient,
  q: { agentId: string; ownerUserId: string; workflowId: string | null },
): Promise<string> {
  const agent = encodeURIComponent(q.agentId)
  const team = `/chat/${agent}/team${q.workflowId ? `?workflowId=${encodeURIComponent(q.workflowId)}` : ''}`
  try {
    const apps = await listWorkApps(db, { userId: q.ownerUserId, agentId: q.agentId })
    if (q.workflowId) return apps.some((a) => a.workflowId === q.workflowId) ? `/chat/${agent}/app?workflowId=${encodeURIComponent(q.workflowId)}` : team
    return apps.length > 0 ? `/chat/${agent}/app` : team
  } catch (e) {
    console.error('[member-landing] failed:', describeCaughtError(e))
    return team
  }
}
