
import { createHash } from 'crypto'
import type { Prisma, PrismaClient } from '@prisma/client'
import { WorkError } from './errors'
import { isSelfHosted } from '@/lib/edition'
import { decryptJson } from './sealed'
import { decodeRow, isProjectDetached, lockProjectForWrite, actorLabel, type SheetActor, type WorkSheetDeps } from './sheet-gate'
import { writeWorkEvent } from './projects'
import { createSendTx, SEND_SENDING_LIMIT_MS, type SendPayload } from './sends'
import { isCalendarDate } from './dates'
import {
  ASSEMBLED_KIND, accountToday, placeholderValues, readRefRows, readSpec, specSendBlocked, specSheetName,
  type AppSpec, type RefRows, type SpecSend, type SpecTable,
} from './assembled'
import { normalizeSmsNumber, smsPriceFor, SMS_COUNTRIES, type SmsPrice } from './sms-number'

type Db = PrismaClient | Prisma.TransactionClient

export const SMS_DECLARED_PREFIX = 'assembled.sms:'
export const smsDeclared = (sendKey: string) => `${SMS_DECLARED_PREFIX}${sendKey}`
export const isSmsDeclared = (d: string | null | undefined): boolean => typeof d === 'string' && d.startsWith(SMS_DECLARED_PREFIX)
export const SMS_SLOT = 'sms'

export function buildSpecSms(t: SpecTable, s: SpecSend, row: Readonly<Record<string, unknown>>, today: string, refRows: RefRows): string {
  const vals = placeholderValues(t, row, today, refRows)
  return s.body.replace(/\{([a-z][a-z0-9_]*)\}/g, (_, k: string) => vals[k] ?? '').trim()
}

export const smsPrint = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16)
export const smsRefKey = (s: Pick<SpecSend, 'table' | 'key'>, text: string, day: string) => `${s.table}:${s.key}:${smsPrint(text)}:${day}`

export function specSmsBlocked(t: SpecTable, s: SpecSend, row: Readonly<Record<string, unknown>>, confirmed: boolean, today: string): string | null {
  if (s.allowWhen?.confirmed && !confirmed) return `"${s.label}" is only for confirmed rows`
  return specSendBlocked(t, s, row, today)
}

export const smsColumnOf = (s: Pick<SpecSend, 'to'>) => (typeof s.to === 'string' && s.to.startsWith('column:') ? s.to.slice(7) : '')

const NUMBER_WHY: Record<string, string> = {
  RECIPIENT_EMPTY: 'the phone number column of this row is empty',
  RECIPIENT_INVALID: 'the phone number of this row is not a phone number',
  COUNTRY_NOT_SUPPORTED: 'SMS goes only to mobile numbers in Switzerland, Germany and France (write German / French numbers with +49 / +33)',
  NOT_MOBILE: 'this is not a mobile number of Switzerland, Germany or France (landlines cannot get SMS)',
}

export async function specSmsOpen(db: Db, key: Buffer, q: { userId: string; projectId: string; rowId: string }, sp: { spec: AppSpec }, s: SpecSend, t: SpecTable, print: string, made: string): Promise<boolean> {
  const row = await db.dataSheetRow.findFirst({ where: { id: q.rowId, projectId: q.projectId, userId: q.userId, kind: 'project', sheet: { name: specSheetName(t.key) } } })
  if (!row) return false
  const d = decodeRow(row, key)
  if (specSmsBlocked(t, s, d.data, d.confirmed === true, await accountToday(db, q.userId)) !== null) return false
  return smsPrint(buildSpecSms(t, s, d.data, made, await readRefRows(db, key, q, t))) === print
}

export async function smsRowNow(db: Db, key: Buffer, q: { userId: string; projectId: string; rowId: string; table: string; column: string }): Promise<{ number: ReturnType<typeof normalizeSmsNumber> } | null> {
  const row = await db.dataSheetRow.findFirst({ where: { id: q.rowId, projectId: q.projectId, userId: q.userId, kind: 'project', sheet: { name: specSheetName(q.table) } } })
  if (!row) return null
  return { number: normalizeSmsNumber(decodeRow(row, key).data[q.column]) }
}

export function smsPriceNow(card: SmsPrice): 'ok' | 'closed' | 'changed' {
  const unit = (SMS_COUNTRIES as Record<string, number>)[card.country]
  if (!Number.isInteger(unit) || unit <= 0) return 'closed'
  return unit === card.unit && unit * card.segments === card.total ? 'ok' : 'changed'
}

