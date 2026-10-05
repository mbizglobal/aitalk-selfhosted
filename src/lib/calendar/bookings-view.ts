
import type { PrismaClient } from '@prisma/client'
import { getCalendarAccountAccessToken } from '@/lib/google/access-token'
import { getMicrosoftCalendarAccountAccessToken } from '@/lib/microsoft/access-token'
import { parseEventDescription } from '@/lib/calendar/masking'
import { descriptionText } from '@/lib/calendar/capacity'
import { notesFromDescription } from '@/lib/calendar/booking-message'

const CACHE_TTL_MS = 5 * 60 * 1000
const FETCH_TIMEOUT_MS = 8000
const MAX_RESULTS = 250

export interface CalendarNodeOut {
  workflowId: string
  workflowName: string
  agentId: string
  agentTitle: string
  nodeId: string
  nodeName: string
  type: 'google' | 'microsoft'
  connectionId: string
  calendarId: string
  timezone: string
}

export interface EventOut {
  id: string
  time: string
  duration: number
  name: string
  phone: string
  notes: string
  htmlLink: string
}

export interface CalendarMonthData {
  success: true
  timezone: string
  year: number
  month: number
  settings: {
    weeklyClosedDays?: any
    holidays?: any[]
    closedRanges?: any[]
  }
  eventsByDate: Record<string, EventOut[]>
  truncated: boolean
  cached: boolean
}

export type CoreResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string }

export async function userHasCalendarNode(prisma: PrismaClient, userId: string): Promise<boolean> {
  const activeConns = await prisma.workflowConnection.findMany({
    where: { userId, status: 'active', provider: { in: ['google_workspace', 'microsoft_workspace'] } },
    select: { id: true },
  })
  if (activeConns.length === 0) return false
  const activeIds = activeConns.map((c) => c.id)

  const withAccount = new Set(
    (
      await prisma.workflowCalendarAccount.findMany({
        where: { connectionId: { in: activeIds }, status: 'active' },
        select: { connectionId: true },
      })
    ).map((a) => a.connectionId)
  )
  if (withAccount.size === 0) return false

  const workflows = await prisma.workflow.findMany({
    where: { agent: { userId }, status: { not: 'archived' } },
    select: { workflowJson: true },
  })
  for (const wf of workflows) {
    let parsed: any
    try {
      parsed = JSON.parse(wf.workflowJson)
    } catch {
      continue
    }
    const nodes = Array.isArray(parsed?.nodes) ? parsed.nodes : []
    for (const n of nodes) {
      const d = n?.data || {}
      if (d.nodeType !== 'google_calendar' && d.nodeType !== 'microsoft_calendar') continue
      const cid = typeof d.connectionId === 'string' ? d.connectionId : ''
      if (cid && withAccount.has(cid)) return true
    }
  }
  return false
}

export async function listUserCalendars(prisma: PrismaClient, userId: string): Promise<CalendarNodeOut[]> {
  const workflows = await prisma.workflow.findMany({
    where: { agent: { userId }, status: { not: 'archived' } },
    select: {
      workflowId: true,
      name: true,
      agentId: true,
      workflowJson: true,
      agent: { select: { title: true } },
    },
    orderBy: { updatedAt: 'desc' },
  })

  const activeConnectionIds = new Set(
    (
      await prisma.workflowConnection.findMany({
        where: {
          userId,
          status: 'active',
          provider: { in: ['google_workspace', 'microsoft_workspace'] },
        },
        select: { id: true },
      })
    ).map((c) => c.id)
  )

  const connectionsWithActiveAccount = new Set(
    (
      await prisma.workflowCalendarAccount.findMany({
        where: { connectionId: { in: [...activeConnectionIds] }, status: 'active' },
        select: { connectionId: true },
      })
    ).map((a) => a.connectionId)
  )

  const out: CalendarNodeOut[] = []
  for (const wf of workflows) {
    let parsed: any
    try {
      parsed = JSON.parse(wf.workflowJson)
    } catch {
      continue
    }
    const nodes = Array.isArray(parsed?.nodes) ? parsed.nodes : []
    for (const n of nodes) {
      const data = n?.data || {}
      const isGoogle = data.nodeType === 'google_calendar'
      const isMs = data.nodeType === 'microsoft_calendar'
      if (!isGoogle && !isMs) continue
      const connectionId = typeof data.connectionId === 'string' ? data.connectionId : ''
      if (!connectionId || !activeConnectionIds.has(connectionId)) continue
      if (!connectionsWithActiveAccount.has(connectionId)) continue
      out.push({
        workflowId: wf.workflowId,
        workflowName: wf.name,
        agentId: wf.agentId,
        agentTitle: wf.agent?.title || '',
        nodeId: String(n.id),
        nodeName: String(data.label || (isGoogle ? 'Google Calendar' : 'Microsoft Calendar')),
        type: isGoogle ? 'google' : 'microsoft',
        connectionId,
        calendarId: typeof data.calendarId === 'string' ? data.calendarId : 'primary',
        timezone: typeof data.timezone === 'string' ? data.timezone : 'Europe/Zurich',
      })
    }
  }
  return out
}

