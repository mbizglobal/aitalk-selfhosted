
import { WorkError } from '@/lib/work/errors'
import { workRoute } from '@/lib/work/http'
import { assertTeamProject } from '@/lib/work/team-access'
import { readPairTargets } from '@/lib/work/views'

export const GET = workRoute<{ agentId: string; projectId: string }>('pair.targets', async (req, { access, deps }, p) => {
  await assertTeamProject(access, p.projectId)
  const family = req.nextUrl.searchParams.get('family')
  if (!family || family.length > 100) throw new WorkError('INVALID', 'family is required')
  return { rows: await readPairTargets(deps, { userId: access.userId, projectId: p.projectId, family }) }
})
