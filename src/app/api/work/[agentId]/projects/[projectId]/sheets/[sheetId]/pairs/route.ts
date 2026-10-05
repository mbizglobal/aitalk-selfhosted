
import { WorkError } from '@/lib/work/errors'
import { readJsonBody, workRoute } from '@/lib/work/http'
import { pairFromScreen } from '@/lib/work/screen-writes'
import { assertTeamProject } from '@/lib/work/team-access'

const id = (v: unknown, name: string) => {
  if (typeof v !== 'string' || !v || v.length > 100) throw new WorkError('INVALID', `${name} is required`)
  return v
}

export const POST = workRoute<{ agentId: string; projectId: string; sheetId: string }>('pair.create', async (req, { access, deps }, p) => {
  await assertTeamProject(access, p.projectId)
  const body = await readJsonBody(req)
  const pair = await pairFromScreen(deps, { userId: access.userId, projectId: p.projectId, sheetId: p.sheetId, actor: access.actor }, {
    fromRowId: id(body.fromRowId, 'fromRowId'),
    toRowId: id(body.toRowId, 'toRowId'),
    kind: id(body.kind, 'kind'),
    confirm: body.confirm === true,
    exception: body.exception === undefined ? undefined : id(body.exception, 'exception'),
  })
  return { id: pair.id }
})
