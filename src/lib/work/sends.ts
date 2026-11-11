
import { createHash } from 'crypto'
import { Prisma, type PrismaClient } from '@prisma/client'
import { encryptJson, decryptJson } from './sealed'
import { WorkError } from './errors'
import { isSelfHosted } from '@/lib/edition'
import { lockProjectForWrite, isProjectDetached, actorLabel, type SheetActor, type WorkSheetDeps } from './sheet-gate'
import { writeWorkEvent } from './projects'
import { writeSendSignal } from './signals'
import type { DbEngine } from './uses'

type Tx = Prisma.TransactionClient

export const SEND_SENDING_LIMIT_MS = 2 * 60_000

export const SEND_KINDS = ['email', 'telegram', 'http', 'db_write', 'db_sql', 'sms', 'call', 'work_app', 'calendar'] as const
export type SendKind = (typeof SEND_KINDS)[number]
export const SEND_STATUSES = ['pending', 'sending', 'sent', 'failed', 'unknown', 'refused', 'discarded'] as const
export type SendStatus = (typeof SEND_STATUSES)[number]
export const FINAL_SEND_STATUSES: ReadonlySet<SendStatus> = new Set(['sent', 'failed', 'refused', 'discarded'])
const FINISHABLE: SendStatus[] = ['sending', 'unknown']
const REISSUABLE: SendStatus[] = ['unknown', 'failed', 'refused']
export const APP_SEND_CARD_BURST = 10
const REISSUE_MAX_PENDING: Partial<Record<SendKind, number>> = { work_app: APP_SEND_CARD_BURST }

export interface SendPayload {
  to?: string[]
  toSetting?: string
  subject?: string
  text?: string
  json?: unknown
  params?: Record<string, unknown>
  attach?: Array<{ id: string; sha256: string }>
  query?: { id: string; fingerprint: string }
  aiSql?: AiSqlCard
  appSend?: AppSendCard
  refKey?: string
  toChatSlot?: string
  alertRef?: AlertRef
  toHttpSlot?: string
  idemKey?: string
  calSlot?: string
  cal?: { connectionId: string; accountId: string; calendarId: string; provider: 'google' | 'microsoft'; label: string }
  event?: { title: string; description: string; allDay: boolean; start: string; end: string; timeZone: string }
  eventKey?: string
  calNote?: 'previous_calendar' | 'previous_calendar_lost'
  calLost?: string
  smsColumn?: string
  smsPrice?: { country: string; segments: number; unit: number; total: number }
  smsShown?: { display: string; written: string | null; assumed: boolean }
}

export interface AlertRef {
  kind: 'move' | 'date'
  table: string
  alert: string
  send: string
  from?: string | null
  to?: string
  ai?: boolean
  target?: string
  firedAt?: string
  late?: boolean
}

export const TELEGRAM_ALERT_DECLARED = 'assembled.telegram'
export const TELEGRAM_ALERT_STALE_MS = 24 * 3600 * 1000
export const TELEGRAM_ALERT_PER_MINUTE = 15

export interface AppSendCard {
  toWorkflowId: string
  family: string
  toLabel: string
  rows: Array<Record<string, unknown>>
  asm?: { send: string; rowId: string; toProjectId: string; toTable: string }
}

export interface AiSqlCard {
  sql: string
  reason: string
  engine: DbEngine
  connectionId: string
  target: string
  targetLabel: string
  kind: string
  oneStep: boolean
  countSql?: string
}

export const AI_SQL_PREPARE_MAX_MS = 5 * 60_000

export interface SenderFile { id: string; buffer: Buffer; originalName: string; mimeType: string }
export interface SenderOutcome {
  status: 'sent' | 'failed' | 'unknown' | 'refused'
  code?: string
  detail?: string
  affectedRows?: number
  target?: string
}
export interface SendQuery {
  sql: string
  params: readonly string[]
  engine: string
  mode: 'read' | 'write'
  via: string
}
export interface Sender {
  send(input: { kind: SendKind; userId: string; projectId: string; workflowId: string; slot: string; payload: SendPayload; files: SenderFile[]; query?: SendQuery; expectRows?: number; sendId?: string }): Promise<SenderOutcome>
  ready?(): Promise<boolean>
}
export type Senders = Partial<Record<SendKind, Sender>>

export interface SendLookups {
  file(fileId: string): Promise<(SenderFile & { sha256: string }) | null>
  query(queryId: string): SendQuery | null
  settingRecipients?(setting: string): Promise<unknown>
  refOpen?(ref: string, attachFileIds: readonly string[], refKey?: string | null): Promise<boolean>
}

export const SEND_ATTACH_MAX_COUNT = 5
export const SEND_ATTACH_MAX_FILE = 10 * 1024 * 1024
export const SEND_ATTACH_MAX_TOTAL = 20 * 1024 * 1024
const ATTACH_KINDS: ReadonlySet<SendKind> = new Set(['email'])

export function normalizeRecipients(to: unknown): string[] | null {
  const list = Array.isArray(to) ? to : [to]
  if (!list.length) return null
  const out: string[] = []
  for (const v of list) {
    if (typeof v !== 'string' || !v.trim()) return null
    out.push(v.trim())
  }
  return out
}

export function isAutoOff(capabilityOff: unknown, sendId: string): boolean {
  if (!capabilityOff || typeof capabilityOff !== 'object' || Array.isArray(capabilityOff)) return false
  const list = (capabilityOff as { autoOff?: unknown }).autoOff
  return Array.isArray(list) && list.includes(sendId)
}
export function isWebSearchOff(capabilityOff: unknown): boolean {
  return !!capabilityOff && typeof capabilityOff === 'object' && (capabilityOff as { webSearchOff?: unknown }).webSearchOff === true
}

