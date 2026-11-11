import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RepeatFailGuard, failReason } from './work-app-tool'

const err = (e: string) => JSON.stringify({ error: e })

test('failure reason - error code + stop code - same reason when field names change - success is null', () => {
  assert.equal(failReason(err('MODULE_STOPPED: recipe_invalid {"key":"amount"} — recipe: amount must be an object')), 'MODULE_STOPPED: recipe_invalid')
  assert.equal(failReason(err('MODULE_STOPPED: recipe_invalid {"key":"date"} — recipe: date.format must be one of')), 'MODULE_STOPPED: recipe_invalid')
  assert.equal(failReason(err('INVALID: month must be YYYY-MM')), 'INVALID: month')
  assert.equal(failReason(JSON.stringify({ ok: true })), null)
  assert.equal(failReason('not json'), null)
  assert.equal(failReason(JSON.stringify({ error: '' })), null)
})

test('the third identical failure = stop notice - the fourth = not run - other tools unchanged', async () => {
  const g = new RepeatFailGuard()
  let calls = 0
  const fail = () => { calls++; return Promise.resolve(err('MODULE_STOPPED: recipe_invalid — x')) }
  await g.run('ledger_plan_file', fail)
  await g.run('ledger_plan_file', fail)
  const third = JSON.parse(await g.run('ledger_plan_file', fail))
  assert.ok(String(third.stopped).includes('3 times'))
  const fourth = JSON.parse(await g.run('ledger_plan_file', fail))
  assert.ok(String(fourth.error).includes('will not run again'))
  assert.equal(calls, 3)
  assert.equal(await g.run('work_overview', () => Promise.resolve('{"ok":true}')), '{"ok":true}')
})

test('concurrent calls are counted - exceptions count as failures', async () => {
  const g = new RepeatFailGuard()
  const fail = () => new Promise<string>((r) => setTimeout(() => r(err('MODULE_STOPPED: recipe_invalid')), 5))
  await Promise.all([g.run('p', fail), g.run('p', fail), g.run('p', fail)])
  assert.ok(String(JSON.parse(await g.run('p', fail)).error).includes('will not run again'))
  const g2 = new RepeatFailGuard()
  for (let i = 0; i < 3; i++) await g2.run('x', () => Promise.reject(new Error('boom'))).catch(() => {})
  const g3 = new RepeatFailGuard()
  await g3.run('y', () => Promise.reject(Object.assign(new Error('a'), { code: 'A' }))).catch(() => {})
  await g3.run('y', () => Promise.reject(Object.assign(new Error('b'), { code: 'B' }))).catch(() => {})
  await g3.run('y', () => Promise.reject(Object.assign(new Error('a'), { code: 'A' }))).catch(() => {})
  assert.equal(await g3.run('y', () => Promise.resolve('{"ok":true}')), '{"ok":true}')
  assert.ok(String(JSON.parse(await g2.run('x', () => Promise.resolve('{"ok":true}'))).error).includes('will not run again'))
})

test('a different reason or a success in between restarts the count', async () => {
  const g = new RepeatFailGuard()
  let calls = 0
  const out = (e: string | null) => () => { calls++; return Promise.resolve(e ? err(e) : '{"ok":true}') }
  await g.run('t', out('MODULE_STOPPED: recipe_invalid'))
  await g.run('t', out('MODULE_STOPPED: recipe_invalid'))
  await g.run('t', out(null))
  await g.run('t', out('MODULE_STOPPED: recipe_invalid'))
  await g.run('t', out('INVALID: month'))
  const r = JSON.parse(await g.run('t', out('MODULE_STOPPED: recipe_invalid')))
  assert.equal(r.stopped, undefined)
  assert.equal(calls, 6)
})
