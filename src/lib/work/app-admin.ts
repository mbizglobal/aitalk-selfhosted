
import { Prisma, PrismaClient } from '@prisma/client'
import { WorkError } from './errors'
import { decryptJson, encryptJson } from './sealed'
import { APP_AI_KEYS, APP_START_KEYS, APP_WORKFLOW_KIND, appNodesOf, buildAppGraph } from './app-canvas'
import { appStartSettings } from './app-chat'
import { lockProjectForWrite } from './sheet-gate'
import { liveSendingCount } from './sends'
import { writeDeletionSignal } from './signals'

type Tx = Prisma.TransactionClient
type Db = Tx | PrismaClient

type Graph = { nodes?: Array<{ id?: unknown; data?: Record<string, unknown> | null; [k: string]: unknown }>; edges?: Array<{ source?: unknown; target?: unknown; [k: string]: unknown }>; [k: string]: unknown }

function parseGraph(json: string): Graph | null {
  try {
    const g = JSON.parse(json) as Graph
    return g && typeof g === 'object' ? g : null
  } catch {
    return null
  }
}

export function stripNodes(json: string, nodeIds: ReadonlySet<string>): string {
  const g = parseGraph(json)
  if (!g) return json
  const nodes = (g.nodes ?? []).filter((n) => !(typeof n.id === 'string' && nodeIds.has(n.id)))
  const edges = (g.edges ?? []).filter((e) => !(nodeIds.has(String(e.source)) || nodeIds.has(String(e.target))))
  return JSON.stringify({ ...g, nodes, edges })
}

export function blankNodeData(json: string, nodeId: string): string {
  const g = parseGraph(json)
  if (!g) return json
  const nodes = (g.nodes ?? []).map((n) => (n.id === nodeId ? { ...n, data: { nodeType: n.data?.nodeType ?? null, label: '' } } : n))
  return JSON.stringify({ ...g, nodes })
}

export interface TrashApp { nodeId: string; workflowId: string }
export interface TrashBody { name: string; description: string | null; workflowJson: string; groupId: string | null }

export const trashAppsOf = (v: unknown): TrashApp[] =>
  Array.isArray(v) ? v.filter((a): a is TrashApp => !!a && typeof a === 'object' && typeof (a as TrashApp).nodeId === 'string' && typeof (a as TrashApp).workflowId === 'string') : []

export async function findTrashOf(db: Db, userId: string, hiddenWorkflowId: string): Promise<{ id: string; apps: TrashApp[] } | null> {
  const rows = await db.$queryRaw<Array<{ id: string; apps: unknown }>>`
    SELECT id, apps FROM work_canvas_trash WHERE user_id = ${userId} AND apps @> ${JSON.stringify([{ workflowId: hiddenWorkflowId }])}::jsonb ORDER BY created_at DESC LIMIT 1`
  return rows[0] ? { id: rows[0].id, apps: trashAppsOf(rows[0].apps) } : null
}

export async function lockTrashOf(tx: Tx, userId: string, hiddenWorkflowId: string): Promise<{ id: string; agentId: string; oldWorkflowId: string; body: Uint8Array; apps: TrashApp[] } | null> {
  const rows = await tx.$queryRaw<Array<{ id: string; agent_id: string; old_workflow_id: string; body: Uint8Array; apps: unknown }>>`
    SELECT id, agent_id, old_workflow_id, body, apps FROM work_canvas_trash
    WHERE user_id = ${userId} AND apps @> ${JSON.stringify([{ workflowId: hiddenWorkflowId }])}::jsonb
    ORDER BY created_at DESC LIMIT 1 FOR UPDATE`
  const r = rows[0]
  return r ? { id: r.id, agentId: r.agent_id, oldWorkflowId: r.old_workflow_id, body: r.body, apps: trashAppsOf(r.apps) } : null
}

export async function dropFromTrashLocked(tx: Tx, key: Buffer, trash: { id: string; body: Uint8Array; apps: TrashApp[] }, hiddenWorkflowId: string): Promise<void> {
  const gone = trash.apps.find((a) => a.workflowId === hiddenWorkflowId)
  const apps = trash.apps.filter((a) => a.workflowId !== hiddenWorkflowId)
  if (!apps.length) { await tx.workCanvasTrash.delete({ where: { id: trash.id } }); return }
  const body = decryptJson<TrashBody>(trash.body, key)
  const next: TrashBody = gone ? { ...body, workflowJson: stripNodes(body.workflowJson, new Set([gone.nodeId])) } : body
  await tx.workCanvasTrash.update({ where: { id: trash.id }, data: { body: encryptJson(next, key), apps: apps as unknown as Prisma.InputJsonValue } })
}

