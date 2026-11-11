
import { createHash } from 'crypto'
import type { Prisma, PrismaClient } from '@prisma/client'
import { WorkError } from './errors'
import { isSelfHosted } from '@/lib/edition'
import { decryptJson } from './sealed'
import { decodeRow, isProjectDetached, lockProjectForWrite, actorLabel, type SheetActor, type WorkSheetDeps } from './sheet-gate'
import { writeWorkEvent } from './projects'
import { createSendTx, SEND_SENDING_LIMIT_MS, type SendPayload } from './sends'
import { isCalendarDate } from './dates'
import type { CalSlotValue } from './calendar-slot'
import {
  ASSEMBLED_KIND, NUMBER_COLUMN, TIME_RE, accountToday, placeholderValues, readRefRows, readSpec, specSendBlocked, specSheetName,
  type AppSpec, type RefRows, type SpecSend, type SpecTable,
} from './assembled'

type Db = PrismaClient | Prisma.TransactionClient

export const CAL_DECLARED_PREFIX = 'assembled.calendar:'
export const calDeclared = (sendKey: string) => `${CAL_DECLARED_PREFIX}${sendKey}`
export const isCalDeclared = (d: string | null | undefined): boolean => typeof d === 'string' && d.startsWith(CAL_DECLARED_PREFIX)
export const CAL_SLOT = 'cal'
export const CAL_RETRIED = 'RETRIED'
export const CAL_DELETED = 'DELETED_IN_CALENDAR'
const TITLE_MAX = 200
const DESC_MAX = 4000

export type CalProvider = 'google' | 'microsoft'
export interface CalTarget {
  connectionId: string
  accountId: string
  calendarId: string
  provider: CalProvider
  label: string
}
export interface CalEvent {
  title: string
  description: string
  allDay: boolean
  start: string
  end: string
  timeZone: string
}

export function addDaysIso(d: string, n: number): string | null {
  if (!isCalendarDate(d)) return null
  const t = new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)) + n))
  return t.toISOString().slice(0, 10)
}

export function addMinutesWall(date: string, time: string, minutes: number): { date: string; time: string } | null {
  if (!isCalendarDate(date) || !TIME_RE.test(time)) return null
  const total = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) + minutes
  const days = Math.floor(total / 1440)
  const rest = total - days * 1440
  const d = addDaysIso(date, days)
  if (!d) return null
  return { date: d, time: `${String(Math.floor(rest / 60)).padStart(2, '0')}:${String(rest % 60).padStart(2, '0')}` }
}

const wall = (d: string, t: string) => `${d}T${t}:00`

