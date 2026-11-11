
import { readJsonBody, workRoute } from '@/lib/work/http'
import { approveProjectSend } from '@/lib/work/send-api'
import { assertTeamProject } from '@/lib/work/team-access'

type P = { agentId: string; projectId: string; sendId: string }

export const POST = workRoute<P>('sends.approve', async (req, { access, deps }, p) => {
  await assertTeamProject(access, p.projectId)
  const body = await readJsonBody(req).catch(() => ({}) as Record<string, unknown>)
  return approveProjectSend(deps, { userId: access.userId, projectId: p.projectId, sendId: p.sendId }, access.actor, { confirmDanger: body.confirmDanger === true, confirmDuplicate: body.confirmDuplicate === true, ...(typeof body.prepareId === 'string' ? { prepareId: body.prepareId.slice(0, 40) } : {}) })
})
