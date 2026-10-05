
export const BOOKING_EDIT_GRACE_MS = 60 * 60 * 1000
const CLOCK_SKEW_MS = 5 * 60 * 1000

export function isWithinEditGrace(
  event: { created?: unknown; createdDateTime?: unknown } | null | undefined,
  now: number = Date.now(),
): boolean {
  const raw = event?.created ?? event?.createdDateTime
  if (typeof raw !== 'string') return false
  const createdMs = Date.parse(raw)
  if (!Number.isFinite(createdMs)) return false
  const age = now - createdMs
  return age > -CLOCK_SKEW_MS && age < BOOKING_EDIT_GRACE_MS
}
