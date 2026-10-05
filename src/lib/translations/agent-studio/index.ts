// Agent Studio translations index
import { translations as en } from './en'
import { translations as ko } from './ko'
import { translations as de } from './de'
import { translations as fr } from './fr'
import { translations as es } from './es'

export type AgentStudioTranslationKey = keyof typeof en.en

export const agentStudioTranslations = {
  ...en,
  ...ko,
  ...de,
  ...fr,
  ...es,
}

export type AgentStudioTranslations = typeof agentStudioTranslations

// Helper function to get translation
export function getAgentStudioTranslation(lang: string): Record<string, string> {
  const normalized = lang === 'de-ch' ? 'de' : lang
  const supportedLang = ['en', 'ko', 'de', 'fr', 'es'].includes(normalized) ? normalized : 'en'
  return agentStudioTranslations[supportedLang as keyof AgentStudioTranslations] || agentStudioTranslations.en
}
