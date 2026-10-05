
export type Weekday =
  | 'sunday'
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'

const WEEKDAY_KEYS: ReadonlyArray<Weekday> = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
]

export interface WeeklyClosedDayConfig {
  closed: boolean
  partialOpenStart?: string
  partialOpenEnd?: string
  message?: string
}

export interface HolidayEntry {
  date: string
  name: string
  origin?: 'auto' | 'manual'
  message?: string
  subdivisions?: string[]
}

export interface ClosedRangeEntry {
  startDate: string
  endDate: string
  name: string
  message?: string
}

export interface ClosedDaySettings {
  weeklyClosedDays?: Partial<Record<Weekday, WeeklyClosedDayConfig>>
  holidays?: HolidayEntry[]
  closedRanges?: ClosedRangeEntry[]
}

export type DayStatus =
  | { kind: 'open' }
  | { kind: 'partial'; openStart: string; openEnd: string; weekday: Weekday; message?: string }
  | { kind: 'holiday'; date: string; name: string; message?: string }
  | { kind: 'range'; startDate: string; endDate: string; name: string; message?: string }
  | { kind: 'weekly'; weekday: Weekday; message?: string }

export function weekdayFromYmd(ymd: string): Weekday | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return null
  const [, y, mo, da] = m
  const d = new Date(`${y}-${mo}-${da}T12:00:00Z`)
  if (!Number.isFinite(d.getTime())) return null
  return WEEKDAY_KEYS[d.getUTCDay()]
}

export function computeDayStatus(date: string, settings: ClosedDaySettings): DayStatus {
  // 1) Holiday — exact date match
  const holiday = settings.holidays?.find((h) => h.date === date)
  if (holiday) {
    return {
      kind: 'holiday',
      date: holiday.date,
      name: holiday.name,
      message: holiday.message,
    }
  }

  const range = settings.closedRanges?.find((r) => date >= r.startDate && date <= r.endDate)
  if (range) {
    return {
      kind: 'range',
      startDate: range.startDate,
      endDate: range.endDate,
      name: range.name,
      message: range.message,
    }
  }

  // 3) Weekly closed day
  const weekday = weekdayFromYmd(date)
  if (!weekday) return { kind: 'open' }
  const cfg = settings.weeklyClosedDays?.[weekday]
  if (!cfg?.closed) return { kind: 'open' }

  if (cfg.partialOpenStart && cfg.partialOpenEnd) {
    return {
      kind: 'partial',
      openStart: cfg.partialOpenStart,
      openEnd: cfg.partialOpenEnd,
      weekday,
      message: cfg.message,
    }
  }
  return { kind: 'weekly', weekday, message: cfg.message }
}

export function weekdayDisplay(wd: Weekday): string {
  return wd.charAt(0).toUpperCase() + wd.slice(1)
}
