import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BLOCKS, validateSpec, type AppSpec } from './assembled'
import { addDaysIso, addMinutesWall, buildSpecEvent, calEventKey, calPrint } from './assembled-calendar'
import { parseCalSlot } from './calendar-slot'
import { guardStudioOnlyFields } from '../mcp-server/studio-only'

const visits = (): Record<string, unknown> & { tables: Array<Record<string, unknown>>; sends: Array<Record<string, unknown>> } => ({
  spec: 1, name: 'Visits',
  tables: [{
    key: 'visits', name: 'Visits', number: { prefix: 'VI' },
    columns: [
      { key: 'customer', label: 'Customer', kind: 'text' }, { key: 'day', label: 'Day', kind: 'date' }, { key: 'last', label: 'Last day', kind: 'date' },
      { key: 'from', label: 'From', kind: 'time' }, { key: 'to', label: 'To', kind: 'time' }, { key: 'note', label: 'Note', kind: 'longtext' },
      { key: 'secret', label: 'Secret', kind: 'text', hidden: true }, { key: 'qty', label: 'Qty', kind: 'number' },
    ],
    status: { values: ['new', 'confirmed'], start: 'new', moves: [['new', 'confirmed']], lockedIn: ['confirmed'] },
    alerts: [{ key: 'soon', label: 'Soon', date: 'day', daysBefore: 1 }],
  }],
  sends: [
    { key: 'cal', label: 'Calendar', table: 'visits', via: 'calendar', to: 'cal', subject: 'Visit — {customer} ({number})', body: 'Note: {note}', event: { date: 'day', start: 'from', end: 'to' }, allowWhen: { status: ['confirmed'], confirmed: true } },
  ],
})
const codes = (raw: unknown): string[] => { const r = validateSpec(raw, null); return r.ok ? [] : r.issues.map((i) => i.code) }
const v = (f: (x: ReturnType<typeof visits>) => void) => { const x = visits(); f(x); return codes(x) }
const ev = (e: Record<string, unknown>) => (x: ReturnType<typeof visits>) => { x.sends[0].event = e }

test('calendar — passes · shape · block list', () => {
  const r = validateSpec(visits(), null)
  assert.ok(r.ok, JSON.stringify(!r.ok && r.issues))
  const s = r.spec.sends![0]
  assert.equal(s.via, 'calendar')
  assert.deepEqual(s.event, { date: 'day', start: 'from', end: 'to' })
  assert.ok(BLOCKS.some((b) => b.id === 'calendar'))
  assert.deepEqual(v(ev({ date: 'day' })), [])
  assert.deepEqual(v(ev({ date: 'day', endDate: 'last' })), [])
  assert.deepEqual(v(ev({ date: 'day', start: 'from', minutes: 90 })), [])
  assert.deepEqual(v(ev({ date: 'day', start: 'from' })), [])
  assert.deepEqual(v(ev({ date: 'day', start: 'from', end: 'to', endDate: 'last' })), [])
  assert.deepEqual(v((x) => { delete x.sends[0].body }), [])
  const again = validateSpec(JSON.parse(JSON.stringify(r.spec)), null)
  assert.ok(again.ok, JSON.stringify(!again.ok && again.issues))
})

