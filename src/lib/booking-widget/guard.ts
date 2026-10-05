
export const MIN_FILL_MS = 3000
export const MAX_FORM_AGE_MS = 2 * 60 * 60 * 1000

export type TimingVerdict = 'ok' | 'too_fast' | 'stale' | 'invalid'

export function checkFormTiming(renderedAt: unknown, nowMs: number): TimingVerdict {
  const t = Number(renderedAt)
  if (!Number.isFinite(t) || t <= 0) return 'invalid'
  const age = nowMs - t
  if (age < MIN_FILL_MS) return 'too_fast'
  if (age > MAX_FORM_AGE_MS) return 'stale'
  return 'ok'
}

export function isHoneypotFilled(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

export class SlidingWindowLimiter {
  private hits = new Map<string, number[]>()
  constructor(private readonly windowMs: number, private readonly maxKeys = 50_000) {}

  tryHit(key: string, limit: number, nowMs: number): boolean {
    const from = nowMs - this.windowMs
    const list = (this.hits.get(key) ?? []).filter((t) => t > from)
    if (list.length >= limit) {
      this.hits.set(key, list)
      return false
    }
    list.push(nowMs)
    this.hits.set(key, list)
    if (this.hits.size > this.maxKeys) this.sweep(nowMs)
    return true
  }

  count(key: string, nowMs: number): number {
    const from = nowMs - this.windowMs
    return (this.hits.get(key) ?? []).filter((t) => t > from).length
  }

  release(key: string, stampMs: number): void {
    const list = this.hits.get(key)
    if (!list) return
    const i = list.indexOf(stampMs)
    if (i >= 0) list.splice(i, 1)
  }

  record(key: string, nowMs: number): void {
    const from = nowMs - this.windowMs
    const list = (this.hits.get(key) ?? []).filter((t) => t > from)
    list.push(nowMs)
    this.hits.set(key, list)
    if (this.hits.size > this.maxKeys) this.sweep(nowMs)
  }

  private sweep(nowMs: number): void {
    const from = nowMs - this.windowMs
    for (const [k, list] of this.hits) {
      if (!list.some((t) => t > from)) this.hits.delete(k)
    }
  }
}

const HOUR = 60 * 60 * 1000

export const IP_RESERVE_LIMIT = 5
export const IP_SLOTS_LIMIT = 120
export const EMAIL_CONFIRM_LIMIT = 3
export const IP_CONFIRM_MAIL_LIMIT = 10
export const IP_CONFIRM_LIMIT = 30
export const AGENT_CONFIRM_MAIL_FACTOR = 3

const g = globalThis as unknown as { __aitalkBookingLimitersV2?: Record<string, SlidingWindowLimiter> }
const limiters = (g.__aitalkBookingLimitersV2 ??= {
  ipReserve: new SlidingWindowLimiter(HOUR),
  agentReserve: new SlidingWindowLimiter(HOUR),
  ipSlots: new SlidingWindowLimiter(10 * 60 * 1000),
  confirmMail: new SlidingWindowLimiter(10 * 60 * 1000),
  ipConfirm: new SlidingWindowLimiter(10 * 60 * 1000),
  agentConfirmMail: new SlidingWindowLimiter(HOUR),
})
export const ipReserveLimiter = limiters.ipReserve
export const agentReserveLimiter = limiters.agentReserve
export const ipSlotsLimiter = limiters.ipSlots
export const confirmMailLimiter = limiters.confirmMail
export const ipConfirmLimiter = limiters.ipConfirm
export const agentConfirmMailLimiter = limiters.agentConfirmMail

export function isSameOriginRequest(headers: Headers): boolean {
  const origin = headers.get('origin')
  const host = headers.get('host')
  if (!origin || !host) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}
