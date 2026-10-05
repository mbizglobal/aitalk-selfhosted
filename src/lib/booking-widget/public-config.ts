
import type { ClosedDaySettings, Weekday, WeeklyClosedDayConfig } from '@/lib/holidays/closed-day-status'
import { bookingMessagePromptOf } from '@/lib/calendar/booking-message'
import { normalizeWidgetLang, type WidgetLang } from './i18n'

export interface BookingWidgetSettings {
  title: string
  defaultLang: WidgetLang | ''
  address: string
  email: string
  emailConfirm: boolean
  confirmTtlMin: 15 | 30 | 60
  onlineMaxParty: number
  hourlyLimit: number
}

export const DEFAULT_HOURLY_LIMIT = 20
export const MAX_HOURLY_LIMIT = 200
export const PARTY_PICKER_CAP = 20

export function widgetSettingsOf(nodeData: any): BookingWidgetSettings {
  const raw = nodeData?.bookingWidget && typeof nodeData.bookingWidget === 'object' ? nodeData.bookingWidget : {}
  const limit = Number(raw.hourlyLimit)
  return {
    title: typeof raw.title === 'string' ? raw.title.trim().slice(0, 80) : '',
    defaultLang: normalizeWidgetLang(raw.defaultLang) ?? '',
    address: typeof raw.address === 'string' ? raw.address.trim().slice(0, 160) : '',
    email: typeof raw.email === 'string' && /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(raw.email.trim()) ? raw.email.trim().slice(0, 120) : '',
    emailConfirm: raw.emailConfirm === true,
    confirmTtlMin: raw.confirmTtlMin === 15 || raw.confirmTtlMin === 60 ? raw.confirmTtlMin : 30,
    onlineMaxParty: Number.isInteger(Number(raw.onlineMaxParty)) && Number(raw.onlineMaxParty) >= 1 ? Math.min(Number(raw.onlineMaxParty), 100) : 0,
    hourlyLimit: Number.isInteger(limit) && limit >= 1 ? Math.min(limit, MAX_HOURLY_LIMIT) : DEFAULT_HOURLY_LIMIT,
  }
}

export function takesPartySize(nodeData: any): boolean {
  return nodeData?.capacityMode === 'simple' || nodeData?.capacityMode === 'tables'
}

export function maxPartyOf(nodeData: any): number | null {
  if (nodeData?.capacityMode === 'simple') {
    const n = Number(nodeData.simpleCapacity)
    return Number.isInteger(n) && n > 0 ? n : 1
  }
  if (nodeData?.capacityMode === 'tables') {
    const caps = (Array.isArray(nodeData.tableInventory) ? nodeData.tableInventory : [])
      .filter((t: any) => Number(t?.count) > 0)
      .map((t: any) => Number(t?.capacity))
      .filter((n: number) => Number.isInteger(n) && n > 0)
    return caps.length ? Math.max(...caps) : null
  }
  return null
}

export function widgetMaxPartyOf(nodeData: any): number | null {
  if (!takesPartySize(nodeData)) return null
  const cal = maxPartyOf(nodeData)
  if (!cal) return null
  const online = widgetSettingsOf(nodeData).onlineMaxParty
  return Math.min(cal, online > 0 ? online : PARTY_PICKER_CAP)
}

const WEEKDAYS: Weekday[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const YMD = /^\d{4}-\d{2}-\d{2}$/
const HHMM = /^\d{2}:\d{2}$/

export function publicClosedDaysOf(nodeData: any): ClosedDaySettings {
  const weekly: Partial<Record<Weekday, WeeklyClosedDayConfig>> = {}
  const rawWeekly = nodeData?.weeklyClosedDays && typeof nodeData.weeklyClosedDays === 'object' ? nodeData.weeklyClosedDays : {}
  for (const wd of WEEKDAYS) {
    const c = rawWeekly[wd]
    if (!c || c.closed !== true) continue
    const partial = typeof c.partialOpenStart === 'string' && typeof c.partialOpenEnd === 'string'
      && HHMM.test(c.partialOpenStart) && HHMM.test(c.partialOpenEnd)
    weekly[wd] = partial ? { closed: true, partialOpenStart: c.partialOpenStart, partialOpenEnd: c.partialOpenEnd } : { closed: true }
  }
  const holidays = (Array.isArray(nodeData?.holidays) ? nodeData.holidays : [])
    .filter((h: any) => typeof h?.date === 'string' && YMD.test(h.date))
    .map((h: any) => ({ date: h.date, name: '' }))
  const closedRanges = (Array.isArray(nodeData?.closedRanges) ? nodeData.closedRanges : [])
    .filter((r: any) => typeof r?.startDate === 'string' && typeof r?.endDate === 'string' && YMD.test(r.startDate) && YMD.test(r.endDate))
    .map((r: any) => ({ startDate: r.startDate, endDate: r.endDate, name: '' }))
  return { weeklyClosedDays: weekly, holidays, closedRanges }
}

export type OpeningHours = Array<{ weekday: Weekday; ranges: Array<[string, string]> }>

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}
function toHhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}

