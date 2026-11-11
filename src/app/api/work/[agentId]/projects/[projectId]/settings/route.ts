
import { readJsonBody, workRoute } from '@/lib/work/http'
import { readProjectSetup, updateProjectSettings } from '@/lib/work/projects'
import { assertTeamProject } from '@/lib/work/team-access'

export const GET = workRoute<{ agentId: string; projectId: string }>('settings.read', async (_req, { access, deps }, p) => {
  await assertTeamProject(access, p.projectId)
  return readProjectSetup(deps, { userId: access.userId, projectId: p.projectId })
})

export const PUT = workRoute<{ agentId: string; projectId: string }>('settings.update', async (req, { access, deps }, p) => {
  await assertTeamProject(access, p.projectId)
  const body = await readJsonBody(req)
  return updateProjectSettings(deps, { userId: access.userId, projectId: p.projectId, settings: body.settings, seen: body.seen, actor: access.actor })
})
