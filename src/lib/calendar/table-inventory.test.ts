import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseTableAssignment,
  assignTable,
  replaceTableLine,
  formatTableLine,
  computeTableOccupancy,
  normalizeTableInventory,
  type TableType,
} from './table-inventory'

const INV: TableType[] = [
  { id: 't4', name: '4-seat table', capacity: 4, count: 2 },
  { id: 't6', name: '6-seat table', capacity: 6, count: 1 },
]

const SHAPES: Record<string, string> = {
  text: 'Name: Anna\nParty: 4\nTable: 4-seat table #2',
  br: 'Name: Anna<br>Party: 4<br>Table: 4-seat table #2<br>Allergy: nuts',
  div: '<div>Name: Anna</div><div>Party: 4</div><div>Table: 4-seat table #2</div>',
  outlook: '<html><body><div>Name: Anna<br>\r\nParty: 4<br>\r\nTable: 4-seat table #2</div></body></html>',
  span: '<span>Name: Anna</span><br><b>Party: 4</b><br><span>Table: 4-seat table #2</span>',
  td: '<table><tr><td>Party: 4</td></tr><tr><td>Table: 4-seat table #2</td></tr></table>',
}
for (const [shape, desc] of Object.entries(SHAPES)) {
  test(`parseTableAssignment: reads 4-seat #2 from the ${shape} shape`, () => {
    assert.deepEqual(parseTableAssignment(desc, INV), { tableId: 't4', tableName: '4-seat table', instanceIdx: 2 })
  })
}

test('parseTableAssignment: also reads names that contain entities', () => {
  const inv: TableType[] = [{ id: 'tc', name: "Chef's table", capacity: 8, count: 1 }]
  assert.deepEqual(parseTableAssignment('<div>Table: Chef&#39;s table #1</div>', inv), {
    tableId: 'tc', tableName: "Chef's table", instanceIdx: 1,
  })
})

test('skips tables occupied by an HTML description and assigns the next number', () => {
  const events = [{
    description: SHAPES.div.replace('#2', '#1'),
    start: { dateTime: '2026-10-01T18:00:00Z' },
    end: { dateTime: '2026-10-01T19:30:00Z' },
  }]
  const { occupied } = computeTableOccupancy(events, INV, Date.parse('2026-10-01T18:15:00Z'), Date.parse('2026-10-01T19:45:00Z'), 'UTC')
  assert.deepEqual(assignTable(INV, occupied, 4), { tableId: 't4', tableName: '4-seat table', instanceIdx: 2 })
})

test('replaceTableLine: replaces a normal line with a new line', () => {
  const out = replaceTableLine('Name: Anna\nParty: 4\nTable: 4-seat table #1\n\nSource: Web voice call', 'Table: 6-seat table #1')
  assert.equal(out, 'Name: Anna\nParty: 4\nTable: 6-seat table #1\n\nSource: Web voice call')
})

test('replaceTableLine: also removes a hand-edited Table line (no number) and leaves only one new line', () => {
  const out = replaceTableLine('Name: Anna\nParty: 4\nTable: window', 'Table: 4-seat table #2')
  assert.equal(out, 'Name: Anna\nParty: 4\nTable: 4-seat table #2')
})

test('replaceTableLine: converts an HTML description to text and inserts the new line', () => {
  const out = replaceTableLine('<div>Name: Anna</div><div>Party: 4</div><div>Table: 4-seat table #1</div>', 'Table: 6-seat table #1')
  assert.equal(out, 'Name: Anna\nParty: 4\nTable: 6-seat table #1')
})

test('replaceTableLine: inserts after the Party line when there is no Table line', () => {
  const out = replaceTableLine('Name: Anna\nParty: 4\n\nSource: Web voice call', 'Table: 4-seat table #1')
  assert.equal(out, 'Name: Anna\nParty: 4\nTable: 4-seat table #1\n\nSource: Web voice call')
})

test('replaceTableLine: appends at the end when there is no Party line either', () => {
  assert.equal(replaceTableLine('Name: Anna', 'Table: 4-seat table #1'), 'Name: Anna\nTable: 4-seat table #1')
  assert.equal(replaceTableLine('', 'Table: 4-seat table #1'), 'Table: 4-seat table #1')
})

test('parseTableAssignment: does not treat a plain-text "<VIP>" as HTML', () => {
  const inv: TableType[] = [{ id: 'tv', name: 'Patio <VIP>', capacity: 4, count: 1 }]
  assert.deepEqual(parseTableAssignment('Party: 4\nTable: Patio <VIP> #1', inv), {
    tableId: 'tv', tableName: 'Patio <VIP>', instanceIdx: 1,
  })
})

test('replaceTableLine: keeps the owner\'s sentence in the notes area ("Table: window seat")', () => {
  const out = replaceTableLine('Name: Anna\nParty: 4\nTable: 4-seat table #1\n\nNotes: x\nTable: by the window please', 'Table: 6-seat table #1')
  assert.equal(out, 'Name: Anna\nParty: 4\nTable: 6-seat table #1\n\nNotes: x\nTable: by the window please')
})

