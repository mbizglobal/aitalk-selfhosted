import { NextRequest, NextResponse } from 'next/server'
import { describeCaughtError } from '@/lib/log-mask'
import { clientIpOf } from '@/lib/auth/app-rate-limit'
import { IP_SLOTS_LIMIT, ipSlotsLimiter } from '@/lib/booking-widget/guard'
import { takesPartySize, widgetMaxPartyOf } from '@/lib/booking-widget/public-config'
import {
  cachedDaySlots,
  isBookableDate,
  isServiceAvailable,
  loadWidgetCalendarClient,
  resolveBookingWidget,
} from '@/lib/booking-widget/server'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function GET(request: NextRequest, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const { agentId } = await params
    const ip = clientIpOf(request.headers) || 'unknown'
    if (!ipSlotsLimiter.tryHit(ip, IP_SLOTS_LIMIT, Date.now())) {
      return NextResponse.json({ ok: false, reason: 'rate_limited' }, { status: 429, headers: NO_STORE })
    }

    const resolved = await resolveBookingWidget(agentId)
    if (!resolved) return NextResponse.json({ error: 'not_found' }, { status: 404, headers: NO_STORE })
    if (!(await isServiceAvailable(resolved.userId))) {
      return NextResponse.json({ ok: false, reason: 'unavailable' }, { headers: NO_STORE })
    }

    const { nodeData } = resolved
    const timezone = typeof nodeData.timezone === 'string' && nodeData.timezone ? nodeData.timezone : 'Europe/Zurich'
    const windowDays = Number(nodeData.bookingWindowDays) > 0 ? Math.floor(Number(nodeData.bookingWindowDays)) : 0
    const date = request.nextUrl.searchParams.get('date') || ''
    if (!isBookableDate(date, timezone, windowDays)) {
      return NextResponse.json({ ok: true, times: [] }, { headers: NO_STORE })
    }

    let party: number | null = null
    if (takesPartySize(nodeData)) {
      const n = Number(request.nextUrl.searchParams.get('party'))
      if (!Number.isInteger(n) || n < 1) return NextResponse.json({ ok: false, reason: 'invalid' }, { status: 400, headers: NO_STORE })
      const max = widgetMaxPartyOf(nodeData)
      if (!max) return NextResponse.json({ ok: false, reason: 'unavailable' }, { headers: NO_STORE })
      if (n > max) return NextResponse.json({ ok: false, reason: 'party_too_large' }, { headers: NO_STORE })
      party = n
    }

    const slots = await cachedDaySlots(agentId, () => loadWidgetCalendarClient(resolved), date, timezone, party)
    if (!slots.ok) return NextResponse.json({ ok: false, reason: slots.reason }, { headers: NO_STORE })
    const times = slots.starts.map((start) => ({ start, label: start.slice(11, 16) }))
    return NextResponse.json({ ok: true, times }, { headers: NO_STORE })
  } catch (error) {
    console.error('[BookingWidget/slots] failed:', describeCaughtError(error))
    return NextResponse.json({ ok: false, reason: 'unavailable' }, { status: 500, headers: NO_STORE })
  }
}