export function viewStatus(row: { status: string; claimedAt: Date | null; kind?: string; dispatchedAt?: Date | null }, now: Date = new Date()): SendStatus {
  if (row.status !== 'sending') return row.status as SendStatus
  if (row.kind === 'sms' && row.dispatchedAt !== undefined) {
    if (row.dispatchedAt) return now.getTime() - row.dispatchedAt.getTime() > SEND_SENDING_LIMIT_MS ? 'unknown' : 'sending'
    return row.claimedAt && now.getTime() - row.claimedAt.getTime() > SEND_SENDING_LIMIT_MS ? 'refused' : 'sending'
  }
  if (row.claimedAt && now.getTime() - row.claimedAt.getTime() > SEND_SENDING_LIMIT_MS) return 'unknown'
  return row.status as SendStatus
}

export function queryFingerprint(q: { sql: string; params: readonly string[]; engine?: string }): string {
  return createHash('sha256').update(JSON.stringify(q.engine === undefined ? [q.sql, [...q.params]] : [q.sql, [...q.params], q.engine])).digest('hex')
}

const needsRecipient = (kind: SendKind) => kind !== 'db_write' && kind !== 'db_sql' && kind !== 'work_app' && kind !== 'calendar'

const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/
const TELEGRAM_RE = /^(-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{3,31})$/
export function recipientValid(kind: SendKind, to: string): boolean {
  if (kind === 'email') return to.length <= 254 && EMAIL_RE.test(to)
  if (kind === 'telegram') return TELEGRAM_RE.test(to)
  if (kind === 'http') {
    try { const u = new URL(to); return u.protocol === 'https:' && !!u.hostname && !u.username && !u.password } catch { return false }
  }
  if (kind === 'sms') return SMS_E164_RE.test(to)
  return true
}
const SMS_E164_RE = /^\+(417[5-9]\d{7}|491[5-7]\d{8,9}|33[67]\d{8})$/

// ─────────────────────────────── DB ───────────────────────────────

export type SendDeps = WorkSheetDeps

const where = (k: { userId: string; projectId: string; sendId: string }) => ({ id: k.sendId, projectId: k.projectId, userId: k.userId })

export async function createSend(
  deps: SendDeps,
  input: {
    userId: string
    projectId: string
    taskId?: string | null
    workflowId: string
    kind: SendKind
    slot: string
    declared?: string | null
    auto: boolean
    payload: SendPayload
    requestedBy: SheetActor
    refuseCode?: string
    maxPending?: number
    ref?: string | null
    reissueOf?: string | null
  },
): Promise<{ id: string; status: 'pending' | 'refused' }> {
  if (!(SEND_KINDS as readonly string[]).includes(input.kind)) throw new WorkError('INVALID', `send kind ${input.kind}`)
  const key = await deps.dataKey(deps.db, input.userId)
  return deps.db.$transaction(async (tx) => {
    await lockProjectForWrite(tx, input.userId, input.projectId)
    return createSendTx(tx, key, input)
  })
}

export async function createSendTx(tx: Tx, key: Buffer, input: Parameters<typeof createSend>[1]): Promise<{ id: string; status: 'pending' | 'refused' }> {
  if (!(SEND_KINDS as readonly string[]).includes(input.kind)) throw new WorkError('INVALID', `send kind ${input.kind}`)
  if (input.maxPending !== undefined && (await tx.workSend.count({ where: { projectId: input.projectId, userId: input.userId, kind: input.kind, status: 'pending' } })) >= input.maxPending) {
    throw new WorkError('INVALID', `too many waiting cards (${input.maxPending}) — ask the person to run or discard them first`)
  }
  const status = input.refuseCode ? 'refused' : 'pending'
  const row = await tx.workSend.create({
    data: {
      userId: input.userId,
      projectId: input.projectId,
      taskId: input.taskId ?? null,
      workflowId: input.workflowId,
      kind: input.kind,
      slot: input.slot,
      declared: input.declared ?? null,
      status,
      auto: input.auto,
      payload: encryptJson(input.payload, key),
      requestedBy: actorText(input.requestedBy),
      code: input.refuseCode ?? null,
      ref: input.ref ?? null,
      reissueOf: input.reissueOf ?? null,
    },
    select: { id: true },
  })
  await writeWorkEvent(tx, key, { userId: input.userId, projectId: input.projectId, taskId: input.taskId ?? undefined, actor: input.requestedBy, action: status === 'refused' ? 'send_refused' : 'send_create', detail: { sendId: row.id, kind: input.kind, declared: input.declared ?? null, code: input.refuseCode ?? null } })
  return { id: row.id, status }
}

