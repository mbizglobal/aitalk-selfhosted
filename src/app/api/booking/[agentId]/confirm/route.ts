import { NextRequest, NextResponse } from 'next/server'
import { describeCaughtError } from '@/lib/log-mask'
import { clientIpOf } from '@/lib/auth/app-rate-limit'
import { IP_CONFIRM_LIMIT, ipConfirmLimiter, isSameOriginRequest } from '@/lib/booking-widget/guard'
import { pendingBookings } from '@/lib/booking-widget/confirm-store'
import type { ReserveFailCode, ReserveResponse, ReserveResult } from '@/lib/booking-widget/result'
import { commitBooking, prepareBooking } from '@/lib/booking-widget/commit'
import { isServiceAvailable, resolveBookingWidget } from '@/lib/booking-widget/server'

const NO_STORE = { 'Cache-Control': 'no-store' }

function fail(code: ReserveFailCode, status = 200) {
  return NextResponse.json({ ok: false, code } satisfies ReserveResponse, { status, headers: NO_STORE })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ agentId: string }> }) {
  let token: string | null = null
  let finished = false
  try {
    if (!isSameOriginRequest(request.headers)) return fail('invalid', 403)
    const { agentId } = await params
    const now = Date.now()
    const body = await request.json().catch(() => null)
    const begun = pendingBookings.begin(body?.token, now)
    if (begun.kind === 'done') return begun.agentId === agentId ? NextResponse.json(begun.result, { headers: NO_STORE }) : fail('link_expired')
    if (begun.kind === 'busy') return fail('busy')
    if (begun.kind !== 'start') return fail('link_expired')
    token = body.token as string
    const ip = clientIpOf(request.headers) || 'unknown'
    if (!ipConfirmLimiter.tryHit(ip, IP_CONFIRM_LIMIT, now)) {
      pendingBookings.finish(token, { ok: false, code: 'rate_limited' }, now)
      return fail('rate_limited', 429)
    }
    const { input } = begun.pending
    if (begun.pending.agentId !== agentId) {
      pendingBookings.finish(token, { ok: false, code: 'invalid' }, now)
      return fail('link_expired')
    }

    const result = await confirmBooking(agentId, begun.pending.input, now)
    pendingBookings.finish(token, result, now)
    finished = true
    return NextResponse.json({ ...result, ...(result.ok ? { email: input.email } : {}) }, { headers: NO_STORE })
  } catch (error) {
    console.error('[BookingWidget/confirm] failed:', describeCaughtError(error))
    if (token && !finished) pendingBookings.finish(token, { ok: false, code: 'unavailable' }, Date.now())
    return fail('unavailable', 500)
  }
}

async function confirmBooking(agentId: string, input: Parameters<typeof prepareBooking>[1], now: number): Promise<ReserveResult> {
  const resolved = await resolveBookingWidget(agentId)
  if (!resolved) return { ok: false, code: 'unavailable' }
  if (!(await isServiceAvailable(resolved.userId))) return { ok: false, code: 'unavailable' }
  const prep = await prepareBooking(resolved, input, now)
  if (!prep.ok) return prep
  return commitBooking(resolved, input, prep.prepared, now)
}
