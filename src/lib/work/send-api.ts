
import { Prisma } from '@prisma/client'
import { WorkError } from './errors'
import { isSelfHosted } from '@/lib/edition'
import type { WorkFileDeps } from './files'
import type { SheetActor } from './sheet-gate'
import { assertProjectWritable, lockProjectForWrite } from './sheet-gate'
import { writeWorkEvent } from './projects'
import { decryptJson } from './sealed'
import { TELEGRAM_ALERT_DECLARED, canReissue, discardSend, executeSend, isAutoOff, isWebSearchOff, listSends, markSendManual, reissueSend, viewStatus, type SendKind, type SendPayload, type SendStatus, type SendView } from './sends'
import { lookupOf, sendLookups, usesOfKind, type V3Registry } from './v3-handles'
import { isSendQuery, type ConnectionKind, type UsesSendTo } from './uses'
import { workSenders } from './senders'
import { resolveSlotConnection } from './work-senders'
import { dbTargetLabel, resolveDbConnection } from './company-db'
import { reportReissue, reportSendResult } from './send-report'
import { aiSqlCardCounted } from './ai-sql'

type K = { userId: string; projectId: string }

const CONN_TO_SEND: Record<ConnectionKind, SendKind> = { email: 'email', telegram: 'telegram', http: 'http', sms: 'sms', database: 'db_write', calendar: 'calendar' }

async function projectOf(deps: WorkFileDeps, k: K) {
  const p = await deps.db.workProject.findFirst({ where: { id: k.projectId, userId: k.userId }, select: { kind: true, workflowId: true, capabilityOff: true } })
  if (!p) throw new WorkError('NOT_FOUND')
  return p
}

function lookupsFor(deps: WorkFileDeps, k: K, kind: string, by: SheetActor, registry?: V3Registry) {
  const decl = usesOfKind(kind, registry)
  return sendLookups({ deps, userId: k.userId, projectId: k.projectId, caller: by, registry }, { kind, dbQueries: decl?.dbQueries, uses: decl?.uses })
}

export async function listProjectSends(deps: WorkFileDeps, k: K, by: SheetActor, opts: { ids?: string[]; registry?: V3Registry } = {}): Promise<SendView[]> {
  const p = await projectOf(deps, k)
  const lk = lookupsFor(deps, k, p.kind, by, opts.registry)
  const key = await deps.dataKey(deps.db, k.userId)
  const conns = usesOfKind(p.kind, opts.registry)?.uses.connections ?? []
  return listSends(deps, { ...k, ids: opts.ids }, {
    settingRecipients: lk.settingRecipients,
    async dbTarget(slot) {
      const c = conns.find((x) => x.id === slot && x.kind === 'database')
      if (!c || !p.workflowId) return null
      const r = await resolveDbConnection(deps.db, { userId: k.userId, workflowId: p.workflowId, slot, engine: c.engine }, { secret: false })
      return r.ok ? dbTargetLabel(r.config) : null
    },
    async emailConnected(slot) {
      if (!p.workflowId || !conns.some((x) => x.id === slot && x.kind === 'email')) return false
      return !!(await resolveSlotConnection(deps.db, { userId: k.userId, workflowId: p.workflowId, kind: 'email', slot }))
    },
    async fileName(id) {
      const f = await deps.db.workFile.findFirst({ where: { id, projectId: k.projectId, userId: k.userId }, select: { payload: true } })
      if (!f) return null
      try { return decryptJson<{ originalName: string }>(f.payload, key).originalName } catch { return null }
    },
  })
}

async function oneView(deps: WorkFileDeps, k: K, sendId: string, by: SheetActor, registry?: V3Registry): Promise<SendView> {
  const v = (await listProjectSends(deps, k, by, { ids: [sendId], registry }))[0]
  if (!v) throw new WorkError('NOT_FOUND')
  return v
}

