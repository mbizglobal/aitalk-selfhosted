import { test } from 'node:test'
import { cloudOnly } from '@/lib/work/cloud-apps-for-tests'
import assert from 'node:assert/strict'
import { appNodesOf, isAppCanvas, isLegacyAppWorkflow, linkNodesOf, linkTargetOf } from './app-canvas'
import { referenceLinesOf, sendLinesOf } from './reference-lines'
import { isCompanyBookKind, isSharedAppTemplateKind, SHARED_APP_TEMPLATE_KINDS } from './app-template-kinds'
import { validateWorkflowJson } from '@/lib/workflow/validation'

const start = { id: 's', type: 'custom', data: { label: 'Start / App', nodeType: 'start', triggerType: 'app' } }
const app = (id: string, data: Record<string, unknown> = {}) => ({ id, type: 'custom', data: { label: `App ${id}`, nodeType: 'workApp', appTemplate: 'invoices', ...data } })
const link = (id: string, target = '', data: Record<string, unknown> = {}) => ({ id, type: 'custom', data: { label: `Ledger ${id}`, nodeType: 'workAppLink', appTemplate: 'ledger', linkedAppWorkflowId: target, ...data } })
const ref = (id: string, source: string, target: string) => ({ id, source, target, sourceHandle: 'ref', data: { sheets: ['x'] } })
const json = (nodes: unknown[], edges: unknown[]) => JSON.stringify({ nodes, edges })
const check = (nodes: unknown[], edges: unknown[], level: 'structural' | 'deployable' = 'deployable') => validateWorkflowJson(json(nodes, edges), level)
const codes = (r: ReturnType<typeof check>) => r.issues.filter((i) => i.severity !== 'warning').map((i) => `${i.code}: ${i.message}`)

const invoicesCanvas = (target: string) => [
  [start, app('inv'), link('led', target)],
  [{ id: 'si', source: 's', target: 'inv' }, ref('r1', 'inv', 'led'), ref('r2', 'led', 'inv')],
] as const

test('the ledger is a shared app - collected from package meta shared', cloudOnly, () => {
  assert.ok(SHARED_APP_TEMPLATE_KINDS.includes('ledger'))
  assert.equal(isSharedAppTemplateKind('ledger'), true)
  assert.equal(isSharedAppTemplateKind('invoices'), false)
  assert.equal(isSharedAppTemplateKind(undefined), false)
  assert.equal(isSharedAppTemplateKind('receipts'), true)
  assert.equal(isSharedAppTemplateKind('swiss-acc-invoice'), true)
  assert.equal(isSharedAppTemplateKind('swiss-acc-year-end'), false)
  assert.equal(isCompanyBookKind('ledger'), true)
  assert.equal(isCompanyBookKind('receipts'), false)
  assert.equal(isCompanyBookKind('approvals'), false)
})

test('recognizing link nodes - not app nodes (no hidden app is created) - a canvas even with only link nodes', () => {
  const g = { nodes: [start, link('l1', 'wf_x')], edges: [] }
  assert.deepEqual(appNodesOf(g), [], '앱 노드 목록에 안 든다 — 숨은 앱 맞추기 · 넘기기 · 대시보드가 저절로 건너뛴다')
  assert.deepEqual(linkNodesOf(g).map((n) => n.id), ['l1'])
  assert.equal(isAppCanvas(g), true)
  assert.equal(isLegacyAppWorkflow(g), false, 'Start / App + 연결 노드는 옛 구조 업무 앱이 아니다')
  assert.equal(linkTargetOf(link('a', 'wf_1')), 'wf_1')
  assert.equal(linkTargetOf(link('a', '')), null)
  assert.equal(linkTargetOf(link('a', 7 as unknown as string)), null)
})

test('reference line ends - link node = the hidden app it points to - unpicked = placeholder in shape checks, a problem on deploy', () => {
  const [nodes, edges] = invoicesCanvas('wf_ledger')
  const appIdOf = (id: string) => (id === 'inv' ? 'wf_inv_hidden' : undefined)
  const deployed = referenceLinesOf({ nodes, edges }, appIdOf)
  assert.deepEqual(deployed.problems, [])
  assert.deepEqual(deployed.lines.map((l) => `${l.readerWorkflowId}<-${l.sourceWorkflowId}`).sort(), ['wf_inv_hidden<-wf_ledger', 'wf_ledger<-wf_inv_hidden'])
  const shape = referenceLinesOf({ nodes, edges })
  assert.deepEqual(shape.lines.map((l) => `${l.readerWorkflowId}<-${l.sourceWorkflowId}`).sort(), ['node:inv<-wf_ledger', 'wf_ledger<-node:inv'])
  const [n2, e2] = invoicesCanvas('')
  assert.deepEqual(referenceLinesOf({ nodes: n2, edges: e2 }).problems, [], '안 고른 연결 노드도 초안 저장은 된다')
  assert.equal(referenceLinesOf({ nodes: n2, edges: e2 }, appIdOf).problems.length, 2, '배포 때 안 고른 끝점 = 문제')
})

