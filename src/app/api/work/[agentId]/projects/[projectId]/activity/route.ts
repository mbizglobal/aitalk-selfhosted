
import { readProjectActivity } from '@/lib/work/activity'
import { readerOf } from '@/lib/work/app-chat'
import { workRoute } from '@/lib/work/http'
import { assertTeamProject } from '@/lib/work/team-access'

type P = { agentId: string; projectId: string }

export const GET = workRoute<P>('activity.list', async (req, { access, deps }, p) => {
  await assertTeamProject(access, p.projectId)
  const before = req.nextUrl.searchParams.get('before')
  return readProjectActivity(deps, { userId: access.userId, projectId: p.projectId, viewer: readerOf(access.actor), before: before || null })
})
