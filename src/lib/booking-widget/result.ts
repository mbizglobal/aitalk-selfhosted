
export type ReserveFailCode =
  | 'slot_taken'
  | 'party_too_large'
  | 'closed'
  | 'outside_window'
  | 'already_booked'
  | 'unavailable'
  | 'invalid'
  | 'rate_limited'
  | 'link_expired'
  | 'busy'

export type ReserveResult =
  | { ok: true; start: string; end: string | null; partySize: number | null; tableName: string | null }
  | { ok: false; code: ReserveFailCode }

export type ReserveResponse = ReserveResult | { ok: true; pending: true }

const ERROR_CODE: Record<string, ReserveFailCode> = {
  active_booking_exists: 'already_booked',
  capacity_exceeded: 'slot_taken',
  no_table_available: 'slot_taken',
  time_unavailable: 'slot_taken',
  booking_misaligned_slot: 'slot_taken',
  party_too_large: 'party_too_large',
  invalid_party_size: 'invalid',
  party_size_required: 'invalid',
  booking_on_holiday: 'closed',
  booking_in_closed_range: 'closed',
  booking_on_closed_day: 'closed',
  booking_in_break_time: 'closed',
  booking_outside_working_hours: 'closed',
  booking_window_exceeded: 'outside_window',
  phone_required: 'invalid',
  name_required: 'invalid',
  wrong_timezone_offset: 'invalid',
}

export function mapBookResult(raw: string): ReserveResult {
  let parsed: any
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, code: 'unavailable' }
  }
  if (parsed?.success === true && typeof parsed.start === 'string') {
    const party = Number(parsed.party_size ?? parsed.voice_fastpath?.party_size)
    const table = parsed.assigned_table?.name ?? parsed.voice_fastpath?.table_name
    return {
      ok: true,
      start: parsed.start,
      end: typeof parsed.end === 'string' ? parsed.end : null,
      partySize: Number.isInteger(party) && party > 0 ? party : null,
      tableName: typeof table === 'string' && table ? table.slice(0, 60) : null,
    }
  }
  const code = typeof parsed?.error === 'string' ? ERROR_CODE[parsed.error] : undefined
  return { ok: false, code: code ?? 'unavailable' }
}
