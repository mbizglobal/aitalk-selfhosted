import type { WorkScope } from './app-scope'

export function webSearchRequests(response: unknown): number {
  const n = (response as { tool_usage?: { web_search?: { num_requests?: unknown } } } | null | undefined)?.tool_usage?.web_search?.num_requests
  if (typeof n === 'number' && Number.isInteger(n) && n >= 0) return n
  return countWebSearchCalls((response as { output?: unknown } | null | undefined)?.output)
}

export class WebSearchTally {
  private seen = 0
  private items = 0
  private billed: number | null = null
  onChunk(chunk: unknown): void {
    const c = chunk as { type?: unknown; response?: unknown } | null
    if (!c || typeof c !== 'object') return
    if (c.type === 'response.web_search_call.completed') this.seen++
    if ((c.type === 'response.completed' || c.type === 'response.incomplete' || c.type === 'response.failed') && c.response) {
      const n = (c.response as { tool_usage?: { web_search?: { num_requests?: unknown } } }).tool_usage?.web_search?.num_requests
      if (typeof n === 'number' && Number.isInteger(n) && n >= 0) this.billed = n
      else this.items = Math.max(this.items, countWebSearchCalls((c.response as { output?: unknown }).output))
    }
  }
  get count(): number {
    return this.billed ?? Math.max(this.seen, this.items)
  }
}

export function countWebSearchCalls(output: unknown): number {
  return Array.isArray(output) ? output.filter((x) => (x as { type?: unknown })?.type === 'web_search_call').length : 0
}

export async function recordWorkWebSearches(ctx: { userId?: string; workflowId?: string; workScope?: WorkScope }, count: number, round: number): Promise<void> {
  if (!count || !ctx.workScope || !ctx.userId || !ctx.workflowId) return
  console.log(`[work-ai] web_search round ${round} count=${count}`)
  try {
    const [{ prisma }, { ensureUserDataKey }, { writeWorkEvent }] = await Promise.all([import('@/lib/prisma'), import('@/lib/user-data-key'), import('./projects')])
    const key = await ensureUserDataKey(prisma, ctx.userId)
    await writeWorkEvent(prisma as never, key, { userId: ctx.userId, projectId: ctx.workScope.projectId, taskId: ctx.workScope.taskId ?? undefined, actor: { type: 'ai', workflowId: ctx.workflowId, ...(ctx.workScope.requestedBy ? { requestedBy: ctx.workScope.requestedBy } : {}) }, action: 'web_search', detail: { count, round } })
  } catch (e) {
    const { describeCaughtError } = await import('@/lib/log-mask')
    console.error('[work-ai] web_search 기록 실패:', describeCaughtError(e))
  }
}