export function buildSpecEvent(spec: Pick<AppSpec, 'name'>, t: SpecTable, s: SpecSend, row: Readonly<Record<string, unknown>>, today: string, refRows: RefRows, timeZone: string): { event: CalEvent } | { error: string } {
  const e = s.event
  if (!e) return { error: `"${s.label}" is not a calendar send` }
  const label = (k: string) => t.columns.find((c) => c.key === k)?.label ?? k
  const str = (k: string) => (typeof row[k] === 'string' ? (row[k] as string).trim() : '')
  const date = str(e.date)
  if (!isCalendarDate(date)) return { error: `${label(e.date)} is empty — the event needs a date` }
  let endDate: string | null = null
  if (e.endDate) {
    const v = str(e.endDate)
    if (v) {
      if (!isCalendarDate(v)) return { error: `${label(e.endDate)} is not a date` }
      if (v < date) return { error: `${label(e.endDate)} is before ${label(e.date)}` }
      endDate = v
    }
  }
  let start: string, end: string
  const allDay = !e.start
  if (allDay) {
    const last = addDaysIso(endDate ?? date, 1)
    if (!last) return { error: 'the date is not valid' }
    start = date
    end = last
  } else {
    const st = str(e.start!)
    if (!TIME_RE.test(st)) return { error: `${label(e.start!)} is empty — the event needs a start time` }
    if (e.end) {
      const en = str(e.end)
      if (!TIME_RE.test(en)) return { error: `${label(e.end)} is empty — the event needs an end time` }
      const lastDay = endDate ?? date
      if (`${lastDay} ${en}` <= `${date} ${st}`) return { error: endDate ? `the end (${lastDay} ${en}) is not after the start (${date} ${st})` : `${label(e.end)} (${en}) is not after ${label(e.start!)} (${st}) — for an event past midnight use the end date column` }
      start = wall(date, st)
      end = wall(lastDay, en)
    } else {
      const to = addMinutesWall(date, st, e.minutes ?? 60)
      if (!to) return { error: 'the time is not valid' }
      start = wall(date, st)
      end = wall(to.date, to.time)
    }
  }
  const vals = placeholderValues(t, row, today, refRows)
  const fill = (x: string) => x.replace(/\{([a-z][a-z0-9_]*)\}/g, (_, k: string) => vals[k] ?? '')
  const title = fill(s.subject).replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX)
  if (!title) return { error: `the event title of "${s.label}" is empty for this row — fill the columns it uses` }
  const num = typeof row[NUMBER_COLUMN] === 'string' && row[NUMBER_COLUMN] ? ` ${row[NUMBER_COLUMN] as string}` : ''
  const body = fill(s.body).trim()
  const description = `${body ? `${body}\n\n` : ''}Created by AI Talk — ${spec.name}${num}`.slice(0, DESC_MAX)
  return { event: { title, description, allDay, start, end, timeZone } }
}

export const calEventKey = (projectId: string, sendKey: string, rowId: string) => createHash('sha256').update(`aitalk-cal\n${projectId}\n${sendKey}\n${rowId}`).digest('hex').slice(0, 32)
export const calPrint = (e: CalEvent) => createHash('sha256').update(JSON.stringify([e.title, e.description, e.allDay, e.start, e.end, e.timeZone])).digest('hex').slice(0, 16)
export const calRefKey = (s: Pick<SpecSend, 'table' | 'key'>, e: CalEvent, day: string) => `${s.table}:${s.key}:${calPrint(e)}:${day}`
const sameCal = (a: Pick<CalTarget, 'connectionId' | 'accountId' | 'calendarId'> | null | undefined, b: Pick<CalTarget, 'connectionId' | 'accountId' | 'calendarId'> | null | undefined) =>
  !!a && !!b && a.connectionId === b.connectionId && a.accountId === b.accountId && a.calendarId === b.calendarId

export function specCalendarBlocked(t: SpecTable, s: SpecSend, row: Readonly<Record<string, unknown>>, confirmed: boolean, today: string): string | null {
  if (s.allowWhen?.confirmed && !confirmed) return `"${s.label}" is only for confirmed rows`
  return specSendBlocked(t, s, row, today)
}

export async function accountTimeZone(db: Db, userId: string): Promise<string> {
  const s = await db.settings.findUnique({ where: { id: userId }, select: { timezone: true } })
  const tz = s?.timezone && s.timezone !== 'UTC' ? s.timezone : 'Europe/Zurich'
  try { new Intl.DateTimeFormat('en-CA', { timeZone: tz }); return tz } catch { return 'Europe/Zurich' }
}

export { parseCalSlot, type CalSlotValue } from './calendar-slot'

