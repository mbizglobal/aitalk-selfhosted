
import { WorkError } from '@/lib/work/errors'
import { readJsonBody, workRoute } from '@/lib/work/http'
import { deleteRowFromScreen, updateRowFromScreen } from '@/lib/work/screen-writes'
import { assertTeamProject } from '@/lib/work/team-access'

const fileIdOf = (v: unknown): string | null | undefined => {
  if (v === undefined || v === null) return v as undefined | null
  if (typeof v !== 'string' || !v || v.length > 100) throw new WorkError('INVALID', 'fileId must be a file id')
  return v
}

type P = { agentId: string; projectId: string; sheetId: string; rowId: string }

export const PATCH = workRoute<P>('row.update', async (req, { access, deps }, p) => {
  await assertTeamProject(access, p.projectId)
  const body = await readJsonBody(req)
  await updateRowFromScreen(deps, { userId: access.userId, projectId: p.projectId, sheetId: p.sheetId, actor: access.actor }, p.rowId, body.data, body.confirm === true, fileIdOf(body.fileId))
  return { ok: true }
})

export const DELETE = workRoute<P>('row.delete', async (_req, { access, deps }, p) => {
  await assertTeamProject(access, p.projectId)
  await deleteRowFromScreen(deps, { userId: access.userId, projectId: p.projectId, sheetId: p.sheetId, actor: access.actor }, p.rowId)
  return { ok: true }
})
