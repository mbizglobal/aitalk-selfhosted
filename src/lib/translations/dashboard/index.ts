import { translations as enTranslations } from './en'
import { translations as deTranslations } from './de'
import { translations as frTranslations } from './fr'
import { translations as esTranslations } from './es'
import { translations as koTranslations } from './ko'

const allTranslations = {
  ...enTranslations,
  ...deTranslations,
  ...frTranslations,
  ...esTranslations,
  ...koTranslations
}

type Language = 'en' | 'de' | 'fr' | 'es' | 'ko'
type TranslationKey = keyof typeof allTranslations.en

export function getTranslation(language: Language = 'en', key: TranslationKey): string {
  const translations = allTranslations[language]
  return translations?.[key] || allTranslations.en[key] || key
}

export function getErrorMessage(key: TranslationKey, language: Language = 'en'): string {
  return getTranslation(language, key)
}

// Helper function to get language from request headers
export function getLanguageFromHeaders(headers: Headers): Language {
  const acceptLanguage = headers.get('accept-language') || 'en'
  
  const lang = acceptLanguage.toLowerCase().trim()
  
  if (lang === 'en' || lang.startsWith('en-') || lang.startsWith('en_')) return 'en'
  if (lang === 'de' || lang.startsWith('de-') || lang.startsWith('de_')) return 'de'
  if (lang === 'fr' || lang.startsWith('fr-') || lang.startsWith('fr_')) return 'fr'
  if (lang === 'es' || lang.startsWith('es-') || lang.startsWith('es_')) return 'es'
  if (lang === 'ko' || lang.startsWith('ko-') || lang.startsWith('ko_')) return 'ko'

  if (lang.includes(',de') || lang.includes('de,') || (lang.includes('de') && lang.length <= 5)) return 'de'
  if (lang.includes(',fr') || lang.includes('fr,') || (lang.includes('fr') && lang.length <= 5)) return 'fr'
  if (lang.includes(',es') || lang.includes('es,') || (lang.includes('es') && lang.length <= 5)) return 'es'
  if (lang.includes(',ko') || lang.includes('ko,') || (lang.includes('ko') && lang.length <= 5)) return 'ko'
  
  return 'en'
}

// Get entire translation object for a specific language
export function getTranslations(language: Language = 'en') {
  return allTranslations[language] || allTranslations.en
}