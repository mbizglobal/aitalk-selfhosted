import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateSpec, type AppSpec, type SpecCheckLimit, type SpecCheckOverlap, type SpecTable } from './assembled'
import { amountOf, checkTouched, DEC0, decAdd, decText, isCounted, limitBroken, limitGroup, normValue, overlapSpan, spansOverlap } from './assembled-checks'
import { describeSpecChange } from './assembled-change'
import { decimalOf } from './assembled'

const bookings = (checks: unknown[], extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  spec: 1, name: 'Salon',
  tables: [{
    key: 'bookings', name: 'Bookings',
    columns: [
      { key: 'who', label: 'Who', kind: 'text' },
      { key: 'day', label: 'Day', kind: 'date' },
      { key: 'until', label: 'Until', kind: 'date' },
      { key: 'from', label: 'From', kind: 'time' },
      { key: 'to', label: 'To', kind: 'time' },
      { key: 'staff', label: 'Staff', kind: 'person' },
      { key: 'room', label: 'Room', kind: 'choice', options: ['A', 'B'] },
      { key: 'qty', label: 'Qty', kind: 'number' },
      { key: 'price', label: 'Price', kind: 'money' },
      { key: 'gone', label: 'Gone', kind: 'text', hidden: true },
    ],
    status: { values: ['asked', 'booked', 'cancelled'], start: 'asked', moves: [['asked', 'booked'], ['booked', 'cancelled'], ['cancelled', 'booked']] },
    checks,
    ...extra,
  }],
})
const ok = (raw: unknown): AppSpec => { const r = validateSpec(raw); if (!r.ok) assert.fail(JSON.stringify(r.issues)); return r.spec }
const codes = (raw: unknown): string[] => { const r = validateSpec(raw); return r.ok ? [] : r.issues.map((x) => x.code) }
const slot = { key: 'slot', label: 'Staff free', kind: 'no_overlap', start: 'day', startTime: 'from', endTime: 'to', by: 'staff' }
const range = { key: 'rent', label: 'Room free', kind: 'no_overlap', start: 'day', end: 'until', by: 'room' }
const stock = { key: 'stock', label: 'Not below 0', kind: 'limit', column: 'qty', by: 'room', min: 0 }

test('validator — three passing shapes · block list', () => {
  const s = ok(bookings([slot, range, stock, { key: 'len', label: 'Fixed', kind: 'no_overlap', start: 'day', startTime: 'from', minutes: 60 }, { key: 'cap', label: 'Cap', kind: 'limit', column: 'qty', by: 'status', max: 10, when: { status: ['booked'] } }]))
  assert.equal(s.tables[0].checks?.length, 5)
})

