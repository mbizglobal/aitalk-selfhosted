
import { createHash } from 'node:crypto'
import { PARAM_KEY, workDict, type WorkLang } from '@/lib/translations/work'

export interface AppWorkText {
  lang: WorkLang
  version: string
  text: Readonly<Record<string, string>>
  paramKeys: Readonly<Record<string, string>>
}

const cache = new Map<WorkLang, AppWorkText>()

export function appWorkText(lang: WorkLang): AppWorkText {
  const hit = cache.get(lang)
  if (hit) return hit
  const en = workDict('en')
  const d = workDict(lang)
  const text: Record<string, string> = {}
  for (const k of [...new Set([...Object.keys(en), ...Object.keys(d)])].sort()) text[k] = d[k] ?? en[k]
  const paramKeys = Object.fromEntries(Object.entries(PARAM_KEY).map(([name, f]) => [name, f('')]))
  const version = createHash('sha256').update(JSON.stringify([text, paramKeys])).digest('hex').slice(0, 16)
  const out = Object.freeze({ lang, version, text: Object.freeze(text), paramKeys: Object.freeze(paramKeys) })
  cache.set(lang, out)
  return out
}
