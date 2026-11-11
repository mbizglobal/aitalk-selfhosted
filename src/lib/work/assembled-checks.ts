import { isCalendarDate } from './dates'
import { WorkError } from './errors'
import { decimalCompare, decimalOf, STATUS_COLUMN, TIME_RE, type SpecCheck, type SpecCheckLimit, type SpecCheckOverlap, type SpecTable } from './assembled'

type Row = Readonly<Record<string, unknown>>
export interface Dec { n: bigint; scale: number }
export const DEC0: Dec = { n: BigInt(0), scale: 0 }

const blank = (v: unknown) => v === undefined || v === null || v === ''
const DAY = 24 * 3600 * 1000
const dayNum = (d: string): number => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) / DAY
const minutesOf = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))

export function normValue(t: Pick<SpecTable, 'columns' | 'status'>, key: string, v: unknown): string | null {
  if (key === STATUS_COLUMN) return blank(v) ? (t.status?.start ?? null) : String(v)
  if (blank(v)) return null
  if (t.columns.find((c) => c.key === key)?.kind === 'person') return String(v).trim().toLowerCase()
  return String(v)
}

export function checkColumns(c: SpecCheck): string[] {
  const own = c.kind === 'no_overlap' ? [c.start, c.end, c.startTime, c.endTime] : [c.column]
  return [...own, c.by, c.when ? STATUS_COLUMN : undefined].filter((k): k is string => !!k)
}

export function checkTouched(t: Pick<SpecTable, 'columns' | 'status'>, c: SpecCheck, before: Row, after: Row): boolean {
  return checkColumns(c).some((k) => normValue(t, k, before[k]) !== normValue(t, k, after[k]))
}

export function isCounted(t: Pick<SpecTable, 'columns' | 'status'>, c: SpecCheck, row: Row): boolean {
  if (!c.when) return true
  const st = normValue(t, STATUS_COLUMN, row[STATUS_COLUMN])
  return st !== null && c.when.status.includes(st)
}

export interface Span { day: number | null; a: number; b: number }

export function overlapSpan(c: SpecCheckOverlap, row: Row, strict: boolean): Span | null {
  const fail = (m: string): null => { if (strict) throw new WorkError('INVALID', `${c.label}: ${m}`); return null }
  const s = row[c.start]
  if (c.startTime) {
    const st = row[c.startTime]
    const et = c.endTime ? row[c.endTime] : undefined
    const parts = [s, st, ...(c.endTime ? [et] : [])]
    if (parts.every(blank)) return null
    if (parts.some(blank)) return fail(c.endTime ? 'write the whole time slot — the day, the start time and the end time' : 'write the whole time slot — the day and the start time')
    if (typeof s !== 'string' || !isCalendarDate(s) || typeof st !== 'string' || !TIME_RE.test(st) || (c.endTime && (typeof et !== 'string' || !TIME_RE.test(et)))) return fail('the time slot is not a date and HH:MM times')
    const a = minutesOf(st)
    const b = c.endTime ? minutesOf(et as string) : a + (c.minutes ?? 0)
    if (c.endTime && b <= a) return fail('the end time must be after the start time')
    if (b > 1440) return fail('a time slot cannot pass midnight')
    return { day: dayNum(s), a, b }
  }
  const e = c.end ? row[c.end] : undefined
  if (blank(s) && blank(e)) return null
  if (blank(s)) return fail('write the start date too')
  if (typeof s !== 'string' || !isCalendarDate(s) || (!blank(e) && (typeof e !== 'string' || !isCalendarDate(e)))) return fail('the dates are not calendar dates')
  const a = dayNum(s)
  const last = blank(e) ? a : dayNum(e as string)
  if (last < a) return fail('the end date must not be before the start date')
  return { day: null, a, b: last + 1 }
}

export const spansOverlap = (x: Span, y: Span): boolean => x.day === y.day && x.a < y.b && y.a < x.b

export function limitGroup(t: Pick<SpecTable, 'columns' | 'status'>, c: SpecCheckLimit, row: Row): string {
  if (!c.by) return 'all'
  return normValue(t, c.by, row[c.by]) ?? ''
}

export const amountOf = (c: SpecCheckLimit, row: Row): Dec => (blank(row[c.column]) ? DEC0 : (decimalOf(row[c.column]) ?? DEC0))

export function decAdd(x: Dec, y: Dec): Dec {
  const scale = Math.max(x.scale, y.scale)
  const up = (d: Dec) => d.n * BigInt(10) ** BigInt(scale - d.scale)
  return { n: up(x) + up(y), scale }
}

export function limitBroken(c: SpecCheckLimit, before: Dec, after: Dec): 'min' | 'max' | null {
  if (c.min !== undefined) { const m = decimalOf(c.min)!; if (decimalCompare(after, m) < 0 && decimalCompare(after, before) < 0) return 'min' }
  if (c.max !== undefined) { const m = decimalOf(c.max)!; if (decimalCompare(after, m) > 0 && decimalCompare(after, before) > 0) return 'max' }
  return null
}

export function decText(d: Dec): string {
  const neg = d.n < BigInt(0)
  const s = (neg ? -d.n : d.n).toString().padStart(d.scale + 1, '0')
  const int = d.scale ? s.slice(0, -d.scale) : s
  const frac = d.scale ? s.slice(-d.scale).replace(/0+$/, '') : ''
  return `${neg ? '-' : ''}${int}${frac ? `.${frac}` : ''}`
}
