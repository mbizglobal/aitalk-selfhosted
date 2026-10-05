
export interface DateRange {
  start: string
  end: string
}

export const OPEN_END = '9999-12-31'

function shiftDay(d: string, days: number): string {
  const [y, m, day] = d.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, day + days))
  return t.toISOString().slice(0, 10)
}
export const prevDay = (d: string) => shiftDay(d, -1)
export const nextDay = (d: string) => shiftDay(d, 1)

export function dateInAny(date: string, periods: readonly DateRange[]): boolean {
  return periods.some((p) => p.start <= date && date <= p.end)
}

export function rangesOverlap(a: DateRange, b: DateRange): boolean {
  return a.start <= b.end && b.start <= a.end
}

export function anyOverlap(ranges: readonly DateRange[], periods: readonly DateRange[]): boolean {
  return ranges.some((r) => periods.some((p) => rangesOverlap(r, p)))
}

export function effectiveIntervals(rows: ReadonlyArray<{ id: string; start: string }>): Map<string, DateRange> {
  const sorted = [...rows].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
  const out = new Map<string, DateRange>()
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i - 1].start === sorted[i].start) throw new Error('two effective rows start on the same day')
    const end = i + 1 < sorted.length ? prevDay(sorted[i + 1].start) : OPEN_END
    out.set(sorted[i].id, { start: sorted[i].start, end })
  }
  return out
}

function subtract(a: DateRange, b: DateRange): DateRange[] {
  if (!rangesOverlap(a, b)) return [a]
  const out: DateRange[] = []
  if (a.start < b.start) out.push({ start: a.start, end: prevDay(b.start) })
  if (b.end < a.end) out.push({ start: nextDay(b.end), end: a.end })
  return out
}

export function changedDates(before: DateRange | undefined, after: DateRange | undefined, contentChanged: boolean): DateRange[] {
  if (!before && !after) return []
  if (!before) return [after!]
  if (!after) return [before]
  if (contentChanged) return [before, after]
  return [...subtract(before, after), ...subtract(after, before)]
}
