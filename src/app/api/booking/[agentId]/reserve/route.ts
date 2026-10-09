import { NextRequest, NextResponse } from 'next/server'
import { describeCaughtError } from '@/lib/log-mask'
import { clientIpOf } from '@/lib/auth/app-rate-limit'
import {
  AGENT_CONFIRM_MAIL_FACTOR,
  EMAIL_CONFIRM_LIMIT,
  IP_CONFIRM_MAIL_LIMIT,
  IP_RESERVE_LIMIT,
  checkFormTiming,
  agentConfirmMailLimiter,
  confirmMailLimiter,
  ipReserveLimiter,
  isHoneypotFilled,
  isSameOriginRequest,
  type SlidingWindowLimiter,
} from '@/lib/booking-widget/guard'
import { parseReserveInput } from '@/lib/booking-widget/input'
import { widgetSettingsOf } from '@/lib/booking-widget/public-config'
import { pendingBookings } from '@/lib/booking-widget/confirm-store'
import type { ReserveFailCode, ReserveResponse } from '@/lib/booking-widget/result'
import { sendBookingConfirmLink } from '@/lib/booking-widget/mail'
import { commitBooking, prepareBooking, underHourlyLimit } from '@/lib/booking-widget/commit'
import { isServiceAvailable, resolveBookingWidget } from '@/lib/booking-widget/server'

const NO_STORE = { 'Cache-Control': 'no-store' }

function appOrigin(): string {
  try {
    return new URL(process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://www.aitalk.ch').origin
  } catch {
    return 'https://www.aitalk.ch'
  }
}

function fail(code: ReserveFailCode, status = 200) {
  return NextResponse.json({ ok: false, code } satisfies ReserveResponse, { status, headers: NO_STORE })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    if (!isSameOriginRequest(request.headers)) return fail('invalid', 403)
    const { agentId } = await params
    const body = await request.json().catch(() => null)
    const now = Date.now()

    const timing = checkFormTiming(body?.renderedAt, now)
    if (isHoneypotFilled(body?.website) || timing === 'too_fast') {
      return NextResponse.json(
        { ok: true, start: typeof body?.start === 'string' ? body.start.slice(0, 40) : '', end: null, partySize: null, tableName: null } satisfies ReserveResponse,
        { headers: NO_STORE },
      )
    }
    if (timing !== 'ok') return fail('invalid', 400)

    const input = parseReserveInput(body)
    if (!input) return fail('invalid', 400)

    const ip = clientIpOf(request.headers) || 'unknown'
    if (!ipReserveLimiter.tryHit(ip, IP_RESERVE_LIMIT, now)) return fail('rate_limited', 429)

    const resolved = await resolveBookingWidget(agentId)
    if (!resolved) return NextResponse.json({ error: 'not_found' }, { status: 404, headers: NO_STORE })
    if (!(await isServiceAvailable(resolved.userId, resolved.agentId))) return fail('unavailable')

    const settings = widgetSettingsOf(resolved.nodeData)
    if (!underHourlyLimit(resolved, now)) return fail('rate_limited', 429)

    const prep = await prepareBooking(resolved, input, now)
    if (!prep.ok) return fail(prep.code)

    if (settings.emailConfirm) {
      const mailLimits: Array<[SlidingWindowLimiter, string, number]> = [
        [confirmMailLimiter, `ip|${ip}`, IP_CONFIRM_MAIL_LIMIT],
        [confirmMailLimiter, `em|${agentId}|${input.email.toLowerCase()}`, EMAIL_CONFIRM_LIMIT],
        [agentConfirmMailLimiter, agentId, settings.hourlyLimit * AGENT_CONFIRM_MAIL_FACTOR],
      ]
      const taken: Array<[SlidingWindowLimiter, string]> = []
      for (const [limiter, key, limit] of mailLimits) {
        if (!limiter.tryHit(key, limit, now)) {
          for (const [l, k] of taken) l.release(k, now)
          return fail('rate_limited', 429)
        }
        taken.push([limiter, key])
      }
      const releaseMailLimits = () => {
        for (const [l, k] of taken) l.release(k, now)
      }
      const token = pendingBookings.create(agentId, input, settings.confirmTtlMin, now)
      if (!token) {
        releaseMailLimits()
        return fail('unavailable', 503)
      }
      const origin = appOrigin()
      const link = `${origin}/book/${encodeURIComponent(agentId)}/confirm?t=${token}&lang=${input.lang}`
      const sent = await sendBookingConfirmLink({
        to: input.email,
        lang: input.lang,
        title: settings.title || resolved.agentName,
        name: input.firstName,
        startIso: input.start,
        timezone: prep.prepared.timezone,
        partySize: prep.prepared.party,
        link,
        minutes: settings.confirmTtlMin,
      }).catch((error) => {
        console.error('[BookingWidget/reserve] confirm link email threw:', describeCaughtError(error))
        return false
      })
      if (!sent) {
        pendingBookings.discard(token)
        releaseMailLimits()
        return fail('unavailable', 502)
      }
      return NextResponse.json({ ok: true, pending: true } satisfies ReserveResponse, { headers: NO_STORE })
    }

    const result = await commitBooking(resolved, input, prep.prepared, now)
    return NextResponse.json(result satisfies ReserveResponse, { headers: NO_STORE })
  } catch (error) {
    console.error('[BookingWidget/reserve] failed:', describeCaughtError(error))
    return fail('unavailable', 500)
  }
}
