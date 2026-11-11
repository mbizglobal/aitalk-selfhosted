
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkOwner } from '@/lib/work/team-access'
import { APP_WORKFLOW_KIND } from '@/lib/work/app-canvas'
import { describeCaughtError } from '@/lib/log-mask'
import { receiverProblem } from '@/lib/work/handoff'
import { acceptsHandoff } from '@/lib/work/handoff-core'
import { appTemplateOf, appliesWithoutSettings } from '@/lib/work/app-templates'
import { appStartSettings } from '@/lib/work/app-chat'
import { normAppTemplate, projectOfHiddenApp, templateLockOf, type TemplateLock } from '@/lib/work/app-template-lock'

export async function GET(req: NextRequest) {
  try {
    const userId = await resolveWorkOwner()
    if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    const workflowId = req.nextUrl.searchParams.get('workflowId') ?? ''
    const canvas = workflowId ? await prisma.workflow.findFirst({ where: { workflowId, agent: { userId } }, select: { workflowId: true, workflowJson: true } }) : null
    if (!canvas) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    const rows = await prisma.workflow.findMany({ where: { parentWorkflowId: workflowId, kind: APP_WORKFLOW_KIND }, select: { workflowId: true, parentNodeId: true, status: true, workflowJson: true, appProjectId: true } })
    const apps = await Promise.all(rows.map(async (r) => ({
      nodeId: r.parentNodeId, workflowId: r.workflowId, status: r.status,
      handoff: (await receiverProblem(prisma, userId, r.workflowId))?.code ?? 'ready',
      templateLock: await lockOfApp(userId, r),
    })))
    const readyOnDeploy = readyOnDeployOf(canvas.workflowJson, new Set(rows.map((r) => r.parentNodeId)))
    const own = rows.length ? null : await prisma.workProject.findFirst({ where: { userId, workflowId }, select: { id: true, kind: true } })
    const self: TemplateLock | null = own ? await templateLockOf(prisma, own, normAppTemplate(appStartSettings(canvas.workflowJson).appTemplate)) : null
    return NextResponse.json({ apps, self, readyOnDeploy })
  } catch (e) {
    console.error('[work-app-nodes] list', describeCaughtError(e))
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 })
  }
}

async function lockOfApp(userId: string, r: { workflowId: string; workflowJson: string; appProjectId: string | null }): Promise<TemplateLock | null> {
  const p = await projectOfHiddenApp(prisma, userId, r)
  return p ? templateLockOf(prisma, p, normAppTemplate(appStartSettings(r.workflowJson).appTemplate)) : null
}

function readyOnDeployOf(workflowJson: string, hasApp: ReadonlySet<string | null>): string[] {
  let nodes: unknown
  try { nodes = (JSON.parse(workflowJson) as { nodes?: unknown }).nodes } catch { return [] }
  if (!Array.isArray(nodes)) return []
  const out: string[] = []
  for (const n of nodes as Array<{ id?: unknown; data?: { nodeType?: unknown; appTemplate?: unknown } | null }>) {
    if (typeof n?.id !== 'string' || hasApp.has(n.id) || n.data?.nodeType !== 'workApp' || typeof n.data.appTemplate !== 'string' || !n.data.appTemplate) continue
    let tpl = null
    try { tpl = appTemplateOf(n.data.appTemplate) } catch { tpl = null }
    if (tpl && acceptsHandoff(tpl) && appliesWithoutSettings(tpl)) out.push(n.id)
  }
  return out
}
