import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { GoogleCalendarToolClient } from './google-calendar-tool'
import { MicrosoftCalendarToolClient } from './microsoft-calendar-tool'

const TZ = 'Europe/Zurich'
const DAY = '2030-10-01'
const iso = (hhmm: string) => `${DAY}T${hhmm}:00+02:00`
const DAY_END = '2030-10-02T00:00:00+02:00'
const INV = [
  { id: 't4', name: '4-seat table', capacity: 4, count: 1 },
  { id: 't10', name: '10-seat table', capacity: 10, count: 1 },
]
const CONFIG = {
  calendarId: 'cal', timezone: TZ, workingHoursStart: '11:00', workingHoursEnd: '22:00', defaultDurationMin: 90,
  capacityMode: 'tables', tableInventory: INV, mealDurationMin: 90, reservationGridMin: 15, tableMatchPolicy: 'smallest_fit',
}

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

type Call = { url: string; init?: any }
function mockPages(kind: 'google' | 'ms', pages: any[][]): Call[] {
  const calls: Call[] = []
  globalThis.fetch = (async (url: any, init?: any) => {
    const u = String(url)
    calls.push({ url: u, init })
    const m = u.match(/(?:pageToken=|\/next)p?(\d+)/)
    const idx = m ? Number(m[1]) : 0
    const more = idx + 1 < pages.length
    const body = kind === 'google'
      ? { items: pages[idx] || [], ...(more ? { nextPageToken: `p${idx + 1}` } : {}) }
      : { value: pages[idx] || [], ...(more ? { '@odata.nextLink': `https://graph.microsoft.com/v1.0/next${idx + 1}` } : {}) }
    return { ok: true, status: 200, json: async () => body } as any
  }) as any
  return calls
}

const google = (over: Record<string, unknown> = {}) => Object.assign(new GoogleCalendarToolClient() as any, CONFIG, over)
const ms = (over: Record<string, unknown> = {}) => Object.assign(new MicrosoftCalendarToolClient() as any, CONFIG, over)
const gev = (s: string, e: string, description?: string) => ({ status: 'confirmed', start: { dateTime: iso(s) }, end: { dateTime: iso(e) }, description })
const check = async (c: any, args: Record<string, unknown> = {}) =>
  JSON.parse(await c.checkAvailability('tok', { start_iso: iso('00:00'), end_iso: DAY_END, ...args }))
const starts = (r: any) => (r.openSlots || []).map((s: any) => s.start.slice(11, 16))

test('\'availability lookup: returns dinner openings even when lunch is blocked (does not cut to 30 first)\'', async () => {
  mockPages('google', [[gev('11:00', '19:00', 'Private lunch party')]])
  const r = await check(google())
  assert.equal(r.success, true)
  assert.deepEqual(starts(r), ['19:00', '19:15', '19:30', '19:45', '20:00', '20:15', '20:30'])
})

test('\'availability lookup: response is capped at 30 even if a day has more than 30 slots\'', async () => {
  mockPages('google', [[]])
  const r = await check(google())
  assert.equal(r.openSlots.length, 30)
})

test('\'availability lookup: given a party size, returns only times that have a fitting table\'', async () => {
  const booked = gev('18:00', '19:30', 'Party: 8\nTable: 10-seat table #1 [t10]')
  mockPages('google', [[booked]])
  const all = starts(await check(google()))
  assert.ok(all.includes('18:00'), '인원을 안 주면 4인석이 빈 시간도 나온다')
  mockPages('google', [[booked]])
  const for8 = await check(google(), { party_size: 8 })
  assert.ok(!starts(for8).some((t: string) => t >= '16:45' && t <= '19:15'), '10인석이 찬 시간은 빠진다')
  assert.ok(starts(for8).includes('16:30') && starts(for8).includes('19:30'))
})

test('\'availability lookup: tables gives the remaining number of tables as tablesAvailable (not seatsAvailable)\'', async () => {
  mockPages('google', [[]])
  const r = await check(google())
  assert.equal(r.openSlots[0].tablesAvailable, 2)
  assert.equal('seatsAvailable' in r.openSlots[0], false)
})

