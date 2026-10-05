import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { GoogleCalendarToolClient } from './google-calendar-tool'
import { MicrosoftCalendarToolClient } from './microsoft-calendar-tool'
import { MultiCalendarDispatcher } from './multi-calendar-dispatcher'

const TZ = 'Europe/Zurich'
const DESC = 'Name: Anna\nPhone: 0791234567\nParty: 4\nTable: 4-seat #3 [t4]\n\nNotes: 창가 자리 부탁해요\n\nSource: PSTN call from +41791234567'
const PSTN = { callChannel: 'pstn', callerNumber: '+41791234567', sameCallOwnedEventIds: new Set<string>() } as any

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

type Call = { url: string; method: string; body?: any }
function mockEvent(event: any): Call[] {
  const calls: Call[] = []
  globalThis.fetch = (async (url: any, init?: any) => {
    const method = init?.method || 'GET'
    calls.push({ url: String(url), method, body: init?.body ? JSON.parse(init.body) : undefined })
    const isList = /\/events\?|calendarView/.test(String(url))
    const body = method === 'PATCH' ? {} : isList ? { items: [event], value: [event] } : event
    return { ok: true, status: 200, json: async () => body } as any
  }) as any
  return calls
}

const google = () => Object.assign(new GoogleCalendarToolClient() as any, { calendarId: 'cal', timezone: TZ })
const ms = () => Object.assign(new MicrosoftCalendarToolClient() as any, { calendarId: 'cal', timezone: TZ })
const gEvent = (description = DESC) => ({ id: 'ev1', status: 'confirmed', summary: 'Appointment - Anna', description,
  start: { dateTime: '2030-10-01T18:00:00+02:00' }, end: { dateTime: '2030-10-01T19:30:00+02:00' } })
const msEvent = (content = DESC, contentType = 'text') => ({ id: 'ev1', subject: 'Appointment - Anna', body: { content, contentType },
  start: { dateTime: '2030-10-01T18:00:00.0000000', timeZone: TZ }, end: { dateTime: '2030-10-01T19:30:00.0000000', timeZone: TZ } })

const CLIENTS = [
  { label: 'Google', make: google, event: gEvent, patched: (c: Call) => c.body.description },
  { label: 'Outlook', make: ms, event: msEvent, patched: (c: Call) => c.body.body.content },
] as const

