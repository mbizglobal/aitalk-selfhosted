
export const VOICE_LOCALES = [
  { value: 'de-CH', label: 'Deutsch (Schweiz)' },
  { value: 'de-DE', label: 'Deutsch (Deutschland)' },
  { value: 'fr-CH', label: 'Français (Suisse)' },
  { value: 'fr-FR', label: 'Français (France)' },
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'ko-KR', label: '한국어' },
] as const

export type VoiceLocale = (typeof VOICE_LOCALES)[number]['value']

export const VOICE_LANG_FAMILIES = ['en', 'de', 'fr', 'ko'] as const
export type VoiceLangFamily = (typeof VOICE_LANG_FAMILIES)[number]

export const REALTIME_VOICE_LOCALES = [
  { value: 'de-DE', label: 'Deutsch' },
  { value: 'fr-FR', label: 'Français' },
  { value: 'en-US', label: 'English' },
  { value: 'ko-KR', label: '한국어' },
] as const

const LOCALE_VALUES: readonly string[] = VOICE_LOCALES.map((l) => l.value)
const FAMILY_VALUES: readonly string[] = VOICE_LANG_FAMILIES

export function isVoiceLocale(value: unknown): value is VoiceLocale {
  return typeof value === 'string' && LOCALE_VALUES.includes(value)
}

export function toVoiceLangFamily(value: unknown): VoiceLangFamily | null {
  if (!isVoiceLocale(value)) return null
  const family = value.split('-')[0]
  return FAMILY_VALUES.includes(family) ? (family as VoiceLangFamily) : null
}

export function localesChosenByWorkflow(nodes: unknown): VoiceLocale[] {
  const out = new Set<VoiceLocale>()
  const add = (v: unknown) => {
    const t = typeof v === 'string' ? v.trim() : v
    if (isVoiceLocale(t)) out.add(t)
  }
  for (const n of (Array.isArray(nodes) ? nodes : [])) {
    const d = (n as { data?: Record<string, unknown> } | null)?.data
    if (!d || d.nodeType !== 'start') continue
    add(d.language)
    for (const m of (Array.isArray(d.menuLanguages) ? d.menuLanguages : [])) add((m as { locale?: unknown } | null)?.locale)
    for (const a of (Array.isArray(d.autoDetectLanguages) ? d.autoDetectLanguages : [])) add((a as { locale?: unknown } | null)?.locale)
  }
  return VOICE_LOCALES.map((l) => l.value).filter((v) => out.has(v))
}

export function callerCanSwitchLanguage(nodes: unknown): boolean {
  let sawPstnStart = false
  for (const n of (Array.isArray(nodes) ? nodes : [])) {
    const d = (n as { data?: Record<string, unknown> } | null)?.data
    if (!d || d.nodeType !== 'start' || d.triggerType !== 'pstn') continue
    sawPstnStart = true
    if (d.enableLanguageSwitch !== false) return true
  }
  return sawPstnStart ? false : false
}

export function voiceLocaleLabel(locale: string): string {
  return VOICE_LOCALES.find((l) => l.value === locale)?.label ?? locale
}
