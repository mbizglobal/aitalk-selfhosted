
import { isCalendarDate } from '@/lib/work/dates'
import { WorkError } from '@/lib/work/errors'
import { readJsonBody, workRoute } from '@/lib/work/http'
import { confirmFromScreen } from '@/lib/work/screen-writes'
import { assertTeamProject } from '@/lib/work/team-access'

export const POST = workRoute<{ agentId: string; projectId: string; sheetId: string }>('row.confirm', async (req, { access, deps }, p) => {
  await assertTeamProject(access, p.projectId)
  const body = await readJsonBody(req)
  const target = { userId: access.userId, projectId: p.projectId, sheetId: p.sheetId, actor: access.actor }
  if (body.all === true) {
    const pr = body.period as { start?: unknown; end?: unknown } | undefined
    if (pr === undefined) return confirmFromScreen(deps, target, { all: true })
    if (!pr || typeof pr !== 'object' || !isCalendarDate(pr.start) || !isCalendarDate(pr.end) || (pr.start as string) > (pr.end as string)) {
      throw new WorkError('INVALID', 'period must be calendar dates with start ≤ end')
    }
    return confirmFromScreen(deps, target, { all: true, period: { start: pr.start as string, end: pr.end as string } })
  }
  if (!Array.isArray(body.rowIds) || body.rowIds.length === 0 || body.rowIds.length > 1000 || !body.rowIds.every((x) => typeof x === 'string')) {
    throw new WorkError('INVALID', 'rowIds must be a list of row ids')
  }
  return confirmFromScreen(deps, target, { rowIds: body.rowIds as string[] })
})
