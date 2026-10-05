import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  generateOpenSlots, isWithinWorkingHours, findBreakOverlap, wallTimeToUtcMs,
  nearestSlots, answerRequestedTime, MAX_OPEN_SLOTS, REQUESTED_SCAN_MAX,
  requestedMsInWindow, requestedScanWindow, shapeRequestedSlots, mergeSlotsByStart, clampToLastCall,
} from './slot-grid'

const TZ = 'Europe/Zurich'

test('generateOpenSlots: a closing time of 00:00 is read as midnight and creates evening slots', () => {
  const slots = generateOpenSlots({
    searchStart: '2026-10-01T00:00:00+02:00',
    searchEnd: '2026-10-02T00:00:00+02:00',
    timezone: TZ,
    workingHoursStart: '18:00',
    workingHoursEnd: '00:00',
    durationMin: 90,
    intervalMin: 30,
    nowMs: 0,
  })
  assert.equal(slots.length, 10)
  assert.equal(slots[0].start, '2026-10-01T18:00:00+02:00')
  assert.equal(slots[slots.length - 1].start, '2026-10-01T22:30:00+02:00')
})

const within = (start: string, dur: number, ws = '11:00', we = '22:00') =>
  isWithinWorkingHours(start, dur, ws, we, TZ)

test('isWithinWorkingHours: passes if it ends exactly at closing time', () => {
  assert.equal(within('2026-10-01T20:30:00+02:00', 90), true)
})

test('isWithinWorkingHours: rejects going past closing time', () => {
  assert.equal(within('2026-10-01T20:45:00+02:00', 90), false)
  assert.equal(within('2026-10-01T23:00:00+02:00', 90), false)
})

test('isWithinWorkingHours: rejects before opening', () => {
  assert.equal(within('2026-10-01T10:45:00+02:00', 30), false)
})

test('isWithinWorkingHours: a closing time of 00:00 means until midnight', () => {
  assert.equal(within('2026-10-01T22:30:00+02:00', 90, '18:00', '00:00'), true)
  assert.equal(within('2026-10-01T22:45:00+02:00', 90, '18:00', '00:00'), false)
})

test('isWithinWorkingHours: times are read in the calendar timezone (UTC-notated input)', () => {
  assert.equal(within('2026-10-01T18:30:00Z', 90), true)
  assert.equal(within('2026-10-01T18:45:00Z', 90), false)
})

test('isWithinWorkingHours: rejects invalid input', () => {
  assert.equal(within('not-a-date', 30), false)
  assert.equal(within('2026-10-01T12:00:00+02:00', 0), false)
})

test('isWithinWorkingHours: rejects invalid settings (18:00-02:00 crossing midnight, 00:00-00:00) - and 0 slots too', () => {
  assert.equal(within('2026-10-01T03:00:00+02:00', 90, '18:00', '02:00'), false)
  assert.equal(within('2026-10-01T12:00:00+02:00', 90, '00:00', '00:00'), false)
  const slots = generateOpenSlots({
    searchStart: '2026-10-01T00:00:00+02:00', searchEnd: '2026-10-02T00:00:00+02:00', timezone: TZ,
    workingHoursStart: '00:00', workingHoursEnd: '00:00', durationMin: 90, intervalMin: 30, nowMs: 0,
  })
  assert.equal(slots.length, 0)
})

test('isWithinWorkingHours: on the day daylight saving starts (02:00->03:00) the end is taken by actual elapsed time', () => {
  assert.equal(within('2026-03-29T01:30:00+01:00', 90, '00:30', '03:30'), false)
  assert.equal(within('2026-03-29T00:30:00+01:00', 90, '00:30', '03:30'), true)
})

const BREAKS = [{ start: '22:00', end: '00:00', message: 'kitchen closed' }]
test('findBreakOverlap: returns the break if it overlaps a 22:00-00:00 break', () => {
  assert.equal(findBreakOverlap('2026-10-01T21:00:00+02:00', 90, BREAKS, TZ), BREAKS[0])
  assert.equal(findBreakOverlap('2026-10-01T20:30:00+02:00', 90, BREAKS, TZ), null)
})

test('findBreakOverlap: a booking ending at midnight also sees the break', () => {
  const late = [{ start: '23:00', end: '23:30' }]
  assert.deepEqual(findBreakOverlap('2026-10-01T22:30:00+02:00', 90, late, TZ), late[0])
})