async function claimSend(deps: SendDeps, k: { userId: string; projectId: string; sendId: string }, by: SheetActor, now: Date, mode: 'auto' | 'approve', prepare?: { id: string; out: { n?: number } }, confirmDuplicate?: boolean): Promise<'claimed' | 'lost' | 'readonly' | 'carded' | 'prepare_stale' | 'prepare_expired' | 'throttled' | 'off' | 'auto_only' | 'stale' | 'in_progress' | 'dup_risk'> {
  const key = await deps.dataKey(deps.db, k.userId)
  return deps.db.$transaction(async (tx) => {
    let project
    try {
      project = await lockProjectForWrite(tx, k.userId, k.projectId)
    } catch (e) {
      if (e instanceof WorkError && e.code === 'NOT_FOUND') return 'lost'
      throw e
    }
    const readonly = project.status !== 'active' || isProjectDetached(project)
    let claimAt = now
    if (mode === 'approve') {
      const cur = await tx.workSend.findFirst({ where: { ...where(k), status: 'pending' }, select: { declared: true, kind: true } })
      if (cur?.declared === TELEGRAM_ALERT_DECLARED) return 'auto_only'
      if (cur?.kind === 'sms' && !readonly) {
        const { smsSendRisk } = await import('./assembled-sms')
        const risk = await smsSendRisk(tx, key, k, now)
        if (risk?.code === 'SENDING_IN_PROGRESS') return 'in_progress'
        if (risk?.code === 'DUPLICATE_RISK' && confirmDuplicate !== true) return 'dup_risk'
      }
    }
    if (mode === 'auto') {
      const cur = await tx.workSend.findFirst({ where: { ...where(k), status: 'pending' }, select: { auto: true, declared: true, claimedAt: true, createdAt: true, kind: true } })
      if (!cur || !cur.auto || cur.kind === 'sms') return 'lost'
      if (cur.declared === TELEGRAM_ALERT_DECLARED) {
        claimAt = new Date(Math.max(now.getTime(), Date.now()))
        if (claimAt.getTime() - cur.createdAt.getTime() > TELEGRAM_ALERT_STALE_MS) {
          await tx.workSend.updateMany({ where: { ...where(k), status: 'pending' }, data: { status: 'refused', code: 'STALE', decidedBy: actorText(by), decidedAt: claimAt } })
          return 'stale'
        }
      }
      if (!readonly && cur.declared) {
        const off = (await tx.workProject.findUnique({ where: { id: k.projectId }, select: { capabilityOff: true } }))?.capabilityOff
        if (isAutoOff(off, cur.declared)) {
          if (cur.declared === TELEGRAM_ALERT_DECLARED) {
            await tx.workSend.updateMany({ where: { ...where(k), status: 'pending' }, data: { status: 'refused', code: 'OFF', decidedBy: actorText(by), decidedAt: now } })
            return 'off'
          }
          await tx.workSend.updateMany({ where: { ...where(k), status: 'pending' }, data: { auto: false } })
          return 'carded'
        }
      }
      if (!readonly && cur.declared === TELEGRAM_ALERT_DECLARED) {
        if (cur.claimedAt && claimAt.getTime() - cur.claimedAt.getTime() < 60_000) return 'throttled'
        const recent = await tx.workSend.count({ where: { projectId: k.projectId, userId: k.userId, declared: TELEGRAM_ALERT_DECLARED, claimedAt: { gte: new Date(claimAt.getTime() - 60_000) } } })
        if (recent >= TELEGRAM_ALERT_PER_MINUTE) return 'throttled'
      }
    }
    if (prepare && !readonly) {
      const cur = await tx.workSend.findFirst({ where: { ...where(k), status: 'pending' }, select: { prepareId: true, prepareN: true, prepareAt: true } })
      if (!cur) return 'lost'
      if (!cur.prepareId || cur.prepareId !== prepare.id || cur.prepareN === null) return 'prepare_stale'
      const at = Date.now()
      if (!cur.prepareAt || at - cur.prepareAt.getTime() > AI_SQL_PREPARE_MAX_MS || cur.prepareAt.getTime() > at + 60_000) return 'prepare_expired'
      prepare.out.n = cur.prepareN
    }
    const r = await tx.workSend.updateMany({
      where: { ...where(k), status: 'pending', ...(prepare && !readonly ? { prepareId: prepare.id } : {}) },
      data: readonly ? { status: 'refused', code: 'PROJECT_READONLY', decidedBy: actorText(by), decidedAt: now } : { status: 'sending', claimedAt: claimAt, decidedBy: actorText(by), decidedAt: claimAt, ...(prepare ? { prepareId: null, prepareN: null, prepareAt: null } : {}) },
    })
    if (r.count !== 1) return 'lost'
    if (readonly) await writeWorkEvent(tx, key, { userId: k.userId, projectId: k.projectId, actor: by, action: 'send_refused', detail: { sendId: k.sendId, code: 'PROJECT_READONLY' } })
    return readonly ? 'readonly' : 'claimed'
  })
}

export async function finishSend(
  deps: SendDeps,
  k: { userId: string; projectId: string; sendId: string },
  out: { status: 'sent' | 'failed' | 'unknown' | 'refused'; code?: string; detail?: string; sentTo?: string[]; affectedRows?: number },
): Promise<number> {
  const key = await deps.dataKey(deps.db, k.userId)
  return deps.db.$transaction(async (tx) => {
    const from: SendStatus[] = FINISHABLE
    const r = await tx.workSend.updateMany({
      where: { ...where(k), status: { in: from } },
      data: { status: out.status, code: out.code ?? null, result: out.detail === undefined && !out.sentTo && out.affectedRows === undefined ? undefined : encryptJson({ ...(out.detail === undefined ? {} : { detail: out.detail }), ...(out.sentTo ? { sentTo: out.sentTo } : {}), ...(out.affectedRows === undefined ? {} : { affectedRows: out.affectedRows }) }, key) },
    })
    if (r.count !== 1) return 0
    if (out.status === 'sent') {
      await tx.workSend.updateMany({ where: { reissueOf: k.sendId, projectId: k.projectId, userId: k.userId, status: 'pending' }, data: { status: 'discarded', code: 'ORIGINAL_SENT' } })
      await signalIfRef(tx, key, k, 'mail', new Date())
    }
    await writeWorkEvent(tx, key, { userId: k.userId, projectId: k.projectId, actor: { type: 'human' }, action: `send_${out.status}`, detail: { sendId: k.sendId, code: out.code ?? null } })
    return 1
  })
}

