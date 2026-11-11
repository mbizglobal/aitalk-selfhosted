
import type { AppTemplate } from './app-templates'
import type { SheetTemplate } from './sheet-templates'
import type { WorkModule } from './modules'
import type { WorkFileDeps } from './files'
import type { SheetActor } from './sheet-gate'
import type { WorkScope } from './app-scope'
import type { WorkAppMeta } from './package-meta'
import type { WorkAppHandles, WorkAppToolHandles } from './handles'
import type { DbQueryImpl } from './uses'

export interface WorkAppPackage {
  id: string
  version: string
  core: number
  meta: WorkAppMeta
  appTemplates: readonly AppTemplate[]
  sheetTemplates: readonly SheetTemplate[]
  modules: readonly WorkModule[]
  tools?: readonly WorkAppTool[]
  dbQueries?: Readonly<Record<string, DbQueryImpl>>
  libs?: Readonly<Record<string, number>>
  sendRefs?: SendRefHooks
  workflowTemplates?: readonly unknown[]
}

export type SendRefCtx = Pick<WorkAppHandles, 'sheets' | 'files'> & { userId: string; projectId: string }

export interface SendRefHooks {
  canSend(ctx: SendRefCtx, input: { ref: string; attachFileIds: readonly string[]; key?: string | null }): Promise<boolean>
  afterSent(ctx: SendRefCtx, input: { ref: string; sendId: string; sentAt: string; how: 'mail' | 'manual'; attachFileIds?: readonly string[] | null }): Promise<void>
}

export interface WorkAppToolCtx extends WorkAppToolHandles {
  deps: WorkFileDeps
  userId: string
  workflowId: string
  scope: WorkScope
  actor: SheetActor
  project: { id: string; kind: string; modules: string[] }
}

export interface WorkAppTool {
  def: { name: string; description: string; parameters: Record<string, unknown> }
  readOnly?: boolean
  run(ctx: WorkAppToolCtx, args: Record<string, unknown>): Promise<unknown>
}

export type WorkAppFactory = () => WorkAppPackage
