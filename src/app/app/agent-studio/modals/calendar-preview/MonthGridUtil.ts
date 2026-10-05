
export interface GridCell {
  ymd: string // 'YYYY-MM-DD'
  isCurrentMonth: boolean
  dayNum: number
  isToday: boolean
}

export function buildMonthGrid(year: number, month: number, todayYmd?: string): GridCell[] {
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1, 12, 0, 0))
  const firstWeekday = firstOfMonth.getUTCDay() // 0=Sun
  const start = new Date(firstOfMonth)
  start.setUTCDate(start.getUTCDate() - firstWeekday)

  const cells: GridCell[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(start)
    d.setUTCDate(start.getUTCDate() + i)
    const y = d.getUTCFullYear()
    const m = d.getUTCMonth() + 1
    const day = d.getUTCDate()
    const ymd = `${y}-${pad2(m)}-${pad2(day)}`
    cells.push({
      ymd,
      isCurrentMonth: m === month && y === year,
      dayNum: day,
      isToday: !!todayYmd && ymd === todayYmd,
    })
  }
  return cells
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

export function todayInTimezone(tz?: string): string {
  const d = new Date()
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz || undefined,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const y = parts.find((p) => p.type === 'year')?.value || '0000'
  const mo = parts.find((p) => p.type === 'month')?.value || '01'
  const da = parts.find((p) => p.type === 'day')?.value || '01'
  return `${y}-${mo}-${da}`
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const total = year * 12 + (month - 1) + delta
  return { year: Math.floor(total / 12), month: (total % 12) + 1 }
}
