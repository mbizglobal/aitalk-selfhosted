
import { WorkError } from '@/lib/work/errors'
import { workRoute } from '@/lib/work/http'
import { NO_WORK_APP_TOOL, appStartSettings, checkWorkAppGraph, findWorkApp } from '@/lib/work/app-chat'
import { ensureAppProject } from '@/lib/work/projects'
import { assertTeamProject } from '@/lib/work/team-access'
import { creatableAppTemplates } from '@/lib/work/views'

export const GET = workRoute<{ agentId: string; workflowId: string }>('app.open', async (_req, { access, deps }, p) => {
  const w = await findWorkApp(deps.db, { userId: access.userId, agentId: access.agentId, workflowId: p.workflowId })
  const project = await ensureAppProject(deps, { userId: access.userId, workflowId: w.workflowId })
  try { await assertTeamProject(access, project.id) } catch { throw new WorkError('NOT_FOUND') }
  const start = appStartSettings(w.workflowJson)
  const graphProblem = checkWorkAppGraph(w.workflowJson)
  return {
    workflowId: w.workflowId,
    name: w.name,
    projectId: project.id,
    welcome: start.welcome,
    fixedAppTemplate: start.appTemplate,
    chatBlocked: graphProblem !== null,
    chatBlockedReason: graphProblem === null ? null : graphProblem === NO_WORK_APP_TOOL ? 'no_tool' : 'graph',
    appTemplates: creatableAppTemplates(),
  }
})