export type ManagedState = 'live' | 'paused' | 'removed' | 'orphan'
export interface ManagedApp {
  projectId: string
  appWorkflowId: string | null
  nodeId: string | null
  name: string
  agentId: string | null
  template: string | null
  tasks: number
  state: ManagedState
}
export interface ManagedGroup {
  type: 'canvas' | 'trash' | 'workflow' | 'none'
  id: string
  name: string
  status: string | null
  agentId: string | null
  apps: ManagedApp[]
}

export async function listManagedApps(db: Db, userId: string, key: Buffer, scope?: { agentId: string }): Promise<ManagedGroup[]> {
  const hidden = await db.workflow.findMany({
    where: { kind: APP_WORKFLOW_KIND, agent: { userId }, ...(scope ? { agentId: scope.agentId } : {}) },
    select: { workflowId: true, agentId: true, name: true, status: true, parentWorkflowId: true, parentNodeId: true, appProjectId: true, workflowJson: true },
  })
  const projects = await db.workProject.findMany({
    where: {
      userId, status: 'active',
      ...(scope ? { OR: [{ workflow: { agentId: scope.agentId } }, { workflowId: null, id: { in: hidden.map((h) => h.appProjectId).filter((x): x is string => !!x) } }] } : {}),
    },
    select: { id: true, kind: true, agentId: true, settings: true, workflowId: true, createdAt: true, _count: { select: { tasks: true } } },
    orderBy: { createdAt: 'asc' },
  })
  if (!projects.length) return []
  const parents = await db.workflow.findMany({
    where: { workflowId: { in: [...new Set([...hidden.map((h) => h.parentWorkflowId), ...projects.map((p) => p.workflowId)].filter((x): x is string => !!x))] }, agent: { userId } },
    select: { workflowId: true, agentId: true, name: true, status: true, kind: true, workflowJson: true },
  })
  const parentById = new Map(parents.map((w) => [w.workflowId, w]))
  const trash = scope ? [] : await db.workCanvasTrash.findMany({ where: { userId }, select: { id: true, agentId: true, body: true, apps: true, createdAt: true } })
  const trashOf = new Map<string, { id: string; agentId: string; name: string }>()
  for (const t of trash) {
    let name = ''
    try { name = decryptJson<TrashBody>(t.body, key).name } catch { }
    for (const a of trashAppsOf(t.apps)) trashOf.set(a.workflowId, { id: t.id, agentId: t.agentId, name })
  }

  const groups = new Map<string, ManagedGroup>()
  const groupOf = (g: Omit<ManagedGroup, 'apps'>): ManagedGroup => {
    const k = `${g.type}:${g.id}`
    let cur = groups.get(k)
    if (!cur) { cur = { ...g, apps: [] }; groups.set(k, cur) }
    return cur
  }
  for (const p of projects) {
    let projectName = ''
    try { projectName = p.settings ? decryptJson<{ name?: string }>(p.settings, key).name ?? '' : '' } catch { }
    const h = hidden.find((x) => x.workflowId === p.workflowId) ?? (p.workflowId === null ? hidden.find((x) => x.appProjectId === p.id) : undefined)
    const base = { projectId: p.id, tasks: p._count.tasks }
    const kindTpl = p.kind !== 'free' ? p.kind : null
    if (h) {
      const app: ManagedApp = { ...base, appWorkflowId: h.workflowId, nodeId: h.parentNodeId, name: h.name || projectName || 'Work app', agentId: h.agentId, template: kindTpl ?? appStartSettings(h.workflowJson).appTemplate, state: 'orphan' }
      const c = h.parentWorkflowId ? parentById.get(h.parentWorkflowId) : undefined
      if (c) {
        const onCanvas = appNodesOf(c.workflowJson).some((n) => n.id === h.parentNodeId)
        app.state = !onCanvas ? 'removed' : c.status === 'production' ? 'live' : 'paused'
        groupOf({ type: 'canvas', id: c.workflowId, name: c.name, status: c.status, agentId: c.agentId }).apps.push(app)
      } else {
        const t = trashOf.get(h.workflowId)
        if (t) groupOf({ type: 'trash', id: t.id, name: t.name, status: null, agentId: t.agentId }).apps.push(app)
        else groupOf({ type: 'none', id: 'none', name: '', status: null, agentId: null }).apps.push(app)
      }
      continue
    }
    const w = p.workflowId ? parentById.get(p.workflowId) : undefined
    if (w && w.kind === 'main') {
      const app: ManagedApp = { ...base, appWorkflowId: w.workflowId, nodeId: null, name: w.name || projectName || 'Work app', agentId: w.agentId, template: kindTpl ?? appStartSettings(w.workflowJson).appTemplate, state: w.status === 'production' ? 'live' : 'paused' }
      groupOf({ type: 'workflow', id: w.workflowId, name: w.name, status: w.status, agentId: w.agentId }).apps.push(app)
      continue
    }
    groupOf({ type: 'none', id: 'none', name: '', status: null, agentId: null }).apps.push({ ...base, appWorkflowId: null, nodeId: null, name: projectName || 'Work app', agentId: p.agentId, template: kindTpl, state: 'orphan' })
  }
  const order = { canvas: 0, trash: 1, workflow: 2, none: 3 } as const
  return [...groups.values()]
    .filter((g) => !scope || ((g.type === 'canvas' || g.type === 'workflow') && g.agentId === scope.agentId))
    .sort((a, b) => order[a.type] - order[b.type] || a.name.localeCompare(b.name))
}

