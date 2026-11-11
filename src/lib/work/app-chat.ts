
import { Prisma, type PrismaClient } from '@prisma/client'
import { WorkError } from './errors'
import { decryptJson, encryptJson } from './sealed'
import type { WorkSheetDeps } from './sheet-gate'
import { actorBase, actorLabel, type SheetActor } from './sheet-gate'
import type { WorkAppProposal } from './app-scope'
import { APP_TRIGGER } from '@/lib/workflow/start-trigger'
import { APP_WORKFLOW_KIND, isWorkAppRow } from './app-canvas'
import { resolveNodeType } from '@/lib/workflow/engine/resolve-node-type'
import { isAppTemplateKind } from './app-template-kinds'
import { parseCalSlot, type CalSlotValue } from './calendar-slot'
import { memberAccess, memberCanUseWorkflow } from '@/lib/memberAccess'
import type { ShownAttachment } from './turn-attachments'
import type { WorkNotice } from './notices'

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

export const TELEGRAM_CHAT_RE = /^(-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{3,31})$/
export const isTelegramChatId = (v: string): boolean => TELEGRAM_CHAT_RE.test(v)

export interface AppStartSettings {
  welcome: string
  appTemplate: string | null
  ragSpaceId: number | null
  connections: Record<string, Record<string, string>>
  dbAiSql: Record<string, true>
  telegramChats: Record<string, string>
  startNodeId: string | null
  calendarSlots: Record<string, CalSlotValue>
}

export function appStartSettings(workflowJson: unknown): AppStartSettings {
  try {
    const json = typeof workflowJson === 'string' ? JSON.parse(workflowJson) : workflowJson
    const start = ((json as { nodes?: NodeLike[] })?.nodes ?? []).find((n) => resolveNodeType(n as never) === 'start' && n.data?.triggerType === APP_TRIGGER)
    const welcome = typeof start?.data?.appWelcomeMessage === 'string' ? start.data.appWelcomeMessage.trim().slice(0, 2000) : ''
    const tpl = start?.data?.appTemplate
    const rs = start?.data?.ragSpaceId
    const ragSpaceId = (typeof rs === 'number' && Number.isSafeInteger(rs) && rs > 0) ? rs : (typeof rs === 'string' && /^[1-9]\d{0,9}$/.test(rs)) ? Number(rs) : null
    const connections: Record<string, Record<string, string>> = {}
    const raw = start?.data?.connections
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [kind, slots] of Object.entries(raw as Record<string, unknown>)) {
        if (!slots || typeof slots !== 'object' || Array.isArray(slots)) continue
        const m: Record<string, string> = {}
        for (const [slot, id] of Object.entries(slots as Record<string, unknown>)) if (typeof id === 'string' && id) m[slot] = id
        connections[kind] = m
      }
    }
    const dbAiSql: Record<string, true> = {}
    const ai = start?.data?.dbAiSql
    if (ai && typeof ai === 'object' && !Array.isArray(ai)) for (const [slot, on] of Object.entries(ai as Record<string, unknown>)) if (on === true) dbAiSql[slot] = true
    const telegramChats: Record<string, string> = {}
    const tc = start?.data?.telegramChats
    if (tc && typeof tc === 'object' && !Array.isArray(tc)) for (const [slot, v] of Object.entries(tc as Record<string, unknown>)) if (typeof v === 'string' && isTelegramChatId(v.trim())) telegramChats[slot] = v.trim()
    const calendarSlots: Record<string, CalSlotValue> = {}
    const cs = start?.data?.calendarSlots
    if (cs && typeof cs === 'object' && !Array.isArray(cs)) for (const [slot, v] of Object.entries(cs as Record<string, unknown>)) { const c = parseCalSlot(v); if (c) calendarSlots[slot] = c }
    return { welcome, appTemplate: isAppTemplateKind(tpl) ? tpl : null, ragSpaceId, connections, dbAiSql, telegramChats, startNodeId: typeof start?.id === 'string' ? start.id : null, calendarSlots }
  } catch {
    return { welcome: '', appTemplate: null, ragSpaceId: null, connections: {}, dbAiSql: {}, telegramChats: {}, startNodeId: null, calendarSlots: {} }
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
  groupId: string
  groupName: string
  groupType: 'canvas' | 'workflow'
  projectCreatedAt: Date | null
}

