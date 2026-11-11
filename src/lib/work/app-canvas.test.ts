import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appKeyOf, appNodesOf, buildAppGraph, canvasEventEntries, eventRunGraph, hasDoneLine, isAppCanvas, isLegacyAppWorkflow, isWorkAppRow, EVENT_START_ID, DEFAULT_APP_AI } from './app-canvas'
import { checkWorkAppGraph, appStartSettings } from './app-chat'
import { referenceLinesOf, sendLinesOf } from './reference-lines'
import { validateWorkflowJson } from '@/lib/workflow/validation'

const app = (id: string, data: Record<string, unknown> = {}) => ({ id, type: 'custom', data: { label: `App ${id}`, nodeType: 'workApp', ...data } })
const start = { id: 's', type: 'custom', data: { label: 'Start / App', nodeType: 'start', triggerType: 'app' } }
const mail = (id: string) => ({ id, type: 'custom', data: { label: 'Mail', nodeType: 'sendgrid', toEmail: 'a@example.com', fromEmail: 'b@example.com', subject: 'x', bodyTemplate: 'y', connectionId: 'c1' } })
const end = (id: string) => ({ id, type: 'custom', data: { label: 'End', nodeType: 'end' } })
const canvas = (nodes: unknown[], edges: unknown[]) => ({ nodes, edges })

test('recognizing a canvas - app nodes make a canvas - old shape = Start / App and not a canvas', () => {
  const legacy = canvas([start, { id: 'ai', type: 'custom', data: { nodeType: 'ai' } }], [])
  const c = canvas([start, app('a')], [])
  assert.equal(isAppCanvas(c), true)
  assert.equal(isAppCanvas(legacy), false)
  assert.equal(isLegacyAppWorkflow(legacy), true)
  assert.equal(isLegacyAppWorkflow(c), false)
  assert.equal(isWorkAppRow({ kind: 'main', workflowJson: JSON.stringify(c) }), false, '캔버스 자체는 업무 앱이 아니다')
  assert.equal(isWorkAppRow({ kind: 'main', workflowJson: JSON.stringify(legacy) }), true)
  assert.equal(isWorkAppRow({ kind: 'sub', workflowJson: JSON.stringify(legacy) }), false)
  assert.equal(isWorkAppRow({ kind: 'app', workflowJson: buildAppGraph('wf_p', app('a')) }), true)
  assert.equal(isAppCanvas('not json'), false)
  assert.deepEqual(appNodesOf(canvas([app(''), { id: 7, data: { nodeType: 'workApp' } }], [])), [], 'id 없는 노드는 앱이 아니다')
})

test('hidden graph - same shape as the current work app graph - Start id = app key - settings field - AI defaults', () => {
  const n = app('n1', { appTemplate: 'vat', appWelcomeMessage: 'Hi', connections: { database: { erp: 'conn1' } }, dbAiSql: { erp: true }, ragSpaceId: 3, ai: { model: 'gpt-6-luna', systemMessage: 'Do it' } })
  const json = buildAppGraph('wf_parent', n)
  assert.equal(checkWorkAppGraph(json), null, '업무 앱 실행 검사를 그대로 통과')
  const g = JSON.parse(json)
  assert.equal(g.nodes[0].id, appKeyOf('wf_parent', 'n1'))
  assert.equal(g.nodes[0].id, 'wf_parent.n1')
  const st = appStartSettings(json)
  assert.equal(st.appTemplate, 'vat')
  assert.equal(st.welcome, 'Hi')
  assert.deepEqual(st.connections, { database: { erp: 'conn1' } })
  assert.deepEqual(st.dbAiSql, { erp: true })
  assert.equal(st.ragSpaceId, 3)
  const ai = g.nodes.find((x: { id: string }) => x.id === 'ai').data
  assert.equal(ai.model, 'gpt-6-luna')
  assert.equal(ai.systemMessage, 'Do it')
  assert.equal(ai.maxTokens, DEFAULT_APP_AI.maxTokens, '안 준 칸은 기본값')
  assert.equal(buildAppGraph('wf_parent', n), json, '같은 설정 = 같은 글자(맞추기가 바뀐 것만 쓴다)')
  const bare = JSON.parse(buildAppGraph('wf_parent', app('n2')))
  assert.equal(bare.nodes[1].data.systemMessage, DEFAULT_APP_AI.systemMessage)
  assert.equal(bare.nodes[0].data.appTemplate, undefined, '빈 칸은 싣지 않는다')
})

