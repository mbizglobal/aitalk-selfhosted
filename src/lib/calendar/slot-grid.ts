
type Weekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday'
const WEEKDAY_KEYS: ReadonlyArray<Weekday> = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
]

export const MAX_OPEN_SLOTS = 30

export const REQUESTED_SCAN_MAX = 2000
export const REQUESTED_SCAN_HALF_MS = 36 * 60 * 60 * 1000
export const REQUESTED_ALTERNATIVES_MAX = 3
export const REQUESTED_FALLBACK_SCAN_MAX = 20_000

export function mergeSlotsByStart<T extends { start: string }>(...lists: T[][]): T[] {
  const byStart = new Map<number, T>()
  for (const list of lists) {
    for (const slot of list) {
      const ms = new Date(slot.start).getTime()
      if (Number.isFinite(ms) && !byStart.has(ms)) byStart.set(ms, slot)
    }
  }
  return [...byStart.entries()].sort((a, b) => a[0] - b[0]).map(([, slot]) => slot)
}

export function nearestSlots<T extends { start: string }>(slots: T[], targetMs: number, max: number): T[] {
  if (max <= 0 || !Number.isFinite(targetMs)) return []
  return slots
    .map((s, i) => ({ s, i, d: Math.abs(new Date(s.start).getTime() - targetMs) }))
    .filter((x) => Number.isFinite(x.d))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .slice(0, max)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.s)
}

export interface RequestedTimeAnswer {
  requested: string
  available: boolean
  alternatives: string[]
}

export function answerRequestedTime<T extends { start: string }>(slots: T[], requestedIso: string): RequestedTimeAnswer {
  const target = new Date(requestedIso).getTime()
  const available = Number.isFinite(target) && slots.some((s) => new Date(s.start).getTime() === target)
  return {
    requested: requestedIso,
    available,
    alternatives: available ? [] : nearestSlots(slots, target, REQUESTED_ALTERNATIVES_MAX).map((s) => s.start),
  }
}

export function requestedMsInWindow(requestedIso: string | null, startIso: string, endIso: string): number | null {
  if (!requestedIso) return null
  const ms = new Date(requestedIso).getTime()
  const s = new Date(startIso).getTime()
  const e = new Date(endIso).getTime()
  if (!Number.isFinite(ms) || !Number.isFinite(s) || !Number.isFinite(e)) return null
  return ms >= s && ms < e ? ms : null
}

export function requestedScanWindow(requestedMs: number, startIso: string, endIso: string): { start: string; end: string } {
  const s = Math.max(new Date(startIso).getTime(), requestedMs - REQUESTED_SCAN_HALF_MS)
  const e = Math.min(new Date(endIso).getTime(), requestedMs + REQUESTED_SCAN_HALF_MS)
  return { start: new Date(s).toISOString(), end: new Date(e).toISOString() }
}

export function shapeRequestedSlots<T extends { start: string }>(
  allSlots: T[],
  requestedIso: string | null,
  requestedMs: number | null,
  fallbackSlots: T[] = [],
): { openSlots: T[]; fields: Record<string, unknown> } {
  if (!requestedIso) return { openSlots: allSlots, fields: {} }
  if (requestedMs === null) {
    return {
      openSlots: allSlots,
      fields: {
        requestedTime: { requested: requestedIso, outsideSearchWindow: true },
        requestedTimeNote: 'requested_start_iso is outside start_iso–end_iso, so it was not checked. Call again with a window that includes it before saying anything about that time.',
      },
    }
  }
  const pool = fallbackSlots.length > 0 ? fallbackSlots : allSlots
  return {
    openSlots: nearestSlots(pool, requestedMs, MAX_OPEN_SLOTS),
    fields: {
      requestedTime: answerRequestedTime(pool, requestedIso),
      requestedTimeNote: 'Answer the requested time first: if available, say that exact time is free; if not, say so and offer "alternatives" (they are in openSlots).',
    },
  }
}
export interface BreakTime {
  start: string // 'HH:MM'
  end: string
  message?: string
}

export interface WeeklyClosedConfig {
  closed: boolean
  partialOpenStart?: string
  partialOpenEnd?: string
  message?: string
}

export interface Holiday {
  date: string // 'YYYY-MM-DD'
  name: string
  message?: string
}

export interface ClosedRange {
  startDate: string
  endDate: string
  name: string
  message?: string
}

export interface BusyInterval {
  start: string // ISO
  end: string
}

