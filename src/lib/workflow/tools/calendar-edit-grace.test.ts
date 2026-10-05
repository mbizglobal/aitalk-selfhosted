import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { GoogleCalendarToolClient } from './google-calendar-tool'
import { MicrosoftCalendarToolClient } from './microsoft-calendar-tool'

const TZ = 'Europe/Zurich'
const POLICY = {
  reschedulePolicy: { enabled: true, cutoffHours: 24, refuseMessage: '' },
  cancellationPolicy: { enabled: true, cutoffHours: 24, refuseMessage: '', offerTransfer: false, transferMessage: '' },
}
const BASE = { calendarId: 'cal', timezone: TZ, workingHoursStart: '00:00', workingHoursEnd: '23:59', defaultDurationMin: 60, weeklyClosedDays: {}, ...POLICY }
const DESC = 'Name: Anna\nPhone: 0791234567'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

function eventTimes(createdAgoMin: number) {
  const now = Date.now()
  let startMs = Math.ceil((now + 3 * 3600_000) / 3600_000) * 3600_000
  while ([21, 22, 23].includes(Number(zurichWall(startMs).slice(11, 13)))) startMs += 3600_000
  return { startMs, createdIso: new Date(now - createdAgoMin * 60_000).toISOString() }
}
function zurichWall(ms: number): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    .formatToParts(new Date(ms)).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}T${p.hour === '24' ? '00' : p.hour}:${p.minute}:${p.second}.0000000`
}

function zurichIso(ms: number): string {
  const wall = zurichWall(ms).slice(0, 19)
  const offMin = Math.round((Date.parse(wall + 'Z') - ms) / 60_000)
  const sign = offMin >= 0 ? '+' : '-'
  const a = Math.abs(offMin)
  return `${wall}${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`
}

function mockGoogle(createdAgoMin: number) {
  const { startMs, createdIso } = eventTimes(createdAgoMin)
  const calls: string[] = []
  globalThis.fetch = (async (url: any, init?: any) => {
    const method = init?.method || 'GET'
    calls.push(method)
    if (method === 'DELETE') return { ok: true, status: 204, json: async () => ({}) } as any
    if (method === 'PATCH') return { ok: true, status: 200, json: async () => ({ id: 'e1', start: { dateTime: new Date(startMs + 3600_000).toISOString() } }) } as any
    if (/\/events\/e1$/.test(String(url))) {
      return { ok: true, status: 200, json: async () => ({
        id: 'e1', status: 'confirmed', summary: 'Dinner', description: DESC, created: createdIso,
        start: { dateTime: new Date(startMs).toISOString() }, end: { dateTime: new Date(startMs + 3600_000).toISOString() },
      }) } as any
    }
    return { ok: true, status: 200, json: async () => ({ items: [], calendars: { cal: { busy: [] } } }) } as any
  }) as any
  return { calls, startMs }
}

function mockMs(createdAgoMin: number) {
  const { startMs, createdIso } = eventTimes(createdAgoMin)
  const calls: string[] = []
  globalThis.fetch = (async (url: any, init?: any) => {
    const method = init?.method || 'GET'
    calls.push(method)
    if (method === 'DELETE') return { ok: true, status: 204, json: async () => ({}) } as any
    if (method === 'PATCH') return { ok: true, status: 200, json: async () => ({ subject: 'Dinner' }) } as any
    if (/\/events\/e1$/.test(String(url))) {
      return { ok: true, status: 200, json: async () => ({
        id: 'e1', subject: 'Dinner', isCancelled: false, body: { contentType: 'text', content: DESC }, createdDateTime: createdIso,
        start: { dateTime: zurichWall(startMs) }, end: { dateTime: zurichWall(startMs + 3600_000) },
      }) } as any
    }
    return { ok: true, status: 200, json: async () => ({ value: [{ scheduleItems: [] }] }) } as any
  }) as any
  return { calls, startMs }
}

const CLIENTS = [
  { label: 'Google', make: () => Object.assign(new GoogleCalendarToolClient() as any, BASE), mock: mockGoogle },
  { label: 'Outlook', make: () => Object.assign(new MicrosoftCalendarToolClient() as any, BASE), mock: mockMs },
] as const

for (const K of CLIENTS) {
  test(`${K.label}: a booking made 1 minute ago can be changed even within the 24-hour cutoff`, async () => {
    const { calls, startMs } = K.mock(1)
    const r = JSON.parse(await K.make().rescheduleEvent('tok', { event_id: 'e1', new_start_iso: zurichIso(startMs + 3600_000) }))
    assert.notEqual(r.error, 'reschedule_too_late', JSON.stringify(r))
    assert.ok(calls.includes('PATCH'), JSON.stringify(r))
  })

  test(`${K.label}: a booking made 1 minute ago can be canceled even within the 24-hour cutoff`, async () => {
    const { calls } = K.mock(1)
    const r = JSON.parse(await K.make().cancelEvent('tok', { event_id: 'e1' }))
    assert.notEqual(r.error, 'cancellation_too_late', JSON.stringify(r))
    assert.ok(calls.includes('DELETE'), JSON.stringify(r))
  })

  test(`${K.label}: a booking made 2 hours ago is blocked per policy`, async () => {
    const m1 = K.mock(120)
    const r1 = JSON.parse(await K.make().rescheduleEvent('tok', { event_id: 'e1', new_start_iso: zurichIso(m1.startMs + 3600_000) }))
    assert.equal(r1.error, 'reschedule_too_late')
    assert.ok(!m1.calls.includes('PATCH'))
    const m2 = K.mock(120)
    const r2 = JSON.parse(await K.make().cancelEvent('tok', { event_id: 'e1' }))
    assert.ok(r2.success === false && /too_late|policy/.test(String(r2.error)), JSON.stringify(r2))
    assert.ok(!m2.calls.includes('DELETE'))
  })
}
