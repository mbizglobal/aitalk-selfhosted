import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateEventOwnership, resolveOwnedEventId } from './calendar-ownership'
import type { ToolCallContext } from './types'

const PHONE_LOCAL = '0791234567'
const PHONE_E164 = '+41791234567'
const HAY = `Booking\nName: Anna\nPhone: ${PHONE_LOCAL}\nEmail: anna@example.com`

test('\'owned event-id passes without channel/contact (null)\'', () => {
  const ctx: ToolCallContext = { callChannel: 'web_voice', sameCallOwnedEventIds: new Set(['evt1']) }
  assert.equal(evaluateEventOwnership('evt1', HAY, ctx), null)
})

test('\'event-id not in the owned set proceeds to channel logic\'', () => {
  const ctx: ToolCallContext = { callChannel: 'web_voice', sameCallOwnedEventIds: new Set(['evt1']) }
  assert.equal(evaluateEventOwnership('evt-other', HAY, ctx), 'verification_required')
})

test('\'PSTN: callerNumber matches the event by last digits -> null (E.164 needle vs local storage)\'', () => {
  const ctx: ToolCallContext = { callChannel: 'pstn', callerNumber: PHONE_E164 }
  assert.equal(evaluateEventOwnership('e', HAY, ctx), null)
})

test('\'PSTN: callerNumber mismatch -> ownership_mismatch\'', () => {
  const ctx: ToolCallContext = { callChannel: 'pstn', callerNumber: '+41780000000' }
  assert.equal(evaluateEventOwnership('e', HAY, ctx), 'ownership_mismatch')
})

test('\'PSTN: no callerNumber (withheld) -> verification_required (theoretically cannot happen but blocked)\'', () => {
  const ctx: ToolCallContext = { callChannel: 'pstn', callerNumber: null }
  assert.equal(evaluateEventOwnership('e', HAY, ctx), 'verification_required')
})

test('\'web_voice: restrictedContact.phone match -> null\'', () => {
  const ctx: ToolCallContext = { callChannel: 'web_voice', restrictedContact: { phone: PHONE_LOCAL } }
  assert.equal(evaluateEventOwnership('e', HAY, ctx), null)
})

test('\'web_voice: restrictedContact.email match (case-insensitive) -> null\'', () => {
  const ctx: ToolCallContext = { callChannel: 'web_voice', restrictedContact: { email: 'ANNA@example.com' } }
  assert.equal(evaluateEventOwnership('e', HAY, ctx), null)
})

test('\'web_voice: restrictedContact present but both phone/email mismatch -> ownership_mismatch\'', () => {
  const ctx: ToolCallContext = {
    callChannel: 'web_voice',
    restrictedContact: { phone: '0780000000', email: 'bob@example.com' },
  }
  assert.equal(evaluateEventOwnership('e', HAY, ctx), 'ownership_mismatch')
})

test('\'web_voice: no restrictedContact -> verification_required (KYC not passed)\'', () => {
  const ctx: ToolCallContext = { callChannel: 'web_voice' }
  assert.equal(evaluateEventOwnership('e', HAY, ctx), 'verification_required')
})

test('\'chat_widget: no restrictedContact -> verification_required\'', () => {
  const ctx: ToolCallContext = { callChannel: 'chat_widget' }
  assert.equal(evaluateEventOwnership('e', HAY, ctx), 'verification_required')
})

test('\'web_voice: restrictedContact has only name, no phone/email -> verification_required\'', () => {
  const ctx: ToolCallContext = { callChannel: 'web_voice', restrictedContact: { name: 'Anna' } }
  assert.equal(evaluateEventOwnership('e', HAY, ctx), 'verification_required')
})

test('\'no channel + no context -> null (skip)\'', () => {
  assert.equal(evaluateEventOwnership('e', HAY, undefined), null)
})

test('\'PSTN: callerNumber takes priority - mismatch if callerNumber does not match even when restrictedContact does\'', () => {
  const ctx: ToolCallContext = {
    callChannel: 'pstn',
    callerNumber: '+41780000000',
    restrictedContact: { phone: PHONE_LOCAL },
  }
  assert.equal(evaluateEventOwnership('e', HAY, ctx), 'ownership_mismatch')
})

test('\'web_voice: phone mismatch + email match -> null (email fallback)\'', () => {
  const ctx: ToolCallContext = {
    callChannel: 'web_voice',
    restrictedContact: { phone: '0780000000', email: 'anna@example.com' },
  }
  assert.equal(evaluateEventOwnership('e', HAY, ctx), null)
})

