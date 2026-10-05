
import { WorkError } from '@/lib/work/errors'
import { readJsonBody, workRoute } from '@/lib/work/http'
import { createNote, listNotes } from '@/lib/work/notes'
import { assertTeamProject, assertTeamTask } from '@/lib/work/team-access'

type P = { agentId: string; projectId: string }

export const GET = workRoute<P>('notes.list', async (req, { access, deps }, p) => {
  const taskId = req.nextUrl.searchParams.get('taskId') || null
  if (taskId) await assertTeamTask(access, p.projectId, taskId)
  else await assertTeamProject(access, p.projectId)
  return listNotes(deps, { userId: access.userId, projectId: p.projectId, taskId })
})

export const POST = workRoute<P>('notes.create', async (req, { access, deps }, p) => {
  const body = await readJsonBody(req)
  if (body.taskId !== undefined && body.taskId !== null && typeof body.taskId !== 'string') throw new WorkError('INVALID', 'taskId must be text')
  const taskId = (body.taskId as string | null | undefined) || null
  if (taskId) await assertTeamTask(access, p.projectId, taskId)
  else await assertTeamProject(access, p.projectId)
  return { note: await createNote(deps, { userId: access.userId, projectId: p.projectId, taskId, kind: body.kind, text: body.text, actor: access.actor }) }
})
