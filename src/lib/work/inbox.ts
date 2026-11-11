
import { createHmac } from 'crypto'
import { Prisma } from '@prisma/client'
import { APP_WORKFLOW_KIND, isWorkAppRow } from './app-canvas'
import { WorkError } from './errors'
import { withProjectSheetWrite, isProjectDetached, decodeRow, type WorkSheetDeps } from './sheet-gate'
import { writeInboxSignal } from './signals'
import { usesOfKind, type V3Registry } from './v3-handles'
import { zurichToday } from './dates'
import type { UsesInbox } from './uses'
import { templateId } from './sheet-templates'
import type { PrismaClient } from '@prisma/client'
import { ASSEMBLED_KIND, readSpec, specSheetName, type SpecColumn } from './assembled'

export const INBOX_HOURLY_LIMIT = 60
export const INBOX_READ_LIMIT = 10

export type InboxBy = UsesInbox['identify']['by']
export interface InboxIdentity { by: InboxBy; value: string }

export function phoneIdentity(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (!s.startsWith('+')) return null
  if (/[^\d\s().+-]/.test(s)) return null
  const digits = s.replace(/\D/g, '')
  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null
}

export function telegramIdentity(raw: unknown): string | null {
  const s = typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0 ? String(raw) : raw
  return typeof s === 'string' && /^[1-9]\d{0,19}$/.test(s) ? s : null
}

export function inboxChannelKey(key: Buffer, id: InboxIdentity): string {
  return createHmac('sha256', key).update(`work.inbox\0${id.by}\0${id.value}`).digest('hex')
}

export type InboxFailCode = 'UNAVAILABLE' | 'LOCKED' | 'LIMIT' | 'INVALID' | 'UNIDENTIFIED' | 'TAKEN'
export type InboxResult<T> = ({ ok: true } & T) | { ok: false; code: InboxFailCode; reason?: string }

export interface InboxDecl {
  family: string
  identify?: UsesInbox['identify']
  readable: readonly string[]
  assembled?: { columns: readonly SpecColumn[]; version: number }
}

export interface InboxTarget {
  userId: string
  targetWorkflowId: string
  family: string
  callerWorkflowId: string
  registry?: V3Registry
  assembled?: boolean
  specVersion?: number
}

const fail = (code: InboxFailCode, reason?: string) => ({ ok: false as const, code, reason })

export async function resolveInbox(deps: Pick<WorkSheetDeps, 'db'> & Partial<Pick<WorkSheetDeps, 'dataKey'>>, t: Pick<InboxTarget, 'userId' | 'targetWorkflowId' | 'family' | 'registry' | 'assembled'>): Promise<{ projectId: string; decl: InboxDecl } | null> {
  if (!t.targetWorkflowId || !t.family) return null
  const p = await deps.db.workProject.findFirst({
    where: { workflowId: t.targetWorkflowId, userId: t.userId },
    select: { id: true, kind: true, status: true, workflowId: true, workflowLinkedAt: true },
  })
  if (!p || p.status !== 'active' || isProjectDetached(p)) return null
  if (p.kind === ASSEMBLED_KIND) {
    if (!t.assembled || !deps.dataKey) return null
    const decl = await assembledInbox(deps.db, await deps.dataKey(deps.db as PrismaClient, t.userId), t.userId, p.id, t.family)
    return decl ? { projectId: p.id, decl } : null
  }
  const decl = usesOfKind(p.kind, t.registry)?.uses.inbox?.find((b) => b.family === t.family)
  if (!decl) return null
  return { projectId: p.id, decl }
}

export async function assembledInbox(db: Pick<PrismaClient, 'workAppSpec'> | Prisma.TransactionClient, key: Buffer, userId: string, projectId: string, family: string): Promise<InboxDecl | null> {
  const row = await readSpec(db as PrismaClient, key, { userId, projectId })
  const t = row?.spec.tables.find((x) => specSheetName(x.key) === family)
  if (!row || !t?.intake || t.hidden) return null
  return {
    family,
    ...(t.intake.identify ? { identify: t.intake.identify } : {}),
    readable: [],
    assembled: { columns: t.intake.columns.map((k) => t.columns.find((c) => c.key === k)!).filter(Boolean), version: row.version },
  }
}

