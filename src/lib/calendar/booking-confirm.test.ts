import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  needsBookingConfirm,
  bookingConfirmKey,
  consumeBookingConfirm,
  bookingConfirmRequiredResult,
  BOOKING_CONFIRM_TTL_MS,
} from './booking-confirm'

const BASE = { calendarId: 'cal', startIso: '2026-09-21T20:00:00+02:00', name: '김철수', phone: '079 123 45 67', partySize: 2 }

test('needsBookingConfirm: voice only (PSTN and web voice)', () => {
  assert.equal(needsBookingConfirm('pstn'), true)
  assert.equal(needsBookingConfirm('web_voice'), true)
  for (const c of ['chat_widget', 'test', undefined, null, '']) assert.equal(needsBookingConfirm(c as any), false, String(c))
})

test('bookingConfirmKey: same booking gives the same key - time notation, name spacing and phone separators are ignored', () => {
  const k = bookingConfirmKey(BASE)
  assert.equal(bookingConfirmKey({ ...BASE, startIso: '2026-09-21T18:00:00Z' }), k)
  assert.equal(bookingConfirmKey({ ...BASE, name: '김 철수 ' }), k)
  assert.equal(bookingConfirmKey({ ...BASE, phone: '0791234567' }), k)
  assert.equal(bookingConfirmKey({ ...BASE, phone: '+41 79 123 45 67' }), k, '국내·국제 표기는 같은 번호 (grok)')
})

test('bookingConfirmKey: a different key if time, party size, name, phone or calendar changes', () => {
  const k = bookingConfirmKey(BASE)
  for (const change of [
    { startIso: '2026-09-21T18:00:00+02:00' }, { partySize: 3 }, { name: '김영희' }, { phone: '0781234567' }, { calendarId: 'other' },
  ]) assert.notEqual(bookingConfirmKey({ ...BASE, ...change }), k, JSON.stringify(change))
})

test('consumeBookingConfirm: the first call is ask; after the confirmation is created and the guest answers, the same content + confirmed=true gives book', () => {
  const k = bookingConfirmKey(BASE)
  const t0 = 1_000_000
  const ctx: any = { callerLastTurnAt: t0 - 3000 }
  assert.equal(consumeBookingConfirm(ctx, k, undefined, t0), 'ask')
  assert.equal(ctx.pendingBookingConfirm.key, k)
  ctx.callerLastTurnAt = t0 + 4000
  assert.equal(consumeBookingConfirm(ctx, k, true, t0 + 5000), 'book')
  assert.equal(ctx.pendingBookingConfirm, undefined, '저장한 뒤엔 대기를 지운다')
  assert.equal(consumeBookingConfirm(ctx, k, true, t0 + 6000), 'ask', '두 번째 저장은 다시 확인부터')
})

test('consumeBookingConfirm: attaching confirmed=true from the very first call cannot skip it', () => {
  assert.equal(consumeBookingConfirm({ callerLastTurnAt: 5 } as any, bookingConfirmKey(BASE), true, 10), 'ask')
})

test('consumeBookingConfirm: if the guest says nothing after the confirmation was created, it is not saved even with confirmed=true', () => {
  const k = bookingConfirmKey(BASE)
  const ctx: any = { callerLastTurnAt: 900 }
  consumeBookingConfirm(ctx, k, undefined, 1000)
  assert.equal(consumeBookingConfirm(ctx, k, true, 1500), 'ask')
  const unknown: any = {}
  consumeBookingConfirm(unknown, k, undefined, 1000)
  assert.equal(consumeBookingConfirm(unknown, k, true, 1500), 'ask')
})

test('consumeBookingConfirm: words interjected during the calendar check do not count as an answer - the criterion is time, not count', () => {
  const k = bookingConfirmKey(BASE)
  const ctx: any = { callerLastTurnAt: 950 }
  consumeBookingConfirm(ctx, k, undefined, 1000)
  assert.equal(consumeBookingConfirm(ctx, k, true, 1200), 'ask')
})