for (const K of CLIENTS) {
  test(`${K.label} lookup: carries notes separately for each booking`, async () => {
    mockEvent(K.event())
    const r = JSON.parse(await K.make().lookupAppointments('tok', {}, { ...PSTN, sameCallOwnedEventIds: new Set() }))
    assert.equal(r.success, true)
    assert.equal(r.count, 1)
    assert.equal(r.appointments[0].notes, '창가 자리 부탁해요')
  })

  test(`${K.label} edit: pending_field='notes' reads the current message aloud and does not save`, async () => {
    const calls = mockEvent(K.event())
    const r = JSON.parse(await K.make().updateEventContact('tok', { event_id: 'ev1', pending_field: 'notes' }, PSTN))
    assert.equal(r.success, true)
    assert.equal(r.ask_for_value, true)
    assert.equal(r.current_value, '창가 자리 부탁해요')
    assert.ok(r.instruction.includes('창가 자리 부탁해요'))
    assert.equal(r.voice_fastpath, undefined, '음성 브리지 고정 문구는 이름·전화용 — 메시지엔 싣지 않는다')
    assert.equal(calls.filter((c) => c.method === 'PATCH').length, 0)
  })

  test(`${K.label} edit: new_notes changes only the notes line - works on phone (PSTN) too`, async () => {
    const calls = mockEvent(K.event())
    const r = JSON.parse(await K.make().updateEventContact('tok', { event_id: 'ev1', new_notes: '유모차 있어요' }, PSTN))
    assert.equal(r.success, true)
    assert.equal(r.updated_field, 'notes')
    const patch = calls.find((c) => c.method === 'PATCH')!
    assert.equal(K.patched(patch), DESC.replace('창가 자리 부탁해요', '유모차 있어요'))
  })

  test(`${K.label} edit: does not save when the message is the same`, async () => {
    const calls = mockEvent(K.event())
    const r = JSON.parse(await K.make().updateEventContact('tok', { event_id: 'ev1', new_notes: ' 창가 자리 부탁해요 ' }, PSTN))
    assert.equal(r.unchanged, true)
    assert.equal(calls.filter((c) => c.method === 'PATCH').length, 0)
  })

  test(`${K.label} edit: rejects every mixed call that includes a message`, async () => {
    for (const args of [
      { new_notes: '유모차', new_name: 'Bob' },
      { new_notes: '유모차', new_phone: '0791112233' },
      { new_notes: '유모차', pending_field: 'name' },
      { new_notes: '유모차', pending_field: 'phone' },
      { pending_field: 'notes', new_name: 'Bob' },
    ]) {
      const calls = mockEvent(K.event())
      const r = JSON.parse(await K.make().updateEventContact('tok', { event_id: 'ev1', ...args }, PSTN))
      assert.equal(r.error, 'one_field_at_a_time', JSON.stringify(args))
      assert.equal(calls.length, 0)
    }
  })

  test(`${K.label} edit: clear_notes erases the notes line - does not save when there is none`, async () => {
    const calls = mockEvent(K.event())
    const r = JSON.parse(await K.make().updateEventContact('tok', { event_id: 'ev1', clear_notes: true }, PSTN))
    assert.equal(r.cleared, true)
    const out: string = K.patched(calls.find((c) => c.method === 'PATCH')!)
    assert.ok(!out.includes('Notes:'))
    assert.ok(out.includes('Name: Anna') && out.includes('Party: 4') && out.includes('Source: PSTN'))

    const none = mockEvent(K.event(DESC.replace('\n\nNotes: 창가 자리 부탁해요', '')))
    const r2 = JSON.parse(await K.make().updateEventContact('tok', { event_id: 'ev1', clear_notes: true }, PSTN))
    assert.equal(r2.unchanged, true)
    assert.equal(none.filter((c) => c.method === 'PATCH').length, 0)
  })

  test(`${K.label} edit: even if new_notes is sent as an empty value while fixing the name, it goes down the name branch`, async () => {
    mockEvent(K.event())
    const r = JSON.parse(await K.make().updateEventContact('tok', { event_id: 'ev1', pending_field: 'name', new_notes: '' }, PSTN))
    assert.equal(r.voice_fastpath?.field, 'name')
  })

  test(`${K.label} edit: someone else's booking is neither read aloud nor edited`, async () => {
    const other = { ...PSTN, callerNumber: '+41780000000', sameCallOwnedEventIds: new Set() }
    for (const args of [{ pending_field: 'notes' }, { new_notes: '유모차' }, { clear_notes: true }]) {
      const calls = mockEvent(K.event())
      const r = JSON.parse(await K.make().updateEventContact('tok', { event_id: 'ev1', ...args }, other))
      assert.equal(r.error, 'ownership_mismatch')
      assert.equal(r.current_value, undefined)
      assert.equal(calls.filter((c) => c.method === 'PATCH').length, 0)
    }
  })

  test(`${K.label} edit: a line break cannot inject a Party line`, async () => {
    const calls = mockEvent(K.event())
    await K.make().updateEventContact('tok', { event_id: 'ev1', new_notes: '괜찮아요\nParty: 50' }, PSTN)
    const out: string = K.patched(calls.find((c) => c.method === 'PATCH')!)
    assert.ok(out.includes('Notes: 괜찮아요 Party: 50'))
    assert.equal(out.split('\n').filter((l) => /^\s*party\s*:/i.test(l)).length, 1)
  })

  test(`${K.label} edit: add_notes appends after the current message - does not erase the answer received at booking (post-booking extra request)`, async () => {
    const calls = mockEvent(K.event())
    const r = JSON.parse(await K.make().updateEventContact('tok', { event_id: 'ev1', add_notes: '유모차 있어요' }, PSTN))
    assert.equal(r.success, true)
    assert.equal(r.added, '유모차 있어요')
    assert.ok(r.instruction.includes('유모차 있어요') && !r.instruction.includes('창가'), '붙인 요청만 말하게')
    const patch = calls.find((c) => c.method === 'PATCH')!
    assert.equal(K.patched(patch), DESC.replace('창가 자리 부탁해요', '창가 자리 부탁해요; 유모차 있어요'))
  })

  test(`${K.label} edit: when only part of add_notes is a new item, appends only the new item and has only that spoken`, async () => {
    const calls = mockEvent(K.event())
    const r = JSON.parse(await K.make().updateEventContact('tok', { event_id: 'ev1', add_notes: '창가 자리 부탁해요; 유모차' }, PSTN))
    assert.equal(r.added, '유모차')
    assert.ok(r.instruction.includes('"유모차"') && !r.instruction.includes('창가'))
    assert.equal(K.patched(calls.find((c) => c.method === 'PATCH')!), DESC.replace('창가 자리 부탁해요', '창가 자리 부탁해요; 유모차'))
  })

  test(`${K.label} edit: add_notes - new line if there is no message, not saved if already present`, async () => {
    const calls = mockEvent(K.event(DESC.replace('\n\nNotes: 창가 자리 부탁해요', '')))
    await K.make().updateEventContact('tok', { event_id: 'ev1', add_notes: '유모차 있어요' }, PSTN)
    const out: string = K.patched(calls.find((c) => c.method === 'PATCH')!)
    assert.ok(out.includes('Table: 4-seat #3 [t4]\n\nNotes: 유모차 있어요\n\nSource: PSTN'), out)

    const again = mockEvent(K.event())
    const r = JSON.parse(await K.make().updateEventContact('tok', { event_id: 'ev1', add_notes: '창가 자리 부탁해요' }, PSTN))
    assert.equal(r.unchanged, true)
    assert.equal(r.current_value, undefined, '붙이기 중복은 메모 전체를 다시 읽히지 않는다 (grok R1)')
    assert.ok(r.instruction.includes('창가 자리 부탁해요'))
    assert.equal(again.filter((c) => c.method === 'PATCH').length, 0)
  })

  test(`${K.label} edit: mixed calls including add_notes and someone else's booking are refused`, async () => {
    for (const args of [{ add_notes: '유모차', new_notes: 'x' }, { add_notes: '유모차', clear_notes: true }, { add_notes: '유모차', new_name: 'Bob' }]) {
      const calls = mockEvent(K.event())
      const r = JSON.parse(await K.make().updateEventContact('tok', { event_id: 'ev1', ...args }, PSTN))
      assert.equal(r.error, 'one_field_at_a_time', JSON.stringify(args))
      assert.equal(calls.length, 0)
    }
    const other = { ...PSTN, callerNumber: '+41780000000', sameCallOwnedEventIds: new Set() }
    const calls = mockEvent(K.event())
    const r = JSON.parse(await K.make().updateEventContact('tok', { event_id: 'ev1', add_notes: '유모차' }, other))
    assert.equal(r.error, 'ownership_mismatch')
    assert.equal(calls.filter((c) => c.method === 'PATCH').length, 0)
  })

  test(`${K.label} edit: name branch unchanged - pending_field='name' still carries voice_fastpath as before`, async () => {
    mockEvent(K.event())
    const r = JSON.parse(await K.make().updateEventContact('tok', { event_id: 'ev1', pending_field: 'name' }, PSTN))
    assert.equal(r.voice_fastpath?.field, 'name')
    assert.equal(r.voice_fastpath?.current_value, 'Anna')
  })
}