test('send lines - cannot be drawn to a link node', () => {
  const g = { nodes: [start, app('inv'), link('led', 'wf_l')], edges: [{ id: 'x', source: 'inv', target: 'led', sourceHandle: 'send', data: { inboxFamily: 'f' } }] }
  const r = sendLinesOf(g)
  assert.equal(r.lines.length, 0)
  assert.match(r.problems[0].message, /reference lines only/)
})

test('check - Invoices + ledger link canvas passes deploy - not flagged as never runs - reference lines both ways', cloudOnly, () => {
  const [nodes, edges] = invoicesCanvas('wf_ledger')
  assert.deepEqual(codes(check([...nodes], [...edges])), [])
  assert.deepEqual(codes(check([...nodes], [ref('r2', 'led', 'inv')])), [], '연결 → 앱 한 방향만')
  assert.deepEqual(codes(check([...nodes], [ref('r1', 'inv', 'led')])), [], '앱 → 연결 한 방향만')
})

test('check - no target = draft passes - deploy rejected LINK_TARGET_MISSING', cloudOnly, () => {
  const [nodes, edges] = invoicesCanvas('')
  assert.equal(check([...nodes], [...edges], 'structural').valid, true, JSON.stringify(check([...nodes], [...edges], 'structural').issues))
  const r = check([...nodes], [...edges])
  assert.equal(r.valid, false)
  assert.ok(r.issues.some((i) => i.code === 'LINK_TARGET_MISSING' && i.nodeId === 'led'))
})

test('check - not a shared app template or a wrong target id shape = rejected (from the draft on)', () => {
  const r = check([start, app('inv'), link('led', 'wf_l', { appTemplate: 'invoices' })], [], 'structural')
  assert.equal(r.valid, false)
  assert.ok(r.issues.some((i) => i.field === 'appTemplate' && /shared work app/.test(i.message)))
  assert.equal(check([start, app('inv'), link('led', 'wf_l', { appTemplate: undefined })], [], 'structural').valid, false, '빈 appTemplate')
  assert.equal(check([start, app('inv'), link('led', 'x'.repeat(26))], [], 'structural').valid, false)
  assert.equal(check([start, app('inv'), link('led', 5 as unknown as string)], [], 'structural').valid, false)
})

test('check - link node lines only to app nodes and reference lines: send, event, when closed, Start, link to link, flow nodes = rejected', () => {
  const base = [start, app('inv'), link('led', 'wf_l'), link('led2', 'wf_m')]
  const mail = { id: 'm', type: 'custom', data: { label: 'Mail', nodeType: 'sendgrid', toEmail: 'a@example.com', fromEmail: 'b@example.com', subject: 'x', bodyTemplate: 'y', connectionId: 'c1' } }
  const bad: Array<[string, unknown[], unknown[]]> = [
    ['send', base, [{ id: 'x', source: 'inv', target: 'led', sourceHandle: 'send', data: { inboxFamily: 'f' } }]],
    ['사건', base, [{ id: 'x', source: 'inv', target: 'led', sourceHandle: 'ev:sealed' }]],
    ['마감되면', base, [{ id: 'x', source: 'inv', target: 'led', sourceHandle: 'done' }]],
    ['Start', base, [{ id: 'x', source: 's', target: 'led' }]],
    ['연결끼리', base, [ref('x', 'led', 'led2')]],
    ['연결 → 흐름', [...base, mail], [ref('x', 'led', 'm')]],
    ['연결 기본 출력', base, [{ id: 'x', source: 'led', target: 'inv' }]],
  ]
  for (const [name, nodes, edges] of bad) {
    const r = check(nodes, edges, 'structural')
    assert.equal(r.valid, false, name)
    assert.ok(r.issues.some((i) => /link node connects only by a reference line/.test(i.message)), `${name}: ${JSON.stringify(r.issues)}`)
  }
})

test('check - one link node per target app on a canvas (not one line per pair)', cloudOnly, () => {
  const r = check([start, app('inv'), link('a', 'wf_l'), link('b', 'wf_l')], [ref('r1', 'inv', 'a'), ref('r2', 'b', 'inv')], 'structural')
  assert.equal(r.valid, false)
  assert.ok(r.issues.some((i) => i.nodeId === 'b' && /already linked/.test(i.message)), JSON.stringify(r.issues))
  assert.equal(check([start, app('inv'), link('a'), link('b')], [], 'structural').valid, true, '둘 다 안 고름 = 초안은 된다')
})

test('check - canvas with only link nodes: draft passes, deploy is rejected', cloudOnly, () => {
  assert.equal(check([start, link('led', 'wf_l')], [], 'structural').valid, true)
  const r = check([start, link('led', 'wf_l')], [])
  assert.equal(r.valid, false)
  assert.ok(r.issues.some((i) => /add at least one Work app node/.test(i.message)), JSON.stringify(r.issues))
  assert.equal(check([start, link('led', 'wf_l')], [], 'structural', ).issues.length, 0)
})

test('check - not allowed in a sub-workflow', () => {
  const r = validateWorkflowJson(json([{ id: 's', type: 'custom', data: { label: 'S', nodeType: 'start', triggerType: 'subworkflow' } }, link('led', 'wf_l')], []), 'structural', 'sub')
  assert.equal(r.valid, false)
})
