import { PrismaClient } from '@prisma/client'

// ============================================================================
// ============================================================================
//
//
//

const HIT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const MAX_HITS_PER_AGENT = 5000

export const MAX_RATE_LIMIT_COUNT = MAX_HITS_PER_AGENT

type Hit = { t: number; c: string | null }
const hits = new Map<string, Hit[]>()

export function clampRateLimitCount(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(Math.floor(n), MAX_RATE_LIMIT_COUNT)
}

const SWEEP_EVERY = 200
let sinceSweep = 0

function sweep(now: number): void {
  const cutoff = now - HIT_RETENTION_MS
  for (const [agentId, list] of hits) {
    const kept = list.filter(h => h.t >= cutoff)
    if (kept.length === 0) hits.delete(agentId)
    else if (kept.length !== list.length) hits.set(agentId, kept)
  }
}

export function recordChatRequest(
  agentId: string,
  clientId: string | null,
  now: number = Date.now()
): void {
  const cutoff = now - HIT_RETENTION_MS
  const list = (hits.get(agentId) ?? []).filter(h => h.t >= cutoff)
  list.push({ t: now, c: clientId })
  hits.set(agentId, list.length > MAX_HITS_PER_AGENT ? list.slice(-MAX_HITS_PER_AGENT) : list)

  if (++sinceSweep >= SWEEP_EVERY) {
    sinceSweep = 0
    sweep(now)
  }
}

export function countRecentChatRequests(
  agentId: string,
  clientId: string | null,
  since: number
): number {
  const list = hits.get(agentId)
  if (!list) return 0
  return list.reduce(
    (n, h) => n + (h.t >= since && (!clientId || h.c === clientId) ? 1 : 0),
    0
  )
}

export function __resetChatRequestCounter(): void {
  hits.clear()
}

interface RateLimitSettings {
  chatLimitCount: number
  chatLimitDurationMinutes: number
  chatLimitMessage: string
  continuousAnswerLimit: number
  continuousAnswerLimitMessage: string
}

interface RateLimitResult {
  allowed: boolean
  reason?: 'chat_limit' | 'continuous_limit'
  message?: string
  resetTime?: Date
}

function decideAndRecord(p: {
  agentId: string
  clientId: string | null
  settings: RateLimitSettings
  nowMs: number
  chatWindowStart: Date
  recentWindow: Date
  savedChat: number
  savedRecent: number
}): RateLimitResult {
  const { agentId, clientId, settings, nowMs, chatWindowStart, recentWindow } = p

  if (settings.chatLimitCount > 0) {
    const count = Math.max(
      p.savedChat,
      countRecentChatRequests(agentId, clientId, chatWindowStart.getTime())
    )
    if (count >= settings.chatLimitCount) {
      return {
        allowed: false,
        reason: 'chat_limit',
        message: settings.chatLimitMessage,
        resetTime: new Date(
          chatWindowStart.getTime() + settings.chatLimitDurationMinutes * 60 * 1000
        ),
      }
    }
  }

  if (settings.continuousAnswerLimit > 0) {
    const count = Math.max(
      p.savedRecent,
      countRecentChatRequests(agentId, clientId, recentWindow.getTime())
    )
    if (count >= settings.continuousAnswerLimit) {
      return {
        allowed: false,
        reason: 'continuous_limit',
        message: settings.continuousAnswerLimitMessage,
      }
    }
  }

  recordChatRequest(agentId, clientId, nowMs)
  return { allowed: true }
}

/**
 * Check rate limits for chat messages based on existing History data
 * @param prisma - Prisma client instance
 * @param agentId - Agent ID to check limits for
 * @param clientId - Client ID (for widget users)
 * @param settings - Rate limit settings from user preferences
 * @returns Rate limit check result
 */
export async function checkRateLimit(
  prisma: PrismaClient,
  agentId: string,
  clientId: string | null,
  settings: RateLimitSettings
): Promise<RateLimitResult> {
  try {
    // If limits are disabled (0), allow all requests
    if (settings.chatLimitCount <= 0 && settings.continuousAnswerLimit <= 0) {
      recordChatRequest(agentId, clientId)
      return { allowed: true }
    }

    const nowMs = Date.now()
    const chatWindowStart = new Date(nowMs - settings.chatLimitDurationMinutes * 60 * 1000)
    const recentWindow = new Date(nowMs - 5 * 60 * 1000)

    const countSaved = (since: Date) =>
      prisma.conversation.count({
        where: {
          agentId: agentId,
          ...(clientId && { client_id: clientId }),
          created_at: { gte: since },
        },
      })

    const savedChat = settings.chatLimitCount > 0 ? await countSaved(chatWindowStart) : 0
    const savedRecent = settings.continuousAnswerLimit > 0 ? await countSaved(recentWindow) : 0

    //
    return decideAndRecord({
      agentId, clientId, settings, nowMs,
      chatWindowStart, recentWindow, savedChat, savedRecent,
    })
  } catch (error) {
    console.error('Rate limit check failed:', error)
    throw error
  }
}

export interface RateLimitAgentFields {
  chatLimitCount?: number | null
  chatLimitDurationMinutes?: number | null
  chatLimitMessage?: string | null
  continuousAnswerLimit?: number | null
  continuousAnswerLimitMessage?: string | null
}

export function toRateLimitSettings(agent: RateLimitAgentFields): RateLimitSettings {
  return {
    chatLimitCount: agent.chatLimitCount ?? 0,
    chatLimitDurationMinutes: agent.chatLimitDurationMinutes ?? 1440,
    chatLimitMessage: agent.chatLimitMessage ?? 'You have reached your chat limit. Please try again later.',
    continuousAnswerLimit: agent.continuousAnswerLimit ?? 0,
    continuousAnswerLimitMessage: agent.continuousAnswerLimitMessage ?? 'You are sending messages too quickly. Please wait a moment.',
  }
}

export function areRateLimitsEnabled(agent: RateLimitAgentFields | null | undefined): boolean {
  return (agent?.chatLimitCount ?? 0) > 0 || (agent?.continuousAnswerLimit ?? 0) > 0
}