test('generateOpenSlots: reads break end 00:00 as midnight and blocks after 22:00', () => {
  const slots = generateOpenSlots({
    searchStart: '2026-10-01T00:00:00+02:00', searchEnd: '2026-10-02T00:00:00+02:00', timezone: TZ,
    workingHoursStart: '18:00', workingHoursEnd: '00:00', durationMin: 90, intervalMin: 30,
    breakTimes: BREAKS, nowMs: 0,
  })
  assert.equal(slots[slots.length - 1].start, '2026-10-01T20:30:00+02:00')
})

test('wallTimeToUtcMs: reads an offset-less local wall time in the calendar timezone', () => {
  assert.equal(wallTimeToUtcMs('2026-10-01T18:00:00.0000000', TZ), Date.parse('2026-10-01T16:00:00Z'))
  assert.equal(wallTimeToUtcMs('2026-10-01T18:00:00Z', TZ), Date.parse('2026-10-01T18:00:00Z'))
  assert.ok(Number.isNaN(wallTimeToUtcMs('', TZ)))
  assert.ok(Number.isNaN(wallTimeToUtcMs('garbage', TZ)))
})

test('isWithinWorkingHours: on the day daylight saving ends (03:00->02:00) the end does not flip to before the start', () => {
  assert.equal(within('2026-10-25T02:45:00+02:00', 30, '02:00', '03:00'), false)
  assert.equal(within('2026-10-25T02:15:00+02:00', 30, '02:00', '03:00'), true)
})

test('wallTimeToUtcMs: also reads fractional seconds', () => {
  assert.equal(wallTimeToUtcMs('2026-10-01T18:00:00.5000000', TZ), Date.parse('2026-10-01T16:00:00.500Z'))
})

test('generateOpenSlots: builds while filtering with accept, and stops when accepted slots fill maxSlots', () => {
  let seen = 0
  const slots = generateOpenSlots<{ start: string }>({
    searchStart: '2026-10-01T00:00:00+02:00', searchEnd: '2026-10-11T00:00:00+02:00', timezone: TZ,
    workingHoursStart: '09:00', workingHoursEnd: '18:00', durationMin: 30, intervalMin: 30, nowMs: 0, maxSlots: 3,
    accept: (s) => { seen++; return s.start.startsWith('2026-10-09') ? { start: s.start } : null },
  })
  assert.deepEqual(slots.map((s) => s.start.slice(0, 16)), ['2026-10-09T09:00', '2026-10-09T09:30', '2026-10-09T10:00'])
  assert.equal(seen, 8 * 18 + 3)
})


const daySlots = (busy: Array<{ start: string; end: string }> = [], maxSlots?: number) =>
  generateOpenSlots({
    searchStart: '2026-10-01T00:00:00+02:00',
    searchEnd: '2026-10-02T00:00:00+02:00',
    timezone: TZ,
    workingHoursStart: '11:00',
    workingHoursEnd: '22:00',
    durationMin: 90,
    intervalMin: 15,
    busy,
    nowMs: 0,
    maxSlots: maxSlots ?? REQUESTED_SCAN_MAX,
  })

test('answerRequestedTime: judging by a list truncated to 30 would say \'not possible\' for a possible time - judge on the whole window', () => {
  const capped = daySlots([], MAX_OPEN_SLOTS)
  const full = daySlots([], REQUESTED_SCAN_MAX)
  assert.equal(capped.length, 30)
  assert.equal(full.length, 39)
  assert.equal(answerRequestedTime(capped, '2026-10-01T20:00:00+02:00').available, false, '잘린 목록 = 오판(이것을 막으려는 것)')
  assert.equal(answerRequestedTime(full, '2026-10-01T20:00:00+02:00').available, true)
})

test('answerRequestedTime: if possible, the alternatives are empty', () => {
  const r = answerRequestedTime(daySlots(), '2026-10-01T20:00:00+02:00')
  assert.deepEqual(r, { requested: '2026-10-01T20:00:00+02:00', available: true, alternatives: [] })
})

test('answerRequestedTime: if not possible, the three nearest - not the three earliest, in time order', () => {
  const busy = [{ start: '2026-10-01T19:30:00+02:00', end: '2026-10-01T21:00:00+02:00' }]
  const r = answerRequestedTime(daySlots(busy), '2026-10-01T20:00:00+02:00')
  assert.equal(r.available, false)
  assert.deepEqual(r.alternatives, [
    '2026-10-01T17:30:00+02:00',
    '2026-10-01T17:45:00+02:00',
    '2026-10-01T18:00:00+02:00',
  ])
})

