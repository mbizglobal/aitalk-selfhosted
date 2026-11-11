
import { WorkError } from '@/lib/work/errors'
import { readJsonBody, workRoute } from '@/lib/work/http'
import { ensureAppProject } from '@/lib/work/projects'
import { findWorkApp, readerOf, shareToTeam, teamUnread } from '@/lib/work/app-chat'
import { assertTeamProject, memberOf, type WorkTeamAccess } from '@/lib/work/team-access'
import type { WorkFileDeps } from '@/lib/work/files'

type P = { agentId: string; workflowId: string }

async function projectOf(access: WorkTeamAccess, deps: WorkFileDeps, workflowId: string) {
  const w = await findWorkApp(deps.db, { userId: access.userId, agentId: access.agentId, workflowId, ...memberOf(access) })
  const project = await ensureAppProject(deps, { userId: access.userId, workflowId: w.workflowId })
  try { await assertTeamProject(access, project.id) } catch { throw new WorkError('NOT_FOUND') }
  return project.id
}

export const GET = workRoute<P>('app.rooms.unread', async (_req, { access, deps }, p) => {
  const projectId = await projectOf(access, deps, p.workflowId)
  const reader = readerOf(access.actor)
  return { unread: reader ? await teamUnread(deps, { userId: access.userId, projectId, reader }) : {} }
})

export const POST = workRoute<P>('app.rooms.share', async (req, { access, deps }, p) => {
  const projectId = await projectOf(access, deps, p.workflowId)
  const body = await readJsonBody(req)
  if (body.action !== 'share' || typeof body.messageId !== 'string') throw new WorkError('INVALID', 'action share with messageId')
  return shareToTeam(deps, { userId: access.userId, projectId, messageId: body.messageId, actor: access.actor })
})