export async function markStaleSends(db: PrismaClient, now: Date = new Date()): Promise<number> {
  const old = new Date(now.getTime() - SEND_SENDING_LIMIT_MS)
  const r = await db.workSend.updateMany({ where: { status: 'sending', kind: { not: 'sms' }, claimedAt: { lt: old } }, data: { status: 'unknown' } })
  const a = await db.workSend.updateMany({ where: { status: 'sending', kind: 'sms', dispatchedAt: null, claimedAt: { lt: old } }, data: { status: 'refused', code: 'STALE_CLAIM' } })
  const b = await db.workSend.updateMany({ where: { status: 'sending', kind: 'sms', dispatchedAt: { lt: old } }, data: { status: 'unknown' } })
  const { sweepSmsRefunds } = await import('./sms-charge')
  await sweepSmsRefunds(db, now).catch((e) => console.error('[work-sms] 남은 돌려주기 실패:', e instanceof Error ? e.message.slice(0, 200) : 'error'))
  return r.count + a.count + b.count
}

export async function executeSend(
  deps: SendDeps,
  k: { userId: string; projectId: string; sendId: string },
  ctx: { by: SheetActor; senders: Senders; lookups: SendLookups; now?: Date; mode?: 'auto' | 'approve'; registry?: import('./v3-handles').V3Registry; prepareId?: string; confirmDuplicate?: boolean },
): Promise<{ status: SendStatus | 'lost'; code?: string; affectedRows?: number }> {
  const now = ctx.now ?? new Date()
  const head = await deps.db.workSend.findFirst({ where: where(k), select: { kind: true } })
  if (head?.kind === 'work_app') {
    if ((ctx.mode ?? 'approve') === 'auto') return { status: 'lost' }
    const { executeAppSend } = await import('./app-send')
    return executeAppSend(deps, k, ctx.by, now, ctx.registry)
  }
  if ((head?.kind === 'sms' || head?.kind === 'calendar') && isSelfHosted()) {
    const key = await deps.dataKey(deps.db, k.userId)
    const n = await deps.db.$transaction(async (tx) => {
      const r = await tx.workSend.updateMany({ where: { ...where(k), status: 'pending' }, data: { status: 'refused', code: 'NOT_IN_EDITION', decidedBy: actorText(ctx.by), decidedAt: now } })
      if (r.count === 1) await writeWorkEvent(tx, key, { userId: k.userId, projectId: k.projectId, actor: ctx.by, action: 'send_refused', detail: { sendId: k.sendId, code: 'NOT_IN_EDITION' } })
      return r.count
    })
    return n === 1 ? { status: 'refused', code: 'NOT_IN_EDITION' } : { status: 'lost' }
  }
  const prepared: { n?: number } = {}
  const claim = await claimSend(deps, k, ctx.by, now, ctx.mode ?? 'approve', ctx.prepareId !== undefined ? { id: ctx.prepareId, out: prepared } : undefined, ctx.confirmDuplicate)
  if (claim === 'lost') return { status: 'lost' }
  if (claim === 'in_progress') return { status: 'pending', code: 'SENDING_IN_PROGRESS' }
  if (claim === 'dup_risk') return { status: 'pending', code: 'DUPLICATE_RISK' }
  if (claim === 'prepare_stale') return { status: 'pending', code: 'PREPARE_STALE' }
  if (claim === 'prepare_expired') return { status: 'pending', code: 'PREPARE_EXPIRED' }
  if (claim === 'carded') return { status: 'pending', code: 'AUTO_OFF' }
  if (claim === 'readonly') return { status: 'refused', code: 'PROJECT_READONLY' }
  if (claim === 'throttled') return { status: 'pending', code: 'THROTTLED' }
  if (claim === 'off') return { status: 'refused', code: 'OFF' }
  if (claim === 'stale') return { status: 'refused', code: 'STALE' }
  if (claim === 'auto_only') return { status: 'pending', code: 'AUTO_ONLY' }

  const row = await deps.db.workSend.findFirst({ where: where(k), select: { kind: true, slot: true, workflowId: true, payload: true, ref: true } })
  if (!row) return { status: 'lost' }
  const kind = row.kind as SendKind
  const refuse = async (code: string) => (await finishSend(deps, k, { status: 'refused', code })) ? { status: 'refused' as const, code } : { status: 'lost' as const }
  let payload: SendPayload
  let alertPayload: Uint8Array<ArrayBuffer> | null = null

  const files: SenderFile[] = []
  let sentTo: string[] | undefined
  let query: SendQuery | undefined
  try {
    payload = decryptJson<SendPayload>(row.payload, await deps.dataKey(deps.db, k.userId))
    if (row.ref && ctx.lookups.refOpen && !(await ctx.lookups.refOpen(row.ref, (payload.attach ?? []).map((a) => a.id), payload.refKey ?? null))) return refuse('REF_CLOSED')
    if (payload.alertRef) {
      alertPayload = row.payload
      const { resolveAlertLine } = await import('./assembled-telegram')
      const line = await resolveAlertLine(deps.db, await deps.dataKey(deps.db, k.userId), { userId: k.userId, projectId: k.projectId, workflowId: row.workflowId, rowId: row.ref, ref: payload.alertRef })
      if (!line.ok) return refuse(line.code)
      payload = { ...payload, to: [line.to], subject: line.subject, text: line.text }
      await deps.db.workSend.updateMany({ where: { ...where(k), status: 'sending' }, data: { payload: encryptJson(payload, await deps.dataKey(deps.db, k.userId)) } })
    } else if (payload.toChatSlot) {
      const now = await slotChatNow(deps.db, k.userId, row.workflowId, payload.toChatSlot)
      if (!now) return refuse('RECIPIENT_EMPTY')
      if (now !== normalizeRecipients(payload.to)?.[0]) return refuse('RECIPIENT_CHANGED')
    } else if (payload.toHttpSlot) {
      const { slotHttpNow } = await import('./http-target')
      const now = await slotHttpNow(deps.db, k.userId, row.workflowId, payload.toHttpSlot)
      if (!now) return refuse('RECIPIENT_EMPTY')
      if (now.url !== payload.to?.[0]) return refuse('RECIPIENT_CHANGED')
    } else if (payload.calSlot) {
      const { calendarForRowNow } = await import('./assembled-calendar')
      const declared = (await deps.db.workSend.findFirst({ where: where(k), select: { declared: true } }))?.declared
      const now = declared && row.ref ? await calendarForRowNow(deps.db, await deps.dataKey(deps.db, k.userId), { userId: k.userId, projectId: k.projectId, workflowId: row.workflowId, declared, rowId: row.ref, exceptSendId: k.sendId }) : null
      if (!now || !payload.cal || !payload.event || !payload.eventKey) return refuse('RECIPIENT_EMPTY')
      if (now.cal.connectionId !== payload.cal.connectionId || now.cal.accountId !== payload.cal.accountId || now.cal.calendarId !== payload.cal.calendarId) return refuse('RECIPIENT_CHANGED')
      sentTo = [payload.cal.label]
    } else if (kind === 'sms') {
      const { smsRowNow, smsPriceNow } = await import('./assembled-sms')
      const table = payload.refKey?.split(':')[0]
      if (!row.ref || !table || !payload.smsColumn || !payload.smsPrice) return refuse('RECIPIENT_EMPTY')
      const cur = await smsRowNow(deps.db, await deps.dataKey(deps.db, k.userId), { userId: k.userId, projectId: k.projectId, rowId: row.ref, table, column: payload.smsColumn })
      if (!cur) return refuse('REF_CLOSED')
      if (!cur.number.ok) return refuse(cur.number.code === 'RECIPIENT_EMPTY' ? 'RECIPIENT_EMPTY' : 'RECIPIENT_CHANGED')
      if (cur.number.e164 !== payload.to?.[0]) return refuse('RECIPIENT_CHANGED')
      const price = smsPriceNow(payload.smsPrice as import('./sms-number').SmsPrice)
      if (price === 'closed') return refuse('COUNTRY_CLOSED')
      if (price === 'changed') return refuse('PRICE_CHANGED')
    }
    if (payload.toSetting && ctx.lookups.settingRecipients) {
      const now = normalizeRecipients(await ctx.lookups.settingRecipients(payload.toSetting))
      if (!now) return refuse('RECIPIENT_EMPTY')
      payload = { ...payload, to: now }
    }
    if (needsRecipient(kind)) {
      const to = normalizeRecipients(payload.to)
      if (!to) return refuse('RECIPIENT_EMPTY')
      if (!to.every((x) => recipientValid(kind, x)) || (kind !== 'email' && to.length > 1)) return refuse('RECIPIENT_INVALID')
      sentTo = to
    }
    const attach = payload.attach ?? []
    if (attach.length && !ATTACH_KINDS.has(kind)) return refuse('ATTACHMENT_UNSUPPORTED')
    if (attach.length > SEND_ATTACH_MAX_COUNT) return refuse('ATTACHMENT_TOO_LARGE')
    if (kind === 'db_write') {
      const q = payload.query ? ctx.lookups.query(payload.query.id) : null
      if (!q || q.mode !== 'write' || q.via !== row.slot || queryFingerprint(q) !== payload.query!.fingerprint) return refuse('QUERY_CHANGED')
      query = q
    }
    for (const a of payload.attach ?? []) {
      const f = await ctx.lookups.file(a.id)
      if (!f) return refuse('ATTACHMENT_MISSING')
      if (f.sha256 !== a.sha256) return refuse('ATTACHMENT_CHANGED')
      if (f.buffer.length > SEND_ATTACH_MAX_FILE) return refuse('ATTACHMENT_TOO_LARGE')
      files.push({ id: f.id, buffer: f.buffer, originalName: f.originalName, mimeType: f.mimeType })
    }
    if (files.reduce((n, f) => n + f.buffer.length, 0) > SEND_ATTACH_MAX_TOTAL) return refuse('ATTACHMENT_TOO_LARGE')
  } catch (e) {
    console.error('[work-send] 보내기 전 대조 실패:', e instanceof Error ? e.message.slice(0, 200) : 'error')
    return refuse('PRECHECK_FAILED')
  }
  const sender = ctx.senders[kind]
  if (!sender) return refuse('NOT_AVAILABLE')
  if (kind === 'sms') {
    try {
      if (sender.ready && !(await sender.ready())) return refuse('NOT_AVAILABLE')
    } catch {
      return refuse('NOT_AVAILABLE')
    }
    const { chargeSmsSend } = await import('./sms-charge')
    const ch = await chargeSmsSend(deps, k, now)
    if (!ch.ok) return ch.status === 'lost' ? { status: 'lost' } : { status: ch.status, code: ch.code }
  }

  let out: SenderOutcome
  try {
    out = await sender.send({ kind, userId: k.userId, projectId: k.projectId, workflowId: row.workflowId, slot: row.slot, payload, files, sendId: k.sendId, ...(query ? { query } : {}), ...(prepared.n !== undefined ? { expectRows: prepared.n } : {}) })
  } catch (e) {
    out = { status: 'unknown', detail: e instanceof Error ? e.message.slice(0, 300) : 'error' }
  }
  if (payload.alertRef && out.status === 'failed' && out.code === 'HTTP_429') {
    const r = await deps.db.workSend.updateMany({ where: { ...where(k), status: 'sending' }, data: { status: 'pending', decidedBy: null, decidedAt: null, ...(alertPayload ? { payload: alertPayload } : {}) } })
    if (r.count === 1) return { status: 'pending', code: 'RETRY' }
  }
  if (kind === 'sms' && (out.status === 'failed' || out.status === 'refused')) {
    const { markSmsRefundDue } = await import('./sms-charge')
    await markSmsRefundDue(deps.db, k.sendId).catch((e) => console.error('[work-sms] 돌려줄 것 표시 실패 — 손으로 확인:', k.sendId, e instanceof Error ? e.message.slice(0, 200) : 'error'))
  }
  const n = await finishSend(deps, k, { status: out.status, code: out.code, detail: out.detail, sentTo: sentTo ?? (out.target ? [out.target] : undefined), affectedRows: out.affectedRows })
  if (kind === 'sms' && (out.status === 'failed' || out.status === 'refused')) {
    const { refundSmsChargeWithRetry } = await import('./sms-charge')
    await refundSmsChargeWithRetry(deps, k.sendId)
  }
  return n ? { status: out.status, ...(out.code ? { code: out.code } : {}), ...(out.affectedRows !== undefined ? { affectedRows: out.affectedRows } : {}) } : { status: 'lost' }
}

