
import { Prisma, type PrismaClient } from '@prisma/client'
import type { WorkFileDeps } from './files'
import { decryptJson } from './sealed'
import type { SheetActor } from './sheet-gate'
import { WorkError } from './errors'
import { moduleHandles } from './handles'
import type { SendRefCtx, WorkAppPackage } from './package'

type Registry = { packages: readonly WorkAppPackage[] }

async function packageOf(kind: string, registry?: Registry): Promise<WorkAppPackage | null> {
  if (kind === 'free') return null
  const packages = registry?.packages ?? (await import('./registry')).workAppRegistry().packages
  return packages.find((p) => p.appTemplates.some((a) => a.kind === kind)) ?? null
}

function refCtx(deps: WorkFileDeps, userId: string, projectId: string, pkgId: string): SendRefCtx {
  const actor: SheetActor = { type: 'module', id: `${pkgId}.send-refs`, version: 1 }
  const h = moduleHandles({ deps, userId, projectId, caller: actor, writeAs: actor }, async () => {
    throw new Error('send-ref hooks do not run modules')
  })
  return { sheets: h.sheets, files: h.files, userId, projectId }
}

export async function refOpen(s: { deps: WorkFileDeps; userId: string; projectId: string; registry?: Registry }, kind: string, ref: string, attachFileIds: readonly string[], refKey: string | null = null): Promise<boolean> {
  const p = await packageOf(kind, s.registry)
  if (!p?.sendRefs) return true
  return p.sendRefs.canSend(refCtx(s.deps, s.userId, s.projectId, p.id), { ref, attachFileIds, key: refKey })
}

const BATCH = 20

export async function processSendSignals(deps: WorkFileDeps & { db: PrismaClient }, opts: { onlyUserId?: string; registry?: Registry } = {}): Promise<number> {
  const ids = await deps.db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT s.id FROM work_signal s LEFT JOIN workflows w ON w."workflowId" = s.app_workflow_id
    WHERE s.processed_at IS NULL AND s.kind = 'send_sent' AND NOT (COALESCE(w.kind, '') = 'app' AND w.status <> 'production')
    ${opts.onlyUserId ? Prisma.sql`AND s.user_id = ${opts.onlyUserId}` : Prisma.empty}
    ORDER BY s.created_at ASC LIMIT ${BATCH}`)
  const sigs = ids.length
    ? await deps.db.workSignal.findMany({ where: { id: { in: ids.map((x) => x.id) } }, orderBy: { createdAt: 'asc' }, select: { id: true, userId: true, projectId: true, payload: true } })
    : []
  let n = 0
  for (const s of sigs) {
    try {
      const project = await deps.db.workProject.findFirst({ where: { id: s.projectId, userId: s.userId }, select: { kind: true } })
      const pkg = project ? await packageOf(project.kind, opts.registry) : null
      if (pkg?.sendRefs) {
        const p = decryptJson<{ sendId: string; ref: string; sentAt: string; how: 'mail' | 'manual'; attachFileIds?: string[] }>(s.payload, await deps.dataKey(deps.db, s.userId))
        try {
          await pkg.sendRefs.afterSent(refCtx(deps, s.userId, s.projectId, pkg.id), { ref: p.ref, sendId: p.sendId, sentAt: p.sentAt, how: p.how, attachFileIds: Array.isArray(p.attachFileIds) ? p.attachFileIds : null })
        } catch (e) {
          if (e instanceof WorkError && e.code === 'APP_CLOSED') continue
          if (!(e instanceof WorkError && (e.code === 'NOT_FOUND' || e.code === 'READ_ONLY'))) throw e
        }
      }
      await deps.db.workSignal.updateMany({ where: { id: s.id, processedAt: null }, data: { processedAt: new Date() } })
      n++
    } catch (e) {
      console.error(`[send-refs] 보낸 뒤 걸이 실패 — 다음 주기에 다시 (${s.id}):`, e instanceof Error ? e.message.slice(0, 200) : 'error')
    }
  }
  return n
}
