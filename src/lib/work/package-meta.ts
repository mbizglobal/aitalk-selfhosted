
import type { AppTemplateFeatures } from './app-template-features'
import type { WorkAppUses } from './uses'
import { BUILTIN_WORK_APP_METAS } from '@/work-apps/builtin-meta'
import { CUSTOM_WORK_APP_METAS } from '@/work-apps/custom-meta'

export interface WorkAppMeta {
  id: string
  appTemplateKinds: readonly string[]
  features: Readonly<Record<string, AppTemplateFeatures>>
  i18n: { readonly en: Readonly<Record<string, string>> } & Readonly<Partial<Record<'de' | 'fr' | 'ko', Readonly<Record<string, string>>>>>
  uses?: Readonly<Record<string, WorkAppUses>>
  countries?: 'all' | readonly string[]
  shared?: readonly string[]
  companyBook?: readonly string[]
  system?: readonly string[]
  unlisted?: readonly string[]
  publisher?: { kind: 'community'; name: string }
}

export const WORK_APP_METAS: readonly WorkAppMeta[] = [...BUILTIN_WORK_APP_METAS, ...CUSTOM_WORK_APP_METAS]
