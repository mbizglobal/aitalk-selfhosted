import type { PrismaClient } from '@prisma/client'
import { Prisma } from '@prisma/client'
import { WorkError } from './errors'
import { encryptJson, decryptJson } from './sealed'
import { applySpecTx, lockAccountForSpec, readSpec, SpecRejected, specRejectedToResult, specSheetName, validateSpec, type AppSpec, type ApplySpecResult, type SpecIssue } from './assembled'
import { describeSpecChange, type SpecChange } from './assembled-change'

export const SPEC_PROPOSAL_TTL_MS = 15 * 60_000

export interface ProposalDeps {
  db: PrismaClient
  dataKey: (db: PrismaClient, userId: string) => Promise<Buffer>
}

export type UpdateAppSpecResult =
  | { ok: true; applied: boolean; dryRun: boolean; version: number; created: string[]; changed: string[]; needsConfirmation?: true; rows?: number; proposal?: { id: string; expiresAt: Date } }
  | { ok: false; issues: SpecIssue[]; currentVersion?: number }

export async function updateAppSpec(deps: ProposalDeps, i: { userId: string; tokenId: string; projectId: string; spec: unknown; expectedVersion: unknown; dryRun?: boolean; now?: Date }): Promise<UpdateAppSpecResult> {
  const first = validateSpec(i.spec)
  if (!first.ok) return first
  const key = await deps.dataKey(deps.db, i.userId)
  return deps.db.$transaction(async (tx): Promise<UpdateAppSpecResult> => {
    const r = await applySpecTx(tx, key, { userId: i.userId, isOwner: true, projectId: i.projectId, spec: i.spec, expectedVersion: i.expectedVersion, dryRun: i.dryRun, requireEmpty: true })
    if (!r.needsConfirmation) return { ok: true, applied: !r.dryRun, dryRun: r.dryRun, version: r.version, created: r.created, changed: r.changed }
    if (i.dryRun) return { ok: true, applied: false, dryRun: true, version: r.version, created: r.created, changed: r.changed, needsConfirmation: true, rows: r.rows }
    const expiresAt = new Date((i.now ?? new Date()).getTime() + SPEC_PROPOSAL_TTL_MS)
    const v = validateSpec(i.spec)
    if (!v.ok) throw new Error('unreachable — spec passed applySpecTx')
    const p = await tx.workAppSpecProposal.create({ data: { userId: i.userId, projectId: i.projectId, tokenId: i.tokenId, baseVersion: r.version, info: encryptJson(v.spec, key), expiresAt }, select: { id: true, expiresAt: true } })
    return { ok: true, applied: false, dryRun: false, version: r.version, created: r.created, changed: r.changed, needsConfirmation: true, rows: r.rows, proposal: p }
  }).catch((e): UpdateAppSpecResult => specRejectedToResult(e) as UpdateAppSpecResult)
}

export type ProposalState = 'pending' | 'applied' | 'canceled' | 'expired' | 'stale'

export interface ProposalView {
  id: string
  projectId: string
  appName: string
  baseVersion: number
  currentVersion: number
  state: ProposalState
  expiresAt: Date
  changes: SpecChange[]
  rows: Array<{ table: string; rows: number; hidden: boolean }>
  appPath: string | null
}

export async function readSpecProposal(deps: ProposalDeps, q: { userId: string; proposalId: string; now?: Date }): Promise<ProposalView | null> {
  const p = await deps.db.workAppSpecProposal.findFirst({ where: { id: q.proposalId, userId: q.userId } })
  if (!p) return null
  const key = await deps.dataKey(deps.db, q.userId)
  const cur = await readSpec(deps.db, key, { userId: q.userId, projectId: p.projectId })
  const next = decryptJson<AppSpec>(p.info, key)
  const project = await deps.db.workProject.findFirst({ where: { id: p.projectId, userId: q.userId }, select: { workflowId: true, workflow: { select: { agentId: true } } } })
  const appPath = project?.workflowId && project.workflow?.agentId ? `/chat/${encodeURIComponent(project.workflow.agentId)}/app?workflowId=${encodeURIComponent(project.workflowId)}` : null
  const currentVersion = cur?.version ?? 0
  const state: ProposalState = p.status === 'applied' ? 'applied' : p.status === 'canceled' ? 'canceled' : p.expiresAt.getTime() < (q.now ?? new Date()).getTime() ? 'expired' : currentVersion !== p.baseVersion ? 'stale' : 'pending'
  const rows = cur ? (await readSpecRowCounts(deps.db, { userId: q.userId, projectId: p.projectId, spec: cur.spec })).map((r) => ({ table: r.name, rows: r.rows, hidden: r.hidden })) : []
  return { id: p.id, projectId: p.projectId, appName: next.name, baseVersion: p.baseVersion, currentVersion, state, expiresAt: p.expiresAt, changes: describeSpecChange(cur?.spec ?? null, next), rows, appPath }
}

