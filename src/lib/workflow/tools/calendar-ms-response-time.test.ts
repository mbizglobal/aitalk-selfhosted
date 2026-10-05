import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { MicrosoftCalendarToolClient } from './microsoft-calendar-tool'

const TZ = 'Europe/Zurich'
const START = '2030-10-01T20:00:00+02:00'
const GRAPH_UTC_WALL = '2030-10-01T18:00:00.0000000'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

const ms = () => Object.assign(new MicrosoftCalendarToolClient() as any, {
  calendarId: 'cal', timezone: TZ, workingHoursStart: '09:00', workingHoursEnd: '23:00', defaultDurationMin: 60,
  weeklyClosedDays: {},
})

test('\'Outlook booking result: even if Graph gives UTC text, returns the sent time (20:00+02:00) to the model\'', async () => {
  globalThis.fetch = (async (_url: any, init?: any) => {
    if (init?.method === 'POST' && String(_url).endsWith('/events')) {
      return { ok: true, status: 201, json: async () => ({
        id: 'e1', webLink: 'x',
        start: { dateTime: GRAPH_UTC_WALL, timeZone: 'UTC' }, end: { dateTime: '2030-10-01T19:00:00.0000000', timeZone: 'UTC' },
      }) } as any
    }
    return { ok: true, status: 200, json: async () => ({ value: [{ scheduleItems: [] }] }) } as any
  }) as any
  const r = JSON.parse(await ms().bookEvent('tok', {
    start_iso: START, summary: 'Dinner', patient_name: 'Anna Muster', patient_phone: '0791234567',
  }))
  assert.equal(r.success, true, JSON.stringify(r))
  assert.equal(r.start, START)
  assert.equal(r.voice_fastpath.start_iso, START)
  assert.equal(r.end, '2030-10-01T21:00:00+02:00', '끝 시각도 시작과 같은 오프셋 표기 — UTC(Z)면 모델이 19시에 끝난다고 읽는다')
  assert.ok(!JSON.stringify(r).includes(GRAPH_UTC_WALL), 'Graph 의 시간대 없는 글자가 모델에 간다')
})

test('\'Outlook booking change result: the new time also returns the sent value (with offset)\'', async () => {
  const NEW = '2030-10-01T21:00:00+02:00'
  globalThis.fetch = (async (url: any, init?: any) => {
    const u = String(url)
    if (init?.method === 'PATCH') {
      return { ok: true, status: 200, json: async () => ({
        subject: 'Dinner', start: { dateTime: '2030-10-01T19:00:00.0000000' }, end: { dateTime: '2030-10-01T20:00:00.0000000' },
      }) } as any
    }
    if (/\/events\/e1$/.test(u)) {
      return { ok: true, status: 200, json: async () => ({
        id: 'e1', subject: 'Dinner', isCancelled: false, body: { contentType: 'text', content: 'Name: Anna\nPhone: 0791234567' },
        start: { dateTime: '2030-10-01T20:00:00.0000000' }, end: { dateTime: '2030-10-01T21:00:00.0000000' },
      }) } as any
    }
    return { ok: true, status: 200, json: async () => ({ value: [{ scheduleItems: [] }] }) } as any
  }) as any
  const r = JSON.parse(await ms().rescheduleEvent('tok', { event_id: 'e1', new_start_iso: NEW }))
  assert.equal(r.success, true, JSON.stringify(r))
  assert.equal(r.new_start, NEW)
  assert.equal(r.new_end, '2030-10-01T22:00:00+02:00')
  assert.equal(r.voice_fastpath.new_start_iso, NEW)
})