test('answerRequestedTime: a time that does not fit the grid (20:10) is \'not possible\' plus the nearest ones on either side', () => {
  const r = answerRequestedTime(daySlots(), '2026-10-01T20:10:00+02:00')
  assert.equal(r.available, false)
  assert.deepEqual(r.alternatives, [
    '2026-10-01T20:00:00+02:00',
    '2026-10-01T20:15:00+02:00',
    '2026-10-01T20:30:00+02:00',
  ])
})

test('answerRequestedTime: the same instant written with a different offset is the same time', () => {
  assert.equal(answerRequestedTime(daySlots(), '2026-10-01T18:00:00Z').available, true)  // = 20:00+02:00
})

test('answerRequestedTime: empty list or broken time - does not throw, \'not possible\', no alternatives', () => {
  assert.deepEqual(answerRequestedTime([], '2026-10-01T20:00:00+02:00').alternatives, [])
  const bad = answerRequestedTime(daySlots(), 'not-a-date')
  assert.equal(bad.available, false)
  assert.deepEqual(bad.alternatives, [])
})

test('nearestSlots: ties go to the earlier one, returned in time order; empty array when max is 0', () => {
  const slots = daySlots()
  const target = new Date('2026-10-01T15:07:30+02:00').getTime()
  assert.deepEqual(nearestSlots(slots, target, 1).map((s) => s.start), ['2026-10-01T15:00:00+02:00'])
  assert.deepEqual(nearestSlots(slots, target, 2).map((s) => s.start), [
    '2026-10-01T15:00:00+02:00',
    '2026-10-01T15:15:00+02:00',
  ])
  assert.deepEqual(nearestSlots(slots, target, 0), [])
})

test('requestedScanWindow: judges a requested time late in a long window (4 weeks, 5-minute interval) - collecting from the start of the window hits the cap', () => {
  const start = '2026-10-01T00:00:00+02:00'
  const end = '2026-10-29T00:00:00+01:00'
  const req = '2026-10-26T20:00:00+01:00'
  const base = { timezone: TZ, workingHoursStart: '00:00', workingHoursEnd: '23:55', durationMin: 5, intervalMin: 5, nowMs: 0 }
  const fromStart = generateOpenSlots({ ...base, searchStart: start, searchEnd: end, maxSlots: REQUESTED_SCAN_MAX })
  assert.equal(fromStart.length, REQUESTED_SCAN_MAX)
  assert.equal(answerRequestedTime(fromStart, req).available, false)
  const ms = requestedMsInWindow(req, start, end)!
  const scan = requestedScanWindow(ms, start, end)
  const around = generateOpenSlots({ ...base, searchStart: scan.start, searchEnd: scan.end, maxSlots: REQUESTED_SCAN_MAX })
  assert.ok(around.length < REQUESTED_SCAN_MAX)
  assert.equal(answerRequestedTime(around, req).available, true)
})

test('requestedScanWindow: does not cross the window boundary; requestedMsInWindow is [start, end)', () => {
  const start = '2026-10-01T17:00:00+02:00'
  const end = '2026-10-01T22:30:00+02:00'
  const ms = requestedMsInWindow('2026-10-01T20:00:00+02:00', start, end)!
  const w = requestedScanWindow(ms, start, end)
  assert.equal(new Date(w.start).getTime(), new Date(start).getTime())
  assert.equal(new Date(w.end).getTime(), new Date(end).getTime())
  assert.equal(requestedMsInWindow(start, start, end), new Date(start).getTime())
  assert.equal(requestedMsInWindow(end, start, end), null, '끝 시각은 창 밖')
  assert.equal(requestedMsInWindow(null, start, end), null)
  assert.equal(requestedMsInWindow('garbage', start, end), null)
})

test('shapeRequestedSlots: with no requested time, as before (no field); outside the window it does not judge, only displays', () => {
  const slots = daySlots()
  assert.deepEqual(shapeRequestedSlots(slots, null, null), { openSlots: slots, fields: {} })
  const out = shapeRequestedSlots(slots, '2026-10-05T20:00:00+02:00', null)
  assert.deepEqual(out.fields.requestedTime, { requested: '2026-10-05T20:00:00+02:00', outsideSearchWindow: true })
  assert.equal(out.openSlots, slots)
})

