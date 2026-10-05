
import { readJsonBody, workRoute } from '@/lib/work/http'
import { previewTask } from '@/lib/work/projects'
import { assertTeamTask } from '@/lib/work/team-access'

export const POST = workRoute<{ agentId: string; projectId: string; taskId: string }>('task.preview', async (req, { access, deps }, p) => {
  await assertTeamTask(access, p.projectId, p.taskId)
  const body = await readJsonBody(req)
  return previewTask(deps, { userId: access.userId, taskId: p.taskId, moduleInput: body.moduleInput })
})
