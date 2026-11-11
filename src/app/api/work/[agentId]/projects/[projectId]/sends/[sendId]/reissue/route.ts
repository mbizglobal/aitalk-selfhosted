
import { readJsonBody, workRoute } from '@/lib/work/http'
import { reissueProjectSend } from '@/lib/work/send-api'
import { assertTeamProject } from '@/lib/work/team-access'

type P = { agentId: string; projectId: string; sendId: string }

export const POST = workRoute<P>('sends.reissue', async (req, { access, deps }, p) => {
  await assertTeamProject(access, p.projectId)
  const body = await readJsonBody(req)
  return reissueProjectSend(deps, { userId: access.userId, projectId: p.projectId, sendId: p.sendId }, access.actor, body.confirmDuplicate === true)
})
