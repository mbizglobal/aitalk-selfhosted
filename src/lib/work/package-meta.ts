
import type { AppTemplateFeatures } from './app-template-features'
import { BUILTIN_WORK_APP_METAS } from '@/work-apps/builtin-meta'
import { CUSTOM_WORK_APP_METAS } from '@/work-apps/custom-meta'

export interface WorkAppMeta {
  id: string
  appTemplateKinds: readonly string[]
  features: Readonly<Record<string, AppTemplateFeatures>>
  i18n: Readonly<Record<'en' | 'de' | 'fr' | 'ko', Readonly<Record<string, string>>>>
}

export const WORK_APP_METAS: readonly WorkAppMeta[] = [...BUILTIN_WORK_APP_METAS, ...CUSTOM_WORK_APP_METAS]