export async function approveProjectSend(deps: WorkFileDeps, k: K & { sendId: string }, by: SheetActor, opts: { registry?: V3Registry; senders?: ReturnType<typeof workSenders>; confirmDanger?: boolean; prepareId?: string; confirmDuplicate?: boolean } = {}) {
  const p = await projectOf(deps, k)
  const row = await deps.db.workSend.findFirst({ where: { id: k.sendId, projectId: k.projectId, userId: k.userId }, select: { kind: true, payload: true, status: true } })
  if (row?.kind === 'sms' && row.status === 'pending' && !isSelfHosted()) {
    const { smsSendRisk } = await import('./assembled-sms')
    const risk = await smsSendRisk(deps.db, await deps.dataKey(deps.db, k.userId), k)
    if (risk?.code === 'SENDING_IN_PROGRESS') throw new WorkError('STALE', 'SENDING_IN_PROGRESS — another SMS of this row is being sent; wait for its result')
    if (risk?.code === 'DUPLICATE_RISK' && opts.confirmDuplicate !== true) throw new WorkError('INVALID', `DUPLICATE_RISK — an earlier SMS of this row to this number may have gone out (${risk.at?.toISOString().slice(0, 10) ?? ''}); confirmDuplicate is required`)
  }
  let prepareId: string | undefined
  if (row?.kind === 'db_sql' && row.status === 'pending') {
    const card = decryptJson<SendPayload>(row.payload, await deps.dataKey(deps.db, k.userId)).aiSql
    if (card && aiSqlCardCounted(card)) {
      if (!card.countSql) throw new WorkError('INVALID', 'COUNT_REQUIRED — this card has no row count; ask the AI to make it again')
      if (typeof opts.prepareId !== 'string' || !opts.prepareId) throw new WorkError('INVALID', 'PREPARE_REQUIRED — count the rows first (press Run again)')
      prepareId = opts.prepareId
    } else if (opts.confirmDanger !== true) {
      throw new WorkError('INVALID', 'confirmDanger is required — this SQL may not be undoable')
    }
  }
  if (row?.kind === 'http' && row.status === 'pending') {
    const { httpSendRisk } = await import('./assembled-http')
    const risk = await httpSendRisk(deps.db, k)
    if (risk?.code === 'SENDING_IN_PROGRESS') throw new WorkError('STALE', 'SENDING_IN_PROGRESS — another card of this row is being sent; wait for its result')
    if (risk?.code === 'DUPLICATE_RISK' && opts.confirmDuplicate !== true) throw new WorkError('INVALID', `DUPLICATE_RISK — an earlier send of this row may have gone out (${risk.at?.toISOString().slice(0, 10) ?? ''}); confirmDuplicate is required`)
  }
  const r = await executeSend(deps, k, { by, senders: opts.senders ?? workSenders(deps.db), lookups: lookupsFor(deps, k, p.kind, by, opts.registry), registry: opts.registry, ...(prepareId ? { prepareId } : {}), confirmDuplicate: opts.confirmDuplicate === true })
  if (r.status === 'pending' && r.code === 'SENDING_IN_PROGRESS') throw new WorkError('STALE', 'SENDING_IN_PROGRESS — another SMS of this row is being sent; wait for its result')
  if (r.status === 'pending' && r.code === 'DUPLICATE_RISK') throw new WorkError('INVALID', 'DUPLICATE_RISK — an earlier SMS of this row to this number may have gone out; confirmDuplicate is required')
  if (r.status === 'pending' && r.code === 'NO_CREDITS') throw new WorkError('INVALID', 'NO_CREDITS — not enough Credits for this SMS; the card waits')
  if (r.status === 'pending' && r.code === 'CHARGE_FAILED') throw new WorkError('STALE', 'CHARGE_FAILED — the Credits could not be charged just now; nothing was sent — press send again')
  if (r.status === 'pending' && (r.code === 'PREPARE_STALE' || r.code === 'PREPARE_EXPIRED')) throw new WorkError('STALE', `${r.code} — the count changed or is older than 5 minutes; count again`)
  if (r.status === 'pending' && r.code === 'AUTO_ONLY') throw new WorkError('INVALID', 'AUTO_ONLY — this Telegram alert goes out on its own within a minute')
  if (r.status === 'lost') {
    const view = await oneView(deps, k, k.sendId, by, opts.registry)
    return { send: view, changed: false }
  }
  await reportSendResult(deps, { ...k, by })
  return { send: await oneView(deps, k, k.sendId, by, opts.registry), changed: true }
}

export async function prepareProjectSend(deps: WorkFileDeps, k: K & { sendId: string }, opts: { registry?: V3Registry } = {}) {
  await projectOf(deps, k)
  const { prepareAiSqlCard } = await import('./ai-sql')
  const r = await prepareAiSqlCard(deps, k, { registry: opts.registry })
  return { prepareId: r.prepareId, n: r.n, at: r.at.toISOString() }
}