export interface SmsCardResult {
  sendId: string
  status: 'card' | 'waiting' | 'sending'
  to: string
  written: string | null
  assumed: boolean
  text: string
  price: SmsPrice
  lastSentAt: string | null
}

const inFlight = (o: { status: string; claimedAt: Date | null; dispatchedAt: Date | null }, now: Date) =>
  o.status === 'sending' && (o.dispatchedAt ? now.getTime() - o.dispatchedAt.getTime() <= SEND_SENDING_LIMIT_MS : !!o.claimedAt && now.getTime() - o.claimedAt.getTime() <= SEND_SENDING_LIMIT_MS)

export async function createSpecSmsCard(deps: WorkSheetDeps, q: { userId: string; projectId: string; by: SheetActor; taskId?: string | null }, sendKey: unknown, rowId: unknown, now: Date = new Date()): Promise<SmsCardResult> {
  if (isSelfHosted()) throw new WorkError('UNAVAILABLE', 'SMS sends are not in this edition (self-hosted)')
  const key = await deps.dataKey(deps.db, q.userId)
  return deps.db.$transaction(async (tx) => {
    await lockProjectForWrite(tx, q.userId, q.projectId)
    const p = await tx.workProject.findFirst({ where: { id: q.projectId, userId: q.userId }, select: { kind: true, status: true, workflowId: true, workflowLinkedAt: true } })
    if (!p || p.kind !== ASSEMBLED_KIND) throw new WorkError('NOT_FOUND')
    if (p.status !== 'active' || isProjectDetached(p) || !p.workflowId) throw new WorkError('READ_ONLY')
    const sp = await readSpec(tx, key, { userId: q.userId, projectId: q.projectId })
    const s = sp?.spec.sends?.find((x) => x.key === sendKey && x.via === 'sms')
    if (!sp || !s) throw new WorkError('INVALID', `send must be one of ${(sp?.spec.sends ?? []).filter((x) => x.via === 'sms').map((x) => x.key).join(', ') || '(no SMS send in this app)'}`)
    const t = sp.spec.tables.find((x) => x.key === s.table)
    if (!t || t.hidden) throw new WorkError('NOT_FOUND', 'the table of this send is hidden')
    const row = typeof rowId === 'string' && rowId ? await tx.dataSheetRow.findFirst({ where: { id: rowId, projectId: q.projectId, userId: q.userId, kind: 'project', sheet: { name: specSheetName(t.key), template: null } } }) : null
    if (!row) throw new WorkError('NOT_FOUND', `no row ${String(rowId)} in table "${t.key}"`)
    const declared = smsDeclared(s.key)
    const open = await tx.workSend.findMany({ where: { projectId: q.projectId, userId: q.userId, kind: 'sms', declared, ref: row.id, status: { in: ['pending', 'sending'] } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true, status: true, claimedAt: true, dispatchedAt: true, payload: true } })
    const asIs = async (id: string, payload: Uint8Array, status: SmsCardResult['status']): Promise<SmsCardResult> => {
      const op = decryptJson<SendPayload>(payload, key)
      return { sendId: id, status, to: op.smsShown?.display ?? op.to?.[0] ?? '', written: op.smsShown?.written ?? null, assumed: op.smsShown?.assumed === true, text: op.text ?? '', price: op.smsPrice as SmsPrice, lastSentAt: await lastSent(tx, key, { userId: q.userId, projectId: q.projectId, declared, rowId: row.id, to: op.to?.[0] ?? '' }) }
    }
    const sending = open.find((o) => inFlight(o, now))
    if (sending) return asIs(sending.id, sending.payload, 'sending')
    const d = decodeRow(row, key)
    const today = await accountToday(tx, q.userId, now)
    const why = specSmsBlocked(t, s, d.data, d.confirmed === true, today)
    if (why) throw new WorkError('INVALID', why)
    const col = smsColumnOf(s)
    const num = normalizeSmsNumber(d.data[col])
    if (!num.ok) throw new WorkError('INVALID', `${num.code} — ${NUMBER_WHY[num.code]}`)
    const text = buildSpecSms(t, s, d.data, today, await readRefRows(tx, key, q, t))
    if (!text) throw new WorkError('INVALID', 'EMPTY_TEXT — the text of this SMS is empty for this row')
    const price = smsPriceFor(num.country, text)
    if (!price) throw new WorkError('INVALID', `TOO_LONG — this SMS is over 3 parts (${text.length} characters); shorten the text${num.country === 'FR' ? ' (France: keep 20 characters free)' : ''}`)
    const written = typeof d.data[col] === 'string' ? String(d.data[col]).trim().slice(0, 40) : null
    const pend = open.filter((o) => o.status === 'pending')
    const latest = pend[0]
    const keep = latest && (() => { const op = decryptJson<SendPayload>(latest.payload, key); return op.text === text && op.to?.[0] === num.e164 && op.smsPrice?.total === price.total && op.smsPrice?.segments === price.segments && op.smsShown?.assumed === num.assumed && (op.smsShown?.written ?? null) === written })() ? latest : null
    for (const o of pend) {
      if (o === keep) continue
      const r = await tx.workSend.updateMany({ where: { id: o.id, status: 'pending' }, data: { status: 'discarded', code: 'REPLACED', decidedBy: actorLabel(q.by), decidedAt: now } })
      if (r.count === 1) await writeWorkEvent(tx, key, { userId: q.userId, projectId: q.projectId, actor: q.by, action: 'send_discard', detail: { sendId: o.id, code: 'REPLACED' } })
    }
    if (keep) return asIs(keep.id, keep.payload, 'waiting')
    const payload: SendPayload = { to: [num.e164], smsColumn: col, text, smsPrice: price, smsShown: { display: num.display, written, assumed: num.assumed }, refKey: smsRefKey(s, text, today) }
    const c = await createSendTx(tx, key, { userId: q.userId, projectId: q.projectId, taskId: q.taskId ?? null, workflowId: p.workflowId, kind: 'sms', slot: SMS_SLOT, declared, auto: false, payload, requestedBy: q.by, ref: row.id })
    return { sendId: c.id, status: 'card', to: num.display, written, assumed: num.assumed, text, price, lastSentAt: await lastSent(tx, key, { userId: q.userId, projectId: q.projectId, declared, rowId: row.id, to: num.e164 }) }
  })
}