const START_NODE = { id: 'start-1', type: 'custom', position: { x: 100, y: 300 }, data: { label: 'Start / App', icon: null, color: 'bg-green-500', showLeftHandle: false, nodeType: 'start', triggerType: 'app' } }

export function nodeDataFromHidden(name: string, hiddenJson: string | null, fallbackTemplate: string | null): Record<string, unknown> {
  const data: Record<string, unknown> = { label: name || 'Work app', icon: null, color: 'bg-amber-600', nodeType: 'workApp' }
  const g = hiddenJson ? parseGraph(hiddenJson) : null
  const start = g?.nodes?.find((n) => n.data?.nodeType === 'start')?.data ?? {}
  const ai = g?.nodes?.find((n) => n.data?.nodeType === 'ai')?.data ?? {}
  for (const k of APP_START_KEYS) if (start[k] !== undefined) data[k] = start[k]
  const aiOut: Record<string, unknown> = {}
  for (const k of APP_AI_KEYS) if (ai[k] !== undefined) aiOut[k] = ai[k]
  if (Object.keys(aiOut).length) data.ai = aiOut
  if (data.appTemplate === undefined && fallbackTemplate) data.appTemplate = fallbackTemplate
  return data
}

export interface RestoreInput {
  userId: string
  agentId: string
  projectId: string
  projectKind: string
  hiddenWorkflowId: string | null
  newWorkflowId: string
  newHiddenWorkflowId: string
  nodeData?: Record<string, unknown>
}
export type CanvasCreate = (c: { name: string; description: string | null; workflowJson: string }) => Promise<void>

