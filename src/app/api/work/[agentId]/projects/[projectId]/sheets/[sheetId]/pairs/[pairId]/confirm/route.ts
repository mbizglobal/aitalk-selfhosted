
import { workRoute } from '@/lib/work/http'
import { confirmPairFromScreen } from '@/lib/work/screen-writes'
import { assertTeamProject } from '@/lib/work/team-access'

export const POST = workRoute<{ agentId: string; projectId: string; sheetId: string; pairId: string }>('pair.confirm', async (_req, { access, deps }, p) => {
  await assertTeamProject(access, p.projectId)
  await confirmPairFromScreen(deps, { userId: access.userId, projectId: p.projectId, sheetId: p.sheetId, actor: access.actor }, p.pairId)
  return { ok: true }
})