export async function assembledInboxFamilies(db: Pick<PrismaClient, 'workAppSpec'>, key: Buffer, userId: string, projectId: string): Promise<Array<{ family: string; table: string; identify?: { by: InboxBy; label: string } }>> {
  const row = await readSpec(db as PrismaClient, key, { userId, projectId })
  return (row?.spec.tables ?? []).filter((t) => t.intake && !t.hidden).map((t) => {
    const id = t.intake!.identify
    return { family: specSheetName(t.key), table: t.name, ...(id ? { identify: { by: id.by, label: t.columns.find((c) => c.key === id.column)?.label ?? id.column } } : {}) }
  })
}

export async function inboxSheets(deps: Pick<WorkSheetDeps, 'db'>, userId: string, projectId: string, decl: InboxDecl) {
  if (!decl.assembled) return familySheets(deps, userId, projectId, decl.family)
  return deps.db.dataSheet.findMany({ where: { kind: 'project', projectId, userId, name: decl.family, template: null }, select: { id: true, name: true }, orderBy: { id: 'asc' } })
}

export async function familySheets(deps: Pick<WorkSheetDeps, 'db'>, userId: string, projectId: string, family: string) {
  return deps.db.dataSheet.findMany({
    where: { kind: 'project', projectId, userId, templateFamily: family },
    select: { id: true, name: true },
    orderBy: { id: 'asc' },
  })
}

export async function addInboxRow(
  deps: WorkSheetDeps,
  t: InboxTarget,
  values: unknown,
  identity: InboxIdentity | null,
): Promise<InboxResult<{ rowId: string }>> {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return fail('INVALID', 'values must be an object of column names')
  const target = await resolveInbox(deps, t)
  if (!target) return fail('UNAVAILABLE')
  const { projectId, decl } = target
  const sheets = await inboxSheets(deps, t.userId, projectId, decl)
  if (!sheets.length) return fail('UNAVAILABLE')

  const data: Record<string, unknown> = { ...(values as Record<string, unknown>) }
  const me = identity && decl.identify && identity.by === decl.identify.by && identity.value ? identity : null
  if (decl.identify && !decl.assembled) delete data[decl.identify.column]
  if (me && decl.identify) data[decl.identify.column] = me.value

  try {
    const rowId = await withProjectSheetWrite(
      deps,
      { userId: t.userId, projectId, sheetIds: sheets.map((s) => s.id), actor: { type: 'channel', workflowId: t.callerWorkflowId } },
      async (w) => {
        const still = await w.withTx((tx) => tx.workProject.count({ where: { id: projectId, userId: t.userId, workflowId: t.targetWorkflowId } }))
        if (!still) throw new WorkError('NOT_FOUND')
        if (decl.assembled) {
          const v = await w.withTx((tx) => tx.workAppSpec.findFirst({ where: { userId: t.userId, projectId }, select: { version: true } }))
          if (!v || v.version !== decl.assembled.version || (t.specVersion !== undefined && v.version !== t.specVersion)) throw new WorkError('NOT_FOUND')
        }
        const now = decl.assembled
          ? await w.withTx((tx) => tx.dataSheet.findMany({ where: { kind: 'project', projectId, userId: t.userId, name: decl.family, template: null }, select: { id: true }, orderBy: { id: 'asc' } }))
          : await w.sheetsOfFamily(t.family)
        if (!now.length) throw new WorkError('NOT_FOUND')
        const sheet = sheets.find((s) => s.id === now[0].id)
        if (!sheet) throw new WorkError('NOT_FOUND')
        const recent = await w.countChannelInserts(new Date(Date.now() - 3600_000))
        if (recent >= INBOX_HOURLY_LIMIT) throw new InboxLimit()
        const key = await deps.dataKey(deps.db, t.userId)
        const row = await w.insert(sheet.id, data, { channelKey: me ? inboxChannelKey(key, me) : null })
        await w.withTx((tx) => writeInboxSignal(tx, key, { userId: t.userId, projectId, title: sheet.name, rowId: row.id, family: t.family }))
        return row.id
      },
    )
    return { ok: true, rowId }
  } catch (e) {
    if (e instanceof InboxLimit) return fail('LIMIT')
    if (e instanceof WorkError) {
      if (e.code === 'LOCKED') return fail('LOCKED')
      if (e.code === 'CHECK_FAILED') return fail('TAKEN')
      if (e.code === 'INVALID' || e.code === 'DUPLICATE') return fail('INVALID', e.message)
      if (e.code === 'NOT_FOUND' || e.code === 'READ_ONLY' || e.code === 'APP_CLOSED') return fail('UNAVAILABLE')
    }
    throw e
  }
}

