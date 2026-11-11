
import { readJsonBody, workRoute } from '@/lib/work/http'
import { projectCapabilities, setProjectCapabilities } from '@/lib/work/send-api'
import { assertTeamProject } from '@/lib/work/team-access'

type P = { agentId: string; projectId: string }

export const GET = workRoute<P>('capabilities.get', async (_req, { access, deps }, p) => {
  await assertTeamProject(access, p.projectId)
  return projectCapabilities(deps, { userId: access.userId, projectId: p.projectId })
})

export const PUT = workRoute<P>('capabilities.put', async (req, { access, deps }, p) => {
  await assertTeamProject(access, p.projectId)
  const body = await readJsonBody(req)
  return setProjectCapabilities(deps, { userId: access.userId, projectId: p.projectId }, access.actor, { autoOff: body.autoOff, autoSend: body.autoSend, webSearchOff: body.webSearchOff })
})
