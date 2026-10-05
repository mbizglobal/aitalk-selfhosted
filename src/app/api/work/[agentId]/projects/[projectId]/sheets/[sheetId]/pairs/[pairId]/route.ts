
import { WorkError } from '@/lib/work/errors'
import { workRoute } from '@/lib/work/http'
import { unpairFromScreen } from '@/lib/work/screen-writes'
import { assertTeamProject } from '@/lib/work/team-access'

export const DELETE = workRoute<{ agentId: string; projectId: string; sheetId: string; pairId: string }>('pair.delete', async (req, { access, deps }, p) => {
  await assertTeamProject(access, p.projectId)
  const exception = req.nextUrl.searchParams.get('exception') ?? undefined
  if (exception !== undefined && (!exception || exception.length > 100)) throw new WorkError('INVALID', 'exception must be a name')
  await unpairFromScreen(deps, { userId: access.userId, projectId: p.projectId, sheetId: p.sheetId, actor: access.actor }, { pairId: p.pairId, exception })
  return { ok: true }
})
