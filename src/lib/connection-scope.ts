
export class ConnectionScopeError extends Error {
  constructor(label: string, missing: string) {
    super(`[${label}] Missing ${missing} — refusing an unscoped connection lookup`)
    this.name = 'ConnectionScopeError'
  }
}

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

export function agentScopedWhere(
  scope: { agentId?: string | null; userId?: string | null },
  label: string
): { agentId: string; userId?: string } {
  const agentId = clean(scope.agentId)
  if (!agentId) throw new ConnectionScopeError(label, 'agentId')
  const userId = clean(scope.userId)
  return userId ? { agentId, userId } : { agentId }
}

export function userScopedWhere(
  scope: { userId?: string | null; agentId?: string | null },
  label: string
): { userId: string; agentId?: string } {
  const userId = clean(scope.userId)
  if (!userId) throw new ConnectionScopeError(label, 'userId')
  const agentId = clean(scope.agentId)
  return agentId ? { userId, agentId } : { userId }
}

export function restoreExecutionOwner<T extends { agentId?: string; userId?: string }>(
  owner: { agentId: string; userId: string },
  ctx: T
): T {
  if (!ctx) return ctx
  if (ctx.agentId === owner.agentId && ctx.userId === owner.userId) return ctx
  console.error(
    `[Workflow] 🔒 실행 소유자 오염 감지 — 되돌림 (agentId ${String(ctx.agentId)} → ${owner.agentId}, userId ${String(ctx.userId)} → ${owner.userId})`
  )
  return { ...ctx, agentId: owner.agentId, userId: owner.userId }
}

export const MCP_CONNECTION_PROVIDERS = ['notion', 'slack', 'github', 'google', 'telegram_mcp', 'custom'] as const

export const SAVE_AS_RESERVED_KEYS = new Set<string>([
  'agentId', 'userId',
  'skipAiCallCpa', 'isTestMode',
  'isManaged', 'managedRegion',
  'isScheduledTrigger', 'scheduleRunKey', 'workflowId',
  '__templateVars',
  '__debugEnabled',
  'context',
  'subWorkflowDepth', 'input',
  'callerNumber',
  'voiceQuiz',
  'workScope',
  '__proto__', 'prototype', 'constructor',
])

export function isSaveAsKeyAllowed(saveAs: unknown): boolean {
  if (typeof saveAs !== 'string') {
    console.error(`[Workflow] 동적 변수명이 문자열이 아니다 (${typeof saveAs}) — 저장하지 않는다`)
    return false
  }
  if (SAVE_AS_RESERVED_KEYS.has(saveAs)) {
    console.error(`[Workflow] 동적 변수명 "${saveAs}" 은 예약 키라 저장하지 않는다 (보안·과금)`)
    return false
  }
  return true
}