class InboxLimit extends Error {}

const isEmpty = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && !v.trim())

export async function readMyInboxRows(
  deps: WorkSheetDeps,
  t: InboxTarget,
  identity: InboxIdentity | null,
): Promise<InboxResult<{ rows: Array<Record<string, unknown>> }>> {
  const target = await resolveInbox(deps, t)
  if (!target) return fail('UNAVAILABLE')
  const { projectId, decl } = target
  if (decl.assembled || !decl.identify) return fail('UNAVAILABLE')
  if (!identity || identity.by !== decl.identify.by || !identity.value) return fail('UNIDENTIFIED')
  const sheets = await familySheets(deps, t.userId, projectId, t.family)
  if (!sheets.length) return fail('UNAVAILABLE')
  const key = await deps.dataKey(deps.db, t.userId)
  const rows = await deps.db.dataSheetRow.findMany({
    where: { kind: 'project', projectId, userId: t.userId, sheetId: { in: sheets.map((s) => s.id) }, channelKey: inboxChannelKey(key, identity) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: INBOX_READ_LIMIT,
  })
  return {
    ok: true,
    rows: rows.map((r) => {
      const v = decodeRow(r, key)
      const out: Record<string, unknown> = { receivedAt: zurichToday(v.createdAt) }
      for (const c of decl.readable) if (!isEmpty(v.data[c])) out[c] = v.data[c]
      return out
    }),
  }
}

export async function inboxTargetProblems(
  tx: Prisma.TransactionClient,
  userId: string,
  workflowJson: unknown,
  registry?: V3Registry,
): Promise<Array<{ nodeId: string; reason: string }>> {
  let g: { nodes?: Array<{ id?: unknown; type?: unknown; data?: Record<string, unknown> }> }
  try { g = typeof workflowJson === 'string' ? JSON.parse(workflowJson) : (workflowJson as typeof g) } catch { return [] }
  const tools = (Array.isArray(g?.nodes) ? g.nodes : []).filter((n) => n?.type === 'tool' && n.data?.toolType === 'workInbox')
  const out: Array<{ nodeId: string; reason: string }> = []
  for (const n of tools) {
    const nodeId = String(n.id ?? '')
    const target = typeof n.data?.targetWorkflowId === 'string' ? n.data.targetWorkflowId.trim() : ''
    const family = typeof n.data?.inboxFamily === 'string' ? n.data.inboxFamily.trim() : ''
    if (!target || !family) { out.push({ nodeId, reason: 'choose the work app and its inbox' }); continue }
    const reason = await inboxTargetReason(tx, userId, target, family, registry, { assembled: true })
    if (reason) out.push({ nodeId, reason })
  }
  return out
}

export async function inboxTargetReason(tx: Prisma.TransactionClient, userId: string, target: string, family: string, registry?: V3Registry, opts: { assembled?: boolean; appSend?: boolean } = {}): Promise<string | null> {
  const w = await tx.workflow.findFirst({ where: { workflowId: target, kind: { in: ['main', APP_WORKFLOW_KIND] }, agent: { userId } }, select: { kind: true, workflowJson: true } })
  if (!w || !isWorkAppRow(w)) return 'the work app does not exist in this account'
  const p = await tx.workProject.findFirst({ where: { workflowId: target, userId }, select: { id: true, kind: true } })
  if (!p) return 'the work app has not been opened yet — open it once first'
  if (p.kind === ASSEMBLED_KIND) {
    if (opts.appSend) {
      const { ensureUserDataKey } = await import('@/lib/user-data-key')
      const sp = await readSpec(tx as unknown as PrismaClient, await ensureUserDataKey(tx, userId), { userId, projectId: p.id })
      return sp?.spec.tables.some((t) => specSheetName(t.key) === family && !t.hidden) ? null : `the assembled app has no visible table "${family}"`
    }
    if (!opts.assembled) return 'an assembled app does not take rows from another work app'
    const { ensureUserDataKey } = await import('@/lib/user-data-key')
    return (await assembledInbox(tx, await ensureUserDataKey(tx, userId), userId, p.id, family)) ? null : `the assembled app has no table "${family}" that takes intake`
  }
  if (!usesOfKind(p.kind, registry)?.uses.inbox?.some((b) => b.family === family)) return `the work app has no inbox "${family}"`
  return null
}

const SKIP_MAX = 500

export async function inboxWaiting(deps: Pick<WorkSheetDeps, 'db' | 'templates'> & Partial<Pick<WorkSheetDeps, 'dataKey'>>, q: { userId: string; projectId: string; registry?: V3Registry }): Promise<Array<{ sheetId: string; family: string; waiting: number }>> {
  const p = await deps.db.workProject.findFirst({ where: { id: q.projectId, userId: q.userId }, select: { kind: true } })
  if (!p) throw new WorkError('NOT_FOUND')
  if (p.kind === ASSEMBLED_KIND) {
    if (!deps.dataKey) return []
    const sp = await readSpec(deps.db as PrismaClient, await deps.dataKey(deps.db, q.userId), { userId: q.userId, projectId: q.projectId })
    const names = (sp?.spec.tables ?? []).filter((t) => !t.hidden).map((t) => specSheetName(t.key))
    if (!names.length) return []
    const sheets = await deps.db.dataSheet.findMany({ where: { kind: 'project', projectId: q.projectId, userId: q.userId, template: null, name: { in: names } }, select: { id: true, name: true }, orderBy: { id: 'asc' } })
    const out = await Promise.all(sheets.map(async (s) => {
      const [{ n }] = await deps.db.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
        SELECT COUNT(*) AS n FROM data_sheet_rows r
        WHERE r.sheet_id = ${s.id} AND r.user_id = ${q.userId} AND r.confirmed = false
          AND EXISTS (SELECT 1 FROM work_event e WHERE e.row_id = r.id AND e.project_id = ${q.projectId} AND e.action = 'insert' AND (e.actor LIKE 'channel:%' OR e.actor LIKE 'intake_form:%' OR e.actor LIKE 'webhook:%' OR e.actor LIKE 'app:%'))`)
      return { sheetId: s.id, family: s.name, waiting: Number(n ?? 0) }
    }))
    return out.filter((x) => x.waiting > 0)
  }
  const families = (usesOfKind(p.kind, q.registry)?.uses.inbox ?? []).map((b) => b.family)
  if (!families.length) return []
  const sheets = await deps.db.dataSheet.findMany({ where: { kind: 'project', projectId: q.projectId, userId: q.userId, templateFamily: { in: families } }, select: { id: true, templateFamily: true, template: true }, orderBy: { id: 'asc' } })
  const out = await Promise.all(sheets.map(async (s) => {
    const where = { sheetId: s.id, userId: q.userId, confirmed: false }
    const ui = deps.templates.find((t) => templateId(t) === s.template)?.ui
    const col = ui?.waitingWhenEmpty
    let waiting = col
      ? Number((await deps.db.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
          SELECT COUNT(*) AS n FROM data_sheet_rows
          WHERE sheet_id = ${s.id} AND user_id = ${q.userId} AND confirmed = false
            AND COALESCE(row_data::jsonb ->> ${col}, '') = ''`))[0]?.n ?? 0)
      : await deps.db.dataSheetRow.count({ where })
    if (waiting && ui?.waitingSkip && ui.derivedFrom && waiting <= SKIP_MAX) {
      const ids = col
        ? (await deps.db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT id FROM data_sheet_rows WHERE sheet_id = ${s.id} AND user_id = ${q.userId} AND confirmed = false
              AND COALESCE(row_data::jsonb ->> ${col}, '') = '' LIMIT ${SKIP_MAX}`)).map((r) => r.id)
        : (await deps.db.dataSheetRow.findMany({ where, select: { id: true }, take: SKIP_MAX })).map((r) => r.id)
      const { screenRowsOf } = await import('./views')
      const cells = (await screenRowsOf(deps as WorkSheetDeps, q, ui.derivedFrom.module, new Set(ids)))?.cells ?? {}
      const skip = ui.waitingSkip
      waiting = Math.max(0, waiting - ids.filter((id) => skip.in.includes(String(cells[id]?.[skip.cell] ?? ''))).length)
    }
    return { sheetId: s.id, family: s.templateFamily!, waiting }
  }))
  return out.filter((x) => x.waiting > 0)
}
