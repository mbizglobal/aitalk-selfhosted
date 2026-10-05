import type { PrismaClient } from '@prisma/client'
import { getCalendarAccountAccessToken } from '@/lib/google/access-token'
import { getMicrosoftCalendarAccountAccessToken } from '@/lib/microsoft/access-token'

const MAX_ROWS = 200
const CONCURRENCY = 8
const FETCH_TIMEOUT_MS = 8000
const TOKEN_TIMEOUT_MS = 8000
const RECONCILE_BUDGET_MS = 22000

interface Group {
  provider: string
  accountId: string
  calendarId: string
}
interface Candidate extends Group {
  id: string
  externalEventId: string
  startAt: Date
  endAt: Date
}

type Resolved =
  | { kind: 'cancelled' }
  | { kind: 'moved'; startAt: Date; endAt: Date }
  | { kind: 'unchanged' }
  | { kind: 'skip' }

const groupKey = (g: Group) => JSON.stringify([g.provider, g.accountId, g.calendarId])

function tfetch(url: string, token: string): Promise<Response> {
  return fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
}

function raceTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  const T_OUT = Symbol('timeout')
  return Promise.race([p, new Promise<typeof T_OUT>((r) => setTimeout(() => r(T_OUT), ms))]).then((v) =>
    v === T_OUT ? fallback : (v as T)
  )
}

async function runBatched<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn))
  }
}

function parseIso(s: unknown): Date | null {
  if (typeof s !== 'string' || !s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

async function probeGoogle(token: string, calendarId: string): Promise<boolean> {
  try {
    const r = await tfetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId || 'primary')}`, token)
    return r.ok
  } catch {
    return false
  }
}
async function probeMicrosoft(token: string, calendarId: string): Promise<boolean> {
  const url = calendarId
    ? `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(calendarId)}`
    : 'https://graph.microsoft.com/v1.0/me/calendar'
  try {
    const r = await tfetch(url, token)
    return r.ok
  } catch {
    return false
  }
}

async function resolveGoogle(token: string, c: Candidate): Promise<Resolved> {
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
    c.calendarId || 'primary'
  )}/events/${encodeURIComponent(c.externalEventId)}`
  const res = await tfetch(url, token)
  if (res.status === 404 || res.status === 410) return { kind: 'cancelled' }
  if (!res.ok) return { kind: 'skip' }
  const data = await res.json()
  if (data?.status === 'cancelled') return { kind: 'cancelled' }
  if ((Array.isArray(data?.recurrence) && data.recurrence.length > 0) || data?.recurringEventId) return { kind: 'skip' }
  const start = parseIso(data?.start?.dateTime)
  const end = parseIso(data?.end?.dateTime)
  if (!start) return { kind: 'unchanged' }
  if (start.getTime() !== c.startAt.getTime() || (end && end.getTime() !== c.endAt.getTime())) {
    return { kind: 'moved', startAt: start, endAt: end ?? start }
  }
  return { kind: 'unchanged' }
}

async function resolveMicrosoft(token: string, c: Candidate): Promise<Resolved> {
  const url = c.calendarId
    ? `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(c.calendarId)}/events/${encodeURIComponent(c.externalEventId)}`
    : `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(c.externalEventId)}`
  const res = await tfetch(url, token)
  if (res.status === 404 || res.status === 410) return { kind: 'cancelled' }
  if (!res.ok) return { kind: 'skip' }
  const data = await res.json()
  if (data?.isCancelled === true) return { kind: 'cancelled' }
  if (data?.type && data.type !== 'singleInstance') return { kind: 'skip' }
  const asUtc = (dt: unknown, tz: unknown): Date | null => {
    if (typeof dt !== 'string' || !dt) return null
    const withZ = tz === 'UTC' && !/[zZ]|[+-]\d\d:?\d\d$/.test(dt) ? dt + 'Z' : dt
    return parseIso(withZ)
  }
  const start = asUtc(data?.start?.dateTime, data?.start?.timeZone)
  const end = asUtc(data?.end?.dateTime, data?.end?.timeZone)
  if (!start) return { kind: 'unchanged' }
  if (start.getTime() !== c.startAt.getTime() || (end && end.getTime() !== c.endAt.getTime())) {
    return { kind: 'moved', startAt: start, endAt: end ?? start }
  }
  return { kind: 'unchanged' }
}

export async function reconcileBookingIndex(prisma: PrismaClient, userId: string): Promise<number> {
  const now = new Date()
  const past7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

  const rows = (await prisma.bookingIndex.findMany({
    where: {
      userId,
      status: 'confirmed',
      OR: [{ startAt: { gt: now } }, { createdAt: { gte: past7d } }],
    },
    select: { id: true, accountId: true, provider: true, calendarId: true, externalEventId: true, startAt: true, endAt: true },
    orderBy: { startAt: 'asc' },
    take: MAX_ROWS,
  })) as Candidate[]

  if (rows.length === 0) return 0

  const tokenByAccount = new Map<string, string | null>()
  const getToken = async (provider: string, accountId: string): Promise<string | null> => {
    if (tokenByAccount.has(accountId)) return tokenByAccount.get(accountId)!
    let token: string | null = null
    try {
      const p =
        provider === 'google'
          ? getCalendarAccountAccessToken(prisma, accountId)
          : getMicrosoftCalendarAccountAccessToken(prisma, accountId)
      token = await raceTimeout(p.then((t) => t || null).catch(() => null), TOKEN_TIMEOUT_MS, null)
    } catch {
      token = null
    }
    tokenByAccount.set(accountId, token)
    return token
  }

  const groups = new Map<string, Group>()
  for (const r of rows) groups.set(groupKey(r), { provider: r.provider, accountId: r.accountId, calendarId: r.calendarId })
  const accessible = new Map<string, boolean>()
  await runBatched([...groups.values()], CONCURRENCY, async (g) => {
    const token = await getToken(g.provider, g.accountId)
    if (!token) {
      accessible.set(groupKey(g), false)
      return
    }
    const ok = g.provider === 'google' ? await probeGoogle(token, g.calendarId) : await probeMicrosoft(token, g.calendarId)
    accessible.set(groupKey(g), ok)
  })

  const deadline = Date.now() + RECONCILE_BUDGET_MS
  let changed = 0
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    if (Date.now() > deadline) break
    const batch = rows.slice(i, i + CONCURRENCY)
    await Promise.all(
      batch.map(async (c) => {
        if (!accessible.get(groupKey(c))) return
        const token = tokenByAccount.get(c.accountId)
        if (!token) return
        let r: Resolved
        try {
          r = c.provider === 'google' ? await resolveGoogle(token, c) : await resolveMicrosoft(token, c)
        } catch {
          return
        }
        try {
          if (r.kind === 'cancelled') {
            await prisma.bookingIndex.update({ where: { id: c.id }, data: { status: 'cancelled', cancelledAt: new Date() } })
            changed++
          } else if (r.kind === 'moved') {
            await prisma.bookingIndex.update({ where: { id: c.id }, data: { startAt: r.startAt, endAt: r.endAt } })
            changed++
          }
        } catch (e) {
          console.error('[BookingIndex/reconcile] update failed', e)
        }
      })
    )
  }
  return changed
}
