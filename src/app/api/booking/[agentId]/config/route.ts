import { NextRequest, NextResponse } from 'next/server'
import { describeCaughtError } from '@/lib/log-mask'
import { buildPublicConfig } from '@/lib/booking-widget/public-config'
import { accountLocaleOf, contactPhoneOf, isServiceAvailable, resolveBookingWidget } from '@/lib/booking-widget/server'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function GET(_request: NextRequest, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const { agentId } = await params
    const resolved = await resolveBookingWidget(agentId)
    if (!resolved) return NextResponse.json({ error: 'not_found' }, { status: 404, headers: NO_STORE })
    const [available, contactPhone, accountLocale] = await Promise.all([
      isServiceAvailable(resolved.userId, resolved.agentId),
      contactPhoneOf(resolved.agentId),
      accountLocaleOf(resolved.userId),
    ])
    const config = buildPublicConfig({
      agentName: resolved.agentName,
      nodeData: resolved.nodeData,
      contactPhone,
      available,
      workflowLang: resolved.workflowLang,
      accountLocale,
    })
    return NextResponse.json(config, { headers: NO_STORE })
  } catch (error) {
    console.error('[BookingWidget/config] failed:', describeCaughtError(error))
    return NextResponse.json({ error: 'unavailable' }, { status: 500, headers: NO_STORE })
  }
}
