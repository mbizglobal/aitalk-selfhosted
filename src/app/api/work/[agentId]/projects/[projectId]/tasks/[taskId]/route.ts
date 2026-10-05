
import { workRoute } from '@/lib/work/http'
import { deleteTask } from '@/lib/work/projects'
import { assertTeamTask } from '@/lib/work/team-access'

export const DELETE = workRoute<{ agentId: string; projectId: string; taskId: string }>('task.delete', async (_req, { access, deps }, p) => {
  await assertTeamTask(access, p.projectId, p.taskId)
  await deleteTask(deps, { userId: access.userId, taskId: p.taskId, actor: access.actor })
  return { ok: true }
})
