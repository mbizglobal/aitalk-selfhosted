
import type { PrismaClient } from '@prisma/client'
import { WorkError } from './errors'
import { decryptJson, encryptJson } from './sealed'
import type { WorkSheetDeps } from './sheet-gate'
import { actorLabel, type SheetActor } from './sheet-gate'
import type { WorkAppProposal } from './app-scope'
import { APP_TRIGGER, isAppWorkflow } from '@/lib/workflow/start-trigger'
import { resolveNodeType } from '@/lib/workflow/engine/resolve-node-type'
import { isAppTemplateKind } from './app-template-kinds'
import type { ShownAttachment } from './turn-attachments'

export const MAX_WORK_MESSAGE_CHARS = 20_000
export const MAX_WORK_MESSAGE_FILES = 24
export const HISTORY_MESSAGES = 30
export const HISTORY_MESSAGE_CHARS = 6_000

type NodeLike = { id?: unknown; type?: unknown; data?: Record<string, unknown> | null }
type EdgeLike = { source?: unknown; target?: unknown; sourceHandle?: unknown }

export const NO_WORK_APP_TOOL = 'an AI node has no work app tool'

export function checkWorkAppGraph(workflowJson: unknown): string | null {
  let json = workflowJson
  if (typeof json === 'string') {
    try { json = JSON.parse(json) } catch { return 'unreadable workflow' }
  }
  const nodes = (json as { nodes?: unknown })?.nodes
  const edges = (json as { edges?: unknown })?.edges ?? []
  if (!Array.isArray(nodes) || !Array.isArray(edges)) return 'unreadable workflow'
  const byId = new Map<string, NodeLike>()
  for (const n of nodes as NodeLike[]) if (n && typeof n.id === 'string') byId.set(n.id, n)
  const touched = new Set<string>()
  for (const e of edges as EdgeLike[]) {
    if (typeof e?.source === 'string') touched.add(e.source)
    if (typeof e?.target === 'string') touched.add(e.target)
  }
  let starts = 0
  const aiNodes: string[] = []
  const aiWithTool = new Set<string>()
  for (const n of nodes as NodeLike[]) {
    if (!n || typeof n.id !== 'string') return 'a node without id'
    if (n.type === 'note') {
      if (touched.has(n.id)) return 'a note with connections'
      continue
    }
    if (n.type === 'tool') {
      if (n.data?.toolType !== 'workApp') return `tool ${String(n.data?.toolType)} is not allowed in a work app`
      const inbound = (edges as EdgeLike[]).filter((e) => e?.target === n.id)
      const outbound = (edges as EdgeLike[]).filter((e) => e?.source === n.id)
      if (inbound.length !== 1 || outbound.length > 0 || inbound[0].sourceHandle !== 'tools' || resolveNodeType(byId.get(String(inbound[0].source)) as never) !== 'ai') return 'a work app tool must hang on exactly one AI node'
      aiWithTool.add(String(inbound[0].source))
      continue
    }
    const t = resolveNodeType(n as never)
    if (t === 'start') {
      starts++
      if (n.data?.triggerType !== APP_TRIGGER) return 'only the App start is allowed'
      continue
    }
    if (t === 'ai') {
      if (n.data?.saveTempStorage === true || n.data?.loadTempStorage === true) return 'AI temp storage is not allowed in a work app'
      aiNodes.push(n.id)
      continue
    }
    if (t === 'end') continue
    return `node ${String(t ?? n.type)} is not allowed in a work app`
  }
  if (starts !== 1) return 'a work app needs exactly one App start'
  if (aiNodes.length === 0 || aiNodes.some((id) => !aiWithTool.has(id))) return NO_WORK_APP_TOOL
  return null
}

export function appStartSettings(workflowJson: unknown): { welcome: string; appTemplate: string | null } {
  try {
    const json = typeof workflowJson === 'string' ? JSON.parse(workflowJson) : workflowJson
    const start = ((json as { nodes?: NodeLike[] })?.nodes ?? []).find((n) => resolveNodeType(n as never) === 'start' && n.data?.triggerType === APP_TRIGGER)
    const welcome = typeof start?.data?.appWelcomeMessage === 'string' ? start.data.appWelcomeMessage.trim().slice(0, 2000) : ''
    const tpl = start?.data?.appTemplate
    return { welcome, appTemplate: isAppTemplateKind(tpl) ? tpl : null }
  } catch {
    return { welcome: '', appTemplate: null }
  }
}