interface CachedResponse {
  data: CalendarMonthData
  expiresAt: number
}
const cache = new Map<string, CachedResponse>()

export interface LoadMonthParams {
  workflowId: string
  nodeId: string
  year: number
  month: number
  refresh?: boolean
}

export async function loadCalendarMonth(
  prisma: PrismaClient,
  userId: string,
  params: LoadMonthParams
): Promise<CoreResult<CalendarMonthData>> {
  const { workflowId, nodeId, year, month } = params
  const refresh = !!params.refresh

  if (
    !workflowId ||
    !nodeId ||
    !Number.isInteger(year) ||
    year < 2000 ||
    year > 2100 ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  ) {
    return { ok: false, status: 400, error: 'workflowId, nodeId, year, month required' }
  }

  const workflow = await prisma.workflow.findFirst({
    where: { workflowId, agent: { userId } },
    select: { workflowJson: true },
  })
  if (!workflow) return { ok: false, status: 404, error: 'Workflow not found' }

  let parsed: any
  try {
    parsed = JSON.parse(workflow.workflowJson)
  } catch {
    return { ok: false, status: 500, error: 'Invalid workflow JSON' }
  }
  const targetNode = (Array.isArray(parsed?.nodes) ? parsed.nodes : []).find((n: any) => String(n?.id) === nodeId)
  if (!targetNode) return { ok: false, status: 404, error: 'Node not found' }

  const data = targetNode.data || {}
  const isGoogle = data.nodeType === 'google_calendar'
  const isMs = data.nodeType === 'microsoft_calendar'
  if (!isGoogle && !isMs) return { ok: false, status: 400, error: 'Not a Calendar node' }

  const connectionId = String(data.connectionId || '')
  if (!connectionId) return { ok: false, status: 400, error: 'Connection not configured' }
  const calendarId = String(data.calendarId || 'primary')
  const timezone = String(data.timezone || 'Europe/Zurich')

  const conn = await prisma.workflowConnection.findFirst({
    where: {
      id: connectionId,
      userId,
      status: 'active',
      provider: isGoogle ? 'google_workspace' : 'microsoft_workspace',
    },
    select: { id: true },
  })
  if (!conn) return { ok: false, status: 404, error: 'Connection not active' }

  let accountId = ''
  const explicitAccountId = String(data.accountId || '').trim()
  if (explicitAccountId) {
    const acc = await prisma.workflowCalendarAccount.findFirst({
      where: { id: explicitAccountId, connectionId, status: 'active' },
      select: { id: true },
    })
    if (!acc) {
      return { ok: false, status: 404, error: 'Selected calendar account is not active. Reconnect the account.' }
    }
    accountId = acc.id
  } else {
    const first = await prisma.workflowCalendarAccount.findFirst({
      where: { connectionId, status: 'active' },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    })
    if (!first) return { ok: false, status: 404, error: 'No calendar account linked to this connection' }
    accountId = first.id
  }

  const cacheKey = `${userId}:${workflowId}:${nodeId}:${connectionId}:${accountId}:${calendarId}:${timezone}:${year}-${month}`
  if (!refresh) {
    const hit = cache.get(cacheKey)
    if (hit && hit.expiresAt > Date.now()) {
      return { ok: true, data: { ...hit.data, cached: true } }
    }
  }

  const { timeMinIso, timeMaxIso } = monthRangeIso(year, month, timezone)

  let raw: any[] = []
  let truncated = false
  try {
    if (isGoogle) {
      const accessToken = await getCalendarAccountAccessToken(prisma, accountId)
      const url = new URL(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`
      )
      url.searchParams.set('timeMin', timeMinIso)
      url.searchParams.set('timeMax', timeMaxIso)
      url.searchParams.set('singleEvents', 'true')
      url.searchParams.set('orderBy', 'startTime')
      url.searchParams.set('maxResults', String(MAX_RESULTS))
      const r = await fetchWithTimeout(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } })
      const body = await r.json()
      if (!r.ok) {
        return { ok: false, status: r.status, error: body.error?.message || `events.list failed (${r.status})` }
      }
      raw = Array.isArray(body.items) ? body.items : []
      if (body.nextPageToken) truncated = true
    } else {
      const accessToken = await getMicrosoftCalendarAccountAccessToken(prisma, accountId)
      const calPath =
        calendarId && calendarId !== 'primary'
          ? `/me/calendars/${encodeURIComponent(calendarId)}/calendarView`
          : `/me/calendarView`
      const url = new URL(`https://graph.microsoft.com/v1.0${calPath}`)
      url.searchParams.set('startDateTime', timeMinIso)
      url.searchParams.set('endDateTime', timeMaxIso)
      url.searchParams.set('$top', String(MAX_RESULTS))
      url.searchParams.set('$orderby', 'start/dateTime')
      const r = await fetchWithTimeout(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}`, Prefer: `outlook.timezone="${timezone}"` },
      })
      const body = await r.json()
      if (!r.ok) {
        return { ok: false, status: r.status, error: body.error?.message || `calendarView failed (${r.status})` }
      }
      raw = Array.isArray(body.value) ? body.value : []
      if (body['@odata.nextLink']) truncated = true
    }
  } catch (e: any) {
    return { ok: false, status: 500, error: e?.message || 'Failed to load events' }
  }

  const eventsByDate = normalizeEvents(raw, isGoogle ? 'google' : 'microsoft', timezone)

  const responseData: CalendarMonthData = {
    success: true,
    timezone,
    year,
    month,
    settings: {
      weeklyClosedDays: data.weeklyClosedDays,
      holidays: Array.isArray(data.holidays) ? data.holidays : undefined,
      closedRanges: Array.isArray(data.closedRanges) ? data.closedRanges : undefined,
    },
    eventsByDate,
    truncated,
    cached: false,
  }

  cacheSet(cacheKey, { data: responseData, expiresAt: Date.now() + CACHE_TTL_MS })
  return { ok: true, data: responseData }
}

const CACHE_MAX = 500
function cacheSet(key: string, value: CachedResponse) {
  cache.set(key, value)
  if (cache.size <= CACHE_MAX) return
  const now = Date.now()
  for (const [k, v] of cache) {
    if (v.expiresAt <= now) cache.delete(k)
  }
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
}

function monthRangeIso(year: number, month: number, tz: string): { timeMinIso: string; timeMaxIso: string } {
  const startNaive = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0))
  const endNaive = new Date(Date.UTC(year, month, 1, 0, 0, 0))
  const offsetStartMin = tzOffsetMinutes(tz, startNaive)
  const offsetEndMin = tzOffsetMinutes(tz, endNaive)
  const startUtc = new Date(startNaive.getTime() - offsetStartMin * 60 * 1000)
  const endUtc = new Date(endNaive.getTime() - offsetEndMin * 60 * 1000)
  return { timeMinIso: startUtc.toISOString(), timeMaxIso: endUtc.toISOString() }
}

function tzOffsetMinutes(tz: string, date: Date): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const parts = fmt.formatToParts(date).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value
    return acc
  }, {})
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour === '24' ? '0' : parts.hour),
    Number(parts.minute),
    Number(parts.second)
  )
  return Math.round((asUtc - date.getTime()) / 60000)
}

function normalizeEvents(raw: any[], source: 'google' | 'microsoft', timezone: string): Record<string, EventOut[]> {
  const result: Record<string, EventOut[]> = {}
  for (const ev of raw) {
    if (!ev || ev.status === 'cancelled') continue
    const norm = source === 'google' ? normGoogle(ev, timezone) : normMicrosoft(ev, timezone)
    if (!norm) continue
    if (!result[norm.date]) result[norm.date] = []
    result[norm.date].push(norm.event)
  }
  for (const date of Object.keys(result)) {
    result[date].sort((a, b) => a.time.localeCompare(b.time))
  }
  return result
}

function normGoogle(ev: any, timezone: string): { date: string; event: EventOut } | null {
  const startIso: string | undefined = ev?.start?.dateTime || ev?.start?.date
  const endIso: string | undefined = ev?.end?.dateTime || ev?.end?.date
  if (!startIso) return null

  const isAllDay = !!ev?.start?.date && !ev?.start?.dateTime
  const date = isAllDay ? String(startIso) : ymdInTz(new Date(startIso), timezone)
  const time = isAllDay ? '00:00' : hhmmInTz(new Date(startIso), timezone)

  let duration = 0
  if (!isAllDay && endIso) {
    const ms = new Date(endIso).getTime() - new Date(startIso).getTime()
    duration = Math.max(0, Math.round(ms / 60000))
  }

  const text = descriptionText(ev?.description)
  const { name, phone } = parseEventDescription(text)
  return {
    date,
    event: {
      id: String(ev.id || ''),
      time,
      duration,
      name: name || '',
      phone: phone || '',
      notes: notesFromDescription(text) || '',
      htmlLink: typeof ev.htmlLink === 'string' ? ev.htmlLink : '',
    },
  }
}

function normMicrosoft(ev: any, timezone: string): { date: string; event: EventOut } | null {
  const startIso: string | undefined = ev?.start?.dateTime
  const endIso: string | undefined = ev?.end?.dateTime
  if (!startIso) return null

  const startDate = ensureUtcDate(startIso, ev?.start?.timeZone, timezone)
  const endDate = endIso ? ensureUtcDate(endIso, ev?.end?.timeZone, timezone) : null
  const date = ymdInTz(startDate, timezone)
  const time = hhmmInTz(startDate, timezone)
  const duration = endDate ? Math.max(0, Math.round((endDate.getTime() - startDate.getTime()) / 60000)) : 0

  const description: string =
    typeof ev?.body?.content === 'string'
      ? ev.body.content
      : typeof ev?.bodyPreview === 'string'
        ? ev.bodyPreview
        : ''
  const text = descriptionText(description)
  const { name, phone } = parseEventDescription(text)
  return {
    date,
    event: {
      id: String(ev.id || ''),
      time,
      duration,
      name: name || '',
      phone: phone || '',
      notes: notesFromDescription(text) || '',
      htmlLink: typeof ev.webLink === 'string' ? ev.webLink : '',
    },
  }
}

function ymdInTz(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const y = parts.find((p) => p.type === 'year')?.value || '0000'
  const mo = parts.find((p) => p.type === 'month')?.value || '01'
  const da = parts.find((p) => p.type === 'day')?.value || '01'
  return `${y}-${mo}-${da}`
}

function hhmmInTz(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const h = parts.find((p) => p.type === 'hour')?.value || '00'
  const m = parts.find((p) => p.type === 'minute')?.value || '00'
  return `${h === '24' ? '00' : h}:${m}`
}

function ensureUtcDate(iso: string, embeddedTz: string | undefined, fallbackTz: string): Date {
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(iso)) return new Date(iso)
  const tz = embeddedTz || fallbackTz
  const local = new Date(iso + 'Z')
  const offsetMin = tzOffsetMinutes(tz, local)
  return new Date(local.getTime() - offsetMin * 60 * 1000)
}