test('replaceTableLine: removes table lines from the old order (Party/Table after notes) and does not insert after a fake Party in the notes', () => {
  const legacy = 'Name: Anna\nPhone: 079\n\nNotes: x\nParty: 99\nParty: 4\nTable: 4-seat table #1\n\nSource: Web voice call'
  const out = replaceTableLine(legacy, 'Table: 6-seat table #1')
  assert.equal(out, 'Name: Anna\nPhone: 079\nTable: 6-seat table #1\n\nNotes: x\nParty: 99\nParty: 4\n\nSource: Web voice call')
})

test('parseTableAssignment: does not treat angle brackets equal to a tag name, like plain-text "<Table 1>", as HTML', () => {
  const inv: TableType[] = [{ id: 'tt', name: '<Table 1>', capacity: 4, count: 1 }]
  assert.equal(parseTableAssignment('Party: 4\nTable: <Table 1> #1', inv)?.tableId, 'tt')
})

const TZ = 'Europe/Zurich'
const INV3: TableType[] = [
  { id: 't4', name: '4-seat table', capacity: 4, count: 2 },
  { id: 't6', name: '6-seat table', capacity: 6, count: 1 },
  { id: 't10', name: '10-seat table', capacity: 10, count: 1 },
]
const ev = (desc: string | undefined, extra: Record<string, unknown> = {}) => ({
  description: desc,
  start: { dateTime: '2026-10-01T18:00:00+02:00' },
  end: { dateTime: '2026-10-01T19:30:00+02:00' },
  ...extra,
})
const occ = (events: any[]) =>
  computeTableOccupancy(events, INV3, Date.parse('2026-10-01T18:30:00+02:00'), Date.parse('2026-10-01T20:00:00+02:00'), TZ)
const sets = (m: Map<string, Set<number>>) => Object.fromEntries([...m].map(([k, v]) => [k, [...v].sort()]))

test('computeTableOccupancy: a Table line takes that table', () => {
  const r = occ([ev('Party: 4\nTable: 4-seat table #2')])
  assert.equal(r.blocked, false)
  assert.deepEqual(sets(r.occupied), { t4: [2] })
})

test('computeTableOccupancy: a staff manual booking with only a Party line takes the smallest free table that fits', () => {
  const r = occ([ev('Party: 5'), ev('Party: 4\nTable: 4-seat table #1')])
  assert.equal(r.blocked, false)
  assert.deepEqual(sets(r.occupied), { t6: [1], t4: [1] })
})

test('computeTableOccupancy: a manual booking counts toward the smallest fitting table regardless of the restaurant assignment policy (5 guests -> 6-seat)', () => {
  const r = occ([ev('Party: 5')])
  assert.deepEqual(sets(r.occupied), { t6: [1] })
})

test('computeTableOccupancy: an event with neither Table nor Party (venue rental, day off) blocks the whole time slot', () => {
  assert.equal(occ([ev('Private party — whole restaurant')]).blocked, true)
  assert.equal(occ([ev(undefined, { summary: 'Closed' })]).blocked, true)
})

test('computeTableOccupancy: ignores events marked as free', () => {
  const r = occ([ev('Order wine', { transparency: 'transparent' }), ev(undefined, { showAs: 'free' })])
  assert.equal(r.blocked, false)
  assert.equal(r.occupied.size, 0)
})

test('computeTableOccupancy: blocks the time slot when no free table fits a manual booking (safe side)', () => {
  assert.equal(occ([ev('Party: 12')]).blocked, true)
  assert.equal(occ([ev('Party: 10\nTable: 10-seat table #1'), ev('Party: 9')]).blocked, true)
})

test('computeTableOccupancy: does not count non-overlapping events', () => {
  const r = occ([ev('Private', { start: { dateTime: '2026-10-01T20:00:00+02:00' }, end: { dateTime: '2026-10-01T22:00:00+02:00' } })])
  assert.equal(r.blocked, false)
})

test('formatTableLine: writes the kind id as well', () => {
  assert.equal(formatTableLine({ tableId: 't4', tableName: '4-seat table', instanceIdx: 3 }), 'Table: 4-seat table #3 [t4]')
})

test('parseTableAssignment: finds by id even if the name was changed', () => {
  const renamed: TableType[] = [{ id: 't4', name: 'Window 4', capacity: 4, count: 2 }]
  assert.deepEqual(parseTableAssignment('Table: 4-seat table #2 [t4]', renamed), { tableId: 't4', tableName: 'Window 4', instanceIdx: 2 })
})

test('parseTableAssignment: distinguishes two kinds with the same name by id', () => {
  const dup: TableType[] = [
    { id: 'a', name: 'Table', capacity: 4, count: 1 },
    { id: 'b', name: 'Table', capacity: 6, count: 1 },
  ]
  assert.equal(parseTableAssignment('Table: Table #1 [b]', dup)?.tableId, 'b')
})

