
import { workRoute } from '@/lib/work/http'
import { assertTeamProject } from '@/lib/work/team-access'
import { readProjectOverview } from '@/lib/work/views'

export const GET = workRoute<{ agentId: string; projectId: string }>('project.read', async (_req, { access, deps }, p) => {
  await assertTeamProject(access, p.projectId)
  return readProjectOverview(deps, { userId: access.userId, projectId: p.projectId })
})
