
import { WorkError } from '@/lib/work/errors'
import { readJsonBody, workRoute } from '@/lib/work/http'
import { insertRowFromScreen } from '@/lib/work/screen-writes'
import { assertTeamProject } from '@/lib/work/team-access'

const fileIdOf = (v: unknown): string | null | undefined => {
  if (v === undefined || v === null) return v as undefined | null
  if (typeof v !== 'string' || !v || v.length > 100) throw new WorkError('INVALID', 'fileId must be a file id')
  return v
}

export const POST = workRoute<{ agentId: string; projectId: string; sheetId: string }>('row.insert', async (req, { access, deps }, p) => {
  await assertTeamProject(access, p.projectId)
  const body = await readJsonBody(req)
  const row = await insertRowFromScreen(deps, { userId: access.userId, projectId: p.projectId, sheetId: p.sheetId, actor: access.actor }, body.data, body.confirm === true, fileIdOf(body.fileId))
  return { id: row.id }
})
