import { WorkError } from '@/lib/work/errors'
import { readJsonBody, workRoute } from '@/lib/work/http'
import { assertTeamTask } from '@/lib/work/team-access'
import { approveTask, cancelApproval, readTaskApproval, rejectApproval, requestApproval } from '@/ee'

export const GET = workRoute<{ agentId: string; projectId: string; taskId: string }>('task.approval.read', async (_req, { access, deps }, p) => {
  await assertTeamTask(access, p.projectId, p.taskId)
  return readTaskApproval(deps, { userId: access.userId, taskId: p.taskId, actor: access.actor })
})

export const POST = workRoute<{ agentId: string; projectId: string; taskId: string }>('task.approval', async (req, { access, deps }, p) => {
  await assertTeamTask(access, p.projectId, p.taskId)
  const body = await readJsonBody(req)
  const base = { userId: access.userId, taskId: p.taskId, actor: access.actor }
  const reason = body.reason === undefined ? undefined : typeof body.reason === 'string' ? body.reason : null
  if (reason === null) throw new WorkError('INVALID', 'reason must be text')
  switch (body.action) {
    case 'request': {
      const seenWarningsDigest = typeof body.seenWarningsDigest === 'string' && body.seenWarningsDigest.length <= 128 ? body.seenWarningsDigest : null
      return requestApproval(deps, { ...base, input: { moduleInput: body.moduleInput, seenWarningsDigest } })
    }
    case 'approve': {
      const sub = await approveTask(deps, base)
      return { id: sub.id, number: sub.number }
    }
    case 'reject':
      return rejectApproval(deps, { ...base, reason })
    case 'cancel':
      return cancelApproval(deps, { ...base, reason })
    default:
      throw new WorkError('INVALID', "action must be 'request' | 'approve' | 'reject' | 'cancel'")
  }
})
