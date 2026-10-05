import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapBookResult } from './result'
import { checkFormTiming, isHoneypotFilled, isSameOriginRequest, SlidingWindowLimiter, MIN_FILL_MS } from './guard'
import { PendingBookingStore } from './confirm-store'
import { parseReserveInput } from './input'
import { buildPublicConfig, maxPartyOf, openingHoursOf, widgetDefaultLangOf, widgetMaxPartyOf, widgetSettingsOf, DEFAULT_HOURLY_LIMIT } from './public-config'
import { addDaysYmd, dayBoundsIso, isBookableDate } from './server'

test('success: drops eventId, htmlLink and voice_fastpath; keeps only time, party size and table', () => {
  const r = mapBookResult(JSON.stringify({
    success: true, eventId: 'ev_secret', htmlLink: 'https://calendar.google.com/x', start: '2026-10-17T18:00:00+02:00',
    end: '2026-10-17T20:00:00+02:00', voice_fastpath: { contact: { phone: '079' } }, assigned_table: { name: '4-seat', instance: 2, capacity: 4 },
    party_size: 3, message: 'Tell the caller…',
  }))
  assert.deepEqual(r, { ok: true, start: '2026-10-17T18:00:00+02:00', end: '2026-10-17T20:00:00+02:00', partySize: 3, tableName: '4-seat' })
  assert.ok(!JSON.stringify(r).includes('ev_secret'))
  assert.ok(!JSON.stringify(r).includes('calendar.google.com'))
})

test('one-booking rule: another guest\'s booking time (existing_appointment) is never sent out', () => {
  const r = mapBookResult(JSON.stringify({
    success: false, error: 'active_booking_exists',
    existing_appointment: { event_id: 'ev_victim', start_iso: '2026-11-01T19:00:00+01:00', summary: 'Victim' },
    message: 'Tell the caller the existing appointment date and time',
  }))
  assert.deepEqual(r, { ok: false, code: 'already_booked' })
  assert.ok(!JSON.stringify(r).includes('ev_victim'))
  assert.ok(!JSON.stringify(r).includes('2026-11-01'))
})

test('tool error -> screen code; unknown errors and broken JSON become unavailable', () => {
  assert.deepEqual(mapBookResult(JSON.stringify({ success: false, error: 'no_table_available' })), { ok: false, code: 'slot_taken' })
  assert.deepEqual(mapBookResult(JSON.stringify({ success: false, error: 'booking_on_holiday' })), { ok: false, code: 'closed' })
  assert.deepEqual(mapBookResult(JSON.stringify({ success: false, error: 'booking_window_exceeded' })), { ok: false, code: 'outside_window' })
  assert.deepEqual(mapBookResult(JSON.stringify({ success: false, error: 'events.insert failed (status 500)' })), { ok: false, code: 'unavailable' })
  assert.deepEqual(mapBookResult('not json'), { ok: false, code: 'unavailable' })
})

test('screen-shown time: within 3 seconds is too_fast, over 2 hours is stale, non-numeric is invalid', () => {
  const now = Date.parse('2026-09-30T10:00:00Z')
  assert.equal(checkFormTiming(now - 500, now), 'too_fast')
  assert.equal(checkFormTiming(now - MIN_FILL_MS, now), 'ok')
  assert.equal(checkFormTiming(now - 3 * 60 * 60 * 1000, now), 'stale')
  assert.equal(checkFormTiming('abc', now), 'invalid')
  assert.equal(checkFormTiming(undefined, now), 'invalid')
})

test('hidden field: anything filled in means a robot', () => {
  assert.equal(isHoneypotFilled(''), false)
  assert.equal(isHoneypotFilled(undefined), false)
  assert.equal(isHoneypotFilled('http://spam'), true)
})

test('rate limit: passes up to the limit, blocks beyond it, passes again after the window', () => {
  const l = new SlidingWindowLimiter(1000)
  assert.equal(l.tryHit('a', 2, 0), true)
  assert.equal(l.tryHit('a', 2, 10), true)
  assert.equal(l.tryHit('a', 2, 20), false)
  assert.equal(l.tryHit('b', 2, 20), true)
  assert.equal(l.tryHit('a', 2, 1011), true)
})