export async function listWorkApps(db: PrismaClient, q: { userId: string; agentId?: string; memberId?: number }): Promise<WorkAppListItem[]> {
  const rows = await db.workflow.findMany({
    where: { ...(q.agentId ? { agentId: q.agentId } : {}), kind: { in: ['main', APP_WORKFLOW_KIND] }, status: 'production', agent: { userId: q.userId } },
    select: { workflowId: true, agentId: true, name: true, kind: true, workflowJson: true, updatedAt: true, parentWorkflowId: true, workProjects: { where: { userId: q.userId }, select: { kind: true, createdAt: true, _count: { select: { tasks: true } } }, orderBy: { createdAt: 'asc' }, take: 1 } },
    orderBy: { updatedAt: 'desc' },
  })
  const access = q.memberId !== undefined && q.agentId ? await memberAccess(db, q.agentId, q.memberId) : undefined
  if (access === null) return []
  const apps = rows.filter((w) => isWorkAppRow(w) && (!access || access.workflowIds.has(w.workflowId)))
  const parentIds = [...new Set(apps.map((w) => w.parentWorkflowId).filter((x): x is string => !!x))]
  const parents = parentIds.length ? await db.workflow.findMany({ where: { workflowId: { in: parentIds }, agent: { userId: q.userId } }, select: { workflowId: true, name: true } }) : []
  const parentName = new Map(parents.map((p) => [p.workflowId, p.name]))
  return apps
    .map((w) => {
      const parent = w.parentWorkflowId ? parentName.get(w.parentWorkflowId) : undefined
      return {
      workflowId: w.workflowId,
      agentId: w.agentId,
      name: w.name,
      appTemplate: appStartSettings(w.workflowJson).appTemplate,
      tasks: w.workProjects[0]?._count.tasks ?? 0,
      projectKind: w.workProjects[0]?.kind ?? null,
      updatedAt: w.updatedAt,
      groupId: parent !== undefined ? w.parentWorkflowId! : w.workflowId,
      groupName: parent !== undefined ? (parent || 'Untitled Workflow') : w.name,
      groupType: parent !== undefined ? ('canvas' as const) : ('workflow' as const),
      projectCreatedAt: w.workProjects[0]?.createdAt ?? null,
      }
    })
}

export async function findWorkApp(db: PrismaClient, q: { userId: string; agentId: string; workflowId: string; memberId?: number }) {
  const w = await db.workflow.findFirst({
    where: { workflowId: q.workflowId, agentId: q.agentId, kind: { in: ['main', APP_WORKFLOW_KIND] }, status: 'production', agent: { userId: q.userId } },
    select: { workflowId: true, name: true, kind: true, workflowJson: true },
  })
  if (!w || !isWorkAppRow(w)) throw new WorkError('NOT_FOUND')
  if (q.memberId !== undefined && !(await memberCanUseWorkflow(db, q.agentId, q.memberId, w.workflowId))) throw new WorkError('NOT_FOUND')
  return { workflowId: w.workflowId, name: w.name, workflowJson: w.workflowJson }
}

export interface WorkMessageBody {
  text: string
  files?: string[]
  shown?: ShownAttachment[]
  proposals?: WorkAppProposal[]
  sendId?: string
  shared?: true
  notice?: WorkNotice
  done?: Record<string, CardDone>
  scan?: string
  creditShort?: true
}

export type CardDone = Record<string, string | number | null>


export type RoomView = { room: 'team' } | { room: 'private'; owner: string }
export const TEAM_ROOM: RoomView = { room: 'team' }
export const readerOf = (a: SheetActor): string | null => (a.type === 'human' ? actorLabel(a) : null)
export const privateRoomOf = (a: SheetActor): RoomView => {
  const owner = readerOf(a)
  if (!owner) throw new WorkError('FORBIDDEN', 'only a person has a private conversation')
  return { room: 'private', owner }
}
const roomWhere = (v: RoomView) => (v.room === 'team' ? { room: 'team', owner: null } : { room: 'private', owner: v.owner })