test('"web_voice: phone=\'\' (falsy) + email match -> null"', () => {
  const ctx: ToolCallContext = {
    callChannel: 'web_voice',
    restrictedContact: { phone: '', email: 'anna@example.com' },
  }
  assert.equal(evaluateEventOwnership('e', HAY, ctx), null)
})

test('\'chat_widget: restrictedContact.phone match -> null (restricted branch takes priority over verification)\'', () => {
  const ctx: ToolCallContext = { callChannel: 'chat_widget', restrictedContact: { phone: PHONE_LOCAL } }
  assert.equal(evaluateEventOwnership('e', HAY, ctx), null)
})

// ─────────────────────────────────────────────────────────────────────────
const REAL_ID = 'abc123googleeventid'

test('\'resolve: 1 owned + fabricated ("event_1") -> replaced with the only id (overridden)\'', () => {
  const ctx: ToolCallContext = { sameCallOwnedEventIds: new Set([REAL_ID]) }
  assert.deepEqual(resolveOwnedEventId('event_1', ctx), { eventId: REAL_ID, overridden: true })
})

test('\'resolve: 1 owned + already that id -> not replaced\'', () => {
  const ctx: ToolCallContext = { sameCallOwnedEventIds: new Set([REAL_ID]) }
  assert.deepEqual(resolveOwnedEventId(REAL_ID, ctx), { eventId: REAL_ID, overridden: false })
})

test('\'resolve: 0 owned -> not replaced (model value as is)\'', () => {
  const ctx: ToolCallContext = { sameCallOwnedEventIds: new Set() }
  assert.deepEqual(resolveOwnedEventId('event_1', ctx), { eventId: 'event_1', overridden: false })
})

test('\'resolve: 2+ owned (legacy multiple) -> ambiguous, not replaced\'', () => {
  const ctx: ToolCallContext = { sameCallOwnedEventIds: new Set([REAL_ID, 'other999']) }
  assert.deepEqual(resolveOwnedEventId('event_1', ctx), { eventId: 'event_1', overridden: false })
})

test('\'resolve: event_id missing (undefined) -> not replaced (delegated to the required guard)\'', () => {
  const ctx: ToolCallContext = { sameCallOwnedEventIds: new Set([REAL_ID]) }
  assert.deepEqual(resolveOwnedEventId(undefined, ctx), { eventId: undefined, overridden: false })
})

test('\'resolve: event_id empty string -> not replaced\'', () => {
  const ctx: ToolCallContext = { sameCallOwnedEventIds: new Set([REAL_ID]) }
  assert.deepEqual(resolveOwnedEventId('', ctx), { eventId: '', overridden: false })
})

test('\'resolve: sameCallOwnedEventIds itself missing -> not replaced\'', () => {
  assert.deepEqual(resolveOwnedEventId('event_1', { callChannel: 'web_voice' }), { eventId: 'event_1', overridden: false })
})

test('\'lifecycle: seed 1 -> cancel (set.delete) -> resolve does not replace (no own booking to cancel)\'', () => {
  const owned = new Set([REAL_ID])
  const ctx: ToolCallContext = { sameCallOwnedEventIds: owned }
  owned.delete(REAL_ID)
  assert.deepEqual(resolveOwnedEventId('event_1', ctx), { eventId: 'event_1', overridden: false })
})

test('\'lifecycle: seed 1 -> cancel -> new booking (add new) -> resolve replaces with the new id\'', () => {
  const owned = new Set([REAL_ID])
  const ctx: ToolCallContext = { sameCallOwnedEventIds: owned }
  owned.delete(REAL_ID)    // cancel
  owned.add('newEvtId999') // book add
  assert.deepEqual(resolveOwnedEventId('event_1', ctx), { eventId: 'newEvtId999', overridden: true })
})

test('\'lifecycle (regression): if cancel did not delete from the set, cancel->book would make size 2 -> correction off\'', () => {
  const owned = new Set([REAL_ID, 'newEvtId999'])
  const ctx: ToolCallContext = { sameCallOwnedEventIds: owned }
  assert.deepEqual(resolveOwnedEventId('event_1', ctx), { eventId: 'event_1', overridden: false })
})

test('\'booking_widget: verification_required even when restrictedContact matches\'', () => {
  const ctx: ToolCallContext = { callChannel: 'booking_widget', restrictedContact: { phone: '0791234567' } }
  assert.equal(evaluateEventOwnership('ev1', 'Name: Anna\nPhone: 0791234567', ctx), 'verification_required')
})
