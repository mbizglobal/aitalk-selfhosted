
import { workRoute } from '@/lib/work/http'
import { listWorkApps } from '@/lib/work/app-chat'
import { prisma } from '@/lib/prisma'

export const GET = workRoute<{ agentId: string }>('app.list', async (_req, { access }) => {
  const agent = await prisma.agent.findUnique({ where: { agentId: access.agentId }, select: { title: true } })
  return { agentTitle: agent?.title ?? '', apps: await listWorkApps(prisma, { userId: access.userId, agentId: access.agentId }) }
})