export const visibleTo = (reader: string | null) => ({ OR: [{ room: 'team' }, ...(reader ? [{ room: 'private', owner: reader }] : [])] })

export interface WorkMessageView {
  id: string
  role: 'user' | 'assistant' | 'notice'
  actor: string
  text: string
  files: Array<{ id: string; name: string; mimeType: string }>
  shown: ShownAttachment[]
  proposals: WorkAppProposal[]
  sendId: string | null
  shared: boolean
  notice?: WorkNotice
  done: Record<string, CardDone>
  scanId?: string
  creditShort?: true
  createdAt: string
}

export async function saveWorkMessage(
  deps: WorkSheetDeps,
  m: { userId: string; projectId: string; taskId: string | null; role: 'user' | 'assistant'; actor: SheetActor; body: WorkMessageBody; view: RoomView },
) {
  const key = await deps.dataKey(deps.db, m.userId)
  return deps.db.workMessage.create({
    data: { userId: m.userId, projectId: m.projectId, taskId: m.taskId, role: m.role, actor: actorBase(actorLabel(m.actor)), body: encryptJson(m.body, key), ...roomWhere(m.view) },
    select: { id: true },
  })
}

export async function listWorkMessages(deps: WorkSheetDeps, q: { userId: string; projectId: string; taskId: string | null; view: RoomView; limit?: number; noNotices?: boolean; since?: Date; after?: { at: string; id: string } }): Promise<WorkMessageView[]> {
  const rows = await deps.db.workMessage.findMany({
    where: { projectId: q.projectId, userId: q.userId, taskId: q.taskId, ...roomWhere(q.view), ...(q.noNotices ? { role: { not: 'notice' } } : {}), ...(q.since ? { createdAt: { gte: q.since } } : {}), ...(q.since && q.after ? { OR: [{ createdAt: { gt: new Date(q.after.at) } }, { createdAt: new Date(q.after.at), id: { gt: q.after.id } }] } : {}) },
    orderBy: q.since ? [{ createdAt: 'asc' }, { id: 'asc' }] : [{ createdAt: 'desc' }, { id: 'desc' }],
    take: q.limit ?? 200,
  })
  if (!q.since) rows.reverse()
  const key = await deps.dataKey(deps.db, q.userId)
  const bodies = rows.map((r) => decryptJson<WorkMessageBody>(r.body, key))
  const fileIds = [...new Set(bodies.flatMap((b) => b.files ?? []))]
  const files = fileIds.length
    ? await deps.db.workFile.findMany({ where: { id: { in: fileIds }, projectId: q.projectId, userId: q.userId }, select: { id: true, mimeType: true, payload: true } })
    : []
  const fileView = new Map(files.map((f) => [f.id, { id: f.id, name: decryptJson<{ originalName: string }>(f.payload, key).originalName, mimeType: f.mimeType }]))
  return rows.map((r, i) => ({
    id: r.id,
    role: r.role === 'assistant' ? 'assistant' : r.role === 'notice' ? 'notice' : 'user',
    actor: r.actor,
    text: bodies[i].text,
    files: (bodies[i].files ?? []).map((id) => fileView.get(id)).filter((f): f is NonNullable<typeof f> => !!f),
    shown: bodies[i].shown ?? [],
    proposals: bodies[i].proposals ?? [],
    sendId: bodies[i].sendId ?? null,
    shared: bodies[i].shared === true,
    ...(bodies[i].notice ? { notice: bodies[i].notice } : {}),
    done: bodies[i].done ?? {},
    ...(bodies[i].scan ? { scanId: bodies[i].scan } : {}),
    ...(bodies[i].creditShort ? { creditShort: true as const } : {}),
    createdAt: r.createdAt.toISOString(),
  }))
}

const DONE_CARD_TYPES: ReadonlySet<string> = new Set(['module_run', 'confirm_rows', 'ledger_files', 'bank_import', 'report_files'])
const DONE_KEY = /^[a-z][A-Za-z0-9]{0,30}$/

