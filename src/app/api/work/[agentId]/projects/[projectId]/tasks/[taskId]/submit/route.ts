
import { readJsonBody, workRoute } from '@/lib/work/http'
import { submitTask } from '@/lib/work/projects'
import { assertTeamTask } from '@/lib/work/team-access'

export const POST = workRoute<{ agentId: string; projectId: string; taskId: string }>('task.submit', async (req, { access, deps }, p) => {
  await assertTeamTask(access, p.projectId, p.taskId)
  const body = await readJsonBody(req)
  const seenWarningsDigest = typeof body.seenWarningsDigest === 'string' && body.seenWarningsDigest.length <= 128 ? body.seenWarningsDigest : null
  const sub = await submitTask(deps, { userId: access.userId, taskId: p.taskId, actor: access.actor, moduleInput: body.moduleInput, seenWarningsDigest })
  return { id: sub.id, number: sub.number }
})
