
import { stripHtml } from './contact-description'
import { wallTimeToUtcMs } from './slot-grid'

const PARTY_LINE_REGEX = /^\s*party\s*[:：]\s*(\d{1,4})\s*$/im
const HTML_TAG_REGEX = /<br\s*\/?>|<(?:div|p|html|body)\b[^>]*>|<\/[a-z][a-z0-9]*\s*>/i

export function descriptionText(raw: string | null | undefined): string {
  const s = String(raw || '')
  return HTML_TAG_REGEX.test(s) ? stripHtml(s) : s
}

export interface PartyEvent {
  description?: string | null
  start?: { dateTime?: string | null; date?: string | null } | null
  end?: { dateTime?: string | null; date?: string | null } | null
  body?: { content?: string | null } | null
}

export function findPartySize(description: string | null | undefined): number | null {
  const m = descriptionText(description).match(PARTY_LINE_REGEX)
  if (!m) return null
  const n = parseInt(m[1], 10)
  return Number.isFinite(n) && n >= 1 ? n : null
}

export function parsePartySize(description: string | null | undefined): number {
  return findPartySize(description) ?? 1
}

export function partySizeFromEvent(ev: PartyEvent): number {
  return findPartySize(ev?.description) ?? findPartySize(ev?.body?.content) ?? 1
}

export const EVENTS_MAX_PAGES = 10

export interface CalendarEventLike extends PartyEvent {
  transparency?: string | null
  showAs?: string | null
  isAllDay?: boolean | null
}

export function isFreeEvent(ev: CalendarEventLike): boolean {
  return String(ev?.transparency || '').toLowerCase() === 'transparent' || String(ev?.showAs || '').toLowerCase() === 'free'
}

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

function nextDateStr(d: string): string {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, day + 1)).toISOString().slice(0, 10)
}

export function eventRangeMs(ev: CalendarEventLike, timezone: string): { s: number; e: number } | null {
  const sDate = ev?.start?.date
  const eDate = ev?.end?.date
  let s: number
  let e: number
  const isDay = (d: unknown): d is string => typeof d === 'string' && DATE_REGEX.test(d)
  const sDay = sDate ?? (ev?.isAllDay ? String(ev?.start?.dateTime || '').slice(0, 10) : undefined)
  if (sDay !== undefined) {
    if (!isDay(sDay)) return null
    const eDay = sDate ? eDate : String(ev?.end?.dateTime || '').slice(0, 10)
    s = wallTimeToUtcMs(`${sDay}T00:00`, timezone)
    e = wallTimeToUtcMs(`${isDay(eDay) && eDay > sDay ? eDay : nextDateStr(sDay)}T00:00`, timezone)
  } else {
    s = new Date(ev?.start?.dateTime || '').getTime()
    e = new Date(ev?.end?.dateTime || '').getTime()
  }
  return Number.isFinite(s) && Number.isFinite(e) && s < e ? { s, e } : null
}

export function computeSeatUsage(
  events: CalendarEventLike[],
  newStartMs: number,
  newEndMs: number,
  timezone: string
): { used: number; blocked: boolean } {
  let used = 0
  let blocked = false
  for (const ev of events) {
    if (isFreeEvent(ev)) continue
    const r = eventRangeMs(ev, timezone)
    if (!r || r.s >= newEndMs || r.e <= newStartMs) continue
    const party = findPartySize(ev?.description) ?? findPartySize(ev?.body?.content)
    if (party == null) blocked = true
    else used += party
  }
  return { used, blocked }
}

export function parsePartySizeArg(raw: unknown): number | null | 'invalid' {
  if (raw === undefined || raw === null || raw === '') return null
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\s*\d+\s*$/.test(raw) ? Number(raw) : NaN
  return Number.isSafeInteger(n) && n >= 1 ? n : 'invalid'
}

export function formatPartyLine(partySize: number): string {
  const n = Math.max(1, Math.floor(partySize))
  return `Party: ${n}`
}

export function replacePartyLine(description: string | null | undefined, partySize: number): string {
  const lines = descriptionText(description).replace(/\r\n/g, '\n').split('\n')
  let metaEnd = lines.findIndex((l) => l.trim() === '' || /^\s*(notes|source)\s*[:：]/i.test(l))
  if (metaEnd < 0) metaEnd = lines.length
  const meta = lines.slice(0, metaEnd).filter((l) => !/^\s*party\s*[:：]/i.test(l))
  const rest = lines.slice(metaEnd).filter((l) => !/^\s*party\s*[:：]\s*\d{1,4}\s*$/i.test(l))
  const tableIdx = meta.findIndex((l) => /^\s*table\s*[:：]/i.test(l))
  if (tableIdx >= 0) meta.splice(tableIdx, 0, formatPartyLine(partySize))
  else meta.push(formatPartyLine(partySize))
  const out = [...meta, ...rest]
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop()
  return out.join('\n')
}