test('event graph - that app, only after that event output - event Start - other events and other apps flows are left out', () => {
  const c = canvas([start, app('a'), app('b'), mail('m1'), end('e1'), mail('m2'), end('e2')], [
    { id: 'sa', source: 's', target: 'a' }, { id: 'sb', source: 's', target: 'b' },
    { id: 'x1', source: 'a', sourceHandle: 'ev:sealed', target: 'm1' }, { id: 'x2', source: 'm1', target: 'e1' },
    { id: 'y1', source: 'b', sourceHandle: 'ev:inbox_row', target: 'm2' }, { id: 'y2', source: 'm2', target: 'e2' },
    { id: 'snd', source: 'a', sourceHandle: 'send', target: 'b', data: { inboxFamily: 'f' } },
  ])
  assert.deepEqual(canvasEventEntries(c).sort((p, q) => p.appNodeId.localeCompare(q.appNodeId)), [{ appNodeId: 'a', kind: 'sealed' }, { appNodeId: 'b', kind: 'inbox_row' }])
  const g = eventRunGraph(c, 'a', 'sealed', 'wf_hidden_a')!
  assert.deepEqual(g.nodes.map((n) => n.id), [EVENT_START_ID, 'm1', 'e1'])
  assert.equal(g.nodes[0].data?.triggerType, 'workEvent')
  assert.equal(g.nodes[0].data?.workEventWorkflowId, 'wf_hidden_a')
  assert.deepEqual(g.nodes[0].data?.workEvents, ['sealed'])
  assert.deepEqual(g.edges.map((e) => `${e.source}->${e.target}`), [`${EVENT_START_ID}->m1`, 'm1->e1'])
  assert.equal(eventRunGraph(c, 'a', 'unlocked', 'w'), null, '선 없는 사건 = null')
  assert.equal(eventRunGraph(c, 'm1', 'sealed', 'w'), null, '앱 노드가 아니면 null')
  assert.equal(eventRunGraph(c, 'zz', 'sealed', 'w'), null)
  const back = canvas([start, app('a'), app('b'), mail('m1')], [{ id: 'x1', source: 'a', sourceHandle: 'ev:sealed', target: 'm1' }, { id: 'x2', source: 'm1', target: 'b' }])
  assert.equal(eventRunGraph(back, 'a', 'sealed', 'w'), null)
  assert.equal(validateWorkflowJson(JSON.stringify(g), 'deployable').valid, true, JSON.stringify(validateWorkflowJson(JSON.stringify(g), 'deployable').issues))
})

test('reading lines - between app nodes - mapped to hidden app ids - placeholders before deploy (shape check)', () => {
  const c = canvas([start, app('a'), app('b')], [
    { id: 'snd', source: 'a', sourceHandle: 'send', target: 'b', data: { inboxFamily: 'example.requests' } },
    { id: 'ref', source: 'a', sourceHandle: 'ref', target: 'b', data: { sheets: ['x'] } },
  ])
  assert.deepEqual(sendLinesOf(c).lines.map((l) => [l.fromWorkflowId, l.toWorkflowId]), [['node:a', 'node:b']])
  const ids = new Map([['a', 'wf_A'], ['b', 'wf_B']])
  assert.deepEqual(sendLinesOf(c, (n) => ids.get(n)).lines.map((l) => [l.fromWorkflowId, l.toWorkflowId, l.family]), [['wf_A', 'wf_B', 'example.requests']])
  assert.deepEqual(referenceLinesOf(c, (n) => ids.get(n)).lines.map((l) => [l.sourceWorkflowId, l.readerWorkflowId]), [['wf_A', 'wf_B']])
  const half = sendLinesOf(c, (n) => (n === 'a' ? 'wf_A' : undefined))
  assert.equal(half.lines.length, 0)
  assert.match(half.problems[0].message, /need a work app/, '배포 전 노드는 앱이 아직 없다')
  const old = canvas([{ id: 'p', type: 'workAppStep', data: { targetWorkflowId: 'wf_1' } }, { id: 'q', type: 'workAppStep', data: { targetWorkflowId: 'wf_2' } }], [{ id: 'e', source: 'p', sourceHandle: 'send', target: 'q', data: { inboxFamily: 'f' } }])
  assert.deepEqual(sendLinesOf(old).lines.map((l) => [l.fromWorkflowId, l.toWorkflowId]), [['wf_1', 'wf_2']])
})