test('Origin: only the same host as the Host header', () => {
  assert.equal(isSameOriginRequest(new Headers({ origin: 'https://www.aitalk.ch', host: 'www.aitalk.ch' })), true)
  assert.equal(isSameOriginRequest(new Headers({ origin: 'https://evil.example', host: 'www.aitalk.ch' })), false)
  assert.equal(isSameOriginRequest(new Headers({ host: 'www.aitalk.ch' })), false)
})

const OK_RESULT = { ok: true as const, start: '2026-10-17T18:00:00+02:00', end: null, partySize: 2, tableName: null }
test('confirmation link: blocks a second use while processing, returns the same result after success, expires after a while', () => {
  const store = new PendingBookingStore()
  const input = parseReserveInput(GOOD)!
  const tok = store.create('ag', input, 30, 0)!
  assert.match(tok, /^[A-Za-z0-9_-]{32}$/)
  const b1 = store.begin(tok, 1000)
  assert.equal(b1.kind, 'start')
  assert.equal(b1.kind === 'start' && b1.pending.input.email, 'anna@example.com')
  assert.deepEqual(store.begin(tok, 1001), { kind: 'busy' })
  store.finish(tok, OK_RESULT, 2000)
  assert.deepEqual(store.begin(tok, 3000), { kind: 'done', result: OK_RESULT, agentId: 'ag' })
  const late = store.create('ag', input, 15, 0)!
  assert.deepEqual(store.begin(late, 15 * 60_000 + 1), { kind: 'expired' })
  assert.deepEqual(store.begin('../../etc', 0), { kind: 'missing' })
  assert.deepEqual(store.begin(undefined, 0), { kind: 'missing' })
})

test('confirmation link: after a temporary failure it can be pressed again; if just closed, it is deleted', () => {
  const store = new PendingBookingStore()
  const input = parseReserveInput(GOOD)!
  const a = store.create('ag', input, 30, 0)!
  store.begin(a, 1)
  store.finish(a, { ok: false, code: 'unavailable' }, 2)
  assert.equal(store.begin(a, 3).kind, 'start')
  const b = store.create('ag', input, 30, 0)!
  store.begin(b, 1)
  store.finish(b, { ok: false, code: 'slot_taken' }, 2)
  assert.deepEqual(store.begin(b, 3), { kind: 'missing' })
  const c = store.create('ag', input, 1, 0)!
  store.begin(c, 1)
  assert.deepEqual(store.begin(c, 5 * 60_000), { kind: 'busy' })
  store.finish(c, OK_RESULT, 5 * 60_000)
  store.finish(c, { ok: false, code: 'unavailable' }, 5 * 60_000 + 1)
  assert.equal(store.begin(c, 5 * 60_000 + 2).kind, 'done')
  const d = store.create('ag', input, 30, 0)!
  store.discard(d)
  assert.deepEqual(store.begin(d, 1), { kind: 'missing' })
})

test('shop limit: count only counts, record is what increases it', () => {
  const l = new SlidingWindowLimiter(1000)
  assert.equal(l.count('ag', 0), 0)
  assert.equal(l.count('ag', 1), 0)
  l.record('ag', 10)
  l.record('ag', 20)
  assert.equal(l.count('ag', 30), 2)
  assert.equal(l.count('ag', 1015), 1)
  assert.equal(l.tryHit('x', 1, 100), true)
  assert.equal(l.tryHit('x', 1, 101), false)
  l.release('x', 100)
  assert.equal(l.tryHit('x', 1, 102), true)
})

