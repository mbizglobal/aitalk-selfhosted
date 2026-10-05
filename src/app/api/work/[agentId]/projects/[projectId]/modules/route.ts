
import { workRoute } from '@/lib/work/http'
import { listModuleChoices } from '@/lib/work/module-settings'
import { assertTeamProject } from '@/lib/work/team-access'

export const GET = workRoute<{ agentId: string; projectId: string }>('modules.list', async (_req, { access, deps }, p) => {
  await assertTeamProject(access, p.projectId)
  return { modules: await listModuleChoices(deps, { userId: access.userId, projectId: p.projectId }) }
})
