import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePartySize, partySizeFromEvent, computeSeatUsage, eventRangeMs, parsePartySizeArg, replacePartyLine } from './capacity'
import { descriptionLineValue, stripHtml } from './contact-description'

const SHAPES: Record<string, string> = {
  text: 'Name: Anna\nPhone: 079\nParty: 4\nTable: 4-seat table #3',
  crlf: 'Name: Anna\r\nPhone: 079\r\nParty: 4\r\nTable: 4-seat table #3',
  br: 'Name: Anna<br>Phone: 079<br>Party: 4<br>Table: 4-seat table #3',
  div: '<div>Name: Anna</div><div>Phone: 079</div><div>Party: 4</div><div>Table: 4-seat table #3</div>',
  outlook: '<html><head><meta charset="utf-8"></head><body><div>Name: Anna<br>\r\nPhone: 079<br>\r\nParty: 4<br>\r\nTable: 4-seat table #3</div></body></html>',
}
for (const [shape, desc] of Object.entries(SHAPES)) {
  test(`parsePartySize: reads 4 from the ${shape} shape`, () => {
    assert.equal(parsePartySize(desc), 4)
  })
}

test('parsePartySize: 1 when there is no Party line', () => {
  assert.equal(parsePartySize('Name: Anna'), 1)
  assert.equal(parsePartySize(''), 1)
  assert.equal(parsePartySize(null), 1)
})

test('partySizeFromEvent: looks at body.content when the description has no Party', () => {
  assert.equal(partySizeFromEvent({ description: 'Name: Anna', body: { content: '<div>Party: 6</div>' } }), 6)
})

test('computeSeatUsage: sums the party size of two HTML descriptions', () => {
  const ev = (desc: string) => ({
    description: desc,
    start: { dateTime: '2026-10-01T18:00:00Z' },
    end: { dateTime: '2026-10-01T19:30:00Z' },
  })
  const r = computeSeatUsage(
    [ev(SHAPES.br), ev(SHAPES.div)],
    Date.parse('2026-10-01T18:30:00Z'),
    Date.parse('2026-10-01T19:00:00Z'),
    'UTC'
  )
  assert.deepEqual(r, { used: 8, blocked: false })
})

test('descriptionLineValue: strips line breaks and angle brackets into one line', () => {
  assert.equal(descriptionLineValue('window seat\nParty: 50'), 'window seat Party: 50')
  assert.equal(descriptionLineValue('a\r\n\u2028b <br>c'), 'a b brc')
  assert.equal(descriptionLineValue(null), '')
})

test('stripHtml: numeric entity line break (&#10;) becomes a space; out-of-range codes stay as the original text', () => {
  assert.equal(stripHtml('<div>Notes: x&#10;Party: 50</div>'), 'Notes: x Party: 50\n')
  assert.equal(stripHtml('<p>a&#99999999;b</p>'), 'a&#99999999;b\n')
})

test('stripHtml: the Unicode line separator entity (&#8232;) also becomes a space', () => {
  assert.equal(parsePartySize('<div>Notes: x&#8232;Party: 8</div>'), 1)
  assert.equal(stripHtml('<div>a&#x2028;b</div>'), 'a b\n')
})

test('stripHtml: reads as one line even when the label and value are in different table cells', () => {
  assert.equal(parsePartySize('<table><tr><td>Party:</td><td>4</td></tr></table>'), 4)
})

test('descriptionText: treated as HTML even with only an opening block tag and no closing tag', () => {
  assert.equal(parsePartySize('<div>Name: Anna\n<div>Party: 4\n<div>Table: 4-seat table #1'), 4)
})

const TZ = 'Europe/Zurich'
const at = (s: string, e: string, extra: Record<string, unknown> = {}) => ({
  start: { dateTime: s }, end: { dateTime: e }, ...extra,
})
const W_S = Date.parse('2026-10-01T18:00:00+02:00')
const W_E = Date.parse('2026-10-01T19:30:00+02:00')

test('computeSeatUsage: Party lines are added as party size', () => {
  const r = computeSeatUsage([
    at('2026-10-01T18:00:00+02:00', '2026-10-01T19:00:00+02:00', { description: 'Party: 4' }),
    at('2026-10-01T18:30:00+02:00', '2026-10-01T19:30:00+02:00', { description: 'Party: 2' }),
  ], W_S, W_E, TZ)
  assert.deepEqual(r, { used: 6, blocked: false })
})

test('computeSeatUsage: events with no Party line (private hire, closures, old bookings) block that time', () => {
  const r = computeSeatUsage([at('2026-10-01T17:00:00+02:00', '2026-10-01T22:00:00+02:00', { description: 'Private party' })], W_S, W_E, TZ)
  assert.equal(r.blocked, true)
})

