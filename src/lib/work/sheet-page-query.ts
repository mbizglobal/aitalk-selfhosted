
import { isCalendarDate } from './dates'
import { WorkError } from './errors'
import type { SheetPageQuery } from './views'

export function pageQuery(sp: URLSearchParams): SheetPageQuery {
  const bad = (why: string): never => { throw new WorkError('INVALID', why) }
  const page: SheetPageQuery = {}
  const year = sp.get('year')
  if (year !== null) page.year = year === 'all' ? 'all' : /^\d{4}$/.test(year) && Number(year) > 0 ? Number(year) : bad('year must be four digits or all')
  const from = sp.get('from'), to = sp.get('to')
  if (from !== null || to !== null) {
    if (!isCalendarDate(from) || !isCalendarDate(to) || from > to) bad('from and to must be days, from not after to')
    page.period = { start: from!, end: to! }
  }
  const sort = sp.get('sort')
  if (sort !== null) {
    const m = /^([A-Za-z0-9_]{1,64}):(asc|desc)$/.exec(sort)
    page.sort = m ? { col: m[1], dir: m[2] as 'asc' | 'desc' } : bad('sort must be column:asc or column:desc')
  }
  if (sp.get('hidden') === '1') page.showHidden = true
  const after = sp.get('after')
  if (after !== null) page.after = after.length <= 512 ? after : bad('after is too long')
  const filters = [0, 1, 2].map((i) => sp.get(`f${i}`))
  if (filters.some((f) => f !== null && f.length > 200)) bad('filter is too long')
  if (filters.some((f) => f !== null)) page.filters = filters
  return page
}

export function evidenceOf(sp: URLSearchParams): string | undefined {
  if (!sp.has('evidence')) return undefined
  const v = sp.get('evidence') ?? ''
  if (v.length > 64) throw new WorkError('INVALID', 'evidence is too long')
  return v
}
