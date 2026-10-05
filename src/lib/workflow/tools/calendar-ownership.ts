import { phoneSuffixMatch } from '@/lib/calendar/phone-match'
import { ToolCallContext } from './types'

export function evaluateEventOwnership(
  eventId: string | undefined,
  haystack: string,
  callContext?: ToolCallContext
): 'ownership_mismatch' | 'verification_required' | null {
  if (eventId && callContext?.sameCallOwnedEventIds?.has(eventId)) {
    return null
  }

  const haystackLower = haystack.toLowerCase()

  if (callContext?.callChannel === 'pstn') {
    if (!callContext.callerNumber) return 'verification_required'
    return phoneSuffixMatch(haystack, callContext.callerNumber) ? null : 'ownership_mismatch'
  }

  if (callContext?.callChannel === 'booking_widget') return 'verification_required'

  const restricted = callContext?.restrictedContact
  if (restricted && (restricted.phone || restricted.email)) {
    if (restricted.phone && phoneSuffixMatch(haystack, restricted.phone)) {
      return null
    }
    if (restricted.email && haystackLower.includes(restricted.email.toLowerCase())) {
      return null
    }
    return 'ownership_mismatch'
  }

  if (callContext?.callChannel === 'web_voice' || callContext?.callChannel === 'chat_widget') {
    return 'verification_required'
  }
  return null
}

export function resolveOwnedEventId(
  passedId: string | undefined,
  callContext?: ToolCallContext,
): { eventId: string | undefined; overridden: boolean } {
  const owned = callContext?.sameCallOwnedEventIds
  if (!owned || owned.size !== 1) return { eventId: passedId, overridden: false }
  if (!passedId) return { eventId: passedId, overridden: false }
  if (owned.has(passedId)) return { eventId: passedId, overridden: false }
  const only = owned.values().next().value as string
  return { eventId: only, overridden: true }
}
