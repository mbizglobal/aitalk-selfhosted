
import { readJsonBody, workRoute } from '@/lib/work/http'
import { WorkError } from '@/lib/work/errors'
import { runWorkModule } from '@/lib/work/module-registry'
import { workModules } from '@/lib/work/registry'
import { assertTeamProject } from '@/lib/work/team-access'
import { setProjectModule } from '@/lib/work/module-settings'

export const POST = workRoute<{ agentId: string; projectId: string; moduleId: string }>('module.run', async (req, { access, deps }, p) => {
  await assertTeamProject(access, p.projectId)
  if (!workModules().some((m) => m.id === p.moduleId)) throw new WorkError('NOT_FOUND')
  const body = await readJsonBody(req)
  return { output: await runWorkModule(deps, { userId: access.userId, projectId: p.projectId, moduleId: p.moduleId, input: body.input, by: access.actor }) }
})

export const PATCH = workRoute<{ agentId: string; projectId: string; moduleId: string }>('module.toggle', async (req, { access, deps }, p) => {
  await assertTeamProject(access, p.projectId)
  const body = await readJsonBody(req)
  return { modules: await setProjectModule(deps, { userId: access.userId, projectId: p.projectId, moduleId: p.moduleId, enabled: body.enabled, actor: access.actor }) }
})
