import { normalizeWorkCountry, workCountryName } from '@/lib/work/countries'

export interface WorkAppGroupItem {
  templateId: string
  name: string
  description: string
  keywords: string[]
  sortOrder: number
  countries?: 'all' | string[]
  includes?: string[]
}

export interface WorkAppSection<T> {
  key: string
  items: T[]
}

export const WORK_APP_SEARCH_MIN = 11

const countriesOf = (t: WorkAppGroupItem): 'all' | string[] => (Array.isArray(t.countries) && t.countries.length ? t.countries : 'all')
const isBundle = (t: WorkAppGroupItem) => (t.includes?.length ?? 0) >= 2
const order = <T extends WorkAppGroupItem>(xs: T[]) => [...xs].sort((a, b) => Number(isBundle(b)) - Number(isBundle(a)) || a.sortOrder - b.sortOrder)

export function countryOptions(items: readonly WorkAppGroupItem[], lang: string): string[] {
  const codes = new Set<string>()
  for (const t of items) {
    const c = countriesOf(t)
    if (c !== 'all') for (const x of c) codes.add(x)
  }
  return [...codes].sort((a, b) => workCountryName(a, lang).localeCompare(workCountryName(b, lang), lang))
}

export function defaultCountry(billingCountry: unknown, options: readonly string[]): string | null {
  const code = normalizeWorkCountry(billingCountry)
  return code && options.includes(code) ? code : null
}

function matches(t: WorkAppGroupItem, q: string): boolean {
  return t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q) || t.keywords.some((k) => k.toLowerCase().includes(q))
}

export function groupWorkApps<T extends WorkAppGroupItem>(items: readonly T[], selected: string | null, query: string, lang: string): WorkAppSection<T>[] {
  const q = query.trim().toLowerCase()
  const keep = (xs: T[]) => order(q ? xs.filter((t) => matches(t, q)) : xs)
  const sections: WorkAppSection<T>[] = [{ key: 'all', items: keep(items.filter((t) => countriesOf(t) === 'all')) }]
  const options = countryOptions(items, lang)
  if (selected !== null) {
    sections.push({ key: selected, items: keep(items.filter((t) => { const c = countriesOf(t); return c !== 'all' && c.includes(selected) })) })
  } else {
    const placed = new Set<string>()
    for (const code of options) {
      const xs = items.filter((t) => { const c = countriesOf(t); return c !== 'all' && c.includes(code) && !placed.has(t.templateId) })
      for (const t of xs) placed.add(t.templateId)
      sections.push({ key: code, items: keep(xs) })
    }
  }
  return sections.filter((s) => s.items.length > 0)
}