test('\'Outlook edit: does not edit the message of an HTML invite our tool did not create (formatting would be lost)\'', async () => {
  const calls = mockEvent(msEvent('<html><body><p>Team <b>offsite</b></p></body></html>', 'html'))
  const r = JSON.parse(await ms().updateEventContact('tok', { event_id: 'ev1', new_notes: '유모차' }, PSTN))
  assert.equal(r.error, 'external_invite_html_body')
  assert.equal(calls.filter((c) => c.method === 'PATCH').length, 0)
})

test('\'Outlook edit: edits the HTML body of our booking as plain text\'', async () => {
  const html = '<html><body><div>Name: Anna<br>\r\nPhone: 0791234567<br>\r\n<br>\r\nNotes: 5분 늦어요<br>\r\n<br>\r\nSource: PSTN call from +41791234567</div></body></html>'
  const calls = mockEvent(msEvent(html, 'html'))
  const r = JSON.parse(await ms().updateEventContact('tok', { event_id: 'ev1', new_notes: '10분 늦어요' }, PSTN))
  assert.equal(r.success, true)
  const patch = calls.find((c) => c.method === 'PATCH')!
  assert.equal(patch.body.body.contentType, 'text')
  assert.ok(patch.body.body.content.includes('Notes: 10분 늦어요'))
  assert.ok(patch.body.body.content.includes('Name: Anna'))
})

