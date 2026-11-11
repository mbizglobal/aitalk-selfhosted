
import type { PrismaClient } from '@prisma/client'
import type { AIToolClient, ToolDefinition } from './types'
import type { WorkScope } from '@/lib/work/app-scope'
import { buildWorkAppBrief, callWorkAppTool, workAppRerunnable, workAppToolDefs, workAppWebPageOn, workAppWebSearchOn, type WorkAppAiCtx } from '@/lib/work/app-ai'
import { defaultWorkFileDeps } from '@/lib/work/files'
import { isSelfHosted } from '@/lib/edition'
import { aiSqlToolSlots, type AiSqlSlot } from '@/lib/work/ai-sql'
import { sendRouteViews, type SendRouteView } from '@/lib/work/app-send'
import type { ReadImagesFn } from '@/lib/workflow/nodes/ai/read-images'
import type { DocCardFns } from '@/lib/workflow/nodes/ai/doc-card'
import type { DocFindFns } from '@/lib/workflow/nodes/ai/doc-find'
import { ASSEMBLED_KIND, readSpec } from '@/lib/work/assembled'
import { lookupDeclared, lookupFromSpec } from '@/lib/work/v3-handles'
import type { AskTextFn } from '@/lib/work/v3-handles'

export interface WorkAppToolOverrides {
  workflowId?: string
  workScope?: WorkScope
  readImages?: ReadImagesFn
  docCards?: DocCardFns
  docFind?: DocFindFns
  askText?: AskTextFn
  aiConnectionKind?: string | null
  model?: string
}

const REPEAT_FAIL_MAX = 3

export function failReason(out: string): string | null {
  try {
    const o = JSON.parse(out) as { error?: unknown }
    if (!o || typeof o !== 'object' || typeof o.error !== 'string' || !o.error) return null
    const m = /^([A-Z_]+)(?::\s*([A-Za-z_]+))?/.exec(o.error)
    return m ? `${m[1]}${m[2] ? `: ${m[2]}` : ''}` : o.error.slice(0, 60)
  } catch {
    return null
  }
}

function repeatStopText(name: string, f: { reason: string; n: number }): string {
  return `${name} failed ${f.n} times in a row (${f.reason}) — it will not run again in this turn. Stop retrying: tell the person in plain words what is blocked, what you tried, and the one thing you need from them.`
}

export class RepeatFailGuard {
  private fails = new Map<string, { reason: string; n: number }>()
  async run(name: string, call: () => Promise<string>): Promise<string> {
    const was = this.fails.get(name)
    if (was && was.n >= REPEAT_FAIL_MAX) return JSON.stringify({ error: repeatStopText(name, was) })
    let out: string
    try {
      out = await call()
    } catch (e) {
      const k = e && typeof e === 'object' ? String((e as { code?: unknown }).code ?? (e as { name?: unknown }).name ?? 'Error') : 'Error'
      this.count(name, `EXCEPTION: ${k}`)
      throw e
    }
    const reason = failReason(out)
    if (!reason) { this.fails.delete(name); return out }
    const n = this.count(name, reason)
    this.fails.set(name, { reason, n })
    if (n < REPEAT_FAIL_MAX) return out
    try { return JSON.stringify({ ...(JSON.parse(out) as Record<string, unknown>), stopped: repeatStopText(name, { reason, n }) }) } catch { return out }
  }
  private count(name: string, reason: string): number {
    const cur = this.fails.get(name)
    const n = cur && cur.reason === reason ? cur.n + 1 : 1
    this.fails.set(name, { reason, n })
    return n
  }
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
  private webSearch = false
  private aiSqlSlots: AiSqlSlot[] = []
  private webPage = false
  private sendRoutes: SendRouteView[] = []
  private hasReferences = false
  private hasDocFind = false
  private lookupDocs = false

  webSearchOn(): boolean {
    return this.webSearch
  }

  async initialize(prisma: PrismaClient, _connectionId: string, overrides?: WorkAppToolOverrides, userId?: string): Promise<void> {
    const scope = overrides?.workScope
    const workflowId = overrides?.workflowId
    if (!scope || !workflowId || !userId || typeof scope.projectId !== 'string' || typeof scope.runId !== 'string') {
      throw new WorkAppToolError('WORK_APP_SCOPE_MISSING', 'work app tools load only inside the work app')
    }
    const p = await prisma.workProject.findFirst({ where: { id: scope.projectId, userId, workflowId }, select: { id: true, kind: true, capabilityOff: true } })
    if (!p) throw new WorkAppToolError('WORK_APP_NOT_FOUND', 'the project is not linked to this workflow')
    this.kind = p.kind
    const w = await prisma.workflow.findFirst({ where: { workflowId, agent: { userId } }, select: { workflowJson: true } })
    this.ctx = { deps: await defaultWorkFileDeps(), userId, workflowId, scope, readImages: overrides?.readImages, docCards: overrides?.docCards, docFind: overrides?.docFind, askText: overrides?.askText }
    const spec = p.kind === ASSEMBLED_KIND ? await readSpec(prisma, await this.ctx.deps.dataKey(prisma, userId), { userId, projectId: p.id }) : null
    const lookup = p.kind === ASSEMBLED_KIND ? lookupFromSpec(spec?.spec.lookup) : lookupDeclared(p.kind)
    this.lookupDocs = p.kind === ASSEMBLED_KIND && lookup.docs
    this.webPage = workAppWebPageOn(p, undefined, lookup)
    this.webSearch = workAppWebSearchOn({ kind: p.kind, capabilityOff: p.capabilityOff, aiConnectionKind: overrides?.aiConnectionKind ?? null, model: overrides?.model ?? '' }, undefined, lookup)
    this.aiSqlSlots = w ? await aiSqlToolSlots(prisma, await this.ctx.deps.dataKey(prisma, userId), { userId, workflowId, projectId: p.id, kind: p.kind, workflowJson: w.workflowJson }) : []
    this.sendRoutes = await sendRouteViews(this.ctx.deps, userId, workflowId)
    this.hasReferences = (await prisma.projectReference.count({ where: { fromProjectId: p.id, userId } })) > 0
    if (p.kind === ASSEMBLED_KIND && overrides?.docFind) this.hasDocFind = !!spec?.spec.tables.some((t) => t.file)
    this.ctx.lookupOn = { docs: this.lookupDocs, webPages: this.webPage, webSearch: this.webSearch }
    this.brief = await buildWorkAppBrief(this.ctx)
  }

  systemBrief(): string {
    return this.brief
  }

  listTools(): ToolDefinition[] {
    if (!this.ctx) return []
    return workAppToolDefs(this.kind, this.aiSqlSlots, this.webPage, this.sendRoutes, this.hasReferences, !isSelfHosted(), this.hasDocFind, this.lookupDocs).map((d) => ({ name: d.name, description: d.description, parameters: d.parameters as ToolDefinition['parameters'] }))
  }

  private guard = new RepeatFailGuard()

  async callTool(name: string, args: Record<string, any>): Promise<string> {
    if (!this.ctx) return JSON.stringify({ error: 'work app tools are not loaded' })
    const ctx = this.ctx
    return this.guard.run(name, () => callWorkAppTool(ctx, name, args))
  }

  rerunnable(name: string, args: Record<string, any>, previousOutput: string): boolean {
    return workAppRerunnable(name, previousOutput, args, this.kind)
  }
}
