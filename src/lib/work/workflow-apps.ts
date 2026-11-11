
import { Prisma, PrismaClient } from '@prisma/client'
import { APP_WORKFLOW_KIND, appNodesOf, isAppCanvas, isLegacyAppWorkflow, linkNodesOf, linkTargetOf } from './app-canvas'
import { listManagedApps, type ManagedApp } from './app-admin'
import { liveSendingCount } from './sends'
import { linkingCanvases } from './shared-apps'

type Tx = Prisma.TransactionClient
type Db = Tx | PrismaClient

export async function workflowAppProjectIds(db: Db, userId: string, workflowId: string): Promise<string[]> {
  const hidden = await db.workflow.findMany({ where: { parentWorkflowId: workflowId, kind: APP_WORKFLOW_KIND }, select: { workflowId: true, appProjectId: true } })
  const linked = await db.workProject.findMany({ where: { userId, status: 'active', workflowId: { in: [workflowId, ...hidden.map((h) => h.workflowId)] } }, select: { id: true, workflowId: true } })
  const remembered = hidden.filter((h) => h.appProjectId && !linked.some((p) => p.workflowId === h.workflowId)).map((h) => h.appProjectId as string)
  const loose = remembered.length ? await db.workProject.findMany({ where: { userId, status: 'active', workflowId: null, id: { in: remembered } }, select: { id: true } }) : []
  return [...new Set([...linked.map((p) => p.id), ...loose.map((p) => p.id)])]
}

export interface CardApp { projectId: string; name: string; state: ManagedApp['state']; appWorkflowId: string | null; agentId: string | null }
export interface CardLink { name: string; projectId: string | null; state: ManagedApp['state']; appWorkflowId: string | null; agentId: string | null }
export interface WorkflowWorkApp {
  apps: CardApp[]
  links: CardLink[]
  undeployedNodes: boolean
}

const STATE_ORDER: Record<string, number> = { live: 0, paused: 1, removed: 2, orphan: 3 }

export async function workflowCardsWorkApps(db: Db, userId: string, key: Buffer, agentId: string, workflows: ReadonlyArray<{ workflowId: string; workflowJson: string; kind?: string | null }>): Promise<Record<string, WorkflowWorkApp>> {
  const groups = await listManagedApps(db, userId, key, { agentId })
  const byId = new Map(groups.map((g) => [g.id, g]))
  const targets = [...new Set(workflows.flatMap((w) => linkNodesOf(w.workflowJson).map((n) => linkTargetOf(n)).filter((x): x is string => !!x)))]
  const ledgers = targets.length ? await db.workflow.findMany({ where: { workflowId: { in: targets }, kind: APP_WORKFLOW_KIND, agent: { userId } }, select: { workflowId: true, agentId: true, name: true, status: true, appProjectId: true } }) : []
  const ledgerProjects = ledgers.length ? await db.workProject.findMany({
    where: { userId, status: 'active', OR: [{ workflowId: { in: ledgers.map((l) => l.workflowId) } }, { workflowId: null, id: { in: ledgers.map((l) => l.appProjectId).filter((x): x is string => !!x) } }] },
    select: { id: true, workflowId: true },
  }) : []

  const out: Record<string, WorkflowWorkApp> = {}
  for (const w of workflows) {
    if (w.kind === 'sub') continue
    const g = byId.get(w.workflowId)
    const isCard = !!g || isAppCanvas(w.workflowJson) || isLegacyAppWorkflow(w.workflowJson)
    if (!isCard) continue
    const apps = (g?.apps ?? [])
      .map((a, i) => ({ a, i }))
      .sort((x, y) => (STATE_ORDER[x.a.state] ?? 9) - (STATE_ORDER[y.a.state] ?? 9) || x.i - y.i)
      .map(({ a }) => ({ projectId: a.projectId, name: a.name, state: a.state, appWorkflowId: a.appWorkflowId, agentId: a.agentId }))
    const withApp = new Set((g?.apps ?? []).map((a) => a.nodeId).filter((x): x is string => !!x))
    const ownNodes = appNodesOf(w.workflowJson)
    const undeployedNodes = ownNodes.some((n) => !withApp.has(n.id)) || (isLegacyAppWorkflow(w.workflowJson) && apps.length === 0)
    const links: CardLink[] = linkNodesOf(w.workflowJson).map((n) => {
      const t = linkTargetOf(n)
      const l = t ? ledgers.find((x) => x.workflowId === t) : undefined
      const label = String((n.data as Record<string, unknown> | undefined)?.label ?? '') || l?.name || 'Bank ledger'
      const p = l ? (ledgerProjects.find((x) => x.workflowId === l.workflowId) ?? ledgerProjects.find((x) => x.workflowId === null && x.id === l.appProjectId)) : undefined
      if (!l || !p) return { name: label, projectId: null, state: 'orphan', appWorkflowId: null, agentId: null }
      const live = l.status === 'production' && p.workflowId === l.workflowId
      return { name: l.name || label, projectId: p.id, state: live ? 'live' : 'paused', appWorkflowId: l.workflowId, agentId: l.agentId }
    })
    out[w.workflowId] = { apps, links, undeployedNodes }
  }
  return out
}

