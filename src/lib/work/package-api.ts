
export const WORK_APP_CORE_API = 10

export { isCalendarDate, addDays, linkExpiresAt, zurichToday } from './dates'
export { publicLinkUrl } from './public-link-url'
export { COUNTRY_CODES, SANCTIONED_COUNTRIES } from './iso-countries'
export { WorkError } from './errors'
export { moduleStop } from './module-stop'
export { normalizeRow, uniqueKeyHash } from './sheet-columns'
export { dateInAny, uncoveredRanges } from './sheet-periods'
export { findTemplate, templateSchema } from './sheet-templates'
export { HANDOFF_FAMILY, HANDOFF_TEMPLATE_ID } from './handoff-core'
export { isFxMonth, monthsBetween, MAX_FX_MONTHS } from './fx-bazg'

import type * as CoreModules from './modules'
import type * as CorePackage from './package'
import type * as CoreAppTemplates from './app-templates'
export type ModuleRunCtx = Omit<CoreModules.ModuleRunCtx, 'deps'>
export type ScreenRowsCtx = Omit<CoreModules.ScreenRowsCtx, 'deps'>
export type WorkAppToolCtx = Omit<CorePackage.WorkAppToolCtx, 'deps'>
export type ActionWorkModule<Ctx = ModuleRunCtx> = Omit<CoreModules.ActionWorkModule<Ctx>, 'screenRows' | 'screenFilter' | 'screenChoices'> & {
  screenRows?(ctx: ScreenRowsCtx): Promise<CoreModules.ScreenRows>
  screenFilter?(ctx: ScreenRowsCtx): Promise<CoreModules.ScreenFilter>
  screenChoices?(ctx: ScreenRowsCtx): Promise<CoreModules.ScreenChoices>
}
export type CalcWorkModule = Omit<CoreModules.CalcWorkModule, 'prepare'>
export type WorkModule = CalcWorkModule | ActionWorkModule
export type WorkAppTool = Omit<CorePackage.WorkAppTool, 'run'> & {
  run(ctx: WorkAppToolCtx, args: Record<string, unknown>): Promise<unknown>
}
export type AppCardRow = CoreAppTemplates.AppCardRow
export type AppTemplate = Omit<CoreAppTemplates.AppTemplate, 'checklist' | 'calcModule'> & {
  calcModule: CalcWorkModule | null
  checklist?(ctx: ScreenRowsCtx & { modules: readonly string[]; settings: Readonly<Record<string, unknown>> }, period: { start: string; end: string }): Promise<CoreAppTemplates.ChecklistItem[]>
}
export type WorkAppPackage = Omit<CorePackage.WorkAppPackage, 'appTemplates' | 'modules' | 'tools'> & {
  appTemplates: readonly AppTemplate[]
  modules: readonly WorkModule[]
  tools?: readonly WorkAppTool[]
}
export type WorkAppFactory = () => WorkAppPackage
export type { SendRefCtx, SendRefHooks } from './package'

import type * as CoreUses from './uses'
export type V3WorkAppToolCtx = WorkAppToolCtx & CoreUses.WorkAppV3Handles
export type V3ModuleRunCtx = ModuleRunCtx & CoreUses.WorkAppV3Handles
export type V3WorkAppTool = Omit<CorePackage.WorkAppTool, 'run'> & {
  run(ctx: V3WorkAppToolCtx, args: Record<string, unknown>): Promise<unknown>
}
export type V3ActionWorkModule = ActionWorkModule<V3ModuleRunCtx>

import type * as CoreV5 from './v5-handles'
export type V5ModuleRunCtx = V3ModuleRunCtx & CoreV5.WorkAppV5Handles
export type V5WorkAppToolCtx = V3WorkAppToolCtx & CoreV5.WorkAppV5ToolHandles
export type V5ScreenRowsCtx = ScreenRowsCtx & CoreV5.WorkAppV5Handles
export type V5ActionWorkModule = Omit<CoreModules.ActionWorkModule<V5ModuleRunCtx>, 'screenRows' | 'screenFilter' | 'screenChoices'> & {
  screenRows?(ctx: V5ScreenRowsCtx): Promise<CoreModules.ScreenRows>
  screenFilter?(ctx: V5ScreenRowsCtx): Promise<CoreModules.ScreenFilter>
  screenChoices?(ctx: V5ScreenRowsCtx): Promise<CoreModules.ScreenChoices>
}
export type V5WorkAppTool = Omit<CorePackage.WorkAppTool, 'run'> & {
  run(ctx: V5WorkAppToolCtx, args: Record<string, unknown>): Promise<unknown>
}
export type V5AppTemplate = Omit<AppTemplate, 'checklist'> & {
  checklist?(ctx: V5ScreenRowsCtx & { modules: readonly string[]; settings: Readonly<Record<string, unknown>> }, period: { start: string; end: string }): Promise<CoreAppTemplates.ChecklistItem[]>
}
export type { WorkAppV5Handles, WorkAppV5ToolHandles } from './v5-handles'

