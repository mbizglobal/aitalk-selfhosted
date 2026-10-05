
import { WorkError } from '@/lib/work/errors'
import { readJsonBody, workRoute } from '@/lib/work/http'
import { unlockTask } from '@/lib/work/projects'
import { assertTeamTask } from '@/lib/work/team-access'

export const POST = workRoute<{ agentId: string; projectId: string; taskId: string }>('task.unlock', async (req, { access, deps }, p) => {
  await assertTeamTask(access, p.projectId, p.taskId)
  const body = await readJsonBody(req)
  if (body.reason !== undefined && (typeof body.reason !== 'string' || body.reason.length > 1000)) throw new WorkError('INVALID', 'reason must be text up to 1000 characters')
  await unlockTask(deps, { userId: access.userId, taskId: p.taskId, actor: access.actor, reason: (body.reason as string | undefined)?.trim() || undefined })
  return { ok: true }
})