test('validator — wrong ones', () => {
  const one = (c: Record<string, unknown>, extra?: Record<string, unknown>) => codes(bookings([c], extra))
  assert.ok(one({ ...slot, start: 'who' }).includes('BAD_REF'), '날짜 칸 아님')
  assert.ok(one({ ...slot, start: 'gone' }).includes('BAD_REF'), '숨긴 칸')
  assert.ok(one({ ...slot, endTime: undefined }).includes('REQUIRED'), 'endTime · minutes 둘 다 없음')
  assert.ok(one({ ...slot, minutes: 30 }).includes('REQUIRED'), 'endTime · minutes 둘 다')
  assert.ok(one({ ...slot, endTime: undefined, minutes: 0 }).includes('INVALID'), 'minutes 0')
  assert.ok(one({ ...slot, endTime: undefined, minutes: 1441 }).includes('INVALID'), 'minutes 1441')
  assert.ok(one({ ...slot, endTime: undefined, minutes: 1.5 }).includes('INVALID'), 'minutes 소수')
  assert.ok(one({ ...slot, end: 'until' }).includes('INVALID'), '시간대 + end')
  assert.ok(one({ key: 'x', label: 'X', kind: 'no_overlap', start: 'day', endTime: 'to' }).includes('REQUIRED'), 'endTime 만')
  assert.ok(one({ ...range, by: 'qty' }).includes('BAD_REF'), 'by = 숫자 칸')
  assert.ok(one({ ...stock, column: 'price' }).includes('BAD_REF'), '금액 칸 X')
  assert.ok(one({ ...stock, min: undefined }).includes('REQUIRED'), 'min · max 없음')
  assert.ok(one({ ...stock, min: 5, max: 1 }).includes('INVALID'), 'min > max')
  assert.ok(one({ ...stock, min: 0.1234567 }).includes('INVALID'), '소수 7 자리')
  assert.ok(one({ ...stock, when: { status: ['nope'] } }).includes('INVALID'), '없는 상태')
  assert.ok(one({ ...slot, kind: 'free' }).includes('INVALID'), '모르는 kind')
  assert.ok(one({ ...slot, extra: 1 }).includes('UNKNOWN_FIELD'))
  assert.ok(codes(bookings([slot, slot])).includes('DUPLICATE'))
  assert.ok(codes(bookings([1, 2, 3, 4, 5, 6])).includes('INVALID'), '6 개째')
  const intake = { intake: { columns: ['who', 'day', 'from', 'to', 'qty', 'room'] } }
  const roomSlot = { ...slot, by: 'room' }
  assert.ok(one({ ...roomSlot, when: { status: ['booked'] } }, intake).includes('INVALID'), '접수 표 — when 에 시작 상태 없음')
  assert.deepEqual(one({ ...roomSlot, when: { status: ['asked', 'booked'] } }, intake), [])
  assert.ok(one({ ...stock }, intake).includes('INVALID'), '접수 칸에 한도')
  assert.ok(one({ ...slot, when: { status: ['asked', 'booked'] } }, { intake: { columns: ['who', 'day', 'from', 'to'] } }).includes('INVALID'), '접수 표 — 대상 칸(staff)이 접수 칸 밖')
  assert.ok(one({ ...stock, min: 1 }).includes('INVALID'), 'min > 0')
  assert.ok(one({ ...stock, min: undefined, max: -1 }).includes('INVALID'), 'max < 0')
  const r = bookings([{ ...stock, when: { status: ['booked'] } }]) as { tables: Array<Record<string, unknown>> }
  delete r.tables[0].status
  assert.ok(codes(r).includes('INVALID'))
})

test('validator — hiding a column a rule uses is refused · removing the rule in the same change passes', () => {
  const hide = (checks: unknown[]) => { const r = bookings(checks) as { tables: Array<{ columns: Array<Record<string, unknown>> }> }; r.tables[0].columns[3].hidden = true; return codes(r) }
  assert.ok(hide([slot]).includes('BAD_REF'))
  assert.deepEqual(hide([]), [])
})

test('change list — added · changed · removed', () => {
  const a = ok(bookings([slot]))
  const b = ok(bookings([{ ...slot, label: 'Staff free!' }, stock]))
  const ch = describeSpecChange(a, b).map((x) => `${x.code}:${x.name}`)
  assert.ok(ch.includes('check_changed:Staff free!') && ch.includes('check_added:Not below 0'))
  assert.ok(describeSpecChange(b, ok(bookings([]))).some((x) => x.code === 'check_removed'))
})

const T = (): SpecTable => ok(bookings([])).tables[0]
const S = (x: Record<string, unknown>) => x as unknown as SpecCheckOverlap
const L = (x: Record<string, unknown>) => x as unknown as SpecCheckLimit

test('period — time slots · end = start does not overlap · date ranges include the end day', () => {
  const a = overlapSpan(S(slot), { day: '2026-11-12', from: '13:00', to: '14:00' }, true)!
  const b = overlapSpan(S(slot), { day: '2026-11-12', from: '14:00', to: '15:00' }, true)!
  const c = overlapSpan(S(slot), { day: '2026-11-12', from: '13:30', to: '13:45' }, true)!
  const d = overlapSpan(S(slot), { day: '2026-11-13', from: '13:00', to: '14:00' }, true)!
  assert.equal(spansOverlap(a, b), false)
  assert.equal(spansOverlap(a, c), true)
  assert.equal(spansOverlap(a, d), false, '다른 날')
  const r1 = overlapSpan(S(range), { day: '2026-11-03', until: '2026-11-05' }, true)!
  const r2 = overlapSpan(S(range), { day: '2026-11-05', until: '2026-11-07' }, true)!
  const r3 = overlapSpan(S(range), { day: '2026-11-06' }, true)!
  assert.equal(spansOverlap(r1, r2), true, '끝 날 = 시작 날 = 겹침(오너 결정 2)')
  assert.equal(spansOverlap(r1, r3), false)
  assert.equal(spansOverlap(r2, r3), true, 'end 없음 = 그날 하루')
  const m = S({ ...slot, endTime: undefined, minutes: 60 })
  assert.deepEqual(overlapSpan(m, { day: '2026-11-12', from: '23:00' }, true)?.b, 1440, '23:00 + 60 = 24:00 은 된다')
})