export async function calendarOwnedNow(db: Db, userId: string, agentId: string, v: Pick<CalSlotValue, 'connectionId' | 'accountId' | 'calendarId'> & { calendarName?: string }): Promise<CalTarget | null> {
  const { agentScopedWhere } = await import('@/lib/connection-scope')
  const conn = await db.workflowConnection.findFirst({
    where: { id: v.connectionId, ...agentScopedWhere({ agentId, userId }, 'Work app calendar'), provider: { in: ['google_workspace', 'microsoft_workspace'] }, status: 'active' },
    select: { id: true, provider: true },
  })
  if (!conn) return null
  const acc = await db.workflowCalendarAccount.findFirst({
    where: { id: v.accountId, connectionId: conn.id, ...agentScopedWhere({ agentId, userId }, 'Work app calendar account'), status: 'active' },
    select: { id: true, ownerEmail: true },
  })
  if (!acc) return null
  const name = v.calendarName || (v.calendarId === 'primary' ? '' : v.calendarId)
  return { connectionId: conn.id, accountId: acc.id, calendarId: v.calendarId, provider: conn.provider === 'google_workspace' ? 'google' : 'microsoft', label: name && name !== acc.ownerEmail ? `${name} (${acc.ownerEmail})` : acc.ownerEmail }
}

export async function slotCalendarNow(db: Db, userId: string, workflowId: string, slot: string = CAL_SLOT): Promise<CalTarget | null> {
  const w = await db.workflow.findFirst({ where: { workflowId, agent: { userId } }, select: { agentId: true, workflowJson: true } })
  if (!w) return null
  const { appStartSettings } = await import('./app-chat')
  const v = appStartSettings(w.workflowJson).calendarSlots[slot]
  return v ? calendarOwnedNow(db, userId, w.agentId, v) : null
}