export async function restoreCanvasLocked(tx: Tx, key: Buffer, input: RestoreInput, create: CanvasCreate): Promise<number> {
  await tx.$queryRaw`SELECT id FROM "user" WHERE id = ${input.userId} FOR NO KEY UPDATE`
  const found = input.hiddenWorkflowId ? await findTrashOf(tx, input.userId, input.hiddenWorkflowId) : null
  if (found) {
    const ids = found.apps.map((a) => a.workflowId)
    const rows = await tx.$queryRaw<Array<{ workflowId: string; parent_node_id: string | null; parent_workflow_id: string | null; status: string; app_project_id: string | null }>>`
      SELECT "workflowId", parent_node_id, parent_workflow_id, status, app_project_id FROM workflows
      WHERE "workflowId" = ANY(${ids}::text[]) AND kind = ${APP_WORKFLOW_KIND} ORDER BY "workflowId" FOR UPDATE`
    const pids = rows.map((r) => r.app_project_id).filter((x): x is string => !!x)
    const projects = pids.length ? await tx.$queryRaw<Array<{ id: string; workflow_id: string | null }>>`
      SELECT id, workflow_id FROM work_project WHERE user_id = ${input.userId} AND id = ANY(${pids}::text[]) ORDER BY id FOR UPDATE` : []
    const detached = new Set(projects.filter((p) => p.workflow_id === null).map((p) => p.id))
    const trash = await lockTrashOf(tx, input.userId, input.hiddenWorkflowId as string)
    if (!trash || trash.id !== found.id || trash.apps.length !== found.apps.length) throw new WorkError('STALE', 'deleted workflow changed meanwhile')
    const keep = rows.filter((r) => r.parent_workflow_id === null && r.status === 'archived' && r.parent_node_id && r.app_project_id && detached.has(r.app_project_id))
    const keepNodes = new Set(keep.map((r) => r.parent_node_id as string))
    const drop = new Set(trash.apps.map((a) => a.nodeId).filter((n) => !keepNodes.has(n)))
    if (!keep.length) {
      await tx.workCanvasTrash.delete({ where: { id: trash.id } })
      throw new WorkError('NOT_FOUND', 'nothing to restore')
    }
    const body = decryptJson<TrashBody>(trash.body, key)
    await create({ name: body.name, description: body.description, workflowJson: drop.size ? stripNodes(body.workflowJson, drop) : body.workflowJson })
    await tx.workflow.updateMany({ where: { workflowId: { in: keep.map((r) => r.workflowId) } }, data: { parentWorkflowId: input.newWorkflowId } })
    if (body.groupId && (await tx.workflowGroup.count({ where: { id: body.groupId } }))) {
      await tx.workflowGroupItem.create({ data: { groupId: body.groupId, workflowId: input.newWorkflowId } })
    }
    await tx.workCanvasTrash.delete({ where: { id: trash.id } })
    return keep.length
  }

  const h = input.hiddenWorkflowId ? await tx.$queryRaw<Array<{ workflowId: string; name: string; workflow_json: string; parent_node_id: string | null; parent_workflow_id: string | null }>>`
      SELECT "workflowId", name, workflow_json, parent_node_id, parent_workflow_id FROM workflows WHERE "workflowId" = ${input.hiddenWorkflowId} AND kind = ${APP_WORKFLOW_KIND} FOR UPDATE` : []
  const p = await tx.$queryRaw<Array<{ id: string; workflow_id: string | null; workflow_linked_at: Date | null }>>`
    SELECT id, workflow_id, workflow_linked_at FROM work_project WHERE id = ${input.projectId} AND user_id = ${input.userId} FOR UPDATE`
  if (!p[0] || p[0].workflow_id !== null) throw new WorkError('NOT_FOUND', 'work app is not detached')
  const tpl = input.projectKind !== 'free' ? input.projectKind : null
  if (input.hiddenWorkflowId) {
    if (!h[0] || h[0].parent_workflow_id !== null || !h[0].parent_node_id) throw new WorkError('NOT_FOUND', 'work app is not detached')
    const node = { id: h[0].parent_node_id, type: 'custom', position: { x: 400, y: 280 }, data: nodeDataFromHidden(h[0].name, h[0].workflow_json, tpl) }
    await create({ name: h[0].name || 'Work app', description: null, workflowJson: JSON.stringify({ nodes: [START_NODE, node], edges: [{ id: `e-start-${node.id}`, source: START_NODE.id, target: node.id }] }) })
    await tx.workflow.update({ where: { workflowId: h[0].workflowId }, data: { parentWorkflowId: input.newWorkflowId } })
    return 1
  }
  if ((await tx.workflow.count({ where: { appProjectId: input.projectId, kind: APP_WORKFLOW_KIND } })) > 0) throw new WorkError('STALE', 'already restored')
  let name = 'Work app'
  const settings = await tx.workProject.findUnique({ where: { id: input.projectId }, select: { settings: true } })
  try { name = (settings?.settings ? decryptJson<{ name?: string }>(settings.settings, key).name : '') || name } catch { }
  const node = { id: 'app-1', type: 'custom', position: { x: 400, y: 280 }, data: { ...nodeDataFromHidden(name, null, tpl), ...(input.nodeData ?? {}), nodeType: 'workApp' } }
  await create({ name, description: null, workflowJson: JSON.stringify({ nodes: [START_NODE, node], edges: [{ id: 'e-start-app-1', source: START_NODE.id, target: node.id }] }) })
  await tx.workflow.create({
    data: { workflowId: input.newHiddenWorkflowId, agentId: input.agentId, name, workflowJson: buildAppGraph(input.newWorkflowId, node), status: 'archived', trafficWeight: 0, kind: APP_WORKFLOW_KIND, parentWorkflowId: input.newWorkflowId, parentNodeId: node.id, appProjectId: input.projectId },
  })
  if (!p[0].workflow_linked_at) await tx.workProject.update({ where: { id: input.projectId }, data: { workflowLinkedAt: new Date() } })
  return 1
}

