
import { workRoute } from '@/lib/work/http'
import { listProjectSends } from '@/lib/work/send-api'
import { assertTeamProject } from '@/lib/work/team-access'

type P = { agentId: string; projectId: string }

export const GET = workRoute<P>('sends.list', async (req, { access, deps }, p) => {
  await assertTeamProject(access, p.projectId)
  const picked = req.nextUrl.searchParams.get('ids')?.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 100)
  const sends = await listProjectSends(deps, { userId: access.userId, projectId: p.projectId }, access.actor, { ids: picked?.length ? picked : undefined })
  return { sends }
})
