
import { Prisma } from '@prisma/client'
import { encryptJson } from './sealed'
import { appNameOf, appNodesOf, APP_WORKFLOW_KIND, buildAppGraph, linkNodesOf } from './app-canvas'
import { SYSTEM_APP_TEMPLATE_KINDS } from './app-template-kinds'
import { appStartSettings } from './app-chat'
import { normAppTemplate, templateLockMessage, templateLockOf } from './app-template-lock'
import { assertSharedAppsNotInUseLocked } from './shared-apps'

type Tx = Prisma.TransactionClient

export interface AppSyncApp {
  nodeId: string
  workflowId: string
  projectId: string
  created: boolean
  revived: boolean
  newProject: boolean
}
export interface AppSyncResult {
  apps: AppSyncApp[]
  closed: string[]
  notes: AppSyncNote[]
}
export type AppSyncNote = { code: 'APP_NEW_PROJECT'; nodeId: string; label: string }

type HiddenRow = { workflowId: string; parentNodeId: string; status: string; workflowJson: string; name: string; version: number; appProjectId: string | null }
type ProjectRow = { id: string; workflowId: string | null; workflowLinkedAt: Date | null; kind: string }

async function lockAccount(tx: Tx, userId: string): Promise<void> {
  const u = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "user" WHERE id = ${userId} FOR NO KEY UPDATE`
  if (u.length === 0) throw new AppCanvasError('NOT_FOUND', 'account not found')
}

async function lockHidden(tx: Tx, parentWorkflowId: string): Promise<HiddenRow[]> {
  return tx.$queryRaw<HiddenRow[]>`
    SELECT "workflowId", parent_node_id AS "parentNodeId", status, workflow_json AS "workflowJson", name, version, app_project_id AS "appProjectId"
    FROM workflows WHERE parent_workflow_id = ${parentWorkflowId} AND kind = ${APP_WORKFLOW_KIND}
    ORDER BY "workflowId" FOR UPDATE`
}

async function lockProjects(tx: Tx, userId: string, ids: string[], workflowIds: string[]): Promise<ProjectRow[]> {
  if (!ids.length && !workflowIds.length) return []
  return tx.$queryRaw<ProjectRow[]>`
    SELECT id, workflow_id AS "workflowId", workflow_linked_at AS "workflowLinkedAt", kind FROM work_project
    WHERE user_id = ${userId} AND (id = ANY(${ids}::text[]) OR workflow_id = ANY(${workflowIds}::text[]))
    ORDER BY id FOR UPDATE`
}

async function applyFixedTemplateIfNoSettings(tx: Tx, input: { userId: string; parentWorkflowId: string; key: Buffer }, node: { data?: Record<string, unknown> | null } | undefined, projectId: string): Promise<void> {
  const kind = node?.data?.appTemplate
  if (typeof kind !== 'string' || !kind) return
  const [{ appTemplateOf, appliesWithoutSettings }, { builtinSheetTemplates }, { applyAppTemplateLocked }] = await Promise.all([import('./app-templates'), import('./registry'), import('./projects')])
  const tpl = appTemplateOf(kind)
  if (!tpl || !appliesWithoutSettings(tpl)) return
  await applyAppTemplateLocked(tx, input.key, builtinSheetTemplates(), { userId: input.userId, projectId, kind, settings: {}, actor: { type: 'flow', workflowId: input.parentWorkflowId } })
}

export class AppCanvasError extends Error {
  constructor(readonly code: string, readonly detail: string) {
    super(`APP_CANVAS ${code}: ${detail}`)
    this.name = 'AppCanvasError'
  }
}

export async function syncAppNodesLocked(
  tx: Tx,
  input: { userId: string; agentId: string; parentWorkflowId: string; workflowJson: unknown; key: Buffer; newWorkflowId: () => string },
): Promise<AppSyncResult> {
  const nodes = appNodesOf(input.workflowJson)
  const has = await tx.workflow.count({ where: { parentWorkflowId: input.parentWorkflowId } })
  if (!nodes.length && has === 0) return { apps: [], closed: [], notes: [] }
  await lockAccount(tx, input.userId)
  if (nodes.length && (await tx.workProject.count({ where: { workflowId: input.parentWorkflowId } })) > 0) {
    throw new AppCanvasError('LEGACY_APP_HAS_DATA', 'this workflow is a work app with its own data — Work app nodes cannot be added to it; build the canvas in a new workflow')
  }
  if (nodes.some((n) => SYSTEM_APP_TEMPLATE_KINDS.includes(String(n.data?.appTemplate ?? ''))) && (nodes.length !== 1 || linkNodesOf(input.workflowJson).length > 0)) {
    throw new AppCanvasError('SYSTEM_APP_ALONE', 'this work app stays alone on its canvas — put other work apps on another canvas')
  }
  const hidden = await lockHidden(tx, input.parentWorkflowId)
  const keepNodes = new Set(nodes.map((n) => n.id))
  await assertSharedAppsNotInUseLocked(tx, input.userId, hidden.filter((h) => !keepNodes.has(h.parentNodeId) && h.status !== 'archived').map((h) => h.workflowId), input.parentWorkflowId)
  const byNode = new Map(hidden.map((h) => [h.parentNodeId, h]))
  const notes: AppSyncNote[] = []

  const live: Array<{ nodeId: string; row: HiddenRow; created: boolean; revived: boolean; prevTemplate: string }> = []
  for (const node of [...nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const json = buildAppGraph(input.parentWorkflowId, node)
    const name = appNameOf(node)
    const cur = byNode.get(node.id)
    if (!cur) {
      const workflowId = input.newWorkflowId()
      await tx.workflow.create({
        data: { workflowId, agentId: input.agentId, name, workflowJson: json, status: 'production', trafficWeight: 100, kind: APP_WORKFLOW_KIND, parentWorkflowId: input.parentWorkflowId, parentNodeId: node.id },
      })
      live.push({ nodeId: node.id, row: { workflowId, parentNodeId: node.id, status: 'production', workflowJson: json, name, version: 1, appProjectId: null }, created: true, revived: false, prevTemplate: '' })
      continue
    }
    const revived = cur.status === 'archived'
    if (cur.workflowJson !== json || cur.name !== name || cur.status !== 'production') {
      await tx.workflow.update({
        where: { workflowId: cur.workflowId },
        data: { name, status: 'production', trafficWeight: 100, ...(cur.workflowJson !== json ? { workflowJson: json, version: cur.version + 1 } : {}) },
      })
    }
    live.push({ nodeId: node.id, row: cur, created: false, revived, prevTemplate: normAppTemplate(appStartSettings(cur.workflowJson).appTemplate) })
  }
  const keep = new Set(nodes.map((n) => n.id))
  const gone = hidden.filter((h) => !keep.has(h.parentNodeId))

  const projIds = [...new Set([...live.map((x) => x.row), ...gone].map((r) => r.appProjectId).filter((x): x is string => !!x))]
  const wfIds = [...live.map((x) => x.row.workflowId), ...gone.map((g) => g.workflowId)]
  const projects = await lockProjects(tx, input.userId, projIds, wfIds)
  const byId = new Map(projects.map((p) => [p.id, p]))
  const byWf = new Map(projects.filter((p) => p.workflowId).map((p) => [p.workflowId as string, p]))
  const now = new Date()
  const apps: AppSyncApp[] = []
  for (const x of live) {
    const wfId = x.row.workflowId
    let projectId: string | null = null
    let newProject = false
    const node = nodes.find((n) => n.id === x.nodeId)
    const value = normAppTemplate(node?.data?.appTemplate)
    const assertUnlocked = async (p: ProjectRow): Promise<boolean> => {
      const lock = await templateLockOf(tx, p, x.prevTemplate)
      if (lock && !lock.allowed.includes(value)) {
        throw new AppCanvasError('APP_TEMPLATE_LOCKED', templateLockMessage([{ nodeId: x.nodeId, value, allowed: lock.allowed }]))
      }
      return lock !== null
    }
    let applyFixed = false
    const settle = async (p: ProjectRow): Promise<ProjectRow | undefined> => {
      if ((await assertUnlocked(p)) || value === x.prevTemplate) return p
      if (normAppTemplate(p.kind) !== 'free' && value !== p.kind) {
        await tx.workEvent.deleteMany({ where: { projectId: p.id } })
        await tx.workProject.delete({ where: { id: p.id } })
        byId.delete(p.id)
        return undefined
      }
      if (normAppTemplate(p.kind) === 'free' && value) applyFixed = true
      return p
    }
    const linked = byWf.get(wfId)
    const kept = linked ? await settle(linked) : undefined
    if (kept) projectId = kept.id
    else {
      const prevRow = x.row.appProjectId ? byId.get(x.row.appProjectId) : undefined
      const prev = prevRow && prevRow.workflowId === null ? await settle(prevRow) : prevRow
      if (prev && prev.workflowId === null) {
        await tx.workProject.update({ where: { id: prev.id }, data: { workflowId: wfId, workflowLinkedAt: now } })
        projectId = prev.id
      } else {
        if (prev) notes.push({ code: 'APP_NEW_PROJECT', nodeId: x.nodeId, label: x.row.name })
        const created = await tx.workProject.create({
          data: { userId: input.userId, kind: 'free', modules: [], settings: encryptJson({ name: x.row.name || 'Work app' }, input.key), agentId: input.agentId, workflowId: wfId, workflowLinkedAt: now },
          select: { id: true },
        })
        projectId = created.id
        newProject = true
        await applyFixedTemplateIfNoSettings(tx, input, node, created.id)
      }
    }
    if (applyFixed && projectId) await applyFixedTemplateIfNoSettings(tx, input, node, projectId)
    if (x.row.appProjectId !== projectId) await tx.workflow.update({ where: { workflowId: wfId }, data: { appProjectId: projectId } })
    apps.push({ nodeId: x.nodeId, workflowId: wfId, projectId, created: x.created, revived: x.revived, newProject })
  }

  for (const g of gone) {
    if (g.status !== 'archived') await tx.workflow.update({ where: { workflowId: g.workflowId }, data: { status: 'archived', trafficWeight: 0 } })
    const p = byWf.get(g.workflowId)
    if (p) {
      await tx.workProject.update({ where: { id: p.id }, data: { workflowId: null } })
      if (g.appProjectId !== p.id) await tx.workflow.update({ where: { workflowId: g.workflowId }, data: { appProjectId: p.id } })
    }
  }
  return { apps, closed: gone.map((g) => g.workflowId), notes }
}

export async function closeAppNodesLocked(tx: Tx, input: { userId: string; parentWorkflowId: string; status: 'draft' | 'archived'; workflowJson: unknown }): Promise<void> {
  const has = await tx.workflow.count({ where: { parentWorkflowId: input.parentWorkflowId } })
  if (has === 0) return
  await lockAccount(tx, input.userId)
  const hidden = await lockHidden(tx, input.parentWorkflowId)
  await assertSharedAppsNotInUseLocked(tx, input.userId, hidden.filter((h) => h.status !== 'archived').map((h) => h.workflowId), input.parentWorkflowId)
  const projects = await lockProjects(tx, input.userId, [], hidden.map((h) => h.workflowId))
  const keep = new Set(appNodesOf(input.workflowJson).map((n) => n.id))
  for (const g of hidden.filter((h) => !keep.has(h.parentNodeId))) {
    if (g.status !== 'archived') await tx.workflow.update({ where: { workflowId: g.workflowId }, data: { status: 'archived', trafficWeight: 0 } })
    const p = projects.find((x) => x.workflowId === g.workflowId)
    if (p) {
      await tx.workProject.update({ where: { id: p.id }, data: { workflowId: null } })
      if (g.appProjectId !== p.id) await tx.workflow.update({ where: { workflowId: g.workflowId }, data: { appProjectId: p.id } })
    }
  }
  const ids = hidden.filter((h) => keep.has(h.parentNodeId) && h.status !== 'archived' && h.status !== input.status).map((h) => h.workflowId)
  if (ids.length) await tx.workflow.updateMany({ where: { workflowId: { in: ids } }, data: { status: input.status, trafficWeight: 0 } })
}

export async function hiddenAppIds(db: { workflow: Tx['workflow'] }, parentWorkflowId: string): Promise<Map<string, { workflowId: string; status: string }>> {
  const rows = await db.workflow.findMany({ where: { parentWorkflowId, kind: APP_WORKFLOW_KIND }, select: { workflowId: true, parentNodeId: true, status: true } })
  return new Map(rows.filter((r) => r.parentNodeId).map((r) => [r.parentNodeId as string, { workflowId: r.workflowId, status: r.status }]))
}
