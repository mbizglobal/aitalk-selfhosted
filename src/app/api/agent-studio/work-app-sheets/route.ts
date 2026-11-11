
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkOwner } from '@/lib/work/team-access'
import { APP_WORKFLOW_KIND, isWorkAppRow } from '@/lib/work/app-canvas'
import { appTemplateOf } from '@/lib/work/app-templates'
import { builtinSheetTemplates } from '@/lib/work/registry'
import { templateId } from '@/lib/work/sheet-templates'
import { describeCaughtError } from '@/lib/log-mask'
import { ASSEMBLED_KIND, readSpec, specSheetName } from '@/lib/work/assembled'
import { ensureUserDataKey } from '@/lib/user-data-key'

export async function GET(req: NextRequest) {
  try {
    const userId = await resolveWorkOwner()
    if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    const canvasId = req.nextUrl.searchParams.get('canvasWorkflowId') ?? ''
    const nodeId = req.nextUrl.searchParams.get('nodeId') ?? ''
    const hidden = canvasId && nodeId
      ? await prisma.workflow.findFirst({ where: { parentWorkflowId: canvasId, parentNodeId: nodeId, kind: APP_WORKFLOW_KIND, agent: { userId } }, select: { workflowId: true } })
      : null
    if (canvasId && nodeId && !hidden) return NextResponse.json({ sheets: [] })
    const workflowId = hidden?.workflowId ?? req.nextUrl.searchParams.get('workflowId') ?? ''
    const w = workflowId ? await prisma.workflow.findFirst({ where: { workflowId, kind: { in: ['main', APP_WORKFLOW_KIND] }, agent: { userId } }, select: { kind: true, workflowJson: true } }) : null
    if (!w || !isWorkAppRow(w)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    const project = await prisma.workProject.findFirst({ where: { workflowId, userId }, select: { id: true, kind: true } })
    if (project?.kind === ASSEMBLED_KIND) {
      const sp = await readSpec(prisma, await ensureUserDataKey(prisma, userId), { userId, projectId: project.id })
      const tables = (sp?.spec.tables ?? []).filter((t) => !t.hidden)
      const found = tables.length ? await prisma.dataSheet.findMany({ where: { userId, projectId: project.id, kind: 'project', template: null, name: { in: tables.map((t) => specSheetName(t.key)) } }, select: { id: true, name: true } }) : []
      return NextResponse.json({ sheets: tables.flatMap((t) => { const sh = found.find((x) => x.name === specSheetName(t.key)); return sh ? [{ family: `sheet:${sh.id}`, label: t.name }] : [] }) })
    }
    const app = project && project.kind !== 'free' ? appTemplateOf(project.kind) : null
    if (!app) return NextResponse.json({ sheets: [] })
    const templates = builtinSheetTemplates()
    const sheets: Array<{ family: string; label: string }> = []
    for (const s of app.sheets) {
      const family = templates.find((t) => templateId(t) === s.template)?.family
      if (family && !sheets.some((x) => x.family === family)) sheets.push({ family, label: s.name || family })
    }
    return NextResponse.json({ sheets })
  } catch (e) {
    console.error('[work-app-sheets] list', describeCaughtError(e))
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 })
  }
}