export interface PurgeProjectInput {
  userId: string
  projectId: string
  hiddenWorkflowId: string | null
  canvasWorkflowIds: string[]
  nodeId: string | null
  confirmReferences: boolean
}

export async function purgeProjectLocked(tx: Tx, key: Buffer, input: PurgeProjectInput): Promise<{ referencedBy: string[] }> {
  await tx.$queryRaw`SELECT id FROM "user" WHERE id = ${input.userId} FOR NO KEY UPDATE`
  if (input.hiddenWorkflowId) await tx.$queryRaw`SELECT "workflowId" FROM workflows WHERE "workflowId" = ${input.hiddenWorkflowId} FOR UPDATE`
  const locked = await lockProjectForWrite(tx, input.userId, input.projectId)
  if ((await tx.workTask.count({ where: { projectId: input.projectId, userId: input.userId, status: 'awaiting' } })) > 0) throw new WorkError('AWAITING_APPROVAL')
  if ((await liveSendingCount(tx, input.projectId)) > 0) throw new WorkError('SENDING')
  const refs = await tx.projectReference.findMany({ where: { toProjectId: input.projectId, userId: input.userId }, select: { fromProjectId: true } })
  const referencedBy = [...new Set(refs.map((r) => r.fromProjectId))]
  if (referencedBy.length && !input.confirmReferences) return { referencedBy }
  const regions = (await tx.workFile.findMany({ where: { projectId: input.projectId }, distinct: ['blobRegion'], select: { blobRegion: true } })).map((r) => r.blobRegion)
  if (await tx.workHandoff.count({ where: { fromProjectId: input.projectId, userId: input.userId, status: { not: 'withdrawn' } } }) > 0) {
    await writeDeletionSignal(tx, key, { userId: input.userId, projectId: input.projectId, workflowId: locked.workflowId ?? input.hiddenWorkflowId })
  }
  await tx.workProject.delete({ where: { id: input.projectId } })
  if (input.hiddenWorkflowId) {
    const trash = await lockTrashOf(tx, input.userId, input.hiddenWorkflowId)
    if (trash) await dropFromTrashLocked(tx, key, trash, input.hiddenWorkflowId)
    await tx.workflow.deleteMany({ where: { workflowId: input.hiddenWorkflowId, kind: APP_WORKFLOW_KIND } })
  }
  await tx.workPurge.create({ data: { userId: input.userId, kind: 'delete', state: 'pending', projectId: input.projectId, canvasWorkflowIds: [...new Set(input.canvasWorkflowIds)], nodeId: input.nodeId, blobRegions: regions } })
  return { referencedBy: [] }
}

const CLAIM_STALE_MS = 10 * 60_000
const UPLOAD_GRACE_MS = 10 * 60_000
const RUN_BACKSTOP_MS = 7 * 86_400_000
const DONE_RUN = ['done', 'failed', 'interrupted']

export interface PurgeDeps {
  db: PrismaClient
  deleteProjectBlobs(regionId: string, userId: string, projectId: string): Promise<void>
  now?: () => Date
  onlyUserId?: string
}

export async function processWorkPurges(d: PurgeDeps): Promise<{ done: number; waiting: number }> {
  const now = d.now?.() ?? new Date()
  const rows = await d.db.workPurge.findMany({
    where: {
      ...(d.onlyUserId ? { userId: d.onlyUserId } : {}),
      OR: [
        { kind: 'delete', state: 'pending' },
        { kind: 'upload', state: 'uploading', deadline: { lt: new Date(now.getTime() - UPLOAD_GRACE_MS) }, OR: [{ claimedAt: null }, { claimedAt: { lt: new Date(now.getTime() - CLAIM_STALE_MS) } }] },
        { state: 'purging', claimedAt: { lt: new Date(now.getTime() - CLAIM_STALE_MS) } },
      ],
    },
    orderBy: [{ claimedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }],
    take: 20,
  })
  let done = 0
  let waiting = 0
  for (const r of rows) {
    const claimed = await d.db.workPurge.updateMany({ where: { id: r.id, state: r.state, claimedAt: r.claimedAt }, data: { state: 'purging', claimedAt: now, attempts: { increment: 1 } } })
    if (claimed.count === 0) continue
    const r2 = { ...r, state: 'purging' }
    const claim = { at: now }
    const mine = () => ({ id: r.id, state: 'purging', claimedAt: claim.at })
    try {
      const finished = r.kind === 'upload' ? await purgeUpload(d, r2, now, claim) : await purgeDeleted(d, r2, now, claim)
      if (finished) { await d.db.workPurge.deleteMany({ where: mine() }); done++ }
      else { await d.db.workPurge.updateMany({ where: mine(), data: { state: r.kind === 'upload' ? 'uploading' : 'pending', claimedAt: now, lastError: r.kind === 'upload' ? 'SWEPT_ONCE' : 'WAITING' } }); waiting++ }
    } catch (e) {
      const code = e instanceof Error ? e.name.slice(0, 40) : 'ERROR'
      console.error(`[work-purge] ${r.kind} project=${r.projectId} 실패:`, e instanceof Error ? e.message.slice(0, 200) : 'error')
      await d.db.workPurge.updateMany({ where: mine(), data: { state: r.kind === 'upload' ? 'uploading' : 'pending', claimedAt: now, lastError: code } })
      waiting++
    }
  }
  return { done, waiting }
}

