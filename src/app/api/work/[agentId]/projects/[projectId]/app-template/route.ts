
import { readJsonBody, workRoute } from '@/lib/work/http'
import { applyAppTemplate } from '@/lib/work/projects'
import { assertTeamProject } from '@/lib/work/team-access'

export const POST = workRoute<{ agentId: string; projectId: string }>('app-template.apply', async (req, { access, deps }, p) => {
  await assertTeamProject(access, p.projectId)
  const body = await readJsonBody(req)
  await applyAppTemplate(deps, { userId: access.userId, projectId: p.projectId, kind: typeof body.kind === 'string' ? body.kind : '', settings: body.settings, modules: body.modules, actor: access.actor })
  return { ok: true }
})
