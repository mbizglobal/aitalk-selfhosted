
import { workRoute } from '@/lib/work/http'
import { discardProjectSend } from '@/lib/work/send-api'
import { assertTeamProject } from '@/lib/work/team-access'

type P = { agentId: string; projectId: string; sendId: string }

export const POST = workRoute<P>('sends.discard', async (_req, { access, deps }, p) => {
  await assertTeamProject(access, p.projectId)
  return discardProjectSend(deps, { userId: access.userId, projectId: p.projectId, sendId: p.sendId }, access.actor)
})
