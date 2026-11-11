
import type { PrismaClient } from '@prisma/client'
import { listWorkApps } from '@/lib/work/app-chat'
import { isTeamChatWorkflow } from '@/lib/chat/public-access'

export interface AccessOption { workflowId: string; name: string; group: string | null }
export interface AccessOptions { workApps: AccessOption[]; teamChats: AccessOption[] }

export async function memberAccessOptions(db: PrismaClient, q: { userId: string; agentId: string; accessMode: string | null }): Promise<AccessOptions> {
  const apps = await listWorkApps(db, { userId: q.userId, agentId: q.agentId })
  const flows = await db.workflow.findMany({ where: { agentId: q.agentId, status: 'production' }, select: { workflowId: true, name: true, workflowJson: true }, orderBy: { name: 'asc' } })
  const teamChats = flows
    .filter((w) => {
      try { return isTeamChatWorkflow(JSON.parse(w.workflowJson)?.nodes, q.accessMode) } catch { return false }
    })
    .map((w) => ({ workflowId: w.workflowId, name: w.name, group: null }))
  return {
    workApps: apps
      .map((a) => ({ workflowId: a.workflowId, name: a.name, group: a.groupType === 'canvas' ? a.groupName : null }))
      .sort((a, b) => (a.group ?? a.name).localeCompare(b.group ?? b.name) || a.name.localeCompare(b.name)),
    teamChats,
  }
}

const idList = (v: unknown): string[] | null => (Array.isArray(v) && v.length <= 5000 && v.every((x) => typeof x === 'string') ? [...new Set(v as string[])] : null)
const shownOf = (options: AccessOptions) => new Set([...options.workApps, ...options.teamChats].map((o) => o.workflowId))

export function parseInviteAccess(body: unknown, agentWorkflowIds: ReadonlySet<string>): { workflowIds: string[] } | null {
  if (!body || typeof body !== 'object') return null
  const ids = idList((body as { workflowIds?: unknown }).workflowIds)
  if (!ids) return null
  return { workflowIds: ids.filter((id) => agentWorkflowIds.has(id)) }
}

export function parseAccessChange(body: unknown, options: AccessOptions): { add: string[]; remove: string[] } | null {
  if (!body || typeof body !== 'object') return null
  const b = body as { add?: unknown; remove?: unknown }
  const add = idList(b.add); const remove = idList(b.remove)
  if (!add || !remove || add.some((id) => remove.includes(id))) return null
  const ok = shownOf(options)
  return { add: add.filter((id) => ok.has(id)), remove }
}