test('\'tool description: update_event_contact accepts notes (both Google and Outlook)\'', () => {
  for (const c of [google(), ms()]) {
    const def = c.listTools().find((t: any) => t.name === 'update_event_contact')
    assert.deepEqual(def.parameters.properties.pending_field.enum, ['name', 'phone', 'notes'])
    assert.equal(def.parameters.properties.new_notes.type, 'string')
    assert.equal(def.parameters.properties.add_notes.type, 'string')
    assert.ok(def.description.includes('new_notes') && def.description.includes('add_notes') && def.description.includes('clear_notes'))
    assert.equal(def.parameters.properties.clear_notes.type, 'boolean')
  }
})

const START = '2030-10-01T20:00:00+02:00'
const BOOK_CONFIG = { calendarId: 'cal', timezone: TZ, workingHoursStart: '09:00', workingHoursEnd: '23:00', defaultDurationMin: 60, weeklyClosedDays: {} }
const BOOK_ARGS = { start_iso: START, summary: 'Dinner', patient_name: 'Anna Muster', patient_phone: '0791234567' }
function mockBooking() {
  globalThis.fetch = (async (url: any, init?: any) => {
    if (init?.method === 'POST' && /\/events(\?|$)/.test(String(url))) {
      return { ok: true, status: 200, json: async () => ({ id: 'new1', htmlLink: 'x', webLink: 'x', start: { dateTime: START }, end: { dateTime: START } }) } as any
    }
    return { ok: true, status: 200, json: async () => ({ calendars: { cal: { busy: [] } }, items: [], value: [{ scheduleItems: [] }] }) } as any
  }) as any
}

for (const K of [
  { label: 'Google', make: () => Object.assign(new GoogleCalendarToolClient() as any, BOOK_CONFIG) },
  { label: 'Outlook', make: () => Object.assign(new MicrosoftCalendarToolClient() as any, BOOK_CONFIG) },
]) {
  test(`${K.label} booking: when on, the success result has next_step (ask once) - when off, the result is the same as before`, async () => {
    mockBooking()
    const off = JSON.parse(await K.make().bookEvent('tok', BOOK_ARGS))
    assert.equal(off.success, true, JSON.stringify(off))
    assert.equal('next_step' in off, false)

    mockBooking()
    const c = K.make()
    c.setBookingMessagePrompt('Any requests?')
    const on = JSON.parse(await c.bookEvent('tok', BOOK_ARGS))
    assert.equal(on.success, true, JSON.stringify(on))
    assert.ok(on.next_step.includes('"Any requests?"') && on.next_step.includes('add_notes'))
    assert.equal(on.eventId, 'new1')
  })
}

test('\'multi calendar: the first value among the enabled calendars applies to the booking results of all calendars\'', () => {
  const d = new MultiCalendarDispatcher() as any
  const a = google()
  const b = ms()
  d.clients.set('cal_a', a)
  d.clients.set('cal_b', b)
  d.setBookingMessagePrompt('Any requests?')
  assert.equal(a.bookingMessagePrompt, 'Any requests?')
  assert.equal(b.bookingMessagePrompt, 'Any requests?')
  d.setBookingMessagePrompt(undefined)
  assert.equal(b.bookingMessagePrompt, undefined)
})