test('shapeRequestedSlots: if the 36 hours before and after are all blocked (holidays), the earliest one later in the window becomes the alternative - not just leaving \'not possible\'', () => {
  const later = [
    { start: '2026-10-04T11:30:00+02:00' },
    { start: '2026-10-04T11:45:00+02:00' },
    { start: '2026-10-04T12:00:00+02:00' },
    { start: '2026-10-04T12:15:00+02:00' },
  ]
  const req = '2026-10-01T20:00:00+02:00'
  const out = shapeRequestedSlots([], req, new Date(req).getTime(), later)
  assert.deepEqual(out.fields.requestedTime, {
    requested: req,
    available: false,
    alternatives: ['2026-10-04T11:30:00+02:00', '2026-10-04T11:45:00+02:00', '2026-10-04T12:00:00+02:00'],
  })
  assert.deepEqual(out.openSlots, later, '대안이 openSlots 안에 있어야 예약할 수 있다')
})

test('slot straddling the boundary - splitting the collection at scan.end drops 19:30 to 21:00 from both; collecting again from scan.start includes it', () => {
  const base = { timezone: TZ, workingHoursStart: '11:00', workingHoursEnd: '00:00', durationMin: 90, intervalMin: 30, nowMs: 0 }
  const start = '2026-10-01T00:00:00+02:00'
  const req = '2026-10-01T08:15:00+02:00'
  const end = '2026-10-05T00:00:00+02:00'
  const busy = [{ start: '2026-09-30T00:00:00+02:00', end: '2026-10-02T19:30:00+02:00' }]
  const ms = requestedMsInWindow(req, start, end)!
  const scan = requestedScanWindow(ms, start, end)
  assert.equal(new Date(scan.end).getTime(), new Date('2026-10-02T20:15:00+02:00').getTime())
  const inScan = generateOpenSlots({ ...base, busy, searchStart: scan.start, searchEnd: scan.end, maxSlots: REQUESTED_SCAN_MAX })
  assert.equal(inScan.length, 0, '19:30~21:00 은 끝이 경계를 넘어 스캔 안에서 빠진다')
  const split = generateOpenSlots({ ...base, busy, searchStart: scan.end, searchEnd: end, maxSlots: MAX_OPEN_SLOTS })
  assert.equal(split[0].start, '2026-10-02T20:30:00+02:00', '경계부터 모으면 19:30 은 시작이 경계 앞이라 또 빠진다')
  const later = generateOpenSlots({ ...base, busy, searchStart: scan.start, searchEnd: end, maxSlots: MAX_OPEN_SLOTS })
  assert.equal(later[0].start, '2026-10-02T19:30:00+02:00')
})

test('shapeRequestedSlots: gives alternatives even if free slots exist only earlier than 36 hours away - nearest first, in time order', () => {
  const req = '2026-10-09T20:00:00+02:00'
  const earlier = [
    { start: '2026-10-05T12:00:00+02:00' },
    { start: '2026-10-06T12:00:00+02:00' },
    { start: '2026-10-07T12:00:00+02:00' },
    { start: '2026-10-07T19:00:00+02:00' },
  ]
  const out = shapeRequestedSlots([], req, new Date(req).getTime(), earlier)
  assert.deepEqual((out.fields.requestedTime as any).alternatives, [
    '2026-10-06T12:00:00+02:00',
    '2026-10-07T12:00:00+02:00',
    '2026-10-07T19:00:00+02:00',
  ])
  assert.equal((out.fields.requestedTime as any).available, false)
})

test('shapeRequestedSlots: even with only one within 36 hours, the three nearest in the whole window - judged with the pool passed in', () => {
  const req = '2026-10-10T20:00:00+02:00'
  const inScan = [{ start: '2026-10-09T09:00:00+02:00' }]
  const pool = mergeSlotsByStart(
    [{ start: '2026-10-08T12:00:00+02:00' }, ...inScan],
    inScan,
    [...inScan, { start: '2026-10-12T08:10:00+02:00' }, { start: '2026-10-12T08:20:00+02:00' }],
  )
  assert.equal(pool.length, 4, '겹친 것은 한 번만')
  const out = shapeRequestedSlots(inScan, req, new Date(req).getTime(), pool)
  assert.deepEqual((out.fields.requestedTime as any).alternatives, [
    '2026-10-09T09:00:00+02:00',
    '2026-10-12T08:10:00+02:00',
    '2026-10-12T08:20:00+02:00',
  ])
})

test('mergeSlotsByStart: the same instant only once (even with different offsets); in time order; broken times are dropped', () => {
  const merged = mergeSlotsByStart(
    [{ start: '2026-10-01T20:00:00+02:00' }, { start: 'bad' }],
    [{ start: '2026-10-01T18:00:00Z' }, { start: '2026-10-01T12:00:00+02:00' }],
  )
  assert.deepEqual(merged.map((m) => m.start), ['2026-10-01T12:00:00+02:00', '2026-10-01T20:00:00+02:00'])
})

