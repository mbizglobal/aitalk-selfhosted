
import { WorkError } from '@/lib/work/errors'
import { workRoute } from '@/lib/work/http'
import { readSubmission } from '@/lib/work/projects'
import { assertTeamTask } from '@/lib/work/team-access'

export const GET = workRoute<{ agentId: string; projectId: string; taskId: string; submissionId: string }>('task.submission', async (_req, { access, deps }, p) => {
  await assertTeamTask(access, p.projectId, p.taskId)
  const s = await readSubmission(deps, access.userId, p.submissionId)
  if (s.taskId !== p.taskId) throw new WorkError('NOT_FOUND')
  return { number: s.number, submittedAt: s.submittedAt, result: s.result, files: s.files.length, references: s.references.length }
})
