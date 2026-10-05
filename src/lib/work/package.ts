
import type { AppTemplate } from './app-templates'
import type { SheetTemplate } from './sheet-templates'
import type { WorkModule } from './modules'
import type { WorkFileDeps } from './files'
import type { SheetActor } from './sheet-gate'
import type { WorkScope } from './app-scope'
import type { WorkAppMeta } from './package-meta'

export interface WorkAppPackage {
  id: string
  version: string
  core: number
  meta: WorkAppMeta
  appTemplates: readonly AppTemplate[]
  sheetTemplates: readonly SheetTemplate[]
  modules: readonly WorkModule[]
  tools?: readonly WorkAppTool[]
}

export interface WorkAppToolCtx {
  deps: WorkFileDeps
  userId: string
  workflowId: string
  scope: WorkScope
  actor: SheetActor
  project: { id: string; kind: string; modules: string[] }
}

export interface WorkAppTool {
  def: { name: string; description: string; parameters: Record<string, unknown> }
  run(ctx: WorkAppToolCtx, args: Record<string, unknown>): Promise<unknown>
}

export type WorkAppFactory = () => WorkAppPackage
