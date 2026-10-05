import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveLookupIdentity, matchAppointmentBy } from './calendar-lookup'
import type { ToolCallContext } from './types'

test('\'PSTN: uses only callerNumber, discards args (spoken phone/name)\'', () => {
  const ctx: ToolCallContext = { callChannel: 'pstn', callerNumber: '+41791234567' }
  const id = resolveLookupIdentity(ctx, { patient_name: 'Eve', patient_phone: '0780000000', patient_email: 'x@y.z' })
  assert.deepEqual(id, { name: undefined, phone: '+41791234567', email: undefined })
})

test('\'PSTN: phone is also undefined without callerNumber (cannot search)\'', () => {
  const ctx: ToolCallContext = { callChannel: 'pstn', callerNumber: null }
  const id = resolveLookupIdentity(ctx, { patient_phone: '0791234567' })
  assert.deepEqual(id, { name: undefined, phone: undefined, email: undefined })
})

test('\'web_voice: uses only restrictedContact (Visitor Identity), discards spoken phone/name\'', () => {
  const ctx: ToolCallContext = {
    callChannel: 'web_voice',
    restrictedContact: { phone: '0791234567', email: 'anna@example.com' },
  }
  const id = resolveLookupIdentity(ctx, { patient_name: 'Eve', patient_phone: '0780000000' })
  assert.deepEqual(id, { name: undefined, phone: '0791234567', email: 'anna@example.com' })
})

test('\'web_voice: without restrictedContact everything is undefined -> no_match_criteria at the caller\'', () => {
  const ctx: ToolCallContext = { callChannel: 'web_voice' }
  const id = resolveLookupIdentity(ctx, { patient_name: 'Eve', patient_phone: '0780000000' })
  assert.deepEqual(id, { name: undefined, phone: undefined, email: undefined })
})

test('\'chat_widget: same as web_voice (Visitor Identity)\'', () => {
  const ctx: ToolCallContext = { callChannel: 'chat_widget', restrictedContact: { phone: '0791234567' } }
  const id = resolveLookupIdentity(ctx, { patient_phone: '0780000000' })
  assert.deepEqual(id, { name: undefined, phone: '0791234567', email: undefined })
})

test('\'no channel specified (non-voice): keeps args as is\'', () => {
  const id = resolveLookupIdentity(undefined, { patient_name: 'Eve', patient_phone: '0780000000', patient_email: 'e@x.z' })
  assert.deepEqual(id, { name: 'Eve', phone: '0780000000', email: 'e@x.z' })
})

const HAY = 'Booking\nName: Anna\nPhone: 0791234567\nEmail: anna@example.com'

test('\'owned (event-id) has top priority - owned even if the phone does not match\'', () => {
  const m = matchAppointmentBy({
    haystack: HAY, eventId: 'evt1', phone: '0780000000', nameNeedle: '', emailNeedle: '',
    ownedIds: new Set(['evt1']),
  })
  assert.equal(m, 'owned')
})

test('\'phone suffix match -> phone (E.164 needle vs local storage)\'', () => {
  const m = matchAppointmentBy({ haystack: HAY, eventId: 'e', phone: '+41791234567', nameNeedle: '', emailNeedle: '' })
  assert.equal(m, 'phone')
})

test('\'phone mismatch + name needle match -> name\'', () => {
  const m = matchAppointmentBy({ haystack: HAY, eventId: 'e', phone: '0780000000', nameNeedle: 'anna', emailNeedle: '' })
  assert.equal(m, 'name')
})

test('\'phone/name not applied + email needle match -> email\'', () => {
  const m = matchAppointmentBy({ haystack: HAY, eventId: 'e', nameNeedle: '', emailNeedle: 'anna@example.com' })
  assert.equal(m, 'email')
})

test('\'nothing matches -> null (no push)\'', () => {
  const m = matchAppointmentBy({ haystack: HAY, eventId: 'e', phone: '0780000000', nameNeedle: 'bob', emailNeedle: 'bob@x.z' })
  assert.equal(m, null)
})

test('\'no identifiers at all (phone undefined, needle empty string, no owned) -> null\'', () => {
  const m = matchAppointmentBy({ haystack: HAY, eventId: 'e', nameNeedle: '', emailNeedle: '' })
  assert.equal(m, null)
})

test('\'an empty ownedIds Set does not match owned\'', () => {
  const m = matchAppointmentBy({
    haystack: HAY, eventId: 'evt1', nameNeedle: '', emailNeedle: '', ownedIds: new Set(),
  })
  assert.equal(m, null)
})

test('\'booking_widget: uses only restrictedContact (form phone/email), discards name\'', () => {
  const ctx: ToolCallContext = {
    callChannel: 'booking_widget',
    restrictedContact: { name: 'Anna', phone: '0791234567', email: 'anna@example.com' },
  }
  const id = resolveLookupIdentity(ctx, { patient_name: 'Eve', patient_phone: '0780000000' })
  assert.deepEqual(id, { name: undefined, phone: '0791234567', email: 'anna@example.com' })
})
