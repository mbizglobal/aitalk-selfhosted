
import { workRoute } from '@/lib/work/http'
import { assertTeamTask } from '@/lib/work/team-access'
import { readTaskChecklist } from '@/lib/work/views'

export const GET = workRoute<{ agentId: string; projectId: string; taskId: string }>('task.checklist', async (_req, { access, deps }, p) => {
  await assertTeamTask(access, p.projectId, p.taskId)
  return readTaskChecklist(deps, { userId: access.userId, projectId: p.projectId, taskId: p.taskId })
})
