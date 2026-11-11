
import { appTemplateOf } from './app-templates'
import { linkedApps } from './linked-apps'
import { decryptJson } from './sealed'
import type { ProjectSettings } from './projects'
import type { WorkSheetDeps } from './sheet-gate'
import { memberOf, type WorkTeamAccess } from './team-access'

export interface PeerSettings {
  name: string
  kind: string
  url: string
  values: Record<string, unknown>
}

export async function readPeerSettings(deps: Pick<WorkSheetDeps, 'db' | 'dataKey'>, access: WorkTeamAccess, projectId: string): Promise<PeerSettings[]> {
  const p = await deps.db.workProject.findFirst({ where: { id: projectId, userId: access.userId, agentId: access.agentId }, select: { kind: true } })
  const wanted = p ? appTemplateOf(p.kind)?.ui.peerSettings ?? [] : []
  if (!wanted.length) return []
  const apps = (await linkedApps(deps.db, { userId: access.userId, projectId, onlyAgentId: access.agentId, ...memberOf(access) })).filter((a) => wanted.some((w) => w.kind === a.kind))
  if (!apps.length) return []
  const projects = await deps.db.workProject.findMany({ where: { userId: access.userId, workflowId: { in: apps.map((a) => a.workflowId) } }, select: { workflowId: true, settings: true } })
  const key = await deps.dataKey(deps.db, access.userId)
  const out: PeerSettings[] = []
  for (const a of apps) {
    const fields = wanted.find((w) => w.kind === a.kind)!.fields
    const raw = projects.find((x) => x.workflowId === a.workflowId)?.settings
    const all: Record<string, unknown> = raw ? decryptJson<ProjectSettings>(raw, key) : {}
    out.push({ name: a.name, kind: a.kind, url: `${a.url}&view=setup`, values: Object.fromEntries(fields.map((f) => [f, all[f] ?? null])) })
  }
  return out
}
