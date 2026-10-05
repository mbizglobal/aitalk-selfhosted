
export const SILENT_RETRY_NOTE =
  ` This is an internal formatting fix, not something the caller needs to hear: do NOT mention it (no "timezone", ` +
  `no "let me correct that") — call the tool again right away with the fixed value, with nothing said before the call.`

export interface OffsetValidationResult {
  ok: boolean
  expectedOffset?: string
  gotOffset?: string
  refusalMessage?: string
}

function extractIsoOffset(iso: string): string | null {
  const m = iso.match(/(Z|[+-]\d{2}:?\d{2})$/)
  if (!m) return null
  if (m[1] === 'Z') return '+00:00'
  // Normalize "+0900" → "+09:00"
  return m[1].length === 5 ? `${m[1].slice(0, 3)}:${m[1].slice(3)}` : m[1]
}

function computeValidOffset(date: Date, timezone: string): string | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'shortOffset',
    }).formatToParts(date)
    const tzName = parts.find((p) => p.type === 'timeZoneName')?.value || ''
    // shortOffset returns "GMT+2" / "GMT+02:00" / "GMT-04:00" / "GMT+5:30" / "GMT"
    const m = tzName.match(/GMT([+-])?(\d{1,2})?(?::?(\d{2}))?/)
    if (!m) return null
    const sign = m[1] === '-' ? '-' : '+'
    const hh = String(parseInt(m[2] || '0', 10)).padStart(2, '0')
    const mm = (m[3] || '00').padStart(2, '0')
    return `${sign}${hh}:${mm}`
  } catch {
    return null
  }
}

export function validateOffsetMatchesCalendar(
  iso: string,
  calendarTimezone: string
): OffsetValidationResult {
  const gotOffset = extractIsoOffset(iso)
  if (!gotOffset) {
    return {
      ok: false,
      gotOffset: '(missing)',
      refusalMessage:
        `The provided datetime "${iso}" has no timezone offset. ` +
        `You MUST include the correct offset for calendar timezone "${calendarTimezone}". ` +
        `Example for Europe/Zurich in summer: 2026-05-22T09:00:00+02:00.` +
        SILENT_RETRY_NOTE,
    }
  }

  const targetDate = new Date(iso)
  if (Number.isNaN(targetDate.getTime())) {
    return {
      ok: false,
      gotOffset,
      refusalMessage: `The datetime "${iso}" is not a valid ISO 8601 string.`,
    }
  }

  const expectedOffset = computeValidOffset(targetDate, calendarTimezone)
  if (!expectedOffset) {
    // Cannot determine — accept to avoid blocking legitimate bookings.
    return { ok: true }
  }

  if (gotOffset === expectedOffset) {
    return { ok: true, expectedOffset, gotOffset }
  }

  return {
    ok: false,
    expectedOffset,
    gotOffset,
    refusalMessage:
      `Wrong timezone offset. You sent "${gotOffset}" but calendar timezone "${calendarTimezone}" ` +
      `requires "${expectedOffset}" on the target date (DST-aware). ` +
      `RETRY with the corrected offset — keep the same wall-clock hour and minute. ` +
      `Example: if you sent "2026-05-22T09:00:00${gotOffset}", change it to "2026-05-22T09:00:00${expectedOffset}". ` +
      `Do NOT shift the hour/minute — only the offset suffix.` +
      SILENT_RETRY_NOTE,
  }
}
