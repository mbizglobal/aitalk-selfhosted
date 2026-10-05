import { workTranslations as en, type WorkKey } from './en'
import { workTranslations as ko } from './ko'
import { workTranslations as de } from './de'
import { workTranslations as fr } from './fr'
import { WORK_APP_METAS, type WorkAppMeta } from '@/lib/work/package-meta'

export type WorkLang = 'en' | 'de' | 'fr' | 'ko'
export type { WorkKey }

export function mergeWorkDict(core: Record<string, string>, l: WorkLang, metas: readonly WorkAppMeta[] = WORK_APP_METAS): Record<string, string> {
  const out: Record<string, string> = { ...core }
  for (const m of metas) {
    const d = m.i18n?.[l]
    if (!d || typeof d !== 'object') throw new Error(`work app i18n: ${m.id} has no ${l} dictionary`)
    const want = Object.keys(m.i18n.en ?? {}).sort().join('\n')
    if (Object.keys(d).sort().join('\n') !== want || Object.keys(d).length !== Object.keys(m.i18n.en ?? {}).length) throw new Error(`work app i18n: ${m.id} ${l} keys differ from en`)
    for (const [k, v] of Object.entries(d)) {
      if (k in out) throw new Error(`work app i18n: key ${k} from ${m.id} is already defined`)
      out[k] = v
    }
  }
  return Object.freeze(out)
}
const dicts: Record<WorkLang, Record<string, string>> = { en: mergeWorkDict(en, 'en'), de: mergeWorkDict(de, 'de'), fr: mergeWorkDict(fr, 'fr'), ko: mergeWorkDict(ko, 'ko') }

export function workDict(lang: WorkLang): Readonly<Record<string, string>> {
  return dicts[lang]
}

export function parseWorkLang(v: string | null | undefined): WorkLang {
  return v === 'de' || v === 'fr' || v === 'ko' ? v : 'en'
}

export function workT(lang: WorkLang, key: string, fallback?: string): string {
  return dicts[lang][key] ?? dicts.en[key] ?? fallback ?? key
}

const PARAM_KEY: Record<string, (v: string) => string> = {
  sheet: (v) => `sheet_${v}`,
  column: (v) => `col_${v}`,
  field: (v) => `bankf_${v}`,
  setting: (v) => `set_${v}`,
  module: (v) => `mod_${v}`,
  kind: (v) => `opt_${v}`,
  type: (v) => `opt_${v}`,
  direction: (v) => `opt_${v}`,
  vatCode: (v) => `opt_${v}`,
}

export function workStopText(lang: WorkLang, stop: { code: string; params?: Record<string, string | number> }): string | null {
  const tpl = dicts[lang][`stop_${stop.code}`] ?? dicts.en[`stop_${stop.code}`]
  if (!tpl) return null
  return tpl.replace(/\{(\w+)\}/g, (m, name: string) => {
    const v = stop.params?.[name]
    if (v === undefined || v === null) return m
    const key = PARAM_KEY[name]?.(String(v))
    return key ? workT(lang, key, String(v)) : String(v)
  })
}