export async function discardSend(deps: SendDeps, k: { userId: string; projectId: string; sendId: string }, by: SheetActor): Promise<boolean> {
  const key = await deps.dataKey(deps.db, k.userId)
  return deps.db.$transaction(async (tx) => {
    await lockProjectForWrite(tx, k.userId, k.projectId)
    const r = await tx.workSend.updateMany({ where: { ...where(k), status: 'pending' }, data: { status: 'discarded', decidedBy: actorText(by), decidedAt: new Date() } })
    if (r.count === 1) await writeWorkEvent(tx, key, { userId: k.userId, projectId: k.projectId, actor: by, action: 'send_discard', detail: { sendId: k.sendId } })
    return r.count === 1
  })
}

export async function markSendManual(deps: SendDeps, k: { userId: string; projectId: string; sendId: string }, by: SheetActor, lookups: Pick<SendLookups, 'refOpen'> = {}, now: Date = new Date()): Promise<{ changed: boolean; code?: string }> {
  const head = await deps.db.workSend.findFirst({ where: { ...where(k), status: 'pending' }, select: { kind: true, ref: true, payload: true } })
  if (!head) return { changed: false }
  if (head.kind !== 'email') throw new WorkError('INVALID', 'only an email card can be marked as sent by hand')
  const key = await deps.dataKey(deps.db, k.userId)
  let closed = false
  if (head.ref && lookups.refOpen) {
    const p = decryptJson<SendPayload>(head.payload, key)
    closed = !(await lookups.refOpen(head.ref, (p.attach ?? []).map((a) => a.id), p.refKey ?? null))
  }
  return deps.db.$transaction(async (tx) => {
    const project = await lockProjectForWrite(tx, k.userId, k.projectId)
    if (project.status !== 'active' || isProjectDetached(project)) throw new WorkError('FORBIDDEN', 'this work app is read-only')
    const code = closed ? 'REF_CLOSED' : 'MANUAL'
    const r = await tx.workSend.updateMany({ where: { ...where(k), status: 'pending' }, data: { status: closed ? 'refused' : 'sent', code, decidedBy: actorText(by), decidedAt: now } })
    if (r.count !== 1) return { changed: false }
    if (!closed) {
      await tx.workSend.updateMany({ where: { reissueOf: k.sendId, projectId: k.projectId, userId: k.userId, status: 'pending' }, data: { status: 'discarded', code: 'ORIGINAL_SENT' } })
      await signalIfRef(tx, key, k, 'manual', now)
    }
    await writeWorkEvent(tx, key, { userId: k.userId, projectId: k.projectId, actor: by, action: closed ? 'send_refused' : 'send_sent', detail: { sendId: k.sendId, code } })
    return { changed: true, code }
  })
}

