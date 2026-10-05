import { phoneSuffixMatch } from '@/lib/calendar/phone-match'
import { ToolCallContext } from './types'

export type LookupIdentity = { name?: string; phone?: string; email?: string }

export function resolveLookupIdentity(
  callContext: ToolCallContext | undefined,
  args: { patient_name?: any; patient_phone?: any; patient_email?: any }
): LookupIdentity {
  if (callContext?.callChannel === 'pstn') {
    return { name: undefined, phone: callContext.callerNumber ?? undefined, email: undefined }
  }
  if (callContext?.callChannel === 'web_voice' || callContext?.callChannel === 'chat_widget') {
    const r = callContext.restrictedContact
    return { name: undefined, phone: r?.phone ?? undefined, email: r?.email ?? undefined }
  }
  if (callContext?.callChannel === 'booking_widget') {
    const r = callContext.restrictedContact
    return { name: undefined, phone: r?.phone ?? undefined, email: r?.email ?? undefined }
  }
  return { name: args.patient_name, phone: args.patient_phone, email: args.patient_email }
}

export type MatchedBy = 'owned' | 'phone' | 'name' | 'email'

export function matchAppointmentBy(params: {
  haystack: string
  eventId: unknown
  phone?: string
  nameNeedle: string
  emailNeedle: string
  ownedIds?: Set<string>
}): MatchedBy | null {
  const { haystack, eventId, phone, nameNeedle, emailNeedle, ownedIds } = params
  if (!!ownedIds && typeof eventId === 'string' && ownedIds.has(eventId)) return 'owned'
  if (phone && phoneSuffixMatch(haystack, String(phone))) return 'phone'
  const haystackLower = haystack.toLowerCase()
  if (nameNeedle && haystackLower.includes(nameNeedle)) return 'name'
  if (emailNeedle && haystackLower.includes(emailNeedle)) return 'email'
  return null
}
