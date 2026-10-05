
export const BOOKING_CONFIRM_TTL_MS = 10 * 60 * 1000

export interface PendingBookingConfirm {
  key: string
  at: number
  used?: boolean
}

export function needsBookingConfirm(callChannel: string | null | undefined): boolean {
  return callChannel === 'pstn' || callChannel === 'web_voice'
}

export function bookingConfirmKey(p: {
  calendarId: string
  startIso: string
  name: string
  phone?: string | null
  fullPhone?: boolean
  partySize?: number | null
}): string {
  const startMs = Date.parse(p.startIso)
  const phoneDigits = String(p.phone ?? '').replace(/\D/g, '')
  return JSON.stringify([
    p.calendarId,
    Number.isFinite(startMs) ? startMs : String(p.startIso),
    String(p.name ?? '').toLowerCase().replace(/\s+/g, ''),
    p.fullPhone ? phoneDigits : phoneDigits.slice(-8),
    p.partySize ?? null,
  ])
}

export type BookingConfirmOutcome = 'book' | 'ask' | 'duplicate'

export function consumeBookingConfirm(
  ctx: { pendingBookingConfirm?: PendingBookingConfirm; callerLastTurnAt?: number },
  key: string,
  confirmed: unknown,
  now: number = Date.now(),
): BookingConfirmOutcome {
  const pending = ctx.pendingBookingConfirm
  if (pending?.used && pending.key === key) {
    ctx.pendingBookingConfirm = undefined
    return 'duplicate'
  }
  const lastTurnAt = ctx.callerLastTurnAt
  if (
    confirmed === true && pending && !pending.used && pending.key === key && now - pending.at < BOOKING_CONFIRM_TTL_MS &&
    typeof lastTurnAt === 'number' && lastTurnAt > pending.at
  ) {
    pending.used = true
    ctx.pendingBookingConfirm = undefined
    return 'book'
  }
  ctx.pendingBookingConfirm = { key, at: now }
  return 'ask'
}

export function bookingConfirmDuplicateResult(): string {
  return JSON.stringify({
    success: false,
    error: 'booking_already_confirmed',
    instruction:
      'This exact booking was already confirmed and is being saved by another call. Do NOT call book_calendar_event again for it — tell the caller the result of that booking.',
  })
}

function formatWhen(startIso: string, timezone: string): string {
  const d = new Date(startIso)
  if (!Number.isFinite(d.getTime())) return startIso
  const text = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d)
  return `${text} (${timezone})`
}

export function bookingConfirmRequiredResult(p: {
  startIso: string
  timezone: string
  name: string
  readPhone?: boolean
  partySize?: number | null
  notes?: string | null
}): string {
  const summary: Record<string, unknown> = { when: formatWhen(p.startIso, p.timezone), name: p.name }
  if (p.partySize) summary.party_size = p.partySize
  if (p.notes) summary.message = p.notes
  return JSON.stringify({
    success: false,
    error: 'confirmation_required',
    booking_summary: summary,
    instruction:
      `NOT BOOKED YET. In the caller's language, read these details back in one short sentence — the date and time` +
      `${p.partySize ? ', the party size' : ''}, and the name${p.readPhone ? ', and the phone number you entered one digit at a time (every digit, e.g. five five five five — never group or shorten repeated digits)' : ''} — and ask whether it is correct. Do NOT say it is booked. ` +
      `If they say yes, call book_calendar_event again with EXACTLY the same arguments plus confirmed=true. ` +
      `If they change anything, call book_calendar_event with the corrected arguments (without confirmed) so the new details are read back.`,
  })
}

export const BOOK_CONFIRMED_PARAM = {
  type: 'boolean',
  description:
    'OPTIONAL — pass true ONLY on the second call, with exactly the same details, after you read them back and the caller clearly said yes. Never on the first call.',
}

export const BOOK_CONFIRM_TOOL_DESC =
  `FINAL CONFIRMATION (phone and voice calls): the first call does NOT save — it returns error "confirmation_required" with booking_summary to read back. ` +
  `After the caller says yes, call again with the SAME arguments plus confirmed=true. If they change anything, call again with the corrected arguments (without confirmed).`