test('calendar — wrong ones', () => {
  assert.deepEqual(v((x) => { x.sends[0].to = 'owner' }), ['INVALID'])
  assert.deepEqual(v((x) => { x.sends[0].subject = '' }), ['REQUIRED'])
  assert.deepEqual(v((x) => { x.sends[0].subject = '{nope}' }), ['BAD_REF'])
  assert.deepEqual(v((x) => { x.sends[0].body = '{secret}' }), ['BAD_REF'])
  assert.deepEqual(v((x) => { x.sends[0].map = { a: 'qty' } }), ['INVALID'])
  assert.deepEqual(v((x) => { x.sends[0].attachDoc = 'x' }), ['INVALID'])
  assert.deepEqual(v((x) => { delete x.sends[0].event }), ['INVALID'])
  assert.deepEqual(v(ev({ date: 'customer' })), ['BAD_REF'])
  assert.deepEqual(v(ev({ date: 'day', start: 'day' })), ['BAD_REF'])
  assert.deepEqual(v(ev({ date: 'day', end: 'to' })), ['INVALID'])
  assert.deepEqual(v(ev({ date: 'day', minutes: 30 })), ['INVALID'])
  assert.deepEqual(v(ev({ date: 'day', start: 'from', end: 'to', minutes: 30 })), ['INVALID'])
  assert.deepEqual(v(ev({ date: 'day', start: 'from', minutes: 4 })), ['INVALID'])
  assert.deepEqual(v(ev({ date: 'day', start: 'from', minutes: 1441 })), ['INVALID'])
  assert.deepEqual(v(ev({ date: 'day', start: 'from', minutes: 1.5 })), ['INVALID'])
  assert.deepEqual(v(ev({ date: 'day', start: 'from', endDate: 'last' })), ['INVALID'])
  assert.deepEqual(v(ev({ date: 'day', endDate: 'day' })), ['INVALID'])
  assert.deepEqual(v(ev({ date: 'day', extra: 1 })), ['INVALID'])
  assert.deepEqual(v((x) => { x.sends[0].allowWhen = { confirmed: false } }), ['INVALID'])
  assert.deepEqual(v((x) => { (x.tables[0].alerts as Array<Record<string, unknown>>)[0].send = 'cal' }), ['INVALID'])
  assert.deepEqual(v((x) => { (x.tables[0].alerts as Array<Record<string, unknown>>)[0].telegram = 'cal' }), ['INVALID'])
  assert.deepEqual(v((x) => { x.sends.push({ key: 'm', label: 'M', table: 'visits', to: 'owner', subject: 's', body: 'b', event: { date: 'day' } }) }), ['INVALID'])
})

test('date text arithmetic — month end · leap year · year change · server time zone does not matter', () => {
  assert.equal(addDaysIso('2027-01-31', 1), '2027-02-01')
  assert.equal(addDaysIso('2028-02-28', 1), '2028-02-29')
  assert.equal(addDaysIso('2027-02-28', 1), '2027-03-01')
  assert.equal(addDaysIso('2026-12-31', 1), '2027-01-01')
  assert.equal(addDaysIso('2026-13-01', 1), null)
  assert.deepEqual(addMinutesWall('2026-12-31', '23:30', 60), { date: '2027-01-01', time: '00:30' })
  assert.deepEqual(addMinutesWall('2026-11-14', '09:00', 1440), { date: '2026-11-15', time: '09:00' })
  assert.deepEqual(addMinutesWall('2026-11-14', '09:00', 90), { date: '2026-11-14', time: '10:30' })
})

const spec = (e?: Record<string, unknown>) => { const x = visits(); if (e) x.sends[0].event = e; const r = validateSpec(x, null); assert.ok(r.ok); return r.spec as AppSpec }
const build = (sp: AppSpec, row: Record<string, unknown>) => buildSpecEvent(sp, sp.tables[0], sp.sends![0], row, '2026-11-10', {}, 'Europe/Zurich')

test('event building — end computation · empty columns · title', () => {
  const row = { customer: 'Muster AG', day: '2026-11-14', last: '2026-11-16', from: '09:00', to: '10:30', note: 'Gate B', number: 'VI-2026-001' }
  const a = build(spec(), row)
  assert.ok('event' in a)
  assert.deepEqual(a.event, { title: 'Visit — Muster AG (VI-2026-001)', description: 'Note: Gate B\n\nCreated by AI Talk — Visits VI-2026-001', allDay: false, start: '2026-11-14T09:00:00', end: '2026-11-14T10:30:00', timeZone: 'Europe/Zurich' })
  const d = build(spec({ date: 'day' }), row)
  assert.ok('event' in d && d.event.allDay && d.event.start === '2026-11-14' && d.event.end === '2026-11-15')
  const m = build(spec({ date: 'day', endDate: 'last' }), row)
  assert.ok('event' in m && m.event.end === '2026-11-17')
  const mt = build(spec({ date: 'day', start: 'from', end: 'to', endDate: 'last' }), { ...row, to: '08:00' })
  assert.ok('event' in mt && mt.event.end === '2026-11-16T08:00:00')
  const n = build(spec({ date: 'day', start: 'from', minutes: 90 }), { ...row, from: '23:30' })
  assert.ok('event' in n && n.event.end === '2026-11-15T01:00:00')
  const s1 = build(spec({ date: 'day', start: 'from' }), row)
  assert.ok('event' in s1 && s1.event.end === '2026-11-14T10:00:00')
  assert.ok('error' in build(spec(), { ...row, to: '09:00' }))
  assert.ok('error' in build(spec(), { ...row, to: '08:00' }))
  assert.ok('error' in build(spec(), { ...row, day: '' }))
  assert.ok('error' in build(spec(), { ...row, from: '' }))
  assert.ok('error' in build(spec({ date: 'day', endDate: 'last' }), { ...row, last: '2026-11-13' }))
  const empty = visits(); empty.sends[0].subject = '{customer}'
  const er = validateSpec(empty, null); assert.ok(er.ok)
  assert.ok('error' in buildSpecEvent(er.spec, er.spec.tables[0], er.spec.sends![0], { ...row, customer: '  ' }, '2026-11-10', {}, 'Europe/Zurich'))
  const e2 = build(spec({ date: 'day', endDate: 'last' }), { ...row, last: '' })
  assert.ok('event' in e2 && e2.event.end === '2026-11-15')
})