import type * as CoreHandlesV7 from './handles'
export interface V7SheetWriter extends CoreHandlesV7.WorkAppSheetWriter {
  confirm(rowIds: readonly string[]): Promise<{ confirmed: number }>
}
export type V7ModuleRunCtx = Omit<V5ModuleRunCtx, 'sheets'> & CoreV5.WorkAppV7Handles & {
  sendAppNow?(p: { family: string; rows: unknown; toProjectId?: string }): Promise<{ sent: boolean; rows: number; code?: string; setup?: string }>
  appLinkSetup?(p: { inbox: string; reads: readonly string[]; back: readonly string[] }): Promise<string[] | null>
  sheets: Omit<V5ModuleRunCtx['sheets'], 'write'> & { write<T>(req: Parameters<V5ModuleRunCtx['sheets']['write']>[0], fn: (w: V7SheetWriter) => Promise<T>): Promise<T> }
}
export type V7WorkAppToolCtx = V5WorkAppToolCtx & CoreV5.WorkAppV7Handles
export type V7ActionWorkModule = Omit<CoreModules.ActionWorkModule<V7ModuleRunCtx>, 'screenRows' | 'screenFilter' | 'screenChoices'> & {
  screenRows?(ctx: V5ScreenRowsCtx & CoreV5.WorkAppV7Handles): Promise<CoreModules.ScreenRows>
  screenFilter?(ctx: V5ScreenRowsCtx & CoreV5.WorkAppV7Handles): Promise<CoreModules.ScreenFilter>
  screenChoices?(ctx: V5ScreenRowsCtx & CoreV5.WorkAppV7Handles): Promise<CoreModules.ScreenChoices>
}
export type V7WorkAppTool = Omit<CorePackage.WorkAppTool, 'run'> & {
  run(ctx: V7WorkAppToolCtx, args: Record<string, unknown>): Promise<unknown>
}
export type { WorkAppV7Handles } from './v5-handles'

export type V8ModuleRunCtx = V7ModuleRunCtx & CoreV5.WorkAppV8Handles
export type V8WorkAppToolCtx = V7WorkAppToolCtx & CoreV5.WorkAppV8Handles
export type V8ActionWorkModule = Omit<V7ActionWorkModule, 'run'> & { run(ctx: V8ModuleRunCtx, input: unknown): Promise<unknown> }
export type V8WorkAppTool = Omit<CorePackage.WorkAppTool, 'run'> & {
  run(ctx: V8WorkAppToolCtx, args: Record<string, unknown>): Promise<unknown>
}
export type { WorkAppV8Handles } from './v5-handles'
export type { FetchFxMonthlyResult } from './fx-bazg'
export type { ReferenceReader, ReferenceRowsOptions } from './references'
export type {
  WorkAppUses,
  UsesConnection,
  UsesSend,
  UsesSendTo,
  UsesSendQuery,
  UsesDbQuery,
  UsesInbox,
  SendTarget,
  ConnectionKind,
  DbEngine,
  DbQueryImpl,
  KnowledgeHit,
  SendContent,
  SendRequest,
  SendResult,
  WorkAppV3Handles,
} from './uses'
export type { WorkAppMeta } from './package-meta'
export type { LocaleText, AppTemplateFeatures, AppTemplateFeature } from './app-template-features'
export type { AppTemplateUi, AppTemplateField, ChecklistItem } from './app-templates'
export type { SheetTemplate, ExceptionJudge, DerivedColumn, ConfirmCheckCtx, ConfirmCheckRow, ConfirmProblem, WriteRule, DeleteRule } from './sheet-templates'
export type { AppTemplateHandoff } from './handoff-core'
export type { SheetSchema, ColumnDef } from './sheet-columns'
export type { DateRange } from './sheet-periods'
export type { SheetActor, SheetRowView, WorkPerson, WorkMember } from './sheet-gate'
export type { WorkAppProposal } from './app-scope'
export type { ImportPlan, ImportReader, ImportStop } from './bank-import-contract'
export type {
  ScreenRows,
  ScreenRowResult,
  ScreenFilter,
  ScreenChoices,
  CalcModuleCtx,
  ReadRow,
  PreviewStop,
} from './modules'
export type {
  WorkAppReadHandles,
  WorkAppScreenHandles,
  WorkAppHandles,
  WorkAppToolHandles,
  WorkAppSheetWriter,
  WorkAppSheetInfo,
  WorkAppFileInfo,
  WorkAppPreparedFile,
  WorkAppTaskInfo,
  WorkAppSealedInfo,
} from './handles'

export type { WorkAppTool as V1WorkAppTool, WorkAppToolCtx as V1WorkAppToolCtx, WorkAppFactory as V1WorkAppFactory } from './package'
export type { CalcWorkModule as V1CalcWorkModule } from './modules'