export async function readSpecRowCounts(db: PrismaClient | Prisma.TransactionClient, q: { userId: string; projectId: string; spec: AppSpec }): Promise<Array<{ table: string; name: string; hidden: boolean; rows: number; byStatus?: Record<string, number> }>> {
  const out: Array<{ table: string; name: string; hidden: boolean; rows: number; byStatus?: Record<string, number> }> = []
  for (const t of q.spec.tables) {
    const g = await db.$queryRaw<Array<{ s: string | null; n: number }>>(Prisma.sql`
      SELECT r.row_data::jsonb->>'status' AS s, count(*)::int AS n FROM data_sheet_rows r JOIN data_sheets d ON d.id = r.sheet_id
      WHERE d.project_id = ${q.projectId} AND d.user_id = ${q.userId} AND d.kind = 'project' AND d.template IS NULL AND d.name = ${specSheetName(t.key)} GROUP BY 1`)
    const rows = g.reduce((a, x) => a + x.n, 0)
    const byStatus = t.status ? Object.fromEntries(t.status.values.map((v) => [v, g.filter((x) => (x.s === null || x.s === '' ? t.status!.start : x.s) === v).reduce((a, x) => a + x.n, 0)])) : undefined
    out.push({ table: t.key, name: t.name, hidden: !!t.hidden, rows, ...(byStatus ? { byStatus } : {}) })
  }
  return out
}

export type ApproveResult = ApplySpecResult | { ok: false; code: 'NOT_FOUND' | 'EXPIRED' | 'USED' | 'STALE'; message: string; currentVersion?: number }

export async function approveSpecProposal(deps: ProposalDeps, q: { userId: string; proposalId: string; now?: Date }): Promise<ApproveResult> {
  const head = await deps.db.workAppSpecProposal.findFirst({ where: { id: q.proposalId, userId: q.userId }, select: { projectId: true } })
  if (!head) return { ok: false, code: 'NOT_FOUND', message: 'no such change request' }
  const key = await deps.dataKey(deps.db, q.userId)
  const { lockProjectForWrite } = await import('./sheet-gate')
  return deps.db.$transaction(async (tx): Promise<ApproveResult> => {
    await lockAccountForSpec(tx, q.userId)
    await lockProjectForWrite(tx, q.userId, head.projectId)
    const rows = await tx.$queryRaw<Array<{ id: string; status: string; base_version: number; info: Uint8Array; expires_at: Date; consumed_at: Date | null }>>(Prisma.sql`
      SELECT id, status, base_version, info, expires_at, consumed_at FROM work_app_spec_proposal WHERE id = ${q.proposalId} AND user_id = ${q.userId} AND project_id = ${head.projectId} FOR UPDATE`)
    const p = rows[0]
    if (!p) return { ok: false, code: 'NOT_FOUND', message: 'no such change request' }
    if (p.status !== 'pending' || p.consumed_at) return { ok: false, code: 'USED', message: 'this change request was already used or canceled' }
    if (p.expires_at.getTime() < (q.now ?? new Date()).getTime()) return { ok: false, code: 'EXPIRED', message: 'this change request expired — ask for it again' }
    const spec = decryptJson<AppSpec>(Buffer.from(p.info), key)
    let r: Awaited<ReturnType<typeof applySpecTx>>
    try {
      r = await applySpecTx(tx, key, { userId: q.userId, isOwner: true, projectId: head.projectId, spec, expectedVersion: p.base_version })
    } catch (e) {
      if (e instanceof SpecRejected && e.issues.some((x) => x.code === 'STALE')) return { ok: false, code: 'STALE', message: `the app changed after this request (now version ${e.currentVersion}, the request was made on ${p.base_version}) — ask for the change again`, currentVersion: e.currentVersion }
      throw e
    }
    const used = await tx.workAppSpecProposal.updateMany({ where: { id: p.id, status: 'pending', consumedAt: null }, data: { status: 'applied', consumedAt: q.now ?? new Date() } })
    if (used.count !== 1) throw new WorkError('LOCKED', 'the change request changed while applying')
    return r
  }).catch((e): ApproveResult => specRejectedToResult(e))
}

export async function cancelSpecProposal(deps: ProposalDeps, q: { userId: string; proposalId: string; now?: Date }): Promise<boolean> {
  const now = q.now ?? new Date()
  const r = await deps.db.workAppSpecProposal.updateMany({ where: { id: q.proposalId, userId: q.userId, status: 'pending', consumedAt: null, expiresAt: { gte: now } }, data: { status: 'canceled', consumedAt: now } })
  return r.count === 1
}
