
import { Prisma, PrismaClient } from '@prisma/client'
import { appNodesOf, APP_WORKFLOW_KIND, isLegacyAppWorkflow } from './app-canvas'
import { appStartSettings } from './app-chat'

type Db = Prisma.TransactionClient | PrismaClient

export const normAppTemplate = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

export async function projectUsed(db: Db, projectId: string): Promise<boolean> {
  const r = await db.$queryRaw<Array<{ used: boolean }>>`
    SELECT (
      EXISTS (SELECT 1 FROM work_task WHERE project_id = ${projectId})
      OR EXISTS (SELECT 1 FROM work_file WHERE project_id = ${projectId})
      OR EXISTS (SELECT 1 FROM work_message WHERE project_id = ${projectId})
      OR EXISTS (SELECT 1 FROM work_note WHERE project_id = ${projectId})
      OR EXISTS (SELECT 1 FROM data_sheet_rows WHERE project_id = ${projectId})
      OR EXISTS (SELECT 1 FROM work_send WHERE project_id = ${projectId})
      OR EXISTS (SELECT 1 FROM work_handoff WHERE to_project_id = ${projectId} OR from_project_id = ${projectId})
      OR EXISTS (SELECT 1 FROM project_reference WHERE from_project_id = ${projectId} OR to_project_id = ${projectId})
      OR EXISTS (SELECT 1 FROM work_event WHERE project_id = ${projectId} AND NOT (actor LIKE 'flow:%' AND action = 'template_apply') AND action <> 'backup_download')
    ) AS used`
  return r[0]?.used === true
}

export function allowedTemplates(deployed: string, projectKind: string): string[] {
  const out = [normAppTemplate(deployed)]
  const k = normAppTemplate(projectKind)
  if (k && k !== 'free' && !out.includes(k)) out.push(k)
  return out
}

export interface TemplateLock {
  allowed: string[]
  reason: 'in_use' | 'tasks_before_apply'
}

export async function templateLockOf(db: Db, project: { id: string; kind: string }, deployed: string): Promise<TemplateLock | null> {
  if (!(await projectUsed(db, project.id))) return null
  const allowed = allowedTemplates(deployed, project.kind)
  let reason: TemplateLock['reason'] = 'in_use'
  if (normAppTemplate(project.kind) === 'free' && normAppTemplate(deployed)) {
    const tasks = await db.workTask.count({ where: { projectId: project.id } })
    if (tasks > 0) reason = 'tasks_before_apply'
  }
  return { allowed, reason }
}

export async function projectOfHiddenApp(db: Db, userId: string, h: { workflowId: string; appProjectId: string | null }): Promise<{ id: string; kind: string } | null> {
  const linked = await db.workProject.findFirst({ where: { userId, workflowId: h.workflowId }, select: { id: true, kind: true } })
  if (linked) return linked
  if (!h.appProjectId) return null
  return db.workProject.findFirst({ where: { userId, id: h.appProjectId, workflowId: null }, select: { id: true, kind: true } })
}

export interface TemplateLockProblem { nodeId: string; value: string; allowed: string[] }

export async function templateLockProblems(db: Db, input: { userId: string; workflowId: string; kind: string; workflowJson: unknown; savedJson: string }): Promise<TemplateLockProblem[]> {
  if (input.kind === APP_WORKFLOW_KIND) return []
  const nodes = appNodesOf(input.workflowJson)
  const problems: TemplateLockProblem[] = []
  if (nodes.length) {
    const hidden = await db.workflow.findMany({
      where: { parentWorkflowId: input.workflowId, kind: APP_WORKFLOW_KIND, parentNodeId: { in: nodes.map((n) => n.id) } },
      select: { workflowId: true, parentNodeId: true, workflowJson: true, appProjectId: true },
    })
    for (const h of hidden) {
      const project = await projectOfHiddenApp(db, input.userId, h)
      if (!project) continue
      const node = nodes.find((n) => n.id === h.parentNodeId)
      const value = normAppTemplate(node?.data?.appTemplate)
      const lock = await templateLockOf(db, project, normAppTemplate(appStartSettings(h.workflowJson).appTemplate))
      if (lock && !lock.allowed.includes(value)) problems.push({ nodeId: h.parentNodeId as string, value, allowed: lock.allowed })
    }
    return problems
  }
  if (!isLegacyAppWorkflow(input.workflowJson)) return []
  await db.$queryRaw`SELECT id FROM "user" WHERE id = ${input.userId} FOR NO KEY UPDATE`
  const rows = await db.$queryRaw<Array<{ id: string; kind: string }>>`SELECT id, kind FROM work_project WHERE user_id = ${input.userId} AND workflow_id = ${input.workflowId} FOR UPDATE`
  const project = rows[0]
  if (!project) return []
  const value = normAppTemplate(appStartSettings(input.workflowJson).appTemplate)
  const lock = await templateLockOf(db, project, normAppTemplate(appStartSettings(input.savedJson).appTemplate))
  if (lock && !lock.allowed.includes(value)) problems.push({ nodeId: 'start', value, allowed: lock.allowed })
  return problems
}

export function templateLockMessage(p: TemplateLockProblem[]): string {
  return `This work app is already in use, so its app template can no longer be changed (${p.map((x) => `${x.nodeId}: allowed ${x.allowed.map((a) => a || '(choose in chat)').join(' / ')}`).join('; ')}). Add another Work app node for a different app.`
}
