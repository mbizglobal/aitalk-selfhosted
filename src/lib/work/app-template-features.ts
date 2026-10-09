
import { WORK_APP_METAS } from './package-meta'

export type FeatureLang = 'en' | 'de' | 'fr' | 'ko'
export type LocaleText = { en: string } & Partial<Record<Exclude<FeatureLang, 'en'>, string>>

export interface AppTemplateFeatures { available: readonly AppTemplateFeature[]; planned: readonly AppTemplateFeature[] }

export interface AppTemplateFeature {
  id: string
  module?: boolean
  partOf?: string
  label: LocaleText
}

export const APP_TEMPLATE_FEATURES: Readonly<Record<string, AppTemplateFeatures>> = Object.freeze(
  Object.assign({}, ...WORK_APP_METAS.map((m) => m.features)) as Record<string, AppTemplateFeatures>,
)

export function featureLabel(f: AppTemplateFeature, lang: string): string {
  return localeText(f.label, lang)
}

export function localeText(t: LocaleText, lang: string): string {
  return t[(['de', 'fr', 'ko'] as const).find((l) => l === lang) ?? 'en'] || t.en
}
