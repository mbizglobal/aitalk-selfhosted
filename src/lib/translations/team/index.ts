// Team translations index
import { teamTranslations as en } from './en'
import { teamTranslations as ko } from './ko'
import { teamTranslations as de } from './de'
import { teamTranslations as fr } from './fr'
import { teamTranslations as es } from './es'

export type SupportedLang = 'en' | 'ko' | 'de' | 'fr' | 'es'

export type TeamTranslationKey = keyof typeof en

const translations: Record<SupportedLang, typeof en> = {
  en,
  ko,
  de,
  fr,
  es,
}

export function getTeamTranslation(lang: SupportedLang | undefined, key: TeamTranslationKey): string {
  const language = (lang && lang in translations ? lang : 'en') as SupportedLang
  return translations[language][key] || translations.en[key] || key
}

export { teamTranslations as teamTranslationsEn } from './en'
export { teamTranslations as teamTranslationsKo } from './ko'
export { teamTranslations as teamTranslationsDe } from './de'
export { teamTranslations as teamTranslationsFr } from './fr'
export { teamTranslations as teamTranslationsEs } from './es'