test('computeTableOccupancy: a booking whose number exceeds the reduced quantity takes a table that fits by Party', () => {
  const shrunk: TableType[] = [{ id: 't4', name: '4-seat table', capacity: 4, count: 1 }]
  const r = computeTableOccupancy([ev('Party: 3\nTable: 4-seat table #2 [t4]')], shrunk,
    Date.parse('2026-10-01T18:30:00+02:00'), Date.parse('2026-10-01T20:00:00+02:00'), TZ)
  assert.deepEqual(sets(r.occupied), { t4: [1] })
})

test('replaceTableLine: also removes our id-tagged format from the notes area', () => {
  const out = replaceTableLine('Name: A\n\nNotes: x\nTable: 4-seat table #1 [t4]', 'Table: 6-seat table #1 [t6]')
  assert.equal(out, 'Name: A\nTable: 6-seat table #1 [t6]\n\nNotes: x')
})

test('normalizeTableInventory: empty name becomes "N-seat table", seats and quantity are 1 to 50, duplicate ids and invalid rows are dropped', () => {
  assert.deepEqual(normalizeTableInventory([
    { id: 'a', name: '  ', capacity: 4.7, count: 80 },
    { id: 'a', name: 'dup', capacity: 6, count: 1 },
    { id: '', name: 'no id', capacity: 4, count: 1 },
    { id: 'c', name: 'zero', capacity: 0, count: 1 },
    { id: 'd', name: ' Patio ', capacity: 2, count: 3 },
    null,
  ]), [
    { id: 'a', name: '4-seat table', capacity: 4, count: 50 },
    { id: 'd', name: 'Patio', capacity: 2, count: 3 },
  ])
  assert.deepEqual(normalizeTableInventory('nope'), [])
})

test('computeTableOccupancy: two manual bookings with non-overlapping times are counted as using the same table in turn', () => {
  const one: TableType[] = [{ id: 't4', name: '4-seat table', capacity: 4, count: 2 }]
  const r = computeTableOccupancy([
    ev('Party: 4', { start: { dateTime: '2026-10-01T18:00:00+02:00' }, end: { dateTime: '2026-10-01T18:30:00+02:00' } }),
    ev('Party: 4', { start: { dateTime: '2026-10-01T19:30:00+02:00' }, end: { dateTime: '2026-10-01T20:00:00+02:00' } }),
  ], one, Date.parse('2026-10-01T18:00:00+02:00'), Date.parse('2026-10-01T20:00:00+02:00'), TZ)
  assert.equal(r.blocked, false)
  assert.deepEqual(sets(r.occupied), { t4: [1] })
})

test('computeTableOccupancy: a manual booking avoids only explicit tables with overlapping times', () => {
  const one: TableType[] = [{ id: 't4', name: '4-seat table', capacity: 4, count: 2 }]
  const r = computeTableOccupancy([
    ev('Party: 4\nTable: 4-seat table #1 [t4]', { start: { dateTime: '2026-10-01T18:00:00+02:00' }, end: { dateTime: '2026-10-01T18:30:00+02:00' } }),
    ev('Party: 4', { start: { dateTime: '2026-10-01T19:30:00+02:00' }, end: { dateTime: '2026-10-01T20:00:00+02:00' } }),
  ], one, Date.parse('2026-10-01T18:00:00+02:00'), Date.parse('2026-10-01T20:00:00+02:00'), TZ)
  assert.deepEqual(sets(r.occupied), { t4: [1] })
})

test('parseTableAssignment: a line with an id does not attach to another kind by name once that id is gone', () => {
  const recreated: TableType[] = [{ id: 'new', name: '4-seat table', capacity: 4, count: 2 }]
  assert.equal(parseTableAssignment('Table: 4-seat table #1 [old]', recreated), null)
  assert.equal(parseTableAssignment('Table: 4-seat table #1', recreated)?.tableId, 'new')
})

test('normalizeTableInventory: ids unusable in the description line are replaced with a hash so they do not collide', () => {
  const inv = normalizeTableInventory([
    { id: 'patio/a', name: 'A', capacity: 4, count: 1 },
    { id: 'patio?a', name: 'B', capacity: 4, count: 1 },
  ])
  assert.equal(inv.length, 2)
  assert.notEqual(inv[0].id, inv[1].id)
  assert.match(inv[0].id, /^[A-Za-z0-9_-]{1,64}$/)
  assert.equal(normalizeTableInventory([{ id: 'patio/a', name: 'A', capacity: 4, count: 1 }])[0].id, inv[0].id)
})

test('normalizeTableInventory: accepts numeric ids too, and numbers server auto names when they collide', () => {
  const inv = normalizeTableInventory([
    { id: 1, name: '', capacity: 4, count: 1 },
    { id: 'b', name: '  ', capacity: 4, count: 1 },
    { id: 'c', name: '4-seat table 2', capacity: 4, count: 1 },
  ])
  assert.deepEqual(inv.map((t) => [t.id, t.name]), [['1', '4-seat table'], ['b', '4-seat table 3'], ['c', '4-seat table 2']])
})