type PurgeRow = { id: string; userId: string; projectId: string; canvasWorkflowIds: string[]; nodeId: string | null; blobRegions: string[]; createdAt: Date; attempts: number; lastError: string | null }

class PurgeLost extends Error { constructor() { super('purge row is no longer mine'); this.name = 'PurgeLost' } }
async function stillMine(tx: Prisma.TransactionClient, id: string, claim: { at: Date }): Promise<void> {
  const next = new Date(Math.max(Date.now(), claim.at.getTime() + 1))
  const n = await tx.workPurge.updateMany({ where: { id, state: 'purging', claimedAt: claim.at }, data: { claimedAt: next } })
  if (n.count !== 1) throw new PurgeLost()
  claim.at = next
}

async function purgeDeleted(d: PurgeDeps, r: PurgeRow, now: Date, claim: { at: Date }): Promise<boolean> {
  const backstop = now.getTime() - r.createdAt.getTime() > RUN_BACKSTOP_MS
  const pendingSignals = await d.db.workSignal.count({ where: { userId: r.userId, projectId: r.projectId, processedAt: null } })
  if (pendingSignals > 0) return false
  await d.db.$transaction(async (tx) => {
    await stillMine(tx, r.id, claim)
    await tx.workSignal.deleteMany({ where: { userId: r.userId, projectId: r.projectId, processedAt: { not: null } } })
    await tx.workHandoff.deleteMany({ where: { userId: r.userId, fromProjectId: r.projectId } })
    await tx.workEvent.deleteMany({ where: { userId: r.userId, projectId: r.projectId } })
  })
  let runsLeft = false
  if (r.canvasWorkflowIds.length && r.nodeId) {
    const runs = await d.db.flowRun.findMany({ where: { userId: r.userId, workflowId: { in: r.canvasWorkflowIds }, canvasJson: { not: null } }, select: { id: true, status: true, canvasJson: true } })
    for (const run of runs) {
      if (!run.canvasJson || !run.canvasJson.includes(JSON.stringify(r.nodeId))) continue
      if (!DONE_RUN.includes(run.status) && !backstop) { runsLeft = true; continue }
      if (!DONE_RUN.includes(run.status)) console.warn(`[work-purge] 7일 지나도 안 끝난 실행 ${run.id} — 노드 설정만 비움`)
      const next = blankNodeData(run.canvasJson, r.nodeId)
      if (next !== run.canvasJson && (await d.db.flowRun.updateMany({ where: { id: run.id, canvasJson: run.canvasJson }, data: { canvasJson: next } })).count === 0) runsLeft = true
    }
  }
  for (const region of r.blobRegions) { await d.db.$transaction((tx) => stillMine(tx, r.id, claim)); await d.deleteProjectBlobs(region, r.userId, r.projectId) }
  if (runsLeft) return false
  return (await d.db.workSignal.count({ where: { userId: r.userId, projectId: r.projectId } })) === 0
}

const UPLOAD_LATE_WRITE_MS = 60 * 60_000
async function purgeUpload(d: PurgeDeps, r: PurgeRow & { deadline: Date | null }, now: Date, claim: { at: Date }): Promise<boolean> {
  for (const region of r.blobRegions) { await d.db.$transaction((tx) => stillMine(tx, r.id, claim)); await d.deleteProjectBlobs(region, r.userId, r.projectId) }
  return r.lastError === 'SWEPT_ONCE' && !!r.deadline && now.getTime() > r.deadline.getTime() + UPLOAD_LATE_WRITE_MS
}
