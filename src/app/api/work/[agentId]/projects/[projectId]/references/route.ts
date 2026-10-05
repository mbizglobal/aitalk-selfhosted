
import { workRoute } from '@/lib/work/http'
import { readReferenceScreen } from '@/lib/work/reference-views'
import { assertTeamProject } from '@/lib/work/team-access'

export const GET = workRoute<{ agentId: string; projectId: string }>('project.references', async (_req, { access, deps }, p) => {
  await assertTeamProject(access, p.projectId)
  return { references: await readReferenceScreen(deps, { userId: access.userId, projectId: p.projectId }) }
})
