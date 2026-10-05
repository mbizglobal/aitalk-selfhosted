
import { readJsonBody, workRoute } from '@/lib/work/http'
import { deleteNote, updateNote } from '@/lib/work/notes'
import { assertTeamProject } from '@/lib/work/team-access'

type P = { agentId: string; projectId: string; noteId: string }

export const PATCH = workRoute<P>('notes.update', async (req, { access, deps }, p) => {
  await assertTeamProject(access, p.projectId)
  const body = await readJsonBody(req)
  return { note: await updateNote(deps, { userId: access.userId, projectId: p.projectId, noteId: p.noteId, updatedAt: body.updatedAt, kind: body.kind, text: body.text, done: body.done, actor: access.actor }) }
})

export const DELETE = workRoute<P>('notes.delete', async (req, { access, deps }, p) => {
  await assertTeamProject(access, p.projectId)
  const body = await readJsonBody(req)
  await deleteNote(deps, { userId: access.userId, projectId: p.projectId, noteId: p.noteId, updatedAt: body.updatedAt, actor: access.actor })
  return { ok: true }
})
