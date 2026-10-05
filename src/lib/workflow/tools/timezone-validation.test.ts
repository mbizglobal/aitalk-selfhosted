import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { validateOffsetMatchesCalendar, SILENT_RETRY_NOTE } from './timezone-validation'

test('\'a correct timezone passes (summer +02:00, winter +01:00)\'', () => {
  assert.equal(validateOffsetMatchesCalendar('2026-09-24T20:00:00+02:00', 'Europe/Zurich').ok, true)
  assert.equal(validateOffsetMatchesCalendar('2026-12-24T20:00:00+01:00', 'Europe/Zurich').ok, true)
})

test('\'if only the timezone notation is wrong - do not tell the customer, write to call again right away\'', () => {
  const cases = [
    validateOffsetMatchesCalendar('2026-09-24T20:00:00+09:00', 'Europe/Zurich'),
    validateOffsetMatchesCalendar('2026-09-24T20:00:00', 'Europe/Zurich'),
  ]
  for (const v of cases) {
    assert.equal(v.ok, false)
    assert.ok(v.refusalMessage?.endsWith(SILENT_RETRY_NOTE), v.refusalMessage)
  }
  const broken = validateOffsetMatchesCalendar('not-a-dateZ', 'Europe/Zurich')
  assert.equal(broken.ok, false)
  assert.ok(!broken.refusalMessage?.includes(SILENT_RETRY_NOTE))
  assert.match(SILENT_RETRY_NOTE, /do NOT mention it/)
  assert.match(cases[0].refusalMessage!, /requires "\+02:00"/)
})

test('\'wiring: both calendar tools return the refusal text to the model as is\'', () => {
  for (const f of ['microsoft-calendar-tool.ts', 'google-calendar-tool.ts']) {
    const src = fs.readFileSync(path.join(__dirname, f), 'utf8')
    const n = (src.match(/error: 'wrong_timezone_offset'/g) || []).length
    const withMsg = (src.match(/error: 'wrong_timezone_offset',[\s\S]{0,300}?message: (v|tzCheck)\.refusalMessage/g) || []).length
    assert.ok(n >= 3, `${f} 거절 자리 ${n}`)
    assert.equal(withMsg, n, `${f} — 거절 문구를 싣지 않는 자리가 있다`)
  }
})
