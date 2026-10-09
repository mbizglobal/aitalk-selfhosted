
export const WORK_APP_CORE_API = 2

export { isCalendarDate } from './dates'
export { WorkError } from './errors'
export { moduleStop } from './module-stop'
export { normalizeRow, uniqueKeyHash } from './sheet-columns'
export { dateInAny } from './sheet-periods'
export { findTemplate, templateSchema } from './sheet-templates'

import type * as CoreModules from './modules'
import type * as CorePackage from './package'
import type * as CoreAppTemplates from './app-templates'
export type ModuleRunCtx = Omit<CoreModules.ModuleRunCtx, 'deps'>
export type ScreenRowsCtx = Omit<CoreModules.ScreenRowsCtx, 'deps'>
export type WorkAppToolCtx = Omit<CorePackage.WorkAppToolCtx, 'deps'>
export type ActionWorkModule<Ctx = ModuleRunCtx> = Omit<CoreModules.ActionWorkModule<Ctx>, 'screenRows'> & {
  screenRows?(ctx: ScreenRowsCtx): Promise<CoreModules.ScreenRows>
}
export type CalcWorkModule = Omit<CoreModules.CalcWorkModule, 'prepare'>
export type WorkModule = CalcWorkModule | ActionWorkModule
export type WorkAppTool = Omit<CorePackage.WorkAppTool, 'run'> & {
  run(ctx: WorkAppToolCtx, args: Record<string, unknown>): Promise<unknown>
}
export type AppTemplate = Omit<CoreAppTemplates.AppTemplate, 'checklist' | 'calcModule'> & {
  calcModule: CalcWorkModule | null
  checklist?(ctx: ScreenRowsCtx & { modules: readonly string[] }, period: { start: string; end: string }): Promise<CoreAppTemplates.ChecklistItem[]>
}
export type WorkAppPackage = Omit<CorePackage.WorkAppPackage, 'appTemplates' | 'modules' | 'tools'> & {
  appTemplates: readonly AppTemplate[]
  modules: readonly WorkModule[]
  tools?: readonly WorkAppTool[]
}
export type WorkAppFactory = () => WorkAppPackage
export type { WorkAppMeta } from './package-meta'
export type { LocaleText, AppTemplateFeatures, AppTemplateFeature } from './app-template-features'
export type { AppTemplateUi, AppTemplateField, ChecklistItem } from './app-templates'
export type { SheetTemplate, ExceptionJudge } from './sheet-templates'
export type { SheetSchema, ColumnDef } from './sheet-columns'
export type { DateRange } from './sheet-periods'
export type { SheetActor, SheetRowView } from './sheet-gate'
export type { WorkAppProposal } from './app-scope'
export type { ImportPlan, ImportReader, ImportStop } from './bank-import-contract'
export type {
  ScreenRows,
  ScreenRowResult,
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
  WorkAppTaskInfo,
} from './handles'

export type { WorkAppTool as V1WorkAppTool, WorkAppToolCtx as V1WorkAppToolCtx, WorkAppFactory as V1WorkAppFactory } from './package'
export type { CalcWorkModule as V1CalcWorkModule } from './modules'
