
import { workRoute } from '@/lib/work/http'
import { inboxWaiting } from '@/lib/work/inbox'
import { assertTeamProject } from '@/lib/work/team-access'

type P = { agentId: string; projectId: string }

export const GET = workRoute<P>('inbox.waiting', async (_req, { access, deps }, p) => {
  await assertTeamProject(access, p.projectId)
  return { inboxes: await inboxWaiting(deps, { userId: access.userId, projectId: p.projectId }) }
})
