import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { GoogleCalendarToolClient } from './google-calendar-tool'
import { MicrosoftCalendarToolClient } from './microsoft-calendar-tool'

const TZ = 'Europe/Zurich'
const START = '2030-10-01T20:00:00+02:00'
const CONFIG = { calendarId: 'cal', timezone: TZ, workingHoursStart: '09:00', workingHoursEnd: '23:00', defaultDurationMin: 60, weeklyClosedDays: {} }
const ARGS = { start_iso: START, summary: 'Dinner', patient_name: 'Anna Muster', patient_phone: '0791234567' }
const webCtx = () => ({
  callChannel: 'web_voice', callerNumber: null, callerUtterances: ['Anna Muster', '📱 0791234567'],
  transcriptSource: 'model_input_asr', sameCallOwnedEventIds: new Set<string>(), callerLastTurnAt: Date.now() - 5000,
}) as any

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

function mockCalendar() {
  const posts: any[] = []
  globalThis.fetch = (async (url: any, init?: any) => {
    const u = String(url)
    if (init?.method === 'POST' && (u.endsWith('/events') || /\/events\?/.test(u))) {
      posts.push(JSON.parse(init.body))
      return { ok: true, status: 200, json: async () => ({ id: 'new1', htmlLink: 'x', webLink: 'x', start: { dateTime: START }, end: { dateTime: START } }) } as any
    }
    return { ok: true, status: 200, json: async () => ({ calendars: { cal: { busy: [] } }, items: [], value: [{ scheduleItems: [] }] }) } as any
  }) as any
  return posts
}

const CLIENTS = [
  { label: 'Google', make: (channel?: string) => Object.assign(new GoogleCalendarToolClient() as any, CONFIG, channel ? { channel } : {}) },
  { label: 'Outlook', make: (channel?: string) => Object.assign(new MicrosoftCalendarToolClient() as any, CONFIG, channel ? { channel } : {}) },
] as const

for (const K of CLIENTS) {
  test(`${K.label}: web voice first call does not save and returns the content to read aloud -> saves with confirmed=true after the customer says yes`, async () => {
    const posts = mockCalendar()
    const c = K.make('web_voice')
    const ctx = webCtx()
    const r1 = JSON.parse(await c.bookEvent('tok', ARGS, ctx))
    assert.equal(r1.error, 'confirmation_required', JSON.stringify(r1))
    assert.match(r1.booking_summary.when, /20:00 \(Europe\/Zurich\)/)
    assert.equal(r1.booking_summary.name, 'Anna Muster')
    assert.equal(posts.length, 0, '첫 호출에서 캘린더에 썼다')
    assert.equal(JSON.parse(await c.bookEvent('tok', { ...ARGS, confirmed: true }, ctx)).error, 'confirmation_required')
    assert.equal(posts.length, 0)
    ctx.callerLastTurnAt = Date.now() + 1
    const r2 = JSON.parse(await c.bookEvent('tok', { ...ARGS, confirmed: true }, ctx))
    assert.equal(r2.success, true, JSON.stringify(r2))
    assert.equal(posts.length, 1)
  })

  test(`${K.label}: attaching confirmed=true from the first call does not skip it - changing the time reads it back again`, async () => {
    const posts = mockCalendar()
    const c = K.make('web_voice')
    const ctx = webCtx()
    assert.equal(JSON.parse(await c.bookEvent('tok', { ...ARGS, confirmed: true }, ctx)).error, 'confirmation_required')
    const moved = { ...ARGS, start_iso: '2030-10-01T21:00:00+02:00' }
    ctx.callerLastTurnAt = Date.now() + 1
    const r = JSON.parse(await c.bookEvent('tok', { ...moved, confirmed: true }, ctx))
    assert.equal(r.error, 'confirmation_required', '읽어 준 것과 다른 시각을 확인 없이 저장했다')
    assert.match(r.booking_summary.when, /21:00/)
    assert.equal(posts.length, 0)
  })

  test(`${K.label}: chatbot (no conversation info) saves immediately as before, and the tool shape has no confirmed`, async () => {
    const posts = mockCalendar()
    const r = JSON.parse(await K.make('chat_widget').bookEvent('tok', ARGS))
    assert.equal(r.success, true, JSON.stringify(r))
    assert.equal(posts.length, 1)
    const chatDef = K.make('chat_widget').listTools().find((t: any) => t.name === 'book_calendar_event')
    assert.equal('confirmed' in chatDef.parameters.properties, false)
    assert.ok(!chatDef.description.includes('FINAL CONFIRMATION'))
    const voiceDef = K.make('web_voice').listTools().find((t: any) => t.name === 'book_calendar_event')
    assert.equal(voiceDef.parameters.properties.confirmed.type, 'boolean')
    assert.ok(voiceDef.description.includes('FINAL CONFIRMATION'))
  })

  test(`${K.label}: an unavailable time is refused BEFORE asking for confirmation - so it is not refused after reading it out and getting a yes`, async () => {
    const posts = mockCalendar()
    const ctx = webCtx()
    const r = JSON.parse(await K.make('web_voice').bookEvent('tok', { ...ARGS, start_iso: '2030-10-01T23:30:00+02:00' }, ctx))
    assert.notEqual(r.error, 'confirmation_required', JSON.stringify(r))
    assert.equal(ctx.pendingBookingConfirm, undefined)
    assert.equal(posts.length, 0)
  })
}
