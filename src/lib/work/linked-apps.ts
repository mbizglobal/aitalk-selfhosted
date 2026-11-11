import type { PrismaClient } from '@prisma/client'
import { memberAccess } from '@/lib/memberAccess'

export interface LinkedApp {
  name: string
  kind: string
  workflowId: string
  agentId: string
  url: string
  relation: Array<'reads' | 'readBy' | 'handsTo' | 'receivesFrom'>
  readsSheets?: string[]
}

export async function linkedApps(db: PrismaClient, q: { userId: string; projectId: string; onlyAgentId?: string | null; memberId?: number }): Promise<LinkedApp[]> {
  const rel = new Map<string, Set<LinkedApp['relation'][number]>>()
  const add = (id: string, r: LinkedApp['relation'][number]) => { if (id !== q.projectId) rel.set(id, (rel.get(id) ?? new Set()).add(r)) }
  const refs = await db.projectReference.findMany({ where: { userId: q.userId, OR: [{ fromProjectId: q.projectId }, { toProjectId: q.projectId }] }, select: { fromProjectId: true, toProjectId: true, sheets: true } })
  const readsSheets = new Map<string, Set<string>>()
  for (const r of refs) {
    if (r.fromProjectId === q.projectId) { add(r.toProjectId, 'reads'); continue }
    add(r.fromProjectId, 'readBy')
    readsSheets.set(r.fromProjectId, new Set([...(readsSheets.get(r.fromProjectId) ?? []), ...r.sheets]))
  }
  const hand = await db.workHandoff.findMany({ where: { userId: q.userId, OR: [{ fromProjectId: q.projectId }, { toProjectId: q.projectId }] }, select: { fromProjectId: true, toProjectId: true }, distinct: ['fromProjectId', 'toProjectId'] })
  for (const h of hand) h.fromProjectId === q.projectId ? add(h.toProjectId, 'handsTo') : add(h.fromProjectId, 'receivesFrom')
  if (rel.size === 0) return []
  const projects = await db.workProject.findMany({ where: { id: { in: [...rel.keys()] }, userId: q.userId, workflowId: { not: null } }, select: { id: true, kind: true, workflowId: true } })
  const flows = await db.workflow.findMany({ where: { workflowId: { in: projects.map((p) => p.workflowId!) } }, select: { workflowId: true, agentId: true, name: true } })
  const flowOf = new Map(flows.map((f) => [f.workflowId, f]))
  const access = q.memberId !== undefined && q.onlyAgentId ? await memberAccess(db, q.onlyAgentId, q.memberId) : undefined
  if (access === null) return []
  const out: LinkedApp[] = []
  for (const p of projects) {
    const f = flowOf.get(p.workflowId!)
    if (!f || (q.onlyAgentId && f.agentId !== q.onlyAgentId)) continue
    if (access && !access.workflowIds.has(f.workflowId)) continue
    out.push({ name: f.name, kind: p.kind, workflowId: f.workflowId, agentId: f.agentId, url: `/chat/${encodeURIComponent(f.agentId)}/app?workflowId=${encodeURIComponent(f.workflowId)}`, relation: [...rel.get(p.id)!], ...(readsSheets.has(p.id) ? { readsSheets: [...readsSheets.get(p.id)!] } : {}) })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}