async function signalIfRef(tx: Tx, key: Buffer, k: { userId: string; projectId: string; sendId: string }, how: 'mail' | 'manual', sentAt: Date): Promise<void> {
  const row = await tx.workSend.findFirst({ where: where(k), select: { ref: true, workflowId: true, payload: true } })
  if (!row?.ref) return
  let attachFileIds: string[] | undefined
  try { attachFileIds = (decryptJson<SendPayload>(row.payload, key).attach ?? []).map((a) => a.id) } catch { attachFileIds = undefined }
  await writeSendSignal(tx, key, { userId: k.userId, projectId: k.projectId, workflowId: row.workflowId, sendId: k.sendId, ref: row.ref, sentAt: sentAt.toISOString(), how, ...(attachFileIds ? { attachFileIds } : {}) })
}

export async function reissueSend(deps: SendDeps, k: { userId: string; projectId: string; sendId: string }, by: SheetActor, now: Date = new Date()): Promise<string | null> {
  const key = await deps.dataKey(deps.db, k.userId)
  return deps.db.$transaction(async (tx) => {
    await lockProjectForWrite(tx, k.userId, k.projectId)
    const rows = await tx.$queryRaw<Array<{ status: string; claimed_at: Date | null }>>`
      SELECT status, claimed_at FROM work_send WHERE id = ${k.sendId} AND project_id = ${k.projectId} AND user_id = ${k.userId} FOR UPDATE`
    const o = rows[0]
    if (!o) return null
    const st = viewStatus({ status: o.status, claimedAt: o.claimed_at }, now)
    if (!REISSUABLE.includes(st)) return null
    if (o.status === 'sending') await tx.workSend.updateMany({ where: { ...where(k), status: 'sending' }, data: { status: 'unknown' } })
    if ((await tx.workSend.count({ where: { reissueOf: k.sendId, projectId: k.projectId, userId: k.userId, status: { in: ['pending', 'sending', 'unknown', 'sent'] } } })) > 0) return null
    const src = await tx.workSend.findUniqueOrThrow({ where: { id: k.sendId } })
    if (src.declared === TELEGRAM_ALERT_DECLARED) return null
    if (src.declared?.startsWith('assembled.http:')) return null
    if (src.declared?.startsWith('assembled.calendar:')) return null
    if (src.kind === 'sms') return null
    let payloadBytes = src.payload
    const srcPayload = decryptJson<SendPayload>(src.payload, key)
    if (srcPayload.toChatSlot) {
      const chat = await slotChatNow(tx, k.userId, src.workflowId, srcPayload.toChatSlot)
      if (!chat) throw new WorkError('INVALID', 'the team chat is empty — set the Telegram chat in the studio first')
      payloadBytes = Buffer.from(encryptJson({ ...srcPayload, to: [chat] }, key))
    }
    const cap = REISSUE_MAX_PENDING[src.kind as SendKind]
    if (cap !== undefined && (await tx.workSend.count({ where: { projectId: k.projectId, userId: k.userId, kind: src.kind, status: 'pending' } })) >= cap) {
      throw new WorkError('INVALID', `too many waiting cards (${cap}) — send or discard them first`)
    }
    const row = await tx.workSend.create({
      data: { userId: src.userId, projectId: src.projectId, taskId: src.taskId, workflowId: src.workflowId, kind: src.kind, slot: src.slot, declared: src.declared, status: 'pending', auto: false, payload: payloadBytes, requestedBy: actorText(by), reissueOf: src.id, ref: src.ref },
      select: { id: true },
    })
    await writeWorkEvent(tx, key, { userId: k.userId, projectId: k.projectId, actor: by, action: 'send_reissue', detail: { sendId: row.id, of: src.id } })
    return row.id
  })
}

