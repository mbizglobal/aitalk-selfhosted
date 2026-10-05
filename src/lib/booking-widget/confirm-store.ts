
import { randomBytes } from 'node:crypto'
import type { ReserveInput } from './input'
import type { ReserveResult } from './result'

export interface PendingBooking {
  agentId: string
  input: ReserveInput
  expiresAt: number
}

type Entry = PendingBooking & { state: 'waiting' | 'working' | 'done'; result?: ReserveResult }

const MAX_ENTRIES = 20_000

const DONE_KEEP_MS = 30 * 60_000

export type BeginOutcome =
  | { kind: 'start'; pending: PendingBooking }
  | { kind: 'done'; result: ReserveResult; agentId: string }
  | { kind: 'busy' }
  | { kind: 'missing' | 'expired' }

export class PendingBookingStore {
  private entries = new Map<string, Entry>()

  create(agentId: string, input: ReserveInput, ttlMin: number, nowMs: number): string | null {
    if (this.entries.size >= MAX_ENTRIES) this.sweep(nowMs)
    if (this.entries.size >= MAX_ENTRIES) return null
    const token = randomBytes(24).toString('base64url')
    this.entries.set(token, { agentId, input, expiresAt: nowMs + ttlMin * 60_000, state: 'waiting' })
    return token
  }

  discard(token: string): void {
    this.entries.delete(token)
  }

  begin(token: unknown, nowMs: number): BeginOutcome {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) return { kind: 'missing' }
    const e = this.entries.get(token)
    if (!e) return { kind: 'missing' }
    if (e.state === 'working') return { kind: 'busy' }
    if (nowMs > e.expiresAt) {
      this.entries.delete(token)
      return { kind: e.state === 'done' ? 'missing' : 'expired' }
    }
    if (e.state === 'done' && e.result) return { kind: 'done', result: e.result, agentId: e.agentId }
    e.state = 'working'
    return { kind: 'start', pending: { agentId: e.agentId, input: e.input, expiresAt: e.expiresAt } }
  }

  finish(token: string, result: ReserveResult, nowMs: number): void {
    const e = this.entries.get(token)
    if (!e || e.state === 'done') return
    if (result.ok) {
      e.state = 'done'
      e.result = result
      e.expiresAt = Math.max(e.expiresAt, nowMs + DONE_KEEP_MS)
    } else if (result.code === 'unavailable' || result.code === 'rate_limited') {
      e.state = 'waiting'
    } else {
      this.entries.delete(token)
    }
  }

  private sweep(nowMs: number): void {
    for (const [k, e] of this.entries) if (e.state !== 'working' && nowMs > e.expiresAt) this.entries.delete(k)
  }
}

const g = globalThis as unknown as { __aitalkPendingBookingsV2?: PendingBookingStore }
export const pendingBookings = (g.__aitalkPendingBookingsV2 ??= new PendingBookingStore())
