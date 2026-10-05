
import { prisma } from '@/lib/prisma'
import { workOwnerRoute } from '@/lib/work/http'
import { listProjects } from '@/lib/work/views'
import { listWorkApps } from '@/lib/work/app-chat'

export const GET = workOwnerRoute('owner.projects', async (_req, { userId, deps }) => {
  const [agents, projects, apps] = await Promise.all([
    prisma.agent.findMany({ where: { userId }, select: { agentId: true, title: true, createdAt: true }, orderBy: { createdAt: 'asc' } }),
    listProjects(deps, { userId }),
    listWorkApps(prisma, { userId }),
  ])
  return { agents, projects, apps }
})
