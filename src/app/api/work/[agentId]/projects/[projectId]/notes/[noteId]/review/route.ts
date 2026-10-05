
import { WorkError } from '@/lib/work/errors'
import { readJsonBody, workRoute } from '@/lib/work/http'
import { reviewNote } from '@/lib/work/notes'
import { assertTeamProject } from '@/lib/work/team-access'

type P = { agentId: string; projectId: string; noteId: string }

export const POST = workRoute<P>('notes.review', async (req, { access, deps }, p) => {
  await assertTeamProject(access, p.projectId)
  const body = await readJsonBody(req)
  if (typeof body.accept !== 'boolean') throw new WorkError('INVALID', 'accept must be true or false')
  const note = await reviewNote(deps, { userId: access.userId, projectId: p.projectId, noteId: p.noteId, updatedAt: body.updatedAt, accept: body.accept, actor: access.actor })
  return { note }
})