export async function calendarForRowNow(db: Db, key: Buffer, q: { userId: string; projectId: string; workflowId: string; declared: string; rowId: string; exceptSendId?: string }): Promise<{ cal: CalTarget; from: 'history' | 'slot'; lostLabel?: string } | null> {
  const prev = await db.workSend.findFirst({
    where: {
      projectId: q.projectId, userId: q.userId, kind: 'calendar', declared: q.declared, ref: q.rowId,
      ...(q.exceptSendId ? { id: { not: q.exceptSendId } } : {}),
      OR: [{ status: { in: ['sending', 'unknown', 'sent'] } }, { status: 'discarded', code: CAL_RETRIED }],
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { payload: true },
  })
  let lostLabel: string | undefined
  if (prev) {
    const old = decryptJson<SendPayload>(prev.payload, key).cal
    if (old) {
      const w = await db.workflow.findFirst({ where: { workflowId: q.workflowId, agent: { userId: q.userId } }, select: { agentId: true } })
      const owned = w ? await calendarOwnedNow(db, q.userId, w.agentId, { ...old, calendarName: undefined }) : null
      if (owned) return { cal: { ...owned, label: old.label }, from: 'history' }
      lostLabel = old.label
    }
  }
  const now = await slotCalendarNow(db, q.userId, q.workflowId)
  return now ? { cal: now, from: 'slot', ...(lostLabel ? { lostLabel } : {}) } : null
}

export interface CalCardResult {
  sendId: string
  status: 'card' | 'waiting' | 'sending'
  to: string
  event: CalEvent
  note?: 'previous_calendar' | 'previous_calendar_lost'
}

export async function createSpecCalendarCard(deps: WorkSheetDeps, q: { userId: string; projectId: string; by: SheetActor; taskId?: string | null }, sendKey: unknown, rowId: unknown, now: Date = new Date()): Promise<CalCardResult> {
  if (isSelfHosted()) throw new WorkError('UNAVAILABLE', 'calendar sends are not in this edition (self-hosted)')
  const key = await deps.dataKey(deps.db, q.userId)
  return deps.db.$transaction(async (tx) => {
    await lockProjectForWrite(tx, q.userId, q.projectId)
    const p = await tx.workProject.findFirst({ where: { id: q.projectId, userId: q.userId }, select: { kind: true, status: true, workflowId: true, workflowLinkedAt: true } })
    if (!p || p.kind !== ASSEMBLED_KIND) throw new WorkError('NOT_FOUND')
    if (p.status !== 'active' || isProjectDetached(p) || !p.workflowId) throw new WorkError('READ_ONLY')
    const sp = await readSpec(tx, key, { userId: q.userId, projectId: q.projectId })
    const s = sp?.spec.sends?.find((x) => x.key === sendKey && x.via === 'calendar')
    if (!sp || !s) throw new WorkError('INVALID', `send must be one of ${(sp?.spec.sends ?? []).filter((x) => x.via === 'calendar').map((x) => x.key).join(', ') || '(no calendar send in this app)'}`)
    const t = sp.spec.tables.find((x) => x.key === s.table)
    if (!t || t.hidden) throw new WorkError('NOT_FOUND', 'the table of this send is hidden')
    const row = typeof rowId === 'string' && rowId ? await tx.dataSheetRow.findFirst({ where: { id: rowId, projectId: q.projectId, userId: q.userId, kind: 'project', sheet: { name: specSheetName(t.key), template: null } } }) : null
    if (!row) throw new WorkError('NOT_FOUND', `no row ${String(rowId)} in table "${t.key}"`)
    const declared = calDeclared(s.key)
    const live = await tx.workSend.findMany({ where: { projectId: q.projectId, userId: q.userId, kind: 'calendar', declared, ref: row.id, status: { in: ['pending', 'sending', 'sent', 'unknown'] } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true, status: true, createdAt: true, claimedAt: true, payload: true } })
    const asIs = (id: string, payload: Uint8Array, status: CalCardResult['status']): CalCardResult => {
      const op = decryptJson<SendPayload>(payload, key)
      return { sendId: id, status, to: op.cal?.label ?? '', event: op.event as CalEvent }
    }
    const inCal = async (when: Date, payload: Uint8Array) => new WorkError('INVALID', `ALREADY_IN_CALENDAR — this row is already in the calendar ${decryptJson<SendPayload>(payload, key).cal?.label ?? ''} (sent ${await accountToday(tx, q.userId, when)}); changing an event is not possible yet`)
    const settle = async (id: string): Promise<CalCardResult | null> => {
      const cur = await tx.workSend.findFirst({ where: { id }, select: { status: true, createdAt: true, payload: true } })
      if (cur?.status === 'sent') throw await inCal(cur.createdAt, cur.payload)
      if (cur?.status === 'sending' || cur?.status === 'unknown' || cur?.status === 'pending') return asIs(id, cur.payload, cur.status === 'pending' ? 'waiting' : 'sending')
      return null
    }
    const sent = live.find((o) => o.status === 'sent')
    if (sent) throw await inCal(sent.createdAt, sent.payload)
    for (const o of live) {
      if (o.status !== 'sending' || !o.claimedAt || now.getTime() - o.claimedAt.getTime() <= SEND_SENDING_LIMIT_MS) continue
      const r = await tx.workSend.updateMany({ where: { id: o.id, status: 'sending' }, data: { status: 'unknown' } })
      const cur = r.count === 1 ? 'unknown' : (await tx.workSend.findFirst({ where: { id: o.id }, select: { status: true } }))?.status
      if (cur === 'unknown') o.status = 'unknown'
      else { const got = await settle(o.id); if (got) return got; o.status = cur ?? 'gone' }
    }
    const sending = live.find((o) => o.status === 'sending')
    if (sending) return asIs(sending.id, sending.payload, 'sending')
    for (const u of live.filter((o) => o.status === 'unknown')) {
      const r = await tx.workSend.updateMany({ where: { id: u.id, status: 'unknown' }, data: { status: 'discarded', code: CAL_RETRIED, decidedBy: actorLabel(q.by), decidedAt: now } })
      if (r.count === 1) { await writeWorkEvent(tx, key, { userId: q.userId, projectId: q.projectId, actor: q.by, action: 'send_discard', detail: { sendId: u.id, code: CAL_RETRIED } }); continue }
      const got = await settle(u.id)
      if (got) return got
    }
    const d = decodeRow(row, key)
    const today = await accountToday(tx, q.userId, now)
    const why = specCalendarBlocked(t, s, d.data, d.confirmed === true, today)
    if (why) throw new WorkError('INVALID', why)
    const target = await calendarForRowNow(tx, key, { userId: q.userId, projectId: q.projectId, workflowId: p.workflowId, declared, rowId: row.id })
    if (!target) throw new WorkError('INVALID', 'NO_CALENDAR — this app has no calendar yet; the owner picks one in the studio (Start / App node, slot "Calendar")')
    const deleted = await tx.workSend.findMany({ where: { projectId: q.projectId, userId: q.userId, kind: 'calendar', declared, ref: row.id, status: 'failed', code: CAL_DELETED }, select: { payload: true } })
    if (deleted.some((x) => sameCal(decryptJson<SendPayload>(x.payload, key).cal, target.cal))) {
      throw new WorkError('INVALID', `DELETED_IN_CALENDAR — the event of this row was deleted in the calendar ${target.cal.label}; it cannot be made again from this row`)
    }
    const built = buildSpecEvent(sp.spec, t, s, d.data, today, await readRefRows(tx, key, q, t), await accountTimeZone(tx, q.userId))
    if ('error' in built) throw new WorkError('INVALID', built.error)
    const ev = built.event
    const note: CalCardResult['note'] = target.from === 'history' ? 'previous_calendar' : target.lostLabel ? 'previous_calendar_lost' : undefined
    const pend = live.filter((o) => o.status === 'pending')
    const latest = pend[0]
    const keep = latest && (() => { const op = decryptJson<SendPayload>(latest.payload, key); return op.event && calPrint(op.event as CalEvent) === calPrint(ev) && sameCal(op.cal, target.cal) })() ? latest : null
    for (const o of pend) {
      if (o === keep) continue
      const r = await tx.workSend.updateMany({ where: { id: o.id, status: 'pending' }, data: { status: 'discarded', code: 'REPLACED', decidedBy: actorLabel(q.by), decidedAt: now } })
      if (r.count === 1) await writeWorkEvent(tx, key, { userId: q.userId, projectId: q.projectId, actor: q.by, action: 'send_discard', detail: { sendId: o.id, code: 'REPLACED' } })
      else { const got = await settle(o.id); if (got) return got }
    }
    if (keep) return { ...asIs(keep.id, keep.payload, 'waiting'), ...(note ? { note } : {}) }
    const payload: SendPayload = { calSlot: CAL_SLOT, cal: target.cal, event: ev, eventKey: calEventKey(q.projectId, s.key, row.id), refKey: calRefKey(s, ev, today), ...(note ? { calNote: note, ...(target.lostLabel ? { calLost: target.lostLabel } : {}) } : {}) }
    const c = await createSendTx(tx, key, { userId: q.userId, projectId: q.projectId, taskId: q.taskId ?? null, workflowId: p.workflowId, kind: 'calendar', slot: CAL_SLOT, declared, auto: false, payload, requestedBy: q.by, ref: row.id })
    return { sendId: c.id, status: 'card', to: target.cal.label, event: ev, ...(note ? { note } : {}) }
  })
}

export async function specCalendarOpen(db: Db, key: Buffer, q: { userId: string; projectId: string; rowId: string }, sp: { spec: AppSpec }, s: SpecSend, t: SpecTable, print: string, made: string): Promise<boolean> {
  const row = await db.dataSheetRow.findFirst({ where: { id: q.rowId, projectId: q.projectId, userId: q.userId, kind: 'project', sheet: { name: specSheetName(t.key) } } })
  if (!row) return false
  const d = decodeRow(row, key)
  if (specCalendarBlocked(t, s, d.data, d.confirmed === true, await accountToday(db, q.userId)) !== null) return false
  const built = buildSpecEvent(sp.spec, t, s, d.data, made, await readRefRows(db, key, q, t), await accountTimeZone(db, q.userId))
  return !('error' in built) && calPrint(built.event) === print
}