test('\'availability lookup: a party larger than the biggest table is party_too_large (impossible at any time)\'', async () => {
  mockPages('google', [[]])
  const r = await check(google(), { party_size: 12 })
  assert.equal(r.success, false)
  assert.equal(r.error, 'party_too_large')
  assert.equal(r.largest_table_seats, 10)
})

test('\'availability lookup: a party with no matching size under "Exact size only" is also party_too_large\'', async () => {
  mockPages('google', [[]])
  const r = await check(google({ tableMatchPolicy: 'exact_only' }), { party_size: 5 })
  assert.equal(r.error, 'party_too_large')
})

test('\'availability lookup: invalid_party_size if the party size is not an integer, numeric strings are accepted\'', async () => {
  mockPages('google', [[]])
  assert.equal((await check(google(), { party_size: 'abc' })).error, 'invalid_party_size')
  mockPages('google', [[]])
  assert.equal((await check(google(), { party_size: 4.5 })).error, 'invalid_party_size')
  mockPages('google', [[]])
  assert.equal((await check(google(), { party_size: '4' })).success, true)
})

test('\'availability lookup: also counts events on the next page (Google nextPageToken)\'', async () => {
  const calls = mockPages('google', [[], [gev('11:00', '22:00', 'Closed for private event')]])
  const r = await check(google())
  assert.equal(calls.length, 2)
  assert.deepEqual(starts(r), [])
})

test('\'availability lookup: also counts events on the next page (Outlook @odata.nextLink) - body text without a timezone Prefer\'', async () => {
  const msEv = { id: 'e1', start: { dateTime: '2030-10-01T09:00:00.0000000' }, end: { dateTime: '2030-10-01T20:00:00.0000000' },
    body: { content: 'Closed' }, showAs: 'busy', isAllDay: false, isCancelled: false }
  const calls = mockPages('ms', [[], [msEv]])
  const r = await check(ms())
  assert.equal(calls.length, 2)
  assert.deepEqual(starts(r), [])
  assert.equal(calls[0].init?.headers?.Prefer, 'outlook.body-content-type="text"')
})

test('\'booking: invalid_party_size if the party size is not an integer - party_too_large if larger than the biggest table\'', async () => {
  mockPages('google', [[]])
  const book = (party: unknown) => google().bookEvent('tok', {
    start_iso: iso('19:00'), summary: 'Dinner', patient_name: 'Anna Muster', patient_phone: '0791234567', party_size: party,
  }).then((s: string) => JSON.parse(s))
  assert.equal((await book(4.5)).error, 'invalid_party_size')
  assert.equal((await book(12)).error, 'party_too_large')
  assert.equal((await book(undefined)).error, 'party_size_required')
})

function mockReschedule(existingDesc: string) {
  const patches: any[] = []
  globalThis.fetch = (async (url: any, init?: any) => {
    const u = String(url)
    if (init?.method === 'PATCH') {
      const body = JSON.parse(init.body)
      patches.push(body)
      return { ok: true, status: 200, json: async () => ({ ...body, summary: 'Dinner' }) } as any
    }
    if (/\/events\/e1(\?|$)/.test(u)) {
      return { ok: true, status: 200, json: async () => ({
        id: 'e1', status: 'confirmed', summary: 'Dinner', description: existingDesc,
        start: { dateTime: iso('18:00') }, end: { dateTime: iso('19:30') },
      }) } as any
    }
    return { ok: true, status: 200, json: async () => ({ items: [] }) } as any
  }) as any
  return patches
}
const reschedule = (args: Record<string, unknown>) =>
  google().rescheduleEvent('tok', { event_id: 'e1', new_start_iso: iso('19:00'), ...args }).then((x: string) => JSON.parse(x))
const OLD_DESC = 'Name: Anna\nPhone: 079\nParty: 4\nTable: 4-seat table #1 [t4]\n\nNotes: window'