test('consumeBookingConfirm: two calls sharing the same pending state (concurrent calls) - only one books, the other is duplicate', () => {
  const k = bookingConfirmKey(BASE)
  const main: any = { callerLastTurnAt: 0 }
  consumeBookingConfirm(main, k, undefined, 1000)
  const a: any = { pendingBookingConfirm: main.pendingBookingConfirm, callerLastTurnAt: 1500 }
  const b: any = { pendingBookingConfirm: main.pendingBookingConfirm, callerLastTurnAt: 1500 }
  assert.equal(consumeBookingConfirm(a, k, true, 2000), 'book')
  assert.equal(consumeBookingConfirm(b, k, true, 2001), 'duplicate')
  assert.equal(b.pendingBookingConfirm, undefined)
  const after: any = { pendingBookingConfirm: b.pendingBookingConfirm, callerLastTurnAt: 1500 }
  assert.equal(consumeBookingConfirm(after, k, true, 3000), 'ask', '이긴 쪽 쓰기가 실패했으면 같은 예약은 처음부터 다시')
})

test('consumeBookingConfirm: if content changes, time passes, or confirmed is not true, it is read back again', () => {
  const k = bookingConfirmKey(BASE)
  const k2 = bookingConfirmKey({ ...BASE, startIso: '2026-09-21T19:00:00+02:00' })
  const t0 = 1_000_000
  const a: any = {}
  consumeBookingConfirm(a, k, undefined, t0)
  a.callerLastTurnAt = t0 + 500
  assert.equal(consumeBookingConfirm(a, k2, true, t0 + 1000), 'ask')
  assert.equal(a.pendingBookingConfirm.key, k2, '바뀐 내용이 새 대기가 된다')

  const b: any = {}
  consumeBookingConfirm(b, k, undefined, t0)
  b.callerLastTurnAt = t0 + 500
  assert.equal(consumeBookingConfirm(b, k, true, t0 + BOOKING_CONFIRM_TTL_MS), 'ask')

  for (const v of ['true', 1, 'yes', null]) {
    const c: any = {}
    consumeBookingConfirm(c, k, undefined, t0)
    c.callerLastTurnAt = t0 + 500
    assert.equal(consumeBookingConfirm(c, k, v, t0 + 1000), 'ask', JSON.stringify(v))
  }
})

test('bookingConfirmRequiredResult: not saved; time to read in the calendar timezone; name; party size', () => {
  const r = JSON.parse(bookingConfirmRequiredResult({ startIso: '2026-09-21T18:00:00Z', timezone: 'Europe/Zurich', name: '김철수', partySize: 2, notes: '창가' }))
  assert.equal(r.success, false)
  assert.equal(r.error, 'confirmation_required')
  assert.match(r.booking_summary.when, /20:00 \(Europe\/Zurich\)/, '캘린더 시간대 20:00 으로 읽어 준다 — UTC 18:00 이 아니다')
  assert.equal(r.booking_summary.name, '김철수')
  assert.equal(r.booking_summary.party_size, 2)
  assert.equal(r.booking_summary.message, '창가')
  assert.match(r.instruction, /NOT BOOKED YET/)
  assert.match(r.instruction, /confirmed=true/)
  const noParty = JSON.parse(bookingConfirmRequiredResult({ startIso: '2026-09-21T18:00:00Z', timezone: 'Europe/Zurich', name: 'A' }))
  assert.equal('party_size' in noParty.booking_summary, false)
})

test('bookingConfirmRequiredResult: web voice reads the number digit by digit but does not include the number itself; PSTN does not read the number', () => {
  const web = bookingConfirmRequiredResult({ startIso: BASE.startIso, timezone: 'Europe/Zurich', name: '김민준', readPhone: true })
  assert.match(JSON.parse(web).instruction, /phone number you entered one digit at a time/)
  assert.doesNotMatch(web, /\d{7,}/)
  const pstn = JSON.parse(bookingConfirmRequiredResult({ startIso: BASE.startIso, timezone: 'Europe/Zurich', name: '김민준' }))
  assert.doesNotMatch(pstn.instruction, /phone/)
})

test('bookingConfirmKey: with fullPhone, changing digits outside the last 8 (area and country code) is a different booking', () => {
  const a = { ...BASE, phone: '010 5555 3433' }
  const b = { ...BASE, phone: '011 5555 3433' }
  assert.equal(bookingConfirmKey(a), bookingConfirmKey(b))
  assert.notEqual(bookingConfirmKey({ ...a, fullPhone: true }), bookingConfirmKey({ ...b, fullPhone: true }))
})