test('event building — same body in another server time zone', () => {
  const before = process.env.TZ
  const row = { customer: 'X', day: '2026-03-29', from: '02:30', to: '03:30' }
  const outs: string[] = []
  for (const tz of ['UTC', 'Europe/Zurich', 'Pacific/Kiritimati']) {
    process.env.TZ = tz
    const r = build(spec(), row)
    assert.ok('event' in r)
    outs.push(JSON.stringify(r.event))
  }
  process.env.TZ = before
  assert.equal(new Set(outs).size, 1)
})

test('event key · fingerprint', () => {
  const k = calEventKey('p1', 'cal', 'r1')
  assert.match(k, /^[0-9a-f]{32}$/)
  assert.equal(k, calEventKey('p1', 'cal', 'r1'))
  assert.notEqual(k, calEventKey('p1', 'cal', 'r2'))
  assert.notEqual(k, calEventKey('p1', 'cal2', 'r1'))
  const e = { title: 'a', description: 'b', allDay: false, start: '2026-11-14T09:00:00', end: '2026-11-14T10:00:00', timeZone: 'Europe/Zurich' }
  assert.equal(calPrint(e), calPrint({ ...e }))
  assert.notEqual(calPrint(e), calPrint({ ...e, end: '2026-11-14T10:30:00' }))
})

test('calendar slot value · MCP cannot change it', () => {
  assert.deepEqual(parseCalSlot({ connectionId: ' c ', accountId: 'a', calendarId: 'k', calendarName: 'Team' }), { connectionId: 'c', accountId: 'a', calendarId: 'k', calendarName: 'Team' })
  assert.equal(parseCalSlot({ connectionId: 'c', accountId: '', calendarId: 'k' }), null)
  assert.equal(parseCalSlot(['c']), null)
  const slot = { cal: { connectionId: 'c1', accountId: 'a1', calendarId: 'team@x' } }
  const stored = { nodes: [{ id: 'n', data: { calendarSlots: slot } }] }
  const g = (data: Record<string, unknown> | undefined) => guardStudioOnlyFields({ nodes: [{ id: 'n', ...(data ? { data } : {}) } as never] }, stored)
  assert.deepEqual(g({ calendarSlots: { cal: { ...slot.cal } } }), [])
  assert.deepEqual(g({ calendarSlots: { cal: { ...slot.cal, calendarName: 'renamed' } } }), [])
  assert.equal(g({ calendarSlots: { cal: { ...slot.cal, accountId: 'a2' } } }).length, 1)
  assert.equal(g({ calendarSlots: { cal: { ...slot.cal, calendarId: 'other' } } }).length, 1)
  assert.equal(g({ calendarSlots: { cal: ['x'] } }).length, 1)
  assert.equal(g({ calendarSlots: { cal: { connectionId: 'c1' } } }).length, 1)
  assert.equal(g({ calendarSlots: {} }).length, 1)
  assert.equal(g(undefined).length, 1)
  const kept = { nodes: [{ id: 'n', data: {} as Record<string, unknown> }] }
  assert.deepEqual(guardStudioOnlyFields(kept, stored), [])
  assert.deepEqual(kept.nodes[0].data.calendarSlots, slot)
  assert.equal(guardStudioOnlyFields({ nodes: [{ id: 'new', data: { calendarSlots: slot } }] }, stored).length, 1)
  assert.deepEqual(guardStudioOnlyFields({ nodes: [{ id: 'new', data: { calendarSlots: {} } }] }, stored), [])
})
