
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function isCalendarDate(d: unknown): d is string {
  if (typeof d !== 'string' || !DATE_RE.test(d)) return false
  const [y, m, day] = d.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, day))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === day
}

const pad2 = (n: number) => String(n).padStart(2, '0')
const lastDayOf = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate() // m = 1..12

export function periodContaining(rule: string, date: unknown): { title: string; periodStart: string; periodEnd: string } | null {
  if (!isCalendarDate(date)) return null
  const y = Number(date.slice(0, 4))
  const m = Number(date.slice(5, 7))
  if (rule === 'quarter') {
    const q = Math.floor((m - 1) / 3) + 1
    const m0 = (q - 1) * 3 + 1
    return { title: `${y} Q${q}`, periodStart: `${y}-${pad2(m0)}-01`, periodEnd: `${y}-${pad2(m0 + 2)}-${pad2(lastDayOf(y, m0 + 2))}` }
  }
  if (rule === 'month') return { title: `${y}-${pad2(m)}`, periodStart: `${y}-${pad2(m)}-01`, periodEnd: `${y}-${pad2(m)}-${pad2(lastDayOf(y, m))}` }
  if (rule === 'year') return { title: String(y), periodStart: `${y}-01-01`, periodEnd: `${y}-12-31` }
  return null
}

export function zurichToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function linkExpiresAt(dueDate: string): { lastDay: string; at: Date } {
  const lastDay = addDays(dueDate, 90)
  return { lastDay, at: zurichMidnightUtc(addDays(lastDay, 1)) }
}

export function zurichMidnightUtc(day: string): Date {
  const guess = new Date(`${day}T00:00:00Z`)
  const wall = new Date(guess.toLocaleString('en-US', { timeZone: 'Europe/Zurich' }))
  const utc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }))
  return new Date(guess.getTime() - (wall.getTime() - utc.getTime()))
}
