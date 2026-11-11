import { test } from 'node:test'
import { cloudOnly } from '@/lib/work/cloud-apps-for-tests'
import assert from 'node:assert/strict'
import { doneRunGraph, handoffCycle, handoffRoutesOf, HANDOFF_NODE, EVENT_START_ID } from './app-canvas'
import { handoffFieldsProblem, senderPeriodsWithin, acceptsHandoff, HANDOFF_TEMPLATE_ID } from './handoff-core'
import { periodContaining } from './dates'
import { validateWorkflowJson } from '@/lib/workflow/validation'
import { vatHandoffExport } from '@/work-apps/vat/app-template'

const app = (id: string) => ({ id, type: 'custom', data: { label: `App ${id}`, nodeType: 'workApp' } })
const start = { id: 's', type: 'custom', data: { label: 'Start / App', nodeType: 'start', triggerType: 'app' } }
const mail = (id: string) => ({ id, type: 'custom', data: { label: 'Mail', nodeType: 'sendgrid', toEmail: 'a@example.com', fromEmail: 'b@example.com', subject: 'x', bodyTemplate: 'y', connectionId: 'c1' } })
const iff = (id: string) => ({ id, type: 'custom', data: { label: 'If', nodeType: 'ifElse', conditions: [{ id: 'c1', type: 'if', expression: '{{context.handoff.fields.box500}} > 0' }, { id: 'c2', type: 'else' }] } })
const e = (source: string, target: string, sourceHandle?: string) => ({ id: `${source}-${sourceHandle ?? 'x'}-${target}`, source, target, ...(sourceHandle ? { sourceHandle } : {}) })
const placed = (...ids: string[]) => ids.map((id) => e('s', id))
const end = (id: string) => ({ id, type: 'custom', data: { label: 'End', nodeType: 'end' } })

const three = () => ({
  nodes: [start, app('vch'), app('ych'), app('vuk'), app('yuk'), app('grp'), mail('m'), end('z')],
  edges: [
    ...placed('vch', 'ych', 'vuk', 'yuk', 'grp'),
    e('vch', 'ych', 'done'), e('vuk', 'yuk', 'done'), e('ych', 'grp', 'done'), e('yuk', 'grp', 'done'),
    e('grp', 'm', 'done'), e('m', 'z'),
  ],
})

test('route extraction - from done to an app node - stops at the receiving app - through middle nodes - one route even when joined', () => {
  const g = three()
  const { routes, problems } = handoffRoutesOf(g)
  assert.deepEqual(problems, [])
  assert.deepEqual(routes.map((r) => `${r.fromNodeId}>${r.toNodeId}`).sort(), ['vch>ych', 'vuk>yuk', 'ych>grp', 'yuk>grp'])
  const g2 = { nodes: [start, app('a'), app('b'), iff('i'), mail('m1')], edges: [...placed('a', 'b'), e('a', 'i', 'done'), e('i', 'b', 'c1'), e('i', 'm1', 'c2'), e('m1', 'b')] }
  assert.deepEqual(handoffRoutesOf(g2).routes, [{ fromNodeId: 'a', toNodeId: 'b' }])
  assert.equal(handoffRoutesOf(g2).routes.some((r) => r.fromNodeId === 'b'), false)
})

test('loops and self - caught as problems', () => {
  const self = { nodes: [start, app('a'), mail('m')], edges: [...placed('a'), e('a', 'm', 'done'), e('m', 'a')] }
  assert.match(handoffRoutesOf(self).problems[0]?.message ?? '', /same work app/)
  const loop = { nodes: [start, app('a'), app('b')], edges: [...placed('a', 'b'), e('a', 'b', 'done'), e('b', 'a', 'done')] }
  assert.ok(handoffCycle(handoffRoutesOf(loop).routes))
  assert.equal(handoffCycle(handoffRoutesOf(three()).routes), null)
})

test('run graph - receiving app = handoff node + End - no other app nodes - onlyTo keeps only nodes reaching that app', () => {
  const g = { nodes: [start, app('a'), app('b'), app('c'), mail('mb'), mail('mc')], edges: [...placed('a', 'b', 'c'), e('a', 'mb', 'done'), e('mb', 'b'), e('a', 'mc', 'done'), e('mc', 'c')] }
  const run = doneRunGraph(g, 'a', 'wf_app_a')!
  const kinds = run.nodes.map((n) => `${n.id}:${n.data?.nodeType}`)
  assert.ok(kinds.includes(`${EVENT_START_ID}:start`))
  assert.ok(kinds.includes(`b:${HANDOFF_NODE}`) && kinds.includes(`c:${HANDOFF_NODE}`))
  assert.ok(!run.nodes.some((n) => n.data?.nodeType === 'workApp'), '앱 노드는 실행 그래프에 없다')
  assert.equal(run.nodes.filter((n) => n.data?.nodeType === 'end').length, 2)
  const only = doneRunGraph(g, 'a', 'wf_app_a', 'b')!
  assert.deepEqual(only.nodes.map((n) => n.id).filter((id) => !String(id).startsWith(EVENT_START_ID)).sort(), ['b', 'mb'], 'c 로 가는 메일은 돌지 않는다')
  assert.equal(doneRunGraph(g, 'a', 'wf_app_a', 'zzz'), null, '길이 없는 앱')
  assert.equal(doneRunGraph(g, 'b', 'wf_app_b'), null, 'done 선이 없는 앱')
  const last = doneRunGraph(three(), 'grp', 'wf_grp')!
  assert.deepEqual(last.nodes.map((n) => n.id).filter((id) => !String(id).startsWith(EVENT_START_ID)).sort(), ['m', 'z'])
})

