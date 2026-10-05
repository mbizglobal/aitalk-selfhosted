
import { describeCaughtError } from '@/lib/log-mask'
import { chargeCPAWithReason, checkCPABalance } from '@/lib/cpa-service'
import type { AIToolClient } from '@/lib/workflow/tools/types'
import type { ReserveInput } from './input'
import { ymdOfIso } from './input'
import { takesPartySize, widgetMaxPartyOf, widgetSettingsOf } from './public-config'
import { mapBookResult, type ReserveFailCode, type ReserveResult } from './result'
import { agentReserveLimiter } from './guard'
import { sendBookingConfirmation } from './mail'
import {
  contactPhoneOf,
  fetchDaySlots,
  invalidateDaySlots,
  isBookableDate,
  loadWidgetCalendarClient,
  type ResolvedBookingWidget,
} from './server'

export const WIDGET_BOOKING_CPA = 5

export interface PreparedBooking {
  client: AIToolClient
  timezone: string
  ymd: string
  party: number | null
}

export type PrepareOutcome = { ok: true; prepared: PreparedBooking } | { ok: false; code: ReserveFailCode }

export async function prepareBooking(resolved: ResolvedBookingWidget, input: ReserveInput, nowMs: number): Promise<PrepareOutcome> {
  const { nodeData, agentId } = resolved
  const timezone = typeof nodeData.timezone === 'string' && nodeData.timezone ? nodeData.timezone : 'Europe/Zurich'
  const windowDays = Number(nodeData.bookingWindowDays) > 0 ? Math.floor(Number(nodeData.bookingWindowDays)) : 0
  const ymd = ymdOfIso(input.start)
  if (!isBookableDate(ymd, timezone, windowDays, nowMs)) return { ok: false, code: 'outside_window' }

  let party: number | null = null
  if (takesPartySize(nodeData)) {
    const max = widgetMaxPartyOf(nodeData)
    if (!max) return { ok: false, code: 'unavailable' }
    if (!input.party) return { ok: false, code: 'invalid' }
    if (max && input.party > max) return { ok: false, code: 'party_too_large' }
    party = input.party
  }

  const client = await loadWidgetCalendarClient(resolved)
  if (!client) return { ok: false, code: 'unavailable' }

  const fresh = await fetchDaySlots(client, ymd, timezone, party)
  if (!fresh.ok) return { ok: false, code: fresh.reason === 'party_too_large' ? 'party_too_large' : 'unavailable' }
  const startMs = new Date(input.start).getTime()
  if (!fresh.starts.some((s) => new Date(s).getTime() === startMs)) {
    invalidateDaySlots(agentId, ymd)
    return { ok: false, code: 'slot_taken' }
  }
  return { ok: true, prepared: { client, timezone, ymd, party } }
}

export function underHourlyLimit(resolved: ResolvedBookingWidget, nowMs: number): boolean {
  return agentReserveLimiter.count(resolved.agentId, nowMs) < widgetSettingsOf(resolved.nodeData).hourlyLimit
}

export async function commitBooking(resolved: ResolvedBookingWidget, input: ReserveInput, p: PreparedBooking, nowMs: number): Promise<ReserveResult> {
  const { agentId } = resolved
  if (!agentReserveLimiter.tryHit(agentId, widgetSettingsOf(resolved.nodeData).hourlyLimit, nowMs)) return { ok: false, code: 'rate_limited' }
  let booked = false
  try {
    return await bookAndCharge(resolved, input, p, () => { booked = true })
  } finally {
    if (!booked) agentReserveLimiter.release(agentId, nowMs)
  }
}

async function bookAndCharge(resolved: ResolvedBookingWidget, input: ReserveInput, p: PreparedBooking, markBooked: () => void): Promise<ReserveResult> {
  const { agentId } = resolved
  const balance = await checkCPABalance(resolved.userId)
  if (balance === null || balance < WIDGET_BOOKING_CPA) return { ok: false, code: 'unavailable' }

  const name = `${input.firstName} ${input.lastName}`
  let result: ReserveResult
  try {
    const raw = await p.client.callTool(
      'book_calendar_event',
      {
        start_iso: input.start,
        summary: `Online booking: ${name}`,
        patient_name: name,
        patient_phone: input.phone,
        patient_email: input.email,
        ...(input.message ? { notes: input.message } : {}),
        ...(p.party ? { party_size: p.party } : {}),
      },
      { callChannel: 'booking_widget', restrictedContact: { phone: input.phone, email: input.email } },
    )
    result = mapBookResult(raw)
  } catch (error) {
    console.error('[BookingWidget] book threw:', describeCaughtError(error))
    result = { ok: false, code: 'unavailable' }
  }

  if (!result.ok) {
    if (result.code === 'slot_taken') invalidateDaySlots(agentId, p.ymd)
    return result
  }
  markBooked()
  const charged = await chargeCPAWithReason(agentId, WIDGET_BOOKING_CPA).catch(() => ({ failure: 'error' as const }))
  if ('failure' in charged) {
    console.error('[BookingWidget] CPA charge after booking failed', { agentId, amount: WIDGET_BOOKING_CPA, reason: charged.failure })
  }
  invalidateDaySlots(agentId, p.ymd)

  const booked = { ...result, start: input.start, partySize: result.partySize ?? p.party }
  const settings = widgetSettingsOf(resolved.nodeData)
  void (async () => {
    const contactPhone = await contactPhoneOf(agentId)
    const ok = await sendBookingConfirmation({
      to: input.email,
      lang: input.lang,
      title: settings.title || resolved.agentName,
      name: input.firstName,
      startIso: booked.start,
      timezone: p.timezone,
      partySize: booked.partySize,
      tableName: booked.tableName,
      message: input.message,
      contactPhone,
    })
    if (!ok) console.error('[BookingWidget] confirmation email failed', { agentId })
  })().catch((error) => console.error('[BookingWidget] confirmation email threw:', describeCaughtError(error)))

  return booked
}