test('computeSeatUsage: events marked free are ignored (Google transparency, Outlook showAs)', () => {
  const r = computeSeatUsage([
    at('2026-10-01T18:00:00+02:00', '2026-10-01T19:00:00+02:00', { transparency: 'transparent', summary: 'Order wine' }),
    at('2026-10-01T18:00:00+02:00', '2026-10-01T19:00:00+02:00', { showAs: 'free' }),
  ], W_S, W_E, TZ)
  assert.deepEqual(r, { used: 0, blocked: false })
})

test('computeSeatUsage: events that do not overlap are not counted', () => {
  const r = computeSeatUsage([at('2026-10-01T19:30:00+02:00', '2026-10-01T21:00:00+02:00', { description: 'Private' })], W_S, W_E, TZ)
  assert.deepEqual(r, { used: 0, blocked: false })
})

test('eventRangeMs: a Google all-day event is the whole day in the calendar timezone', () => {
  const r = eventRangeMs({ start: { date: '2026-10-01' }, end: { date: '2026-10-02' } }, TZ)
  assert.deepEqual(r, { s: Date.parse('2026-10-01T00:00:00+02:00'), e: Date.parse('2026-10-02T00:00:00+02:00') })
})

test('eventRangeMs: an Outlook all-day event (isAllDay, written as UTC midnight) is also the whole day in the calendar timezone', () => {
  const r = eventRangeMs({ isAllDay: true, start: { dateTime: '2026-10-01T00:00:00.0000000Z' }, end: { dateTime: '2026-10-02T00:00:00.0000000Z' } }, TZ)
  assert.deepEqual(r, { s: Date.parse('2026-10-01T00:00:00+02:00'), e: Date.parse('2026-10-02T00:00:00+02:00') })
})

test('computeSeatUsage: an all-day closure event also blocks a 00:30 booking that day (reading it as UTC midnight made it start at 02:00)', () => {
  const r = computeSeatUsage([{ start: { date: '2026-10-01' }, end: { date: '2026-10-02' }, summary: 'Closed' }],
    Date.parse('2026-10-01T00:30:00+02:00'), Date.parse('2026-10-01T01:00:00+02:00'), TZ)
  assert.equal(r.blocked, true)
})

test('eventRangeMs: an all-day event blocks that day even if the end date is the same or missing', () => {
  const day = { s: Date.parse('2026-10-01T00:00:00+02:00'), e: Date.parse('2026-10-02T00:00:00+02:00') }
  assert.deepEqual(eventRangeMs({ start: { date: '2026-10-01' }, end: { date: '2026-10-01' } }, TZ), day)
  assert.deepEqual(eventRangeMs({ start: { date: '2026-10-01' } }, TZ), day)
})

test('computeSeatUsage: Google \'free\' is matched regardless of case', () => {
  const r = computeSeatUsage([at('2026-10-01T18:00:00+02:00', '2026-10-01T19:00:00+02:00', { transparency: 'Transparent' })], W_S, W_E, TZ)
  assert.equal(r.blocked, false)
})

test('eventRangeMs: an all-day event with a strange end date is that day; a strange start date gives null (no exception)', () => {
  assert.deepEqual(eventRangeMs({ start: { date: '2026-10-01' }, end: { date: 'not-a-date' } }, TZ),
    { s: Date.parse('2026-10-01T00:00:00+02:00'), e: Date.parse('2026-10-02T00:00:00+02:00') })
  assert.equal(eventRangeMs({ start: { date: 'today' } }, TZ), null)
  assert.equal(eventRangeMs({ isAllDay: true, start: { dateTime: 'garbage' } }, TZ), null)
})

test('parsePartySizeArg: only integers 1 to 999 and numeric strings, otherwise null', () => {
  assert.equal(parsePartySizeArg(undefined), null)
  assert.equal(parsePartySizeArg(''), null)
  assert.equal(parsePartySizeArg(4), 4)
  assert.equal(parsePartySizeArg(' 6 '), 6)
  assert.equal(parsePartySizeArg(1000), 1000)
  for (const bad of [0, -1, 4.9, Infinity, NaN, 'abc', '4.5', true, {}]) {
    assert.equal(parsePartySizeArg(bad), 'invalid', String(bad))
  }
})

test('replacePartyLine: replaces the Party line in the metadata and places it before the Table line', () => {
  assert.equal(
    replacePartyLine('Name: A\nParty: 4\nTable: 4-seat table #1 [t4]\n\nNotes: x', 6),
    'Name: A\nParty: 6\nTable: 4-seat table #1 [t4]\n\nNotes: x')
})

test('replacePartyLine: moves the old order (Party after the note) away and writes it fresh in the metadata area; the note\'s sentences stay', () => {
  assert.equal(
    replacePartyLine('Name: A\n\nNotes: party: big birthday\nParty: 4', 6),
    'Name: A\nParty: 6\n\nNotes: party: big birthday')
})

