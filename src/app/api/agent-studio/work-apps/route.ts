
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkOwner } from '@/lib/work/team-access'
import { listWorkApps } from '@/lib/work/app-chat'
import { describeCaughtError } from '@/lib/log-mask'
import { ASSEMBLED_KIND } from '@/lib/work/assembled'
import { assembledInboxFamilies } from '@/lib/work/inbox'
import { readSpec, specSheetName } from '@/lib/work/assembled'
import { ensureUserDataKey } from '@/lib/user-data-key'

export async function GET() {
  try {
    const userId = await resolveWorkOwner()
    if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    const list = await listWorkApps(prisma, { userId })
    const agents = await prisma.agent.findMany({ where: { userId, agentId: { in: [...new Set(list.map((a) => a.agentId))] } }, select: { agentId: true, title: true } })
    const titles = new Map(agents.map((a) => [a.agentId, a.title]))
    const intake = new Map<string, Array<{ family: string; label: string; identify?: { by: 'phone' | 'telegram'; label: string } }>>()
    const tables = new Map<string, Array<{ family: string; label: string }>>()
    const assembledIds = list.filter((a) => a.projectKind === ASSEMBLED_KIND).map((a) => a.workflowId)
    if (assembledIds.length) {
      const key = await ensureUserDataKey(prisma, userId)
      const projects = await prisma.workProject.findMany({ where: { userId, workflowId: { in: assembledIds } }, select: { id: true, workflowId: true } })
      for (const p of projects) if (p.workflowId) {
        intake.set(p.workflowId, (await assembledInboxFamilies(prisma, key, userId, p.id)).map((f) => ({ family: f.family, label: f.table, ...(f.identify ? { identify: f.identify } : {}) })))
        tables.set(p.workflowId, ((await readSpec(prisma, key, { userId, projectId: p.id }))?.spec.tables ?? []).filter((t) => !t.hidden).map((t) => ({ family: specSheetName(t.key), label: t.name })))
      }
    }
    const apps = list.map((a) => ({
      workflowId: a.workflowId,
      name: a.name,
      agentId: a.agentId,
      agentTitle: titles.get(a.agentId) ?? '',
      appTemplate: a.appTemplate ?? null,
      opened: a.projectKind !== null,
      projectKind: a.projectKind,
      ...(intake.has(a.workflowId) ? { inboxes: intake.get(a.workflowId) } : {}),
      ...(tables.has(a.workflowId) ? { tables: tables.get(a.workflowId) } : {}),
    }))
    return NextResponse.json({ apps })
  } catch (e) {
    console.error('[work-apps] list', describeCaughtError(e))
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 })
  }
}
