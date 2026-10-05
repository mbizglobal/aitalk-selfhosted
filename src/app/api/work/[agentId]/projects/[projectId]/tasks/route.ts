
import { WorkError } from '@/lib/work/errors'
import { readJsonBody, workRoute } from '@/lib/work/http'
import { createTask } from '@/lib/work/projects'
import { assertTeamProject } from '@/lib/work/team-access'

const optionalDate = (v: unknown, name: string): string | null => {
  if (v === undefined || v === null || v === '') return null
  if (typeof v !== 'string') throw new WorkError('INVALID', `${name} must be a date`)
  return v
}

export const POST = workRoute<{ agentId: string; projectId: string }>('task.create', async (req, { access, deps }, p) => {
  await assertTeamProject(access, p.projectId)
  const body = await readJsonBody(req)
  const t = await createTask(deps, {
    userId: access.userId,
    projectId: p.projectId,
    title: typeof body.title === 'string' ? body.title : '',
    periodStart: optionalDate(body.periodStart, 'periodStart'),
    periodEnd: optionalDate(body.periodEnd, 'periodEnd'),
    actor: access.actor,
  })
  return { id: t.id }
})