export async function markCardDone(deps: WorkSheetDeps, q: { userId: string; projectId: string; messageId: string; index: number; reader: string | null; result: unknown }): Promise<{ ok: true }> {
  const r = q.result
  if (!r || typeof r !== 'object' || Array.isArray(r)) throw new WorkError('INVALID', 'result must be an object')
  const entries = Object.entries(r as Record<string, unknown>)
  if (entries.length > 8 || entries.some(([k, v]) => !DONE_KEY.test(k) || !(v === null || (typeof v === 'string' && v.length <= 200) || (typeof v === 'number' && Number.isFinite(v))))) throw new WorkError('INVALID', 'result must be up to 8 short values')
  const key = await deps.dataKey(deps.db, q.userId)
  await deps.db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM work_message WHERE id = ${q.messageId} FOR UPDATE`
    const m = await tx.workMessage.findFirst({ where: { id: q.messageId, projectId: q.projectId, userId: q.userId, role: 'assistant', ...visibleTo(q.reader) }, select: { body: true } })
    if (!m) throw new WorkError('NOT_FOUND')
    const body = decryptJson<WorkMessageBody>(m.body, key)
    const p = body.proposals?.[q.index]
    if (!p || !DONE_CARD_TYPES.has(p.type)) throw new WorkError('NOT_FOUND')
    body.done = { ...(body.done ?? {}), [String(q.index)]: Object.fromEntries(entries) as CardDone }
    await tx.workMessage.update({ where: { id: q.messageId }, data: { body: encryptJson(body, key) } })
  })
  return { ok: true }
}

export async function shareToTeam(deps: WorkSheetDeps, q: { userId: string; projectId: string; messageId: string; actor: SheetActor }): Promise<{ id: string }> {
  const reader = readerOf(q.actor)
  if (!reader) throw new WorkError('FORBIDDEN', 'only a person shares')
  const m = await deps.db.workMessage.findFirst({ where: { id: q.messageId, projectId: q.projectId, userId: q.userId, room: 'private', owner: reader }, select: { taskId: true, body: true } })
  if (!m) throw new WorkError('NOT_FOUND')
  const key = await deps.dataKey(deps.db, q.userId)
  const b = decryptJson<WorkMessageBody>(m.body, key)
  if (!b.text.trim() && !(b.files ?? []).length) throw new WorkError('INVALID', 'nothing to share')
  return saveWorkMessage(deps, { userId: q.userId, projectId: q.projectId, taskId: m.taskId, role: 'user', actor: q.actor, body: { text: b.text, ...(b.files?.length ? { files: b.files } : {}), shared: true }, view: TEAM_ROOM })
}

export async function markTeamRead(deps: WorkSheetDeps, q: { userId: string; projectId: string; taskId: string | null; reader: string; asOf: Date }): Promise<void> {
  const taskKey = q.taskId ?? ''
  const key = { projectId: q.projectId, taskKey, reader: q.reader }
  const moved = await deps.db.workRoomRead.updateMany({ where: { ...key, readAt: { lt: q.asOf } }, data: { readAt: q.asOf } })
  if (moved.count > 0) return
  await deps.db.workRoomRead.create({ data: { ...key, userId: q.userId, readAt: q.asOf } }).catch(async (e: unknown) => {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e
    await deps.db.workRoomRead.updateMany({ where: { ...key, readAt: { lt: q.asOf } }, data: { readAt: q.asOf } })
  })
}

const UNREAD_FRESH_MS = 14 * 86_400_000

export async function teamUnread(deps: WorkSheetDeps, q: { userId: string; projectId: string; reader: string }): Promise<Record<string, number>> {
  const fresh = new Date(Date.now() - UNREAD_FRESH_MS).toISOString().slice(0, 23).replace('T', ' ')
  const rows = await deps.db.$queryRaw<Array<{ k: string; n: bigint }>>`
    SELECT COALESCE(m.task_id, '') AS k, count(*) AS n
    FROM work_message m
    LEFT JOIN work_room_read r ON r.project_id = m.project_id AND r.task_key = COALESCE(m.task_id, '') AND r.reader = ${q.reader}
    WHERE m.project_id = ${q.projectId} AND m.user_id = ${q.userId} AND m.room = 'team' AND m.actor <> ${q.reader}
      AND m.created_at > COALESCE(r.read_at, ${fresh}::timestamp)
    GROUP BY 1`
  return Object.fromEntries(rows.map((r) => [r.k, Number(r.n)]))
}
