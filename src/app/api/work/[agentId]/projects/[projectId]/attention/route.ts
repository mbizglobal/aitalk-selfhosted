
import { workRoute } from '@/lib/work/http'
import { readAttention } from '@/lib/work/views'

export const GET = workRoute<{ agentId: string; projectId: string }>('attention.read', async (_req, { access, deps }, p) => (
  readAttention(deps, { userId: access.userId, projectId: p.projectId, viewer: access.isOwner ? { owner: true } : { owner: false, memberId: access.actor.memberId ?? -1 } })
))