export async function discardProjectSend(deps: WorkFileDeps, k: K & { sendId: string }, by: SheetActor, opts: { registry?: V3Registry } = {}) {
  await projectOf(deps, k)
  const ok = await discardSend(deps, k, by)
  if (ok) await reportSendResult(deps, { ...k, by })
  return { send: await oneView(deps, k, k.sendId, by, opts.registry), changed: ok }
}

export async function markProjectSendManual(deps: WorkFileDeps, k: K & { sendId: string }, by: SheetActor, opts: { registry?: V3Registry } = {}) {
  const p = await projectOf(deps, k)
  const r = await markSendManual(deps, k, by, lookupsFor(deps, k, p.kind, by, opts.registry))
  if (r.changed) await reportSendResult(deps, { ...k, by })
  return { send: await oneView(deps, k, k.sendId, by, opts.registry), changed: r.changed }
}

export async function reissueProjectSend(deps: WorkFileDeps, k: K & { sendId: string }, by: SheetActor, confirmDuplicate: boolean, opts: { registry?: V3Registry } = {}) {
  await projectOf(deps, k)
  const row = await deps.db.workSend.findFirst({ where: { id: k.sendId, projectId: k.projectId, userId: k.userId }, select: { status: true, claimedAt: true, declared: true, kind: true, dispatchedAt: true } })
  if (!row) throw new WorkError('NOT_FOUND')
  if (row.declared === TELEGRAM_ALERT_DECLARED) throw new WorkError('INVALID', 'NOT_RESENDABLE — a Telegram alert is tried once; the alert itself stays in this app')
  if (row.declared?.startsWith('assembled.http:')) throw new WorkError('INVALID', 'NOT_RESENDABLE — make a new card from the row (row button or the AI); it checks again for a double send')
  if (row.declared?.startsWith('assembled.calendar:')) throw new WorkError('INVALID', 'NOT_RESENDABLE — make a new card from the row (row button or the AI); the calendar still gets one event')
  const st: SendStatus = viewStatus(row)
  if (row.kind === 'sms') throw new WorkError('INVALID', 'NOT_RESENDABLE — make a new card from the row (row button or the AI)')
  if (!canReissue(st)) throw new WorkError('STALE', `cannot resend a ${st} send`)
  if (st === 'unknown' && confirmDuplicate !== true) throw new WorkError('INVALID', 'confirmDuplicate is required — the first send may have gone out')
  const id = await reissueSend(deps, k, by)
  if (!id) throw new WorkError('STALE', 'already resent or no longer resendable')
  await reportReissue(deps, { userId: k.userId, projectId: k.projectId, sendId: id, by })
  return { send: await oneView(deps, k, id, by, opts.registry) }
}

export interface CapabilitiesView {
  v3: boolean
  autoSends: Array<{ id: string; label: string; kind: SendKind; via: string; to: { setting: string } | { fixed: string[] } | null; off: boolean }>
  webSearch: { declared: boolean; off: boolean }
  knowledge: boolean
  connections: Array<{ slot: string; kind: ConnectionKind; label: string; connected: boolean }>
  pkg: string | null
  pending: number
}