{
  const base = {
    searchStart: '2026-10-05T00:00:00+02:00',
    searchEnd: '2026-10-06T00:00:00+02:00',
    timezone: 'Europe/Zurich',
    workingHoursStart: '11:45',
    workingHoursEnd: '22:00',
    durationMin: 90,
    intervalMin: 15,
    breakTimes: [{ start: '14:00', end: '17:30' }],
    maxSlots: 200,
    nowMs: Date.parse('2026-10-01T00:00:00Z'),
  }
  const hhmm = (iso: string) => iso.slice(11, 16)

  test('last booking off: the whole 90-minute meal must fit - evening last 20:30, lunch last 12:30', () => {
    const slots = generateOpenSlots(base)
    assert.equal(hhmm(slots[slots.length - 1].start), '20:30')
    assert.ok(!slots.some((s) => hhmm(s.start) === '13:00'))
    assert.ok(slots.some((s) => hhmm(s.start) === '12:30'))
  })

  test('only 30 minutes before closing on: evening until 21:30 (cut at 22:00); lunch as before 12:30', () => {
    const slots = generateOpenSlots({ ...base, lastCallMin: 30 })
    const last = slots[slots.length - 1]
    assert.equal(hhmm(last.start), '21:30')
    assert.equal(hhmm(last.end), '22:00')
    assert.equal(hhmm(slots.find((s) => hhmm(s.start) === '20:45')!.end), '22:00')
    assert.equal(hhmm(slots.find((s) => hhmm(s.start) === '19:00')!.end), '20:30')
    const lunchLast = slots.filter((s) => hhmm(s.start) < '14:00').pop()!
    assert.equal(hhmm(lunchLast.start), '12:30')
    assert.equal(hhmm(lunchLast.end), '14:00')
  })

  test('before-break and before-closing separately: lunch 15 minutes before (until 13:45, 14:00); evening 60 minutes before (21:00)', () => {
    const slots = generateOpenSlots({ ...base, lastCallMin: 60, lastCallBreakMin: 15 })
    const lunchLast = slots.filter((s) => hhmm(s.start) < '14:00').pop()!
    assert.equal(hhmm(lunchLast.start), '13:45')
    assert.equal(hhmm(lunchLast.end), '14:00')
    assert.equal(hhmm(slots[slots.length - 1].start), '21:00')
    assert.ok(!slots.some((s) => hhmm(s.start) >= '14:00' && hhmm(s.start) < '17:30'))
  })

  test('only before-break on: lunch until 13:30, evening as before 20:30', () => {
    const slots = generateOpenSlots({ ...base, lastCallBreakMin: 30 })
    assert.equal(hhmm(slots.filter((s) => hhmm(s.start) < '14:00').pop()!.start), '13:30')
    assert.equal(hhmm(slots[slots.length - 1].start), '20:30')
  })

  test('booking/change guard clampToLastCall - same rule', () => {
    const g = { workingHoursStart: '11:45', workingHoursEnd: '22:00', breakTimes: [{ start: '14:00', end: '17:30' }], timezone: 'Europe/Zurich' }
    assert.deepEqual(clampToLastCall({ ...g, startIso: '2026-10-05T21:30:00+02:00', durationMin: 90, lastCallMin: 30 }), { ok: true, durationMin: 30 })
    assert.deepEqual(clampToLastCall({ ...g, startIso: '2026-10-05T21:45:00+02:00', durationMin: 90, lastCallMin: 30 }), { ok: false })
    assert.deepEqual(clampToLastCall({ ...g, startIso: '2026-10-05T19:00:00+02:00', durationMin: 90, lastCallMin: 30 }), { ok: true, durationMin: 90 })
    assert.deepEqual(clampToLastCall({ ...g, startIso: '2026-10-05T13:30:00+02:00', durationMin: 90, lastCallMin: 30 }), { ok: true, durationMin: 90 })
    assert.deepEqual(clampToLastCall({ ...g, startIso: '2026-10-05T13:30:00+02:00', durationMin: 90, lastCallBreakMin: 30 }), { ok: true, durationMin: 30 })
    assert.deepEqual(clampToLastCall({ ...g, startIso: '2026-10-05T13:45:00+02:00', durationMin: 90, lastCallBreakMin: 30 }), { ok: false })
    assert.deepEqual(clampToLastCall({ ...g, startIso: '2026-10-05T21:45:00+02:00', durationMin: 90 }), { ok: true, durationMin: 90 })
  })
}
