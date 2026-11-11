
import { WorkError } from './errors'
import type { WorkFileDeps } from './files'
import { creatableAppTemplates } from './views'
import { decryptJson } from './sealed'
import { listWorkMessages, TEAM_ROOM, type RoomView } from './app-chat'

export async function openArchivedProject(deps: WorkFileDeps, userId: string, projectId: string) {
  const project = await deps.db.workProject.findFirst({ where: { id: projectId, userId }, select: { id: true, agentId: true, settings: true } })
  if (!project || !project.agentId) throw new WorkError('NOT_FOUND')
  const key = await deps.dataKey(deps.db, userId)
  let name = ''
  try { name = project.settings ? decryptJson<{ name?: string }>(project.settings, key).name ?? '' : '' } catch { }
  const hidden = await deps.db.workflow.findFirst({ where: { appProjectId: project.id, kind: 'app', agent: { userId } }, select: { name: true } })
  return {
    workflowId: 'archive', projectId: project.id, agentId: project.agentId, name: hidden?.name || name || 'Work app',
    welcome: '', fixedAppTemplate: null, chatBlocked: true, chatBlockedReason: null, appTemplates: creatableAppTemplates(),
  }
}

export async function archivedProjectMessages(deps: WorkFileDeps, userId: string, projectId: string, q: { taskId: string | null; room: string | null }) {
  const project = await deps.db.workProject.findFirst({ where: { id: projectId, userId }, select: { id: true } })
  if (!project) throw new WorkError('NOT_FOUND')
  let taskId: string | null = null
  if (q.taskId) {
    const t = await deps.db.workTask.findFirst({ where: { id: q.taskId, projectId: project.id, userId }, select: { id: true } })
    if (!t) throw new WorkError('NOT_FOUND')
    taskId = t.id
  }
  const view: RoomView = q.room === 'private' ? { room: 'private', owner: 'human' } : TEAM_ROOM
  return { projectId: project.id, taskId, room: view.room, messages: await listWorkMessages(deps, { userId, projectId: project.id, taskId, view }) }
}