export function openingHoursOf(nodeData: any): OpeningHours {
  const start = typeof nodeData?.workingHoursStart === 'string' && HHMM.test(nodeData.workingHoursStart) ? nodeData.workingHoursStart : '09:00'
  const end = typeof nodeData?.workingHoursEnd === 'string' && HHMM.test(nodeData.workingHoursEnd) ? nodeData.workingHoursEnd : '18:00'
  const breaks = (Array.isArray(nodeData?.breakTimes) ? nodeData.breakTimes : [])
    .filter((b: any) => typeof b?.start === 'string' && typeof b?.end === 'string' && HHMM.test(b.start) && HHMM.test(b.end))
    .map((b: any) => [toMin(b.start), toMin(b.end)] as [number, number])
    .sort((a: [number, number], b: [number, number]) => a[0] - b[0])
  const cut = (from: number, to: number): Array<[string, string]> => {
    let pieces: Array<[number, number]> = [[from, to]]
    for (const [bs, be] of breaks) {
      pieces = pieces.flatMap(([ps, pe]) => {
        if (be <= ps || bs >= pe) return [[ps, pe] as [number, number]]
        const out: Array<[number, number]> = []
        if (bs > ps) out.push([ps, bs])
        if (be < pe) out.push([be, pe])
        return out
      })
    }
    return pieces.filter(([a, b]) => b > a).map(([a, b]) => [toHhmm(a), toHhmm(b)])
  }
  const weekly = publicClosedDaysOf(nodeData).weeklyClosedDays ?? {}
  const order: Weekday[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
  return order.map((wd) => {
    const c = weekly[wd]
    if (c?.closed && c.partialOpenStart && c.partialOpenEnd) return { weekday: wd, ranges: cut(toMin(c.partialOpenStart), toMin(c.partialOpenEnd)) }
    if (c?.closed) return { weekday: wd, ranges: [] }
    return { weekday: wd, ranges: cut(toMin(start), toMin(end)) }
  })
}

export interface PublicBookingConfig {
  title: string
  timezone: string
  party: { max: number } | null
  bookingWindowDays: number
  closed: ClosedDaySettings
  askMessage: boolean
  emailConfirm: boolean
  confirmTtlMin: number
  contactPhone: string | null
  defaultLang: WidgetLang
  info: { openingHours: OpeningHours; address: string | null; email: string | null }
  available: boolean
}

export function widgetDefaultLangOf(nodeData: any, workflowLang?: string | null, accountLocale?: string | null): WidgetLang {
  return widgetSettingsOf(nodeData).defaultLang || normalizeWidgetLang(workflowLang) || normalizeWidgetLang(accountLocale) || 'en'
}

export function buildPublicConfig(input: {
  agentName: string
  nodeData: any
  contactPhone?: string | null
  available: boolean
  workflowLang?: string | null
  accountLocale?: string | null
}): PublicBookingConfig {
  const { nodeData } = input
  const settings = widgetSettingsOf(nodeData)
  const max = widgetMaxPartyOf(nodeData)
  const windowDays = Number(nodeData?.bookingWindowDays)
  return {
    title: settings.title || String(input.agentName || '').slice(0, 80),
    timezone: typeof nodeData?.timezone === 'string' && nodeData.timezone ? nodeData.timezone : 'Europe/Zurich',
    party: max ? { max } : null,
    bookingWindowDays: Number.isFinite(windowDays) && windowDays > 0 ? Math.floor(windowDays) : 0,
    closed: publicClosedDaysOf(nodeData),
    askMessage: !!bookingMessagePromptOf(nodeData),
    emailConfirm: settings.emailConfirm,
    confirmTtlMin: settings.confirmTtlMin,
    contactPhone: input.contactPhone || null,
    defaultLang: widgetDefaultLangOf(nodeData, input.workflowLang, input.accountLocale),
    info: { openingHours: openingHoursOf(nodeData), address: settings.address || null, email: settings.email || null },
    available: input.available && !(takesPartySize(nodeData) && !max),
  }
}
