import { WORK_APP_METAS } from './package-meta'

export const APP_TEMPLATE_KINDS: readonly string[] = WORK_APP_METAS.flatMap((m) => m.appTemplateKinds)
export type AppTemplateKind = string

export function isAppTemplateKind(v: unknown): v is AppTemplateKind {
  return typeof v === 'string' && APP_TEMPLATE_KINDS.includes(v)
}
