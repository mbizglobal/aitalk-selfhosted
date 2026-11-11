
import type { Prisma, PrismaClient } from '@prisma/client'
import { appStartSettings, checkWorkAppGraph } from './app-chat'
import { APP_AI_KEYS, APP_START_KEYS, APP_WORKFLOW_KIND, WORK_APP_NODE, appKeyOf, buildAppGraph, isAppCanvas, isLegacyAppWorkflow } from './app-canvas'
import { resolveNodeType } from '@/lib/workflow/engine/resolve-node-type'
import { APP_TRIGGER } from '@/lib/workflow/start-trigger'

type Tx = Prisma.TransactionClient

const SLOT_KINDS = ['database', 'http'] as const
export const MIGRATED_NODE_ID = 'app'

export interface MigrateResult {
  workflowId: string
  status: 'migrated' | 'skipped'
  canvasWorkflowId?: string
  cloned?: string[]
}

type Row = { workflowId: string; agentId: string; name: string; status: string; kind: string; workflow_json: string; parent_workflow_id: string | null; version: number }

export class MigrateRefused extends Error {}

function aiNodeCount(json: string): number {
  try {
    const g = JSON.parse(json) as { nodes?: unknown[] }
    return (g.nodes ?? []).filter((n) => resolveNodeType(n as never) === 'ai').length
  } catch { return 0 }
}

function nodeDataOf(json: unknown, name: string, connections: Record<string, Record<string, string>>): Record<string, unknown> {
  const g = (typeof json === 'string' ? JSON.parse(json) : json) as { nodes?: Array<{ type?: unknown; data?: Record<string, unknown> }> }
  const nodes = g.nodes ?? []
  const start = nodes.find((n) => resolveNodeType(n as never) === 'start' && n.data?.triggerType === APP_TRIGGER)?.data ?? {}
  const ai = nodes.find((n) => resolveNodeType(n as never) === 'ai')?.data ?? {}
  const data: Record<string, unknown> = { label: name, nodeType: WORK_APP_NODE }
  for (const k of APP_START_KEYS) if (start[k] !== undefined && start[k] !== null && start[k] !== '') data[k] = start[k]
  if (Object.keys(connections).length) data.connections = connections
  else delete data.connections
  const aiData: Record<string, unknown> = {}
  for (const k of APP_AI_KEYS) if (ai[k] !== undefined && ai[k] !== null && ai[k] !== '') aiData[k] = ai[k]
  data.ai = aiData
  return data
}

async function sharedElsewhere(tx: Tx, agentId: string, selfWorkflowId: string, connectionId: string): Promise<boolean> {
  const others = await tx.workflow.findMany({ where: { agentId, workflowId: { not: selfWorkflowId }, kind: { in: ['main', APP_WORKFLOW_KIND] } }, select: { kind: true, workflowJson: true } })
  return others.some((w) => {
    if (w.kind === 'main' && !isLegacyAppWorkflow(w.workflowJson)) {
      if (!isAppCanvas(w.workflowJson)) return false
      try {
        const g = JSON.parse(w.workflowJson) as { nodes?: Array<{ data?: Record<string, unknown> }> }
        return (g.nodes ?? []).some((n) => n.data?.nodeType === WORK_APP_NODE && Object.values((n.data?.connections ?? {}) as Record<string, Record<string, string>>).some((slots) => Object.values(slots ?? {}).includes(connectionId)))
      } catch { return false }
    }
    return Object.values(appStartSettings(w.workflowJson).connections).some((slots) => Object.values(slots).includes(connectionId))
  })
}