export function decryptPayloadOf(bytes: Uint8Array, key: Buffer): SendPayload {
  return decryptJson<SendPayload>(bytes, key)
}

export async function slotChatNow(db: PrismaClient | Tx, userId: string, workflowId: string, slot: string): Promise<string | null> {
  const w = await db.workflow.findFirst({ where: { workflowId, agent: { userId } }, select: { workflowJson: true } })
  if (!w) return null
  const { appStartSettings } = await import('./app-chat')
  return appStartSettings(w.workflowJson).telegramChats[slot] ?? null
}

export async function liveSendingCount(tx: Tx, projectId: string, now: Date = new Date()): Promise<number> {
  const since = new Date(now.getTime() - SEND_SENDING_LIMIT_MS)
  return tx.workSend.count({ where: { projectId, status: 'sending', OR: [{ claimedAt: { gte: since } }, { dispatchedAt: { gte: since } }] } })
}

const actorText = actorLabel

export interface SendView {
  id: string
  kind: SendKind
  slot: string
  declared: string | null
  status: SendStatus
  code: string | null
  auto: boolean
  to: string[]
  toSetting: string | null
  subject: string | null
  text: string | null
  attachments: Array<{ id: string; name: string | null }>
  requestedBy: string
  decidedBy: string | null
  decidedAt: Date | null
  createdAt: Date
  reissueOf: string | null
  reissued: boolean
  params: Record<string, unknown> | null
  affectedRows: number | null
  aiSql: { sql: string; reason: string; targetLabel: string; kind: string; oneStep: boolean; countSql: string | null } | null
  appSend: { toLabel: string; rows: Array<Record<string, unknown>>; url?: string } | null
  slotConnected: boolean | null
  copyText: string | null
  json: unknown
  calendar: { label: string; title: string; description: string; allDay: boolean; start: string; end: string; timeZone: string; link?: string; note?: 'previous_calendar' | 'previous_calendar_lost'; lost?: string; existing?: { start: string | null; title: string | null } } | null
  sms: { to: string; written: string | null; assumed: boolean; country: string; parts: number; credits: number; refunded: boolean } | null
}

const VIEW_TEXT_MAX = 2_000

