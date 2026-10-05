
import { workRoute } from '@/lib/work/http'
import { listSubmissions } from '@/lib/work/projects'
import { assertTeamTask } from '@/lib/work/team-access'

export const GET = workRoute<{ agentId: string; projectId: string; taskId: string }>('task.submissions', async (_req, { access, deps }, p) => {
  await assertTeamTask(access, p.projectId, p.taskId)
  return { submissions: await listSubmissions(deps, { userId: access.userId, taskId: p.taskId }) }
})
