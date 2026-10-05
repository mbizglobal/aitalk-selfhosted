
import { WorkError } from '@/lib/work/errors'
import { readJsonBody, workRoute } from '@/lib/work/http'
import { acknowledgeReferenceChanges } from '@/lib/work/references'
import { readTaskReferenceStatus } from '@/lib/work/reference-views'
import { assertTeamTask } from '@/lib/work/team-access'

export const GET = workRoute<{ agentId: string; projectId: string; taskId: string }>('task.references', async (_req, { access, deps }, p) => {
  await assertTeamTask(access, p.projectId, p.taskId)
  return { status: await readTaskReferenceStatus(deps, { userId: access.userId, taskId: p.taskId }) }
})

export const POST = workRoute<{ agentId: string; projectId: string; taskId: string }>('task.references.ack', async (req, { access, deps }, p) => {
  await assertTeamTask(access, p.projectId, p.taskId)
  const body = await readJsonBody(req)
  if (typeof body.digest !== 'string' || !/^[0-9a-f]{64}$/.test(body.digest)) throw new WorkError('INVALID', 'digest from the status is required')
  await acknowledgeReferenceChanges(deps, { userId: access.userId, taskId: p.taskId, actor: access.actor, seenDigest: body.digest })
  return { ok: true }
})