export type AppDeleteBlock =
  | { code: 'AWAITING_APPROVAL'; n: number }
  | { code: 'SENDING' }
  | { code: 'SHARED_APP_IN_USE'; canvases: Array<{ workflowId: string; name: string }> }

export interface PopupApp extends CardApp {
  tasks: number
  blocked: AppDeleteBlock | null
  deletesWorkflow: boolean
}
export interface WorkflowDeletePreview {
  workflowId: string
  name: string
  agentId: string
  apps: PopupApp[]
}

export async function workflowDeletePreview(db: Db, userId: string, key: Buffer, workflowId: string): Promise<WorkflowDeletePreview | null> {
  const wf = await db.workflow.findFirst({ where: { workflowId, agent: { userId }, kind: { not: APP_WORKFLOW_KIND } }, select: { workflowId: true, name: true, agentId: true, workflowJson: true } })
  if (!wf) return null
  const g = (await listManagedApps(db, userId, key, { agentId: wf.agentId })).find((x) => x.id === wf.workflowId)
  const legacy = g?.type === 'workflow'
  const hidden = await db.workflow.findMany({ where: { parentWorkflowId: wf.workflowId, kind: APP_WORKFLOW_KIND }, select: { workflowId: true, status: true } })
  const nodes = appNodesOf(wf.workflowJson)
  const rows: Array<PopupApp & { reads: boolean; order: number }> = []
  for (const [i, a] of (g?.apps ?? []).entries()) {
    const awaiting = await db.workTask.count({ where: { projectId: a.projectId, userId, status: 'awaiting' } })
    let blocked: AppDeleteBlock | null = awaiting > 0 ? { code: 'AWAITING_APPROVAL', n: awaiting } : null
    if (!blocked && (await liveSendingCount(db as Tx, a.projectId)) > 0) blocked = { code: 'SENDING' }
    const h = a.appWorkflowId ? hidden.find((x) => x.workflowId === a.appWorkflowId) : undefined
    if (!blocked && h && h.status !== 'archived') {
      const users = await linkingCanvases(db, userId, [h.workflowId], wf.workflowId)
      if (users.length) blocked = { code: 'SHARED_APP_IN_USE', canvases: [...new Map(users.map((u) => [u.workflowId, { workflowId: u.workflowId, name: u.name }])).values()] }
    }
    const deletesWorkflow = legacy || (nodes.every((n) => n.id === a.nodeId) && hidden.every((x) => x.workflowId === a.appWorkflowId))
    const reads = (await db.projectReference.count({ where: { userId, fromProjectId: a.projectId } })) > 0
    rows.push({ projectId: a.projectId, name: a.name, state: a.state, appWorkflowId: a.appWorkflowId, agentId: a.agentId, tasks: a.tasks, blocked, deletesWorkflow, reads, order: i })
  }
  rows.sort((x, y) => Number(y.reads) - Number(x.reads) || (STATE_ORDER[x.state] ?? 9) - (STATE_ORDER[y.state] ?? 9) || x.order - y.order)
  return { workflowId: wf.workflowId, name: wf.name, agentId: wf.agentId, apps: rows.map(({ reads: _r, order: _o, ...a }) => a) }
}