async function lastSent(db: Db, key: Buffer, q: { userId: string; projectId: string; declared: string; rowId: string; to: string }): Promise<string | null> {
  const sent = await db.workSend.findMany({ where: { projectId: q.projectId, userId: q.userId, kind: 'sms', declared: q.declared, ref: q.rowId, status: 'sent' }, orderBy: { dispatchedAt: 'desc' }, take: 50, select: { dispatchedAt: true, payload: true } })
  const hit = sent.find((o) => decryptJson<SendPayload>(o.payload, key).to?.[0] === q.to)
  return hit?.dispatchedAt?.toISOString() ?? null
}

export async function smsSendRisk(db: Db, key: Buffer, k: { userId: string; projectId: string; sendId: string }, now: Date = new Date()): Promise<{ code: 'SENDING_IN_PROGRESS' | 'DUPLICATE_RISK'; at?: Date } | null> {
  const me = await db.workSend.findFirst({ where: { id: k.sendId, projectId: k.projectId, userId: k.userId }, select: { kind: true, declared: true, ref: true, payload: true } })
  if (!me || me.kind !== 'sms' || !isSmsDeclared(me.declared) || !me.ref) return null
  const myTo = decryptJson<SendPayload>(me.payload, key).to?.[0]
  const others = await db.workSend.findMany({ where: { projectId: k.projectId, userId: k.userId, kind: 'sms', declared: me.declared, ref: me.ref, id: { not: k.sendId }, status: { in: ['sending', 'unknown', 'sent'] } }, select: { status: true, claimedAt: true, dispatchedAt: true, payload: true } })
  if (others.some((o) => inFlight(o, now))) return { code: 'SENDING_IN_PROGRESS' }
  const mine = others.filter((o) => o.dispatchedAt && decryptJson<SendPayload>(o.payload, key).to?.[0] === myTo)
  const risky = mine.filter((o) => o.status === 'unknown' || o.status === 'sending')
  const lastOk = mine.filter((o) => o.status === 'sent').reduce<number>((m, o) => Math.max(m, o.dispatchedAt!.getTime()), -Infinity)
  const open = risky.filter((o) => o.dispatchedAt!.getTime() > lastOk).sort((a, b) => b.dispatchedAt!.getTime() - a.dispatchedAt!.getTime())
  return open.length ? { code: 'DUPLICATE_RISK', at: open[0].dispatchedAt! } : null
}

export const smsMadeDay = (made: string | undefined, today: string) => (made && isCalendarDate(made) ? made : today)