test('check - handoff lines save and deploy - loops, default lines between apps, handoff nodes placed by a person are rejected', () => {
  const ok = validateWorkflowJson(JSON.stringify(three()), 'deployable', 'main')
  assert.equal(ok.valid, true, JSON.stringify(ok.issues))
  const loop = { nodes: [start, app('a'), app('b')], edges: [...placed('a', 'b'), e('a', 'b', 'done'), e('b', 'a', 'done')] }
  const r1 = validateWorkflowJson(JSON.stringify(loop), 'structural', 'main')
  assert.equal(r1.valid, false)
  assert.ok(r1.issues.some((i) => /loop/.test(i.message)))
  const plain = { nodes: [start, app('a'), app('b')], edges: [...placed('a', 'b'), e('a', 'b')] }
  assert.equal(validateWorkflowJson(JSON.stringify(plain), 'structural', 'main').valid, false, '앱끼리 기본 선은 안 된다')
  const forged = { nodes: [start, app('a'), { id: 'h', type: 'custom', data: { label: 'H', nodeType: HANDOFF_NODE, toNodeId: 'a' } }], edges: [...placed('a'), e('a', 'h', 'done')] }
  assert.equal(validateWorkflowJson(JSON.stringify(forged), 'structural', 'main').valid, false)
  const evApp = { nodes: [start, app('a'), app('b'), mail('m')], edges: [...placed('a', 'b'), e('a', 'm', 'ev:sealed'), e('m', 'b')] }
  assert.equal(validateWorkflowJson(JSON.stringify(evApp), 'structural', 'main').valid, false)
  const badMail = { nodes: [start, app('a'), app('b'), { id: 'm', type: 'custom', data: { label: 'Mail', nodeType: 'sendgrid' } }], edges: [...placed('a', 'b'), e('a', 'm', 'done'), e('m', 'b')] }
  assert.equal(validateWorkflowJson(JSON.stringify(badMail), 'deployable', 'main').valid, false)
})

test('cells to wait for - quarter to year 4 cells - year to year 1 cell - month to quarter 3 cells - bounds', () => {
  const y = { start: '2026-01-01', end: '2026-12-31' }
  assert.deepEqual(senderPeriodsWithin(periodContaining, 'quarter', y).map((p) => p.end), ['2026-03-31', '2026-06-30', '2026-09-30', '2026-12-31'])
  assert.deepEqual(senderPeriodsWithin(periodContaining, 'year', y), [{ start: '2026-01-01', end: '2026-12-31' }])
  assert.deepEqual(senderPeriodsWithin(periodContaining, 'month', { start: '2026-07-01', end: '2026-09-30' }).map((p) => p.start), ['2026-07-01', '2026-08-01', '2026-09-01'])
  assert.deepEqual(senderPeriodsWithin(periodContaining, 'custom', y), [], '규칙 없음')
  assert.deepEqual(senderPeriodsWithin(periodContaining, 'year', { start: '2026-10-01', end: '2026-12-31' }).length, 1)
  assert.deepEqual(senderPeriodsWithin(periodContaining, 'year', { start: '2026-07-01', end: '2026-09-30' }).length, 0)
  assert.equal(periodContaining('year', '2026-09-30')!.periodStart, '2026-01-01')
})

test('export check - VAT export - receive declaration', cloudOnly, () => {
  assert.equal(handoffFieldsProblem({ box500: '366.30', n: 3 }), null)
  assert.match(handoffFieldsProblem({ a: { b: 1 } }) ?? '', /number or text/)
  assert.match(handoffFieldsProblem({ a: Infinity }) ?? '', /finite/)
  assert.match(handoffFieldsProblem(Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`f${i}`, i]))) ?? '', /more than 50/)
  assert.match(handoffFieldsProblem({ 'bad key!': 1 }) ?? '', /not allowed/)
  assert.match(handoffFieldsProblem({ t: 'x'.repeat(2001) }) ?? '', /longer/)
  assert.match(handoffFieldsProblem([1]) ?? '', /object/)
  const v = vatHandoffExport({ basis: 'cash', fxMethod: 'monthly', acquisition383Base: '0.00', boxes: { '303': '6155.00', '303_tax': '461.10', '500': '366.30' } })
  assert.deepEqual(v, { basis: 'cash', fxMethod: 'monthly', acquisition383Base: '0.00', box303: '6155.00', box303_tax: '461.10', box500: '366.30' })
  assert.equal(handoffFieldsProblem(v), null)
  assert.equal(acceptsHandoff({ sheets: [{ template: HANDOFF_TEMPLATE_ID }] }), true)
  assert.equal(acceptsHandoff({ sheets: [{ template: 'vat.transactions@1' }] }), false)
})
