
import { WorkError } from './errors'
import type { CalcWorkModule, ScreenRowsCtx } from './modules'
import { appTemplates } from './registry'

export type AppTemplateFieldType = 'boolean' | 'text' | 'textarea' | 'money'
export interface AppTemplateField {
  name: string
  type: AppTemplateFieldType
  required?: boolean
  maxLength?: number
}

export type AppTemplatePeriodRule = 'quarter' | 'month' | 'year' | 'custom'

export interface AppTemplateUi {
  settings: readonly AppTemplateField[]
  period: AppTemplatePeriodRule
  calcInput: readonly AppTemplateField[]
  resultTable?: { path: string; labelPrefix: string }
  taskChecks: ReadonlyArray<{ module: string; table: string }>
  sheetImports: ReadonlyArray<{ module: string; family: string; accountColumn: string; fileKind: 'bank_csv'; accept: string }>
}

export interface AppTemplate {
  kind: string
  sheets: ReadonlyArray<{ template: string; name: string }>
  modules: readonly string[]
  calcModule: CalcWorkModule | null
  globalFamilies: readonly string[]
  aiGuide: string
  parseSettings(raw: unknown): Record<string, unknown>
  ui: AppTemplateUi
  checklist?(ctx: ScreenRowsCtx & { modules: readonly string[] }, period: { start: string; end: string }): Promise<ChecklistItem[]>
}

export interface ChecklistItem {
  id: string
  state: 'ok' | 'todo' | 'warn'
  params?: Record<string, string | number>
  goto?: { family: string } | 'files' | 'notes'
}

export function appTemplateOf(kind: string, list: readonly AppTemplate[] = appTemplates()): AppTemplate | null {
  if (kind === 'free') return null
  const b = list.find((x) => x.kind === kind)
  if (!b) throw new WorkError('TEMPLATE_UNKNOWN', `project kind ${kind}`)
  return b
}
