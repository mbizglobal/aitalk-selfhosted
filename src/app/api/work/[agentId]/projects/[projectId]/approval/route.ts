import { readJsonBody, workRoute } from '@/lib/work/http'
import { assertOwner, assertTeamProject } from '@/lib/work/team-access'
import { listApprovalCandidates, readApprovalState, setApprovalSettings } from '@/ee'

type P = { agentId: string; projectId: string }

export const GET = workRoute<P>('project.approval.read', async (_req, { access, deps }, p) => {
  await assertTeamProject(access, p.projectId)
  const state = await readApprovalState(deps, { userId: access.userId, projectId: p.projectId })
  return access.isOwner ? { ...state, candidates: await listApprovalCandidates(deps, { userId: access.userId, projectId: p.projectId }) } : state
})

export const PUT = workRoute<P>('project.approval.write', async (req, { access, deps }, p) => {
  await assertTeamProject(access, p.projectId)
  assertOwner(access)
  const settings = await setApprovalSettings(deps, { userId: access.userId, projectId: p.projectId, actor: access.actor, settings: await readJsonBody(req) })
  return { settings }
})
