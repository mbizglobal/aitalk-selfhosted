export function calendarTodayLine(timezone: string, now: Date = new Date()): string {
  let ymd: string
  let weekday: string
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long' }).formatToParts(now)
    const get = (t: string) => parts.find((p) => p.type === t)?.value || ''
    ymd = `${get('year')}-${get('month')}-${get('day')}`
    weekday = get('weekday')
  } catch {
    return ''
  }
  const [y, m, d] = ymd.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + 1))
  const tomorrowYmd = `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`
  const tomorrowWeekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][t.getUTCDay()]
  return (
    ` Today is ${weekday} ${ymd} and tomorrow is ${tomorrowWeekday} ${tomorrowYmd} (calendar timezone ${timezone}).` +
    ` Resolve relative dates the caller uses ("tomorrow", "this Friday", "next week") from this — never ask them for the date number just because they said it relatively.`
  )
}