test('check - canvas shape - flow after events - app node fields - each event checked on deploy', () => {
  const issues = (j: unknown, level: 'structural' | 'deployable' = 'deployable') => validateWorkflowJson(JSON.stringify(j), level).issues.filter((i) => i.severity !== 'warning').map((i) => i.message)
  const good = canvas([start, app('a'), app('b'), mail('m1'), end('e1')], [
    { id: 'sa', source: 's', target: 'a' }, { id: 'sb', source: 's', target: 'b' },
    { id: 'x1', source: 'a', sourceHandle: 'ev:sealed', target: 'm1' }, { id: 'x2', source: 'm1', target: 'e1' },
    { id: 'snd', source: 'a', sourceHandle: 'send', target: 'b', data: { inboxFamily: 'f' } },
  ])
  assert.deepEqual(issues(good), [])
  assert.deepEqual(issues(canvas([start, app('a')], [{ id: 'sa', source: 's', target: 'a' }])), [], '사건 흐름 없는 앱 하나도 배포된다(End 없어도)')
  assert.ok(issues(canvas([start, app('a'), end('e')], [{ id: 'z', source: 'a', target: 'e' }]), 'structural').some((m) => /event output/.test(m)))
  const stray = canvas([start, app('a'), mail('m9')], [])
  assert.deepEqual(issues(stray, 'structural'), [])
  assert.ok(issues(stray).some((m) => /not connected to any Work app event/.test(m)))
  assert.ok(issues(canvas([start, { ...start, id: 's2' }, app('a')], []), 'structural').some((m) => /exactly one Start/.test(m)))
  assert.ok(issues(canvas([{ id: 's', type: 'custom', data: { nodeType: 'start', triggerType: 'chatWidget' } }, app('a')], []), 'structural').some((m) => /Start \/ App/.test(m)))
  assert.ok(issues(canvas([start, app('a', { appTemplate: 'nope' })], []), 'structural').some((m) => /not a known app template/.test(m)))
  assert.ok(issues(canvas([start, app('a', { ai: { maxTokens: -1 } })], []), 'structural').some((m) => /ai must be/.test(m)))
  assert.ok(issues(canvas([start, app('x'.repeat(101))], []), 'structural').some((m) => /at most 100/.test(m)))
  assert.ok(issues(canvas([start, app('a'), app('b'), mail('m1')], [{ id: 'x1', source: 'a', sourceHandle: 'ev:sealed', target: 'm1' }, { id: 'x2', source: 'm1', target: 'b' }]), 'structural').some((m) => /must not lead back/.test(m) || /connect into a Work app node/.test(m)))
  assert.ok(issues(canvas([start, app('a'), mail('m1')], [{ id: 'x1', source: 'a', sourceHandle: 'ev:sealed', target: 'm1' }])).some((m) => /App a.*sealed event: Workflow must have an End/.test(m)))
  assert.ok(issues(canvas([start, app('a'), { id: 'w', type: 'custom', data: { nodeType: 'wait' } }], []), 'structural').some((m) => /Wait node cannot be used/.test(m)))
  const step = (data: Record<string, unknown>) => ({ id: 'st', type: 'custom', data: { nodeType: 'workAppStep', action: 'open_task', ...data } })
  const withStep = (data: Record<string, unknown>) => canvas([start, app('a'), app('b'), step(data), end('e1')], [{ id: 'x1', source: 'a', sourceHandle: 'ev:sealed', target: 'st' }, { id: 'x2', source: 'st', target: 'e1' }])
  assert.deepEqual(issues(withStep({ targetNodeId: 'b' })), [])
  assert.ok(issues(withStep({ targetNodeId: 'st' }), 'structural').some((m) => /targetNodeId must be a Work app node/.test(m)))
  assert.ok(issues(withStep({})).some((m) => /choose the work app to open/.test(m)))
})

test('when closed run - not run when the only line goes straight to End - run when there is at least one task node', () => {
  const e = (id: string, target: string) => ({ id, source: 'a', sourceHandle: 'done', target })
  assert.equal(hasDoneLine(canvas([start, app('a'), end('x')], [e('1', 'x')]), 'a'), false)
  assert.equal(hasDoneLine(canvas([start, app('a'), end('x'), mail('m')], [e('1', 'x'), e('2', 'm')]), 'a'), true)
  assert.equal(hasDoneLine(canvas([start, app('a'), app('b')], [e('1', 'b')]), 'a'), true)
  assert.equal(hasDoneLine(canvas([start, app('a'), end('x')], []), 'a'), false)
})
