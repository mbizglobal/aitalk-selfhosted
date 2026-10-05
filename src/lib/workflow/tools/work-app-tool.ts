
import type { PrismaClient } from '@prisma/client'
import type { AIToolClient, ToolDefinition } from './types'
import type { WorkScope } from '@/lib/work/app-scope'
import { buildWorkAppBrief, callWorkAppTool, workAppToolDefs, type WorkAppAiCtx } from '@/lib/work/app-ai'
import { defaultWorkFileDeps } from '@/lib/work/files'
import type { ReadImagesFn } from '@/lib/workflow/nodes/ai/read-images'

export interface WorkAppToolOverrides {
  workflowId?: string
  workScope?: WorkScope
  readImages?: ReadImagesFn
}

export class WorkAppToolError extends Error {
  constructor(readonly code: 'WORK_APP_SCOPE_MISSING' | 'WORK_APP_NOT_FOUND', message: string) {
    super(message)
    this.name = 'WorkAppToolError'
  }
}

export class WorkAppToolClient implements AIToolClient {
  private ctx: WorkAppAiCtx | null = null
  private brief = ''
  private kind = 'free'

  async initialize(prisma: PrismaClient, _connectionId: string, overrides?: WorkAppToolOverrides, userId?: string): Promise<void> {
    const scope = overrides?.workScope
    const workflowId = overrides?.workflowId
    if (!scope || !workflowId || !userId || typeof scope.projectId !== 'string' || typeof scope.runId !== 'string') {
      throw new WorkAppToolError('WORK_APP_SCOPE_MISSING', 'work app tools load only inside the work app')
    }
    const p = await prisma.workProject.findFirst({ where: { id: scope.projectId, userId, workflowId }, select: { id: true, kind: true } })
    if (!p) throw new WorkAppToolError('WORK_APP_NOT_FOUND', 'the project is not linked to this workflow')
    this.kind = p.kind
    this.ctx = { deps: await defaultWorkFileDeps(), userId, workflowId, scope, readImages: overrides?.readImages }
    this.brief = await buildWorkAppBrief(this.ctx)
  }

  systemBrief(): string {
    return this.brief
  }

  listTools(): ToolDefinition[] {
    if (!this.ctx) return []
    return workAppToolDefs(this.kind).map((d) => ({ name: d.name, description: d.description, parameters: d.parameters as ToolDefinition['parameters'] }))
  }

  async callTool(name: string, args: Record<string, any>): Promise<string> {
    if (!this.ctx) return JSON.stringify({ error: 'work app tools are not loaded' })
    return callWorkAppTool(this.ctx, name, args)
  }
}