const GOOD = {
  start: '2026-10-17T18:00:00+02:00', party: 2, firstName: ' Anna ', lastName: 'Meyer',
  email: 'anna@example.com', phone: '+41 79 123 45 67', message: '창가\n자리', lang: 'de-CH',
}
test('input: normal values are trimmed and pass', () => {
  const r = parseReserveInput(GOOD)
  assert.ok(r)
  assert.equal(r!.firstName, 'Anna')
  assert.equal(r!.message, '창가 자리')
  assert.equal(r!.lang, 'de')
})
test('input: times without offset, names with line breaks, short numbers and bad emails are rejected', () => {
  assert.equal(parseReserveInput({ ...GOOD, start: '2026-10-17T18:00:00' }), null)
  assert.equal(parseReserveInput({ ...GOOD, firstName: 'An\nParty: 99' }), null)
  assert.equal(parseReserveInput({ ...GOOD, phone: '12345' }), null)
  assert.equal(parseReserveInput({ ...GOOD, email: 'not-an-email' }), null)
  assert.equal(parseReserveInput({ ...GOOD, party: 0 }), null)
  assert.equal(parseReserveInput({ ...GOOD, message: 'x'.repeat(501) }), null)
  assert.equal(parseReserveInput({ ...GOOD, start: '2026-09-31T12:00:00+02:00' }), null)
  assert.equal(parseReserveInput({ ...GOOD, start: '2026-02-29T12:00:00+01:00' }), null)
  assert.equal(parseReserveInput({ ...GOOD, start: '2026-10-17T24:00:00+02:00' }), null)
  assert.equal(parseReserveInput({ ...GOOD, party: [2] }), null)
  assert.equal(parseReserveInput({ ...GOOD, party: '2' })?.party, 2)
})

test('public settings: connectionId, calendarId, closure notice text and holiday names are omitted', () => {
  const nodeData = {
    connectionId: 'conn_secret', accountId: 'acc', calendarId: 'owner@gmail.com', timezone: 'Europe/Zurich',
    capacityMode: 'tables', tableInventory: [{ id: 't1', name: '4', capacity: 4, count: 3 }, { id: 't2', name: '10', capacity: 10, count: 0 }],
    bookingWindowDays: 60, askBookingMessage: true,
    weeklyClosedDays: { monday: { closed: true, message: 'secret note' }, tuesday: { closed: false } },
    holidays: [{ date: '2026-12-25', name: 'Christmas', message: 'closed msg', subdivisions: ['ZH'] }],
    closedRanges: [{ startDate: '2026-08-01', endDate: '2026-08-14', name: 'Summer', message: 'x' }],
    bookingWidget: { title: 'Test Shop', emailConfirm: true, confirmTtlMin: 60, hourlyLimit: 30 },
  }
  const c = buildPublicConfig({ agentName: 'Bot', nodeData, contactPhone: '+41410000000', available: true })
  const json = JSON.stringify(c)
  for (const secret of ['conn_secret', 'owner@gmail.com', 'secret note', 'Christmas', 'closed msg', 'Summer', 'ZH']) {
    assert.ok(!json.includes(secret), `leaked: ${secret}`)
  }
  assert.equal(c.title, 'Test Shop')
  assert.deepEqual(c.party, { max: 4 })
  assert.equal(c.bookingWindowDays, 60)
  assert.equal(c.askMessage, true)
  assert.equal(c.emailConfirm, true)
  assert.equal(c.confirmTtlMin, 60)
  assert.deepEqual(c.closed.weeklyClosedDays, { monday: { closed: true } })
})

test('widget settings defaults and caps; calendars without party size', () => {
  assert.deepEqual(widgetSettingsOf({}), { title: '', defaultLang: '', address: '', email: '', emailConfirm: false, confirmTtlMin: 30, onlineMaxParty: 0, hourlyLimit: DEFAULT_HOURLY_LIMIT })
  assert.equal(widgetSettingsOf({ bookingWidget: { email: 'not an email' } }).email, '')
  assert.equal(widgetSettingsOf({ bookingWidget: { hourlyLimit: 99999 } }).hourlyLimit, 200)
  assert.equal(widgetSettingsOf({ bookingWidget: { hourlyLimit: 0 } }).hourlyLimit, DEFAULT_HOURLY_LIMIT)
  assert.equal(maxPartyOf({ capacityMode: 'single' }), null)
  assert.equal(maxPartyOf({ capacityMode: 'simple', simpleCapacity: 40 }), 40)
  assert.equal(buildPublicConfig({ agentName: 'X', nodeData: { capacityMode: 'simple', simpleCapacity: 40 }, available: true }).party?.max, 20)
  assert.equal(widgetMaxPartyOf({ capacityMode: 'simple', simpleCapacity: 40, bookingWidget: { onlineMaxParty: 14 } }), 14)
  assert.equal(widgetMaxPartyOf({ capacityMode: 'tables', tableInventory: [{ id: 'a', name: '10', capacity: 10, count: 1 }], bookingWidget: { onlineMaxParty: 14 } }), 10)
  assert.equal(widgetMaxPartyOf({ capacityMode: 'single', bookingWidget: { onlineMaxParty: 14 } }), null)
  assert.equal(buildPublicConfig({ agentName: 'X', nodeData: {}, available: true }).party, null)
  assert.equal(buildPublicConfig({ agentName: 'X', nodeData: { capacityMode: 'tables', tableInventory: [{ id: 'a', name: '4', capacity: 4, count: 0 }] }, available: true }).available, false)
})