export interface GenerateOpenSlotsOpts {
  searchStart: string // ISO
  searchEnd: string
  timezone: string
  workingHoursStart: string // 'HH:MM'
  workingHoursEnd: string
  durationMin: number
  intervalMin: number
  busy?: BusyInterval[]
  breakTimes?: BreakTime[]
  weeklyClosedDays?: Partial<Record<Weekday, WeeklyClosedConfig>>
  holidays?: Holiday[]
  closedRanges?: ClosedRange[]
  maxSlots?: number
  nowMs?: number
  lastCallMin?: number
  lastCallBreakMin?: number
}

export interface OpenSlot {
  start: string // ISO with offset
  end: string
}

// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

function hhmmToMin(s: string): number {
  if (typeof s !== 'string' || !/^\d{1,2}:\d{2}$/.test(s)) return NaN
  const [h, m] = s.split(':').map(Number)
  return h * 60 + m
}

function windowEndMin(startMin: number, endHhmm: string): number {
  const e = hhmmToMin(endHhmm)
  return e === 0 && startMin > 0 ? 1440 : e
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function minToHhmm(min: number): string {
  const total = ((min % 1440) + 1440) % 1440
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${pad2(h)}:${pad2(m)}`
}

function utcToLocalParts(utcMs: number, tz: string): { date: string; hhmm: string; weekdayIdx: number } {
  const d = new Date(utcMs)
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  })
  const parts = fmt.formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value || ''
  const date = `${get('year')}-${get('month')}-${get('day')}`
  const h = Number(get('hour')) % 24
  const hhmm = `${pad2(h)}:${get('minute')}`

  const wkFmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' })
  const w = wkFmt.format(d)
  const weekdayIdx = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(w)
  return { date, hhmm, weekdayIdx }
}

function localWallToUtc(dateStr: string, hhmm: string, tz: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || !/^\d{1,2}:\d{2}$/.test(hhmm)) return NaN
  const [y, mo, d] = dateStr.split('-').map(Number)
  const [h, mi] = hhmm.split(':').map(Number)
  if ([y, mo, d, h, mi].some((n) => !Number.isFinite(n))) return NaN

  const guessUtc = Date.UTC(y, mo - 1, d, h, mi, 0)

  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  })
  const parts = fmt.formatToParts(new Date(guessUtc))
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value || '0')
  const tzWallAsUtc = Date.UTC(
    get('year'), get('month') - 1, get('day'),
    get('hour') % 24, get('minute'), get('second')
  )
  const offsetMs = tzWallAsUtc - guessUtc

  return guessUtc - offsetMs
}

export function utcToIsoWithOffset(utcMs: number, tz: string): string {
  const d = new Date(utcMs)
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  })
  const parts = fmt.formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '00'
  const wallStr = `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`

  const wallAsUtc = Date.UTC(
    Number(get('year')), Number(get('month')) - 1, Number(get('day')),
    Number(get('hour')) % 24, Number(get('minute')), Number(get('second'))
  )
  const offsetMin = Math.round((wallAsUtc - utcMs) / 60000)
  const sign = offsetMin >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMin)
  return `${wallStr}${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`
}

// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

export function generateOpenSlots<T = OpenSlot>(
  opts: GenerateOpenSlotsOpts & { accept?: (slot: OpenSlot) => T | null }
): T[] {
  const {
    searchStart, searchEnd, timezone,
    workingHoursStart, workingHoursEnd,
    durationMin, intervalMin,
    busy = [], breakTimes = [],
    weeklyClosedDays, holidays = [], closedRanges = [],
    maxSlots = 30,
    nowMs = Date.now(),
    lastCallMin,
    lastCallBreakMin,
    accept,
  } = opts
  const lastCall = { close: positiveMin(lastCallMin), break: positiveMin(lastCallBreakMin) }
  const anyLastCall = lastCall.close > 0 || lastCall.break > 0

  const result: T[] = []

  if (durationMin <= 0 || intervalMin <= 0) return result

  const wsMin = hhmmToMin(workingHoursStart)
  const weMin = windowEndMin(wsMin, workingHoursEnd)
  if (!Number.isFinite(wsMin) || !Number.isFinite(weMin) || wsMin >= weMin) return result

  const searchStartMs = new Date(searchStart).getTime()
  const searchEndMs = new Date(searchEnd).getTime()
  if (!Number.isFinite(searchStartMs) || !Number.isFinite(searchEndMs) || searchStartMs >= searchEndMs) {
    return result
  }

  const busyMs: Array<{ s: number; e: number }> = busy
    .map((b) => ({ s: new Date(b.start).getTime(), e: new Date(b.end).getTime() }))
    .filter((b) => Number.isFinite(b.s) && Number.isFinite(b.e) && b.s < b.e)

  const breakRanges: Array<{ s: number; e: number }> = breakTimes
    .map((b) => {
      const bs = hhmmToMin(b.start)
      return { s: bs, e: windowEndMin(bs, b.end) }
    })
    .filter((b) => Number.isFinite(b.s) && Number.isFinite(b.e) && b.s < b.e)

  const startDate = utcToLocalParts(searchStartMs, timezone).date
  const endDate = utcToLocalParts(searchEndMs, timezone).date

  let currentDate = startDate
  let safetyCounter = 0
  while (currentDate <= endDate && safetyCounter < 400) {
    safetyCounter++

    const closed = findClosedDayForDate(
      currentDate,
      timezone,
      holidays,
      closedRanges,
      weeklyClosedDays
    )

    let dayWsMin = wsMin
    let dayWeMin = weMin

    if (closed) {
      if (closed.kind === 'holiday' || closed.kind === 'range') {
        currentDate = nextDate(currentDate)
        continue
      }
      if (closed.kind === 'weekly' && closed.partialOpenStart && closed.partialOpenEnd) {
        const ps = hhmmToMin(closed.partialOpenStart)
        const pe = hhmmToMin(closed.partialOpenEnd)
        if (Number.isFinite(ps) && Number.isFinite(pe) && ps < pe) {
          dayWsMin = Math.max(dayWsMin, ps)
          dayWeMin = Math.min(dayWeMin, pe)
        } else {
          currentDate = nextDate(currentDate)
          continue
        }
      } else {
        currentDate = nextDate(currentDate)
        continue
      }
    }

    if (dayWsMin >= dayWeMin) {
      currentDate = nextDate(currentDate)
      continue
    }

    for (let t = dayWsMin; anyLastCall ? t < dayWeMin : t + durationMin <= dayWeMin; t += intervalMin) {
      let effDurMin = durationMin
      if (anyLastCall) {
        const fit = lastCallFit(t, durationMin, dayWeMin, breakRanges, lastCall)
        if (fit === null) continue
        effDurMin = fit
      }
      const slotStartHhmm = minToHhmm(t)
      const slotEndMin = t + effDurMin

      const slotStartMs = localWallToUtc(currentDate, slotStartHhmm, timezone)
      const slotEndMs = slotStartMs + effDurMin * 60000

      if (!Number.isFinite(slotStartMs)) continue
      if (slotStartMs < searchStartMs) continue
      if (slotStartMs < nowMs) continue
      if (slotEndMs > searchEndMs) break

      let blockedByBreak = false
      for (const br of breakRanges) {
        if (t < br.e && slotEndMin > br.s) { blockedByBreak = true; break }
      }
      if (blockedByBreak) continue

      let blockedByBusy = false
      for (const b of busyMs) {
        if (slotStartMs < b.e && slotEndMs > b.s) { blockedByBusy = true; break }
      }
      if (blockedByBusy) continue

      const slot: OpenSlot = {
        start: utcToIsoWithOffset(slotStartMs, timezone),
        end: utcToIsoWithOffset(slotEndMs, timezone),
      }
      const out = accept ? accept(slot) : (slot as unknown as T)
      if (out === null) continue
      result.push(out)
      if (result.length >= maxSlots) return result
    }

    currentDate = nextDate(currentDate)
  }

  return result
}

function positiveMin(v: unknown): number {
  return typeof v === 'number' && v > 0 ? v : 0
}

function sessionEndOf(dayEndMin: number, breakRanges: Array<{ s: number; e: number }>, t: number): { end: number; kind: 'close' | 'break' } | null {
  let end = dayEndMin
  let kind: 'close' | 'break' = 'close'
  for (const br of breakRanges) {
    if (br.s <= t && t < br.e) return null
    if (br.s > t && br.s < end) {
      end = br.s
      kind = 'break'
    }
  }
  return { end, kind }
}

function lastCallFit(
  t: number,
  durationMin: number,
  dayEndMin: number,
  breakRanges: Array<{ s: number; e: number }>,
  lastCall: { close: number; break: number },
): number | null {
  const session = sessionEndOf(dayEndMin, breakRanges, t)
  if (!session) return null
  const n = session.kind === 'break' ? lastCall.break : lastCall.close
  if (n > 0) return t <= session.end - n ? Math.min(durationMin, session.end - t) : null
  return t + durationMin <= session.end ? durationMin : null
}

export function clampToLastCall(opts: {
  startIso: string
  durationMin: number
  workingHoursStart: string
  workingHoursEnd: string
  breakTimes?: BreakTime[]
  weeklyClosedDays?: GenerateOpenSlotsOpts['weeklyClosedDays']
  timezone: string
  lastCallMin?: number
  lastCallBreakMin?: number
}): { ok: true; durationMin: number } | { ok: false } {
  const lastCall = { close: positiveMin(opts.lastCallMin), break: positiveMin(opts.lastCallBreakMin) }
  if (!lastCall.close && !lastCall.break) return { ok: true, durationMin: opts.durationMin }
  const startMs = new Date(opts.startIso).getTime()
  if (!Number.isFinite(startMs)) return { ok: true, durationMin: opts.durationMin }
  const { date, hhmm } = utcToLocalParts(startMs, opts.timezone)
  const t = hhmmToMin(hhmm)
  let dayWs = hhmmToMin(opts.workingHoursStart)
  let dayWe = windowEndMin(dayWs, opts.workingHoursEnd)
  const closed = findClosedDayForDate(date, opts.timezone, [], [], opts.weeklyClosedDays)
  if (closed?.kind === 'weekly' && closed.partialOpenStart && closed.partialOpenEnd) {
    const ps = hhmmToMin(closed.partialOpenStart)
    const pe = hhmmToMin(closed.partialOpenEnd)
    if (Number.isFinite(ps) && Number.isFinite(pe) && ps < pe) {
      dayWs = Math.max(dayWs, ps)
      dayWe = Math.min(dayWe, pe)
    }
  }
  if (!Number.isFinite(t) || !Number.isFinite(dayWs) || !Number.isFinite(dayWe) || t < dayWs || t >= dayWe) {
    return { ok: true, durationMin: opts.durationMin }
  }
  const breakRanges = (opts.breakTimes ?? [])
    .map((b) => {
      const bs = hhmmToMin(b.start)
      return { s: bs, e: windowEndMin(bs, b.end) }
    })
    .filter((b) => Number.isFinite(b.s) && Number.isFinite(b.e) && b.s < b.e)
  const session = sessionEndOf(dayWe, breakRanges, t)
  if (!session) return { ok: true, durationMin: opts.durationMin }
  const n = session.kind === 'break' ? lastCall.break : lastCall.close
  if (!n) return { ok: true, durationMin: opts.durationMin }
  if (t > session.end - n) return { ok: false }
  return { ok: true, durationMin: Math.min(opts.durationMin, session.end - t) }
}

// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

export function isSlotAligned(
  startIso: string,
  intervalMin: number,
  workingHoursStart: string,
  timezone: string
): boolean {
  if (intervalMin <= 0) return true
  const startMs = new Date(startIso).getTime()
  if (!Number.isFinite(startMs)) return false
  const { hhmm } = utcToLocalParts(startMs, timezone)
  const slotMin = hhmmToMin(hhmm)
  const wsMin = hhmmToMin(workingHoursStart)
  if (!Number.isFinite(slotMin) || !Number.isFinite(wsMin)) return false
  if (slotMin < wsMin) return false
  return (slotMin - wsMin) % intervalMin === 0
}

function localSpanMin(startMs: number, durationMin: number, tz: string): { s: number; e: number } | null {
  const sp = utcToLocalParts(startMs, tz)
  const ep = utcToLocalParts(startMs + durationMin * 60000, tz)
  const s = hhmmToMin(sp.hhmm)
  let e = hhmmToMin(ep.hhmm)
  if (!Number.isFinite(s) || !Number.isFinite(e)) return null
  if (ep.date !== sp.date) {
    if (ep.date !== nextDate(sp.date)) return null
    e += 1440
  }
  return { s, e: Math.max(e, s + durationMin) }
}

export function isWithinWorkingHours(
  startIso: string,
  durationMin: number,
  workingHoursStart: string,
  workingHoursEnd: string,
  timezone: string
): boolean {
  const startMs = new Date(startIso).getTime()
  if (!Number.isFinite(startMs) || !(durationMin > 0)) return false
  const wsMin = hhmmToMin(workingHoursStart)
  const weMin = windowEndMin(wsMin, workingHoursEnd)
  if (!Number.isFinite(wsMin) || !Number.isFinite(weMin) || wsMin >= weMin) return false
  const span = localSpanMin(startMs, durationMin, timezone)
  if (!span) return false
  return span.s >= wsMin && span.e <= weMin
}

export function findBreakOverlap<T extends BreakTime>(
  startIso: string,
  durationMin: number,
  breakTimes: T[],
  timezone: string
): T | null {
  const startMs = new Date(startIso).getTime()
  if (!Number.isFinite(startMs) || !(durationMin > 0)) return null
  const span = localSpanMin(startMs, durationMin, timezone)
  if (!span) return null
  for (const b of breakTimes) {
    const bs = hhmmToMin(b.start)
    const be = windowEndMin(bs, b.end)
    if (!Number.isFinite(bs) || !Number.isFinite(be) || bs >= be) continue
    if (span.s < be && span.e > bs) return b
  }
  return null
}

export function wallTimeToUtcMs(wall: string | null | undefined, timezone: string): number {
  if (!wall) return NaN
  if (/[Zz]$|[+-]\d{2}:?\d{2}$/.test(wall)) return new Date(wall).getTime()
  const m = wall.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?/)
  if (!m) return NaN
  const secMs = (m[3] ? Number(m[3]) * 1000 : 0) + (m[4] ? Math.round(Number(`0.${m[4]}`) * 1000) : 0)
  return localWallToUtc(m[1], m[2], timezone) + secMs
}

export function floorToGrid(
  startIso: string,
  intervalMin: number,
  workingHoursStart: string,
  timezone: string
): string | null {
  if (intervalMin <= 0) return null
  const startMs = new Date(startIso).getTime()
  if (!Number.isFinite(startMs)) return null
  const { hhmm } = utcToLocalParts(startMs, timezone)
  const slotMin = hhmmToMin(hhmm)
  const wsMin = hhmmToMin(workingHoursStart)
  if (!Number.isFinite(slotMin) || !Number.isFinite(wsMin)) return null
  if (slotMin < wsMin) return workingHoursStart
  const offset = slotMin - wsMin
  const floored = wsMin + Math.floor(offset / intervalMin) * intervalMin
  return minToHhmm(floored)
}

// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

function findClosedDayForDate(
  dateStr: string,
  timezone: string,
  holidays: Holiday[],
  closedRanges: ClosedRange[],
  weeklyClosedDays: GenerateOpenSlotsOpts['weeklyClosedDays']
):
  | { kind: 'holiday'; date: string; name: string; message?: string }
  | { kind: 'range'; startDate: string; endDate: string; name: string; message?: string }
  | { kind: 'weekly'; weekday: Weekday; partialOpenStart?: string; partialOpenEnd?: string; message?: string }
  | null {
  const h = holidays.find((x) => x.date === dateStr)
  if (h) return { kind: 'holiday', date: h.date, name: h.name, message: h.message }

  const r = closedRanges.find((x) => dateStr >= x.startDate && dateStr <= x.endDate)
  if (r) {
    return { kind: 'range', startDate: r.startDate, endDate: r.endDate, name: r.name, message: r.message }
  }

  if (!weeklyClosedDays) return null
  const probeMs = localWallToUtc(dateStr, '12:00', timezone)
  if (!Number.isFinite(probeMs)) return null
  const { weekdayIdx } = utcToLocalParts(probeMs, timezone)
  if (weekdayIdx < 0) return null
  const dayKey = WEEKDAY_KEYS[weekdayIdx]
  const cfg = weeklyClosedDays[dayKey]
  if (!cfg?.closed) return null
  return {
    kind: 'weekly',
    weekday: dayKey,
    partialOpenStart: cfg.partialOpenStart,
    partialOpenEnd: cfg.partialOpenEnd,
    message: cfg.message,
  }
}

function nextDate(dateStr: string): string {
  const [y, mo, d] = dateStr.split('-').map(Number)
  const nextMs = Date.UTC(y, mo - 1, d, 12, 0, 0) + 24 * 3600 * 1000
  const nx = new Date(nextMs)
  return `${nx.getUTCFullYear()}-${pad2(nx.getUTCMonth() + 1)}-${pad2(nx.getUTCDate())}`
}
