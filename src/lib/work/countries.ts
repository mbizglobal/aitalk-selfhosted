
export interface WorkCountry {
  code: string
  name: { en: string; de: string; fr: string; ko: string }
}

export const WORK_COUNTRIES: readonly WorkCountry[] = [
  { code: 'CH', name: { en: 'Switzerland', de: 'Schweiz', fr: 'Suisse', ko: '스위스' } },
]

export function normalizeWorkCountry(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim().toUpperCase()
  return WORK_COUNTRIES.find((c) => c.code === v)?.code ?? null
}

export function workCountryName(code: string, lang: string): string {
  const c = WORK_COUNTRIES.find((x) => x.code === code)
  if (!c) return code
  return (c.name as Record<string, string>)[lang] ?? c.name.en
}
