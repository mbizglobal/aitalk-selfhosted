
import { WorkError } from './errors'
import type { CalcWorkModule, ScreenRowsCtx } from './modules'
import { appTemplates } from './registry'
import type { AppTemplateHandoff } from './handoff-core'

export type AppTemplateFieldType = 'boolean' | 'text' | 'textarea' | 'money' | 'members'
export interface AppTemplateField {
  name: string
  type: AppTemplateFieldType
  required?: boolean
  maxLength?: number
  example?: string
  showWhen?: { filled: string }
  ownerOnly?: true
}

export interface AttentionItem {
  code: string
  params?: Record<string, string | number>
  ask?: string
  open?: { family: string }
  linked?: { family: string }
  linkedApp?: { agentId: string; workflowId: string; name: string }
  chartSetup?: { module: string; standards: Array<{ id: string; languages: readonly string[] }> }
  review?: {
    pdf: { module: string; input: Record<string, string> }
    actions: Array<{ label: string; module: string; input: Record<string, string>; ask?: 'confirm' | 'reason' | 'check'; tone?: 'primary' | 'danger' }>
    items?: { actions: Array<{ label: string; module: string; input: Record<string, string>; key: string; ask?: 'confirm' | 'reason'; tone?: 'primary' | 'danger'; next?: true }> }
  }
}
export interface ReviewItem { id: string; title: string; sub?: string; fields: Array<{ label: string; value: string }>; amount?: string; note?: string; noteTone?: 'muted' | 'amber' | 'red'; files: string[]; marks: Array<{ text: string; mine: boolean }> }
export type AttentionCtx = ScreenRowsCtx & { settings: Readonly<Record<string, unknown>>; modules: readonly string[]; members?(): Promise<ReadonlyArray<{ id: number; email: string; name: string | null; active: boolean; title?: string | null }>> }

export type AppTemplatePeriodRule = 'quarter' | 'month' | 'year' | 'custom'

export interface AppTemplateUi {
  settings: readonly AppTemplateField[]
  peerSettings?: ReadonlyArray<{ kind: string; fields: readonly string[] }>
  files?: 'kept'
  referenceTab?: false
  modulesTab?: false
  notesTab?: false
  period: AppTemplatePeriodRule
  calcInput: readonly AppTemplateField[]
  resultTable?: { path: string; labelPrefix: string }
  resultSections?: readonly string[]
  taskChecks: ReadonlyArray<{ module: string; table: string }>
  sheetImports: ReadonlyArray<{ module: string; family: string; accountColumn: string; fileKind: 'bank_csv'; accept: string }>
  filing?: boolean
  design?: { family: string; imageGroup?: string; fields: ReadonlyArray<DesignField> }
}

export interface DesignField {
  name: string
  kind: 'cards' | 'color' | 'choice' | 'toggle' | 'text' | 'file' | 'number'
  default?: string
  auto?: true
  showWhen?: { field: string; is: string }
  group?: string
  min?: number
  max?: number
  unit?: string
  needsFile?: string
  sample?: string
  warnEmpty?: true
}

export interface AppTemplate {
  kind: string
  sheets: ReadonlyArray<{ template: string; name: string }>
  modules: readonly string[]
  calcModule: CalcWorkModule | null
  globalFamilies: readonly string[]
  aiGuide: string
  tasks?: TaskRule
  parseSettings(raw: unknown): Record<string, unknown>
  ui: AppTemplateUi
  checklist?(ctx: ScreenRowsCtx & { modules: readonly string[]; settings: Readonly<Record<string, unknown>> }, period: { start: string; end: string }): Promise<ChecklistItem[]>
  setupIssues?(settings: Readonly<Record<string, unknown>>, members: ReadonlyArray<{ email: string; name: string | null; active: boolean }>): Array<{ code: string; params?: Record<string, string | number> }>
  attention?(ctx: AttentionCtx, viewer: { owner: boolean; memberId?: number }): Promise<AttentionItem[]>
  handoff?: AppTemplateHandoff
  cardRows?: Readonly<Record<string, AppCardRow>>
  designPreview?(input: { profile: Readonly<Record<string, unknown>> | null; logo: Buffer | null; design: Readonly<Record<string, unknown>>; lang: string; docLang?: string; docCurrency?: string; files?: Readonly<Record<string, Buffer>> }): Promise<Buffer>
}

export interface AppCardRow {
  family: string
  fromCard(card: Readonly<Record<string, unknown>> | null): Record<string, unknown>
  settable: readonly string[]
  fixable: readonly string[]
}

export interface ChecklistItem {
  id: string
  state: 'ok' | 'todo' | 'warn'
  params?: Record<string, string | number>
  goto?: { family: string } | 'files' | 'notes'
}

export function standardPeriodTitle(rule: string, s: string, e: string): string | null {
  const [y, m] = [Number(s.slice(0, 4)), Number(s.slice(5, 7))]
  const lastDay = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10)
  if (rule === 'quarter' && s.endsWith('-01') && (m - 1) % 3 === 0 && e === lastDay(y, m + 2)) return `${y} Q${(m + 2) / 3}`
  if (rule === 'month' && s.endsWith('-01') && e === lastDay(y, m)) return s.slice(0, 7)
  if (rule === 'year' && s === `${y}-01-01` && e === `${y}-12-31`) return String(y)
  return null
}

export type TaskRule = 'period' | 'none' | 'manual'
export function taskRuleOf(t: Pick<AppTemplate, 'tasks' | 'ui'> | null): TaskRule {
  if (!t) return 'manual'
  return t.tasks ?? (t.ui.period === 'custom' ? 'manual' : 'period')
}

export function appTemplateOf(kind: string, list: readonly AppTemplate[] = appTemplates()): AppTemplate | null {
  if (kind === 'free') return null
  const b = list.find((x) => x.kind === kind)
  if (!b) throw new WorkError('TEMPLATE_UNKNOWN', `project kind ${kind}`)
  return b
}

export function appliesWithoutSettings(tpl: AppTemplate): boolean {
  try { tpl.parseSettings({}); return true } catch { return false }
}