test('period — rows of this write are refused · other rows are left out of the count', () => {
  const bad = [
    { day: '2026-11-12', from: '13:00' },
    { from: '13:00', to: '14:00' },
    { day: '2026-11-12', from: '14:00', to: '14:00' },
    { day: '2026-11-12', from: '15:00', to: '14:00' },
  ]
  for (const row of bad) {
    assert.throws(() => overlapSpan(S(slot), row, true), /INVALID/, JSON.stringify(row))
    assert.equal(overlapSpan(S(slot), row, false), null)
  }
  assert.throws(() => overlapSpan(S({ ...slot, endTime: undefined, minutes: 60 }), { day: '2026-11-12', from: '23:30' }, true), /midnight/)
  assert.throws(() => overlapSpan(S(range), { until: '2026-11-05' }, true), /start date/)
  assert.throws(() => overlapSpan(S(range), { day: '2026-11-05', until: '2026-11-04' }, true), /before/)
  assert.equal(overlapSpan(S(slot), {}, true), null, '다 비면 셈에서 빠짐')
})

test('normalized values · when · changes', () => {
  const t = T()
  assert.equal(normValue(t, 'staff', ' Ada@X.ch '), 'ada@x.ch')
  assert.equal(normValue(t, 'status', ''), 'asked')
  assert.equal(normValue(t, 'room', ''), null)
  const w = S({ ...slot, when: { status: ['asked', 'booked'] } })
  assert.equal(isCounted(t, w, {}), true, '빈 상태 = 시작 값')
  assert.equal(isCounted(t, w, { status: 'cancelled' }), false)
  assert.equal(checkTouched(t, w, { staff: 'Ada@x.ch', note: 1 }, { staff: 'ada@x.ch', note: 2 }), false, '대문자 → 소문자는 안 바뀜')
  assert.equal(checkTouched(t, w, { status: 'cancelled' }, { status: 'booked' }), true)
  assert.equal(checkTouched(t, w, {}, { status: 'asked' }), false, '빈 상태 → 시작 값은 안 바뀜')
})

test('limit — groups · totals · min and max separately · exact decimals', () => {
  const t = T()
  const c = L({ ...stock, max: 100 })
  assert.equal(limitGroup(t, c, {}), '', '빈 묶음 = 하나(화면 합계와 같다)')
  assert.equal(limitGroup(t, L({ ...stock, by: undefined }), { room: 'A' }), 'all')
  assert.equal(decText(amountOf(c, {})), '0')
  const d = (x: number | string) => decimalOf(x)!
  assert.equal(limitBroken(c, d(30), d(-20)), 'min')
  assert.equal(limitBroken(c, d(-5), d(-2)), null, '나아지면 된다')
  assert.equal(limitBroken(c, d(-5), d(-6)), 'min')
  assert.equal(limitBroken(c, d(-1), d(101)), 'max', '하한 밖에서 한 번에 상한을 넘김')
  assert.equal(limitBroken(c, d(5), d(5)), null)
  const z = [d('0.3'), d('-0.1'), d('-0.2')].reduce(decAdd, DEC0)
  assert.equal(decText(z), '0')
  assert.equal(limitBroken(c, d(1), z), null, '0.3 − 0.1 − 0.2 = 0 은 0 아래가 아니다')
  assert.equal(decText(d('-20.50')), '-20.5')
})