test('day boundary uses the shop timezone offset - including the day daylight saving ends', () => {
  assert.deepEqual(dayBoundsIso('2026-10-17', 'Europe/Zurich'), { start: '2026-10-17T00:00:00+02:00', end: '2026-10-18T00:00:00+02:00' })
  assert.deepEqual(dayBoundsIso('2026-10-25', 'Europe/Zurich'), { start: '2026-10-25T00:00:00+02:00', end: '2026-10-26T00:00:00+01:00' })
  assert.equal(addDaysYmd('2026-12-31', 1), '2027-01-01')
})

test('bookable days: from today through the end of the period', () => {
  const now = Date.parse('2026-09-30T10:00:00Z')
  assert.equal(isBookableDate('2026-09-29', 'Europe/Zurich', 0, now), false)
  assert.equal(isBookableDate('2026-09-30', 'Europe/Zurich', 0, now), true)
  assert.equal(isBookableDate('2026-10-30', 'Europe/Zurich', 30, now), true)
  assert.equal(isBookableDate('2026-10-31', 'Europe/Zurich', 30, now), false)
  assert.equal(isBookableDate('2030-01-01', 'Europe/Zurich', 0, now), true)
  assert.equal(isBookableDate('bad', 'Europe/Zurich', 0, now), false)
  assert.equal(isBookableDate('2026-09-31', 'Europe/Zurich', 7, now), false)
})

test('opening hours: excluding the lunch break, closed weekdays empty, partial opening only that span', () => {
  const h = openingHoursOf({
    workingHoursStart: '11:30', workingHoursEnd: '22:00',
    breakTimes: [{ start: '14:00', end: '17:30', message: 'x' }],
    weeklyClosedDays: { sunday: { closed: true }, saturday: { closed: true, partialOpenStart: '17:30', partialOpenEnd: '22:00' } },
  })
  assert.deepEqual(h.find((d) => d.weekday === 'monday')!.ranges, [['11:30', '14:00'], ['17:30', '22:00']])
  assert.deepEqual(h.find((d) => d.weekday === 'saturday')!.ranges, [['17:30', '22:00']])
  assert.deepEqual(h.find((d) => d.weekday === 'sunday')!.ranges, [])
  assert.deepEqual(openingHoursOf({}).find((d) => d.weekday === 'monday')!.ranges, [['09:00', '18:00']])
})

test('first language: widget setting -> workflow language -> account language -> en (browser language is not used)', () => {
  assert.equal(widgetDefaultLangOf({ bookingWidget: { defaultLang: 'fr' } }, 'de-CH', 'ko-KR'), 'fr')
  assert.equal(widgetDefaultLangOf({}, 'de-CH', 'ko-KR'), 'de')
  assert.equal(widgetDefaultLangOf({}, null, 'en-US'), 'en')
  assert.equal(widgetDefaultLangOf({}, 'it-IT', 'ko-KR'), 'ko')
  assert.equal(widgetDefaultLangOf({}, null, null), 'en')
  assert.equal(widgetDefaultLangOf({ bookingWidget: { defaultLang: 'xx' } }, null, 'de-DE'), 'de')
})