export async function listSends(
  deps: SendDeps,
  q: { userId: string; projectId: string; ids?: string[]; limit?: number; now?: Date },
  lookups: Pick<SendLookups, 'settingRecipients'> & { fileName?(id: string): Promise<string | null>; dbTarget?(slot: string): Promise<string | null>; emailConnected?(slot: string): Promise<boolean> } = {},
): Promise<SendView[]> {
  const now = q.now ?? new Date()
  const rows = await deps.db.workSend.findMany({
    where: { userId: q.userId, projectId: q.projectId, ...(q.ids ? { id: { in: q.ids } } : {}) },
    orderBy: { createdAt: 'desc' },
    take: Math.min(q.limit ?? 200, 500),
  })
  if (!rows.length) return []
  const key = await deps.dataKey(deps.db, q.userId)
  const reissuedOf = new Set(
    (await deps.db.workSend.findMany({ where: { projectId: q.projectId, userId: q.userId, reissueOf: { in: rows.map((r) => r.id) }, status: { in: ['pending', 'sending', 'unknown', 'sent'] } }, select: { reissueOf: true } }))
      .map((r) => r.reissueOf!),
  )
  const settingCache = new Map<string, string[] | null>()
  const connCache = new Map<string, boolean>()
  const appTargets = rows.filter((r) => r.kind === 'work_app').map((r) => { try { return decryptJson<SendPayload>(r.payload, key).appSend?.toWorkflowId } catch { return undefined } }).filter((x): x is string => !!x)
  const appAgent = new Map((appTargets.length ? await deps.db.workflow.findMany({ where: { workflowId: { in: [...new Set(appTargets)] }, agent: { userId: q.userId } }, select: { workflowId: true, agentId: true } }) : []).map((w) => [w.workflowId, w.agentId]))
  const smsIds = rows.filter((r) => r.kind === 'sms').map((r) => r.id)
  const smsRefunded = new Set(smsIds.length ? (await deps.db.workSmsCharge.findMany({ where: { sendId: { in: smsIds }, status: 'refunded' }, select: { sendId: true } })).map((x) => x.sendId) : [])
  const out: SendView[] = []
  for (const r of rows) {
    let p: SendPayload = {}
    let sentTo: string[] | undefined
    let affectedRows: number | null = null
    let calLink: string | undefined
    let calExisting: { start: string | null; title: string | null } | undefined
    try { p = decryptJson<SendPayload>(r.payload, key) } catch { p = {} }
    if (r.result) {
      try {
        const res = decryptJson<{ sentTo?: string[]; affectedRows?: unknown; detail?: unknown }>(r.result, key)
        sentTo = res.sentTo
        if (typeof res.affectedRows === 'number') affectedRows = res.affectedRows
        if (r.kind === 'calendar' && r.status === 'sent' && typeof res.detail === 'string') {
          try {
            const d = JSON.parse(res.detail) as { link?: unknown; start?: unknown; title?: unknown }
            if (typeof d.link === 'string' && /^https:\/\//.test(d.link)) calLink = d.link
            if (r.code === 'ALREADY_EXISTS') calExisting = { start: typeof d.start === 'string' ? d.start : null, title: typeof d.title === 'string' ? d.title : null }
          } catch { }
        }
      } catch { }
    }
    const status = viewStatus(r, now)
    let to = sentTo ?? p.to ?? []
    if (r.kind === 'sms' && p.smsShown) to = [p.smsShown.display]
    if (!sentTo && p.toSetting && lookups.settingRecipients && (status === 'pending' || status === 'refused')) {
      if (!settingCache.has(p.toSetting)) settingCache.set(p.toSetting, normalizeRecipients(await lookups.settingRecipients(p.toSetting)))
      to = settingCache.get(p.toSetting) ?? []
    }
    if (!sentTo && r.kind === 'db_sql' && p.aiSql) to = [p.aiSql.targetLabel]
    if (r.kind === 'work_app' && p.appSend) to = [p.appSend.toLabel]
    if (r.kind === 'calendar' && p.cal) to = [p.cal.label]
    if (!sentTo && r.kind === 'db_write' && lookups.dbTarget) {
      const tg = await lookups.dbTarget(r.slot)
      to = tg ? [tg] : []
    }
    if (r.kind === 'http') to = to.map((u) => { try { return new URL(u).host } catch { return '' } }).filter(Boolean)
    const text = p.text ?? (p.json === undefined ? null : JSON.stringify(p.json, null, 2))
    let slotConnected: boolean | null = null
    if (r.kind === 'email' && status === 'pending' && lookups.emailConnected) {
      if (!connCache.has(r.slot)) connCache.set(r.slot, await lookups.emailConnected(r.slot))
      slotConnected = connCache.get(r.slot)!
    }
    out.push({
      id: r.id, kind: r.kind as SendKind, slot: r.slot, declared: r.declared, status, code: r.code, auto: r.auto,
      to, toSetting: p.toSetting ?? null, subject: p.subject ?? null, text: text === null ? null : text.slice(0, VIEW_TEXT_MAX),
      attachments: await Promise.all((p.attach ?? []).map(async (a) => ({ id: a.id, name: lookups.fileName ? await lookups.fileName(a.id) : null }))),
      requestedBy: r.requestedBy, decidedBy: r.decidedBy, decidedAt: r.decidedAt, createdAt: r.createdAt, reissueOf: r.reissueOf,
      reissued: reissuedOf.has(r.id),
      params: r.kind === 'db_write' ? (p.params ?? {}) : null,
      affectedRows,
      aiSql: r.kind === 'db_sql' && p.aiSql ? { sql: p.aiSql.sql, reason: p.aiSql.reason, targetLabel: p.aiSql.targetLabel, kind: p.aiSql.kind, oneStep: p.aiSql.oneStep, countSql: p.aiSql.countSql ?? null } : null,
      appSend: r.kind === 'work_app' && p.appSend ? { toLabel: p.appSend.toLabel, rows: p.appSend.rows, ...(appAgent.has(p.appSend.toWorkflowId) ? { url: `/chat/${encodeURIComponent(appAgent.get(p.appSend.toWorkflowId)!)}/app?workflowId=${encodeURIComponent(p.appSend.toWorkflowId)}` } : {}) } : null,
      slotConnected,
      copyText: slotConnected === false ? p.text ?? null : null,
      json: r.kind === 'http' && p.json !== undefined ? p.json : null,
      sms: r.kind === 'sms' && p.smsShown && p.smsPrice ? { to: p.smsShown.display, written: p.smsShown.written, assumed: p.smsShown.assumed, country: p.smsPrice.country, parts: p.smsPrice.segments, credits: p.smsPrice.total, refunded: smsRefunded.has(r.id) } : null,
      calendar: r.kind === 'calendar' && p.cal && p.event ? { label: p.cal.label, title: p.event.title, description: p.event.description, allDay: p.event.allDay, start: p.event.start, end: p.event.end, timeZone: p.event.timeZone, ...(calLink ? { link: calLink } : {}), ...(p.calNote ? { note: p.calNote } : {}), ...(p.calLost ? { lost: p.calLost } : {}), ...(calExisting ? { existing: calExisting } : {}) } : null,
    })
  }
  return out
}

export const canReissue = (s: SendStatus) => REISSUABLE.includes(s)
