
import { workRoute } from '@/lib/work/http'
import { assertTeamProject } from '@/lib/work/team-access'
import { readSheetScreen } from '@/lib/work/views'

export const GET = workRoute<{ agentId: string; projectId: string; sheetId: string }>('sheet.read', async (_req, { access, deps }, p) => {
  await assertTeamProject(access, p.projectId)
  return readSheetScreen(deps, { userId: access.userId, projectId: p.projectId, sheetId: p.sheetId })
})
