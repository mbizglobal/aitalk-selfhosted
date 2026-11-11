
import { prisma } from '@/lib/prisma'
import { workOwnerRoute } from '@/lib/work/http'
import { listProjects } from '@/lib/work/views'
import { listWorkApps } from '@/lib/work/app-chat'
import { listManagedApps } from '@/lib/work/app-admin'
import { companyLimitOf, countCompanyBooks } from '@/lib/work/company-limit'

export const GET = workOwnerRoute('owner.projects', async (_req, { userId, deps }) => {
  const key = await deps.dataKey(deps.db, userId)
  const [agents, projects, apps, groups] = await Promise.all([
    prisma.agent.findMany({ where: { userId }, select: { agentId: true, title: true, createdAt: true }, orderBy: { createdAt: 'asc' } }),
    listProjects(deps, { userId }),
    listWorkApps(prisma, { userId }),
    listManagedApps(prisma, userId, key),
  ])
  const [used, limit] = await Promise.all([prisma.$transaction((tx) => countCompanyBooks(tx, userId)), companyLimitOf(prisma, userId)])
  return { agents, projects, apps, groups, companies: { used, limit } }
})