test('\'booking change: changing the party size re-picks the table with the new size and updates the Party and Table lines\'', async () => {
  const patches = mockReschedule(OLD_DESC)
  const r = await reschedule({ party_size: 8 })
  assert.equal(r.success, true)
  assert.equal(r.party_size, 8)
  assert.equal(r.assigned_table.name, '10-seat table')
  assert.equal(patches[0].description, 'Name: Anna\nPhone: 079\nParty: 8\nTable: 10-seat table #1 [t10]\n\nNotes: window')
})

test('\'booking change: keeps the existing party size if none is given\'', async () => {
  const patches = mockReschedule(OLD_DESC)
  const r = await reschedule({})
  assert.equal(r.party_size, 4)
  assert.match(patches[0].description, /Party: 4\nTable: 4-seat table #1 \[t4\]/)
})

test('\'booking change: does not change if the new party size is not an integer or too large\'', async () => {
  const patches = mockReschedule(OLD_DESC)
  assert.equal((await reschedule({ party_size: 'x' })).error, 'invalid_party_size')
  assert.equal((await reschedule({ party_size: 12 })).error, 'party_too_large')
  assert.equal(patches.length, 0)
})

test('\'booking change (Outlook): changing the party size updates the Party and Table lines in the body\'', async () => {
  const patches: any[] = []
  globalThis.fetch = (async (url: any, init?: any) => {
    const u = String(url)
    if (init?.method === 'PATCH') {
      const body = JSON.parse(init.body)
      patches.push(body)
      return { ok: true, status: 200, json: async () => ({ ...body, subject: 'Dinner' }) } as any
    }
    if (/\/events\/e1$/.test(u)) {
      return { ok: true, status: 200, json: async () => ({
        id: 'e1', subject: 'Dinner', isCancelled: false, body: { contentType: 'text', content: OLD_DESC },
        start: { dateTime: '2030-10-01T18:00:00.0000000' }, end: { dateTime: '2030-10-01T19:30:00.0000000' },
      }) } as any
    }
    return { ok: true, status: 200, json: async () => ({ value: [] }) } as any
  }) as any
  const r = JSON.parse(await ms().rescheduleEvent('tok', { event_id: 'e1', new_start_iso: iso('19:00'), party_size: 8 }))
  assert.equal(r.success, true, JSON.stringify(r))
  assert.equal(patches[0].body.content, 'Name: Anna\nPhone: 079\nParty: 8\nTable: 10-seat table #1 [t10]\n\nNotes: window')
})

test('\'availability lookup: finds later openings even if the first 60 days of a long range are blocked (no slot count limit)\'', async () => {
  const closed: any[] = []
  for (let d = 0; d < 60; d++) {
    const day = new Date(Date.UTC(2030, 9, 1 + d)).toISOString().slice(0, 10)
    const next = new Date(Date.UTC(2030, 9, 2 + d)).toISOString().slice(0, 10)
    closed.push({ status: 'confirmed', summary: 'Closed', start: { date: day }, end: { date: next } })
  }
  mockPages('google', [closed])
  const r = await check(google(), { end_iso: '2030-12-05T00:00:00+01:00' })
  assert.equal(r.success, true)
  assert.equal(r.openSlots.length, 30)
  assert.equal(r.openSlots[0].start, '2030-11-30T11:00:00+01:00')
})

test('\'availability lookup: a successful response with broken content or no items counts as a lookup failure (Google)\'', async () => {
  globalThis.fetch = (async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json') } })) as any
  assert.equal((await check(google())).error, 'calendar_unavailable')
  globalThis.fetch = (async () => ({ ok: true, status: 200, json: async () => ({ unexpected: true }) })) as any
  assert.equal((await check(google())).error, 'calendar_unavailable')
})

test('\'availability lookup: Outlook without value, or an untrustworthy next page address, counts as a lookup failure\'', async () => {
  globalThis.fetch = (async () => ({ ok: true, status: 200, json: async () => ({}) })) as any
  assert.equal((await check(ms())).error, 'calendar_unavailable')
  globalThis.fetch = (async () => ({ ok: true, status: 200, json: async () => ({ value: [], '@odata.nextLink': 'https://evil.example/next' }) })) as any
  assert.equal((await check(ms())).error, 'calendar_unavailable')
})

test('\'booking change: only the party size changes, time stays - frees its own table and picks again\'', async () => {
  const others = [{ id: 'e2', status: 'confirmed', description: 'Party: 8\nTable: 10-seat table #1 [t10]',
    start: { dateTime: iso('18:00') }, end: { dateTime: iso('19:30') } }]
  const patches: any[] = []
  globalThis.fetch = (async (url: any, init?: any) => {
    const u = String(url)
    if (init?.method === 'PATCH') { const b = JSON.parse(init.body); patches.push(b); return { ok: true, status: 200, json: async () => b } as any }
    if (/\/events\/e1(\?|$)/.test(u)) return { ok: true, status: 200, json: async () => ({ id: 'e1', status: 'confirmed', description: OLD_DESC, start: { dateTime: iso('18:00') }, end: { dateTime: iso('19:30') } }) } as any
    return { ok: true, status: 200, json: async () => ({ items: [...others, { id: 'e1', status: 'confirmed', description: OLD_DESC, start: { dateTime: iso('18:00') }, end: { dateTime: iso('19:30') } }] }) } as any
  }) as any
  const same = (party: number) => google().rescheduleEvent('tok', { event_id: 'e1', new_start_iso: iso('18:00'), party_size: party }).then((x: string) => JSON.parse(x))
  const r3 = await same(3)
  assert.equal(r3.success, true)
  assert.equal(r3.assigned_table.name, '4-seat table')
  assert.equal((await same(6)).error, 'no_table_available')
})

test('\'booking change description: in capacity mode, tells to use it even when only the party size changes\'', () => {
  const desc = (c: any) => c.listTools().find((t: any) => t.name === 'reschedule_event').description as string
  assert.match(desc(google()), /only changes the group size/)
  assert.doesNotMatch(desc(google({ capacityMode: 'single' })), /only changes the group size/)
  assert.match(desc(ms()), /only changes the group size/)
})

test('\'availability lookup: with a party size, tables it cannot seat are not counted - without one, marks "not filtered"\'', async () => {
  mockPages('google', [[]])
  const small = google({ tableInventory: [
    { id: 't2', name: '2-seat table', capacity: 2, count: 3 },
    { id: 't4', name: '4-seat table', capacity: 4, count: 1 },
  ] })
  const r4 = await check(small, { party_size: 4 })
  assert.equal(r4.openSlots[0].tablesAvailable, 1)
  assert.deepEqual(r4.openSlots[0].availableTables.map((t: any) => t.name), ['4-seat table'])
  assert.equal('partySizeNote' in r4, false)
  mockPages('google', [[]])
  assert.match((await check(small)).partySizeNote, /NOT filtered by group size/)
  mockPages('google', [[]])
  assert.equal((await check(small, { party_size: 1000 })).error, 'party_too_large')
})

test('\'availability lookup: a malformed Google next page marker counts as a lookup failure\'', async () => {
  globalThis.fetch = (async () => ({ ok: true, status: 200, json: async () => ({ items: [], nextPageToken: 123 }) })) as any
  assert.equal((await check(google())).error, 'calendar_unavailable')
})

test('\'availability lookup: a long range with many long-blocked events also finishes quickly\'', async () => {
  const evs: any[] = []
  for (let d = 0; d < 125; d++) {
    const day = new Date(Date.UTC(2030, 9, 1 + d)).toISOString().slice(0, 10)
    const next = new Date(Date.UTC(2030, 9, 2 + d)).toISOString().slice(0, 10)
    if (d < 120) evs.push({ status: 'confirmed', summary: 'Closed', start: { date: day }, end: { date: next } })
    for (let k = 0; k < 20; k++) evs.push({ status: 'confirmed', description: 'Party: 2', start: { dateTime: `${day}T19:00:00Z` }, end: { dateTime: `${day}T20:30:00Z` } })
  }
  mockPages('google', [evs])
  const t0 = Date.now()
  const r = await check(google(), { end_iso: '2031-02-05T00:00:00+01:00' })
  const ms = Date.now() - t0
  assert.equal(r.success, true)
  assert.ok(r.openSlots.length > 0)
  assert.ok(ms < 3000, `took ${ms}ms`)
})