export async function projectCapabilities(deps: WorkFileDeps, k: K, opts: { registry?: V3Registry } = {}): Promise<CapabilitiesView> {
  const p = await projectOf(deps, k)
  const pending = await deps.db.workSend.count({ where: { projectId: k.projectId, userId: k.userId, status: 'pending' } })
  const decl = usesOfKind(p.kind, opts.registry)
  if (!decl) return { v3: false, autoSends: [], webSearch: { declared: false, off: false }, knowledge: false, connections: [], pkg: null, pending }
  const { uses } = decl
  const conns = uses.connections ?? []
  const autoSends: CapabilitiesView['autoSends'] = (uses.sends ?? []).filter((s): s is UsesSendTo => !isSendQuery(s) && !!s.auto).map((s) => {
    const c = conns.find((x) => x.id === s.via)
    const to = 'setting' in s.to ? { setting: s.to.setting } : { fixed: (Array.isArray(s.to.fixed) ? [...s.to.fixed] : [s.to.fixed]) as string[] }
    return { id: s.id, label: s.label, kind: c ? CONN_TO_SEND[c.kind] : 'email', via: s.via, to, off: isAutoOff(p.capabilityOff, s.id) }
  })
  const connections = await Promise.all(conns.map(async (c) => ({
    slot: c.id, kind: c.kind, label: c.label,
    connected: !p.workflowId ? false
      : c.kind === 'database' ? (await resolveDbConnection(deps.db, { userId: k.userId, workflowId: p.workflowId, slot: c.id, engine: c.engine }, { secret: false })).ok
      : c.kind === 'calendar' ? !!(await (await import('./assembled-calendar')).slotCalendarNow(deps.db, k.userId, p.workflowId, c.id))
      : !!(await resolveSlotConnection(deps.db, { userId: k.userId, workflowId: p.workflowId, kind: CONN_TO_SEND[c.kind], slot: c.id })),
  })))
  const pkg = (opts.registry?.packages ?? (await import('./registry')).workAppRegistry().packages).find((x) => x.appTemplates.some((a) => a.kind === p.kind))?.id ?? null
  const look = await lookupOf(deps.db, await deps.dataKey(deps.db, k.userId), { userId: k.userId, projectId: k.projectId, kind: p.kind, registry: opts.registry })
  return { v3: true, autoSends, webSearch: { declared: look.webPages || look.webSearch, off: isWebSearchOff(p.capabilityOff) }, knowledge: look.docs, connections, pkg, pending }
}

export async function setProjectCapabilities(deps: WorkFileDeps, k: K, by: SheetActor, body: { autoOff?: unknown; autoSend?: unknown; webSearchOff?: unknown }, opts: { registry?: V3Registry } = {}) {
  const p = await projectOf(deps, k)
  const decl = usesOfKind(p.kind, opts.registry)
  if (!decl) throw new WorkError('INVALID', 'this work app has nothing to switch off')
  const autoIds = new Set((decl.uses.sends ?? []).filter((s) => s.auto).map((s) => s.id))
  if (body.autoOff !== undefined && (!Array.isArray(body.autoOff) || !body.autoOff.every((x) => typeof x === 'string' && autoIds.has(x)))) {
    throw new WorkError('INVALID', 'autoOff must list declared automatic sends')
  }
  const one = body.autoSend as { id?: unknown; off?: unknown } | undefined
  if (one !== undefined && (!one || typeof one !== 'object' || typeof one.id !== 'string' || !autoIds.has(one.id) || typeof one.off !== 'boolean')) throw new WorkError('INVALID', 'autoSend must be { id: a declared automatic send, off: true or false }')
  if (one !== undefined && body.autoOff !== undefined) throw new WorkError('INVALID', 'give autoSend or autoOff, not both')
  if (body.webSearchOff !== undefined && typeof body.webSearchOff !== 'boolean') throw new WorkError('INVALID', 'webSearchOff must be true or false')
  if (body.webSearchOff === true && !decl.uses.webSearch) throw new WorkError('INVALID', 'this work app does not use web search')
  const key = await deps.dataKey(deps.db, k.userId)
  await deps.db.$transaction(async (tx) => {
    const cur = await lockProjectForWrite(tx, k.userId, k.projectId)
    assertProjectWritable(cur)
    const prev = (await tx.workProject.findUnique({ where: { id: k.projectId }, select: { capabilityOff: true } }))?.capabilityOff
    const prevOff = Array.isArray((prev as { autoOff?: unknown })?.autoOff) ? ((prev as { autoOff: unknown[] }).autoOff.filter((x) => typeof x === 'string' && autoIds.has(x)) as string[]) : []
    const patched = one ? (one.off ? [...new Set([...prevOff, one.id as string])] : prevOff.filter((x) => x !== one.id)) : prevOff
    const next = {
      autoOff: body.autoOff !== undefined ? [...new Set(body.autoOff as string[])] : patched,
      webSearchOff: body.webSearchOff !== undefined ? body.webSearchOff === true : isWebSearchOff(prev),
    }
    await tx.workProject.update({ where: { id: k.projectId }, data: { capabilityOff: next as Prisma.InputJsonValue } })
    await writeWorkEvent(tx, key, { userId: k.userId, projectId: k.projectId, actor: by, action: 'capability_set', detail: next })
  })
  return projectCapabilities(deps, k, opts)
}