export interface WorkAppListItem {
  workflowId: string
  agentId: string
  name: string
  appTemplate: string | null
  tasks: number
  projectKind: string | null
  updatedAt: Date
}

export async function listWorkApps(db: PrismaClient, q: { userId: string; agentId?: string }): Promise<WorkAppListItem[]> {
  const rows = await db.workflow.findMany({
    where: { ...(q.agentId ? { agentId: q.agentId } : {}), kind: 'main', status: 'production', agent: { userId: q.userId } },
    select: { workflowId: true, agentId: true, name: true, workflowJson: true, updatedAt: true, workProjects: { where: { userId: q.userId }, select: { kind: true, _count: { select: { tasks: true } } }, take: 1 } },
    orderBy: { updatedAt: 'desc' },
  })
  return rows
    .filter((w) => isAppWorkflow(w.workflowJson))
    .map((w) => ({
      workflowId: w.workflowId,
      agentId: w.agentId,
      name: w.name,
      appTemplate: appStartSettings(w.workflowJson).appTemplate,
      tasks: w.workProjects[0]?._count.tasks ?? 0,
      projectKind: w.workProjects[0]?.kind ?? null,
      updatedAt: w.updatedAt,
    }))
}

export async function findWorkApp(db: PrismaClient, q: { userId: string; agentId: string; workflowId: string }) {
  const w = await db.workflow.findFirst({
    where: { workflowId: q.workflowId, agentId: q.agentId, kind: 'main', status: 'production', agent: { userId: q.userId } },
    select: { workflowId: true, name: true, workflowJson: true },
  })
  if (!w || !isAppWorkflow(w.workflowJson)) throw new WorkError('NOT_FOUND')
  return w
}

export interface WorkMessageBody {
  text: string
  files?: string[]
  shown?: ShownAttachment[]
  proposals?: WorkAppProposal[]
}

export interface WorkMessageView {
  id: string
  role: 'user' | 'assistant'
  actor: string
  text: string
  files: Array<{ id: string; name: string; mimeType: string }>
  shown: ShownAttachment[]
  proposals: WorkAppProposal[]
  createdAt: string
}

export async function saveWorkMessage(
  deps: WorkSheetDeps,
  m: { userId: string; projectId: string; taskId: string | null; role: 'user' | 'assistant'; actor: SheetActor; body: WorkMessageBody },
) {
  const key = await deps.dataKey(deps.db, m.userId)
  return deps.db.workMessage.create({
    data: { userId: m.userId, projectId: m.projectId, taskId: m.taskId, role: m.role, actor: actorLabel(m.actor), body: encryptJson(m.body, key) },
    select: { id: true },
  })
}

export async function listWorkMessages(deps: WorkSheetDeps, q: { userId: string; projectId: string; taskId: string | null; limit?: number }): Promise<WorkMessageView[]> {
  const rows = await deps.db.workMessage.findMany({
    where: { projectId: q.projectId, userId: q.userId, taskId: q.taskId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: q.limit ?? 200,
  })
  rows.reverse()
  const key = await deps.dataKey(deps.db, q.userId)
  const bodies = rows.map((r) => decryptJson<WorkMessageBody>(r.body, key))
  const fileIds = [...new Set(bodies.flatMap((b) => b.files ?? []))]
  const files = fileIds.length
    ? await deps.db.workFile.findMany({ where: { id: { in: fileIds }, projectId: q.projectId, userId: q.userId }, select: { id: true, mimeType: true, payload: true } })
    : []
  const fileView = new Map(files.map((f) => [f.id, { id: f.id, name: decryptJson<{ originalName: string }>(f.payload, key).originalName, mimeType: f.mimeType }]))
  return rows.map((r, i) => ({
    id: r.id,
    role: r.role === 'assistant' ? 'assistant' : 'user',
    actor: r.actor,
    text: bodies[i].text,
    files: (bodies[i].files ?? []).map((id) => fileView.get(id)).filter((f): f is NonNullable<typeof f> => !!f),
    shown: bodies[i].shown ?? [],
    proposals: bodies[i].proposals ?? [],
    createdAt: r.createdAt.toISOString(),
  }))
}
