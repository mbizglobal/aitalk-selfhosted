import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { calendarTodayLine } from './today-line'

test('today, tomorrow and weekday based on the calendar time zone', () => {
  const line = calendarTodayLine('Europe/Zurich', new Date('2026-09-23T22:30:00Z'))
  assert.match(line, /Today is Thursday 2026-09-24 and tomorrow is Friday 2026-09-25 \(calendar timezone Europe\/Zurich\)/)
  assert.match(line, /never ask them for the date number/)
})

test('tomorrow is one day later at month end, year end and the day daylight saving ends', () => {
  assert.match(calendarTodayLine('Europe/Zurich', new Date('2026-12-31T12:00:00Z')), /Today is Thursday 2026-12-31 and tomorrow is Friday 2027-01-01/)
  assert.match(calendarTodayLine('Europe/Zurich', new Date('2026-10-24T12:00:00Z')), /Today is Saturday 2026-10-24 and tomorrow is Sunday 2026-10-25/)
  assert.match(calendarTodayLine('Asia/Seoul', new Date('2026-02-28T20:00:00Z')), /Today is Sunday 2026-03-01 and tomorrow is Monday 2026-03-02/)
})

test('an empty or invalid time zone returns an empty string without throwing', () => {
  assert.equal(calendarTodayLine(''), '')
  assert.equal(calendarTodayLine('Not/AZone'), '')
})

test('tomorrow is one day later even at UTC+14', () => {
  assert.match(calendarTodayLine('Pacific/Kiritimati', new Date('2026-09-23T12:00:00Z')), /Today is Thursday 2026-09-24 and tomorrow is Friday 2026-09-25/)
})

test('wiring: appended to the end of the availability lookup description of both calendar tools', () => {
  for (const f of ['microsoft-calendar-tool.ts', 'google-calendar-tool.ts']) {
    const src = fs.readFileSync(path.join(__dirname, '../workflow/tools', f), 'utf8')
    const i = src.indexOf('description: `Check available time slots')
    const j = src.indexOf('parameters: {', i)
    assert.ok(i > 0 && src.slice(i, j).includes('${calendarTodayLine(this.timezone)}`'), f)
  }
})
