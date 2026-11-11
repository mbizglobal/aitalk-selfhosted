import { WORK_APP_METAS } from './package-meta'

export const APP_TEMPLATE_KINDS: readonly string[] = WORK_APP_METAS.flatMap((m) => m.appTemplateKinds)
export type AppTemplateKind = string

export function isAppTemplateKind(v: unknown): v is AppTemplateKind {
  return typeof v === 'string' && APP_TEMPLATE_KINDS.includes(v)
}

export const SHARED_APP_TEMPLATE_KINDS: readonly string[] = WORK_APP_METAS.flatMap((m) => m.shared ?? [])

export function isSharedAppTemplateKind(v: unknown): v is AppTemplateKind {
  return typeof v === 'string' && SHARED_APP_TEMPLATE_KINDS.includes(v)
}

export const COMPANY_BOOK_KINDS: readonly string[] = WORK_APP_METAS.flatMap((m) => m.companyBook ?? [])

export function isCompanyBookKind(v: unknown): v is AppTemplateKind {
  return typeof v === 'string' && COMPANY_BOOK_KINDS.includes(v)
}

export const SYSTEM_APP_TEMPLATE_KINDS: readonly string[] = WORK_APP_METAS.flatMap((m) => m.system ?? [])

export const UNLISTED_APP_TEMPLATE_KINDS: readonly string[] = WORK_APP_METAS.flatMap((m) => m.unlisted ?? [])

export const PICKABLE_APP_TEMPLATE_KINDS: readonly string[] = APP_TEMPLATE_KINDS.filter((k) => !SYSTEM_APP_TEMPLATE_KINDS.includes(k) && !UNLISTED_APP_TEMPLATE_KINDS.includes(k))
