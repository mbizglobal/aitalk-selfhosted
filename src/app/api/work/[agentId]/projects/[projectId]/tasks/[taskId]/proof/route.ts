
import { WorkError } from '@/lib/work/errors'
import { attachSubmissionProof, detachSubmissionProof } from '@/lib/work/files'
import { readJsonBody, workRoute } from '@/lib/work/http'
import { assertTeamTask } from '@/lib/work/team-access'

const fileIdOf = (v: unknown) => {
  if (typeof v !== 'string' || !v) throw new WorkError('INVALID', 'fileId is required')
  return v
}

export const POST = workRoute<{ agentId: string; projectId: string; taskId: string }>('task.proof', async (req, { access, deps }, p) => {
  await assertTeamTask(access, p.projectId, p.taskId)
  const body = await readJsonBody(req)
  await attachSubmissionProof(deps, { userId: access.userId, taskId: p.taskId, fileId: fileIdOf(body.fileId), actor: access.actor })
})

export const DELETE = workRoute<{ agentId: string; projectId: string; taskId: string }>('task.proof.remove', async (req, { access, deps }, p) => {
  await assertTeamTask(access, p.projectId, p.taskId)
  const body = await readJsonBody(req)
  await detachSubmissionProof(deps, { userId: access.userId, taskId: p.taskId, fileId: fileIdOf(body.fileId), actor: access.actor })
})