export async function migrateLegacyWorkApp(db: PrismaClient, workflowId: string, newWorkflowId: () => string): Promise<MigrateResult> {
  const pre = await db.workflow.findUnique({ where: { workflowId }, select: { agentId: true, agent: { select: { userId: true } } } })
  if (!pre) return { workflowId, status: 'skipped' }
  const userId = pre.agent.userId
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(4202, hashtext(${userId}))`
    const agent = await tx.$queryRaw<Array<{ agentId: string }>>`SELECT "agentId" FROM agents WHERE "agentId" = ${pre.agentId} FOR UPDATE`
    if (!agent.length) return { workflowId, status: 'skipped' as const }
    await tx.$queryRaw`SELECT id FROM "user" WHERE id = ${userId} FOR NO KEY UPDATE`
    const rows = await tx.$queryRaw<Row[]>`
      SELECT "workflowId", "agentId", name, status, kind, workflow_json, parent_workflow_id, version FROM workflows WHERE "workflowId" = ${workflowId} FOR UPDATE`
    const cur = rows[0]
    if (!cur || cur.kind !== 'main' || cur.parent_workflow_id || !isLegacyAppWorkflow(cur.workflow_json)) return { workflowId, status: 'skipped' as const }
    if (aiNodeCount(cur.workflow_json) > 1) throw new MigrateRefused('more than one AI node — kept in the old shape; rebuild it as Work app nodes')
    const why = checkWorkAppGraph(cur.workflow_json)
    if (why) throw new MigrateRefused(`not a valid work app graph (${why}) — kept in the old shape`)
    const project = (await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM work_project WHERE workflow_id = ${workflowId} AND user_id = ${userId} FOR UPDATE`)[0] ?? null

    const canvasId = newWorkflowId()
    const key = appKeyOf(canvasId, MIGRATED_NODE_ID)

    const settings = appStartSettings(cur.workflow_json)
    const connections: Record<string, Record<string, string>> = JSON.parse(JSON.stringify(settings.connections))
    const cloned: string[] = []
    for (const kind of SLOT_KINDS) {
      for (const [slot, id] of Object.entries(connections[kind] ?? {})) {
        const c = await tx.workflowConnection.findFirst({ where: { id, agentId: cur.agentId } })
        if (!c) continue
        const label = `${key}:${slot}`
        if (await sharedElsewhere(tx, cur.agentId, workflowId, id)) {
          const copy = await tx.workflowConnection.create({
            data: {
              userId: c.userId, agentId: c.agentId, provider: c.provider, label, description: c.description, transport: c.transport, authType: c.authType,
              serviceConfig: c.serviceConfig ?? undefined, encryptedToken: c.encryptedToken, status: c.status,
            },
            select: { id: true },
          })
          connections[kind][slot] = copy.id
          cloned.push(`${kind}:${slot}`)
        } else if (c.label !== label) {
          await tx.workflowConnection.update({ where: { id: c.id }, data: { label } })
        }
      }
    }

    const node = { id: MIGRATED_NODE_ID, type: 'custom', position: { x: 400, y: 300 }, data: nodeDataOf(cur.workflow_json, cur.name, connections) }
    const canvas = {
      nodes: [{ id: 'start', type: 'custom', position: { x: 100, y: 300 }, data: { label: 'Start / App', nodeType: 'start', triggerType: APP_TRIGGER, showLeftHandle: false } }, node],
      edges: [{ id: 'edge-start-app', source: 'start', target: MIGRATED_NODE_ID, type: 'default' }],
    }
    await tx.workflow.create({ data: { workflowId: canvasId, agentId: cur.agentId, name: cur.name, status: cur.status, trafficWeight: cur.status === 'production' ? 100 : 0, workflowJson: JSON.stringify(canvas) } })
    await tx.workflowGroupItem.updateMany({ where: { workflowId }, data: { workflowId: canvasId } })
    await tx.workflow.update({
      where: { workflowId },
      data: { kind: APP_WORKFLOW_KIND, parentWorkflowId: canvasId, parentNodeId: MIGRATED_NODE_ID, appProjectId: project?.id ?? null, workflowJson: buildAppGraph(canvasId, node), version: cur.version + 1 },
    })
    return { workflowId, status: 'migrated' as const, canvasWorkflowId: canvasId, ...(cloned.length ? { cloned } : {}) }
  }, { timeout: 30_000 })
}

export async function migrateLegacyWorkApps(db: PrismaClient, newWorkflowId: () => string, opts: { userId?: string } = {}): Promise<{ migrated: MigrateResult[]; failed: Array<{ workflowId: string; error: string }> }> {
  const candidates = await db.workflow.findMany({
    where: { kind: 'main', parentWorkflowId: null, ...(opts.userId ? { agent: { userId: opts.userId } } : {}) },
    select: { workflowId: true, workflowJson: true },
    orderBy: { workflowId: 'asc' },
  })
  const migrated: MigrateResult[] = []
  const failed: Array<{ workflowId: string; error: string }> = []
  for (const w of candidates) {
    if (!isLegacyAppWorkflow(w.workflowJson)) continue
    try {
      const r = await migrateLegacyWorkApp(db, w.workflowId, newWorkflowId)
      if (r.status === 'migrated') migrated.push(r)
    } catch (e) {
      failed.push({ workflowId: w.workflowId, error: e instanceof Error ? e.message.slice(0, 200) : 'error' })
    }
  }
  return { migrated, failed }
}
