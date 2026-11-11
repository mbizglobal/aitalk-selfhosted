
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isAppWorkflow, isChatStartTrigger, pickNonAppWorkflow, workEventStart } from './start-trigger'
import { validateWorkflowJson } from './validation'

const wf = (nodes: unknown[]) => JSON.stringify({ nodes, edges: [] })
const start = (data: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ id: 's', type: 'custom', data: { nodeType: 'start', ...data }, ...extra })

describe('isAppWorkflow', () => {
  it('true for Start / App, false for chat and Telegram', () => {
    assert.equal(isAppWorkflow(wf([start({ triggerType: 'app' })])), true)
    assert.equal(isAppWorkflow(wf([start({})])), false)
    assert.equal(isAppWorkflow(wf([start({ triggerType: 'telegram' })])), false)
  })
  it('catches everything the executor sees as start - nodes whose type is start', () => {
    assert.equal(isAppWorkflow(wf([{ id: 'x', type: 'start', data: { triggerType: 'app' } }])), true)
  })
  it('ignores triggerType on nodes that are not start', () => {
    assert.equal(isAppWorkflow(wf([{ id: 'a', type: 'custom', data: { nodeType: 'ai', triggerType: 'app' } }])), false)
  })
  it('with several Starts, true if any one is App', () => {
    assert.equal(isAppWorkflow(wf([start({}), start({ triggerType: 'app' }, { id: 's2' })])), true)
  })
  it('an unreadable body is not a work app (so work-app-only slots do not accept it) - accepts both string and object', () => {
    assert.equal(isAppWorkflow('{broken'), false)
    assert.equal(isAppWorkflow(null), false)
    assert.equal(isAppWorkflow('{}'), false)
    assert.equal(isAppWorkflow({ nodes: [start({ triggerType: 'app' })] }), true)
    assert.equal(isAppWorkflow({ nodes: [start({})] }), false)
  })
})

describe('isChatStartTrigger - allow list', () => {
  it('only no value or chatWidget counts as chat', () => {
    assert.equal(isChatStartTrigger(undefined), true)
    assert.equal(isChatStartTrigger(null), true)
    assert.equal(isChatStartTrigger('chatWidget'), true)
    for (const t of ['app', 'pstn', 'schedule', 'telegram', 'subworkflow', 'something-new', '']) assert.equal(isChatStartTrigger(t), false, t)
  })
})

describe('pickNonAppWorkflow - auto-pick of the most recent production', () => {
  const chat = { workflowId: 'wf_chat', workflowJson: wf([start({})]) }
  const app = { workflowId: 'wf_app', workflowJson: wf([start({ triggerType: 'app' })]) }
  it('skips a work app at the front (most recent) and picks the next one', () => {
    assert.equal(pickNonAppWorkflow([app, chat])?.workflowId, 'wf_chat')
  })
  it('a workflow started by a work app event is skipped even when first - channels cannot run it', () => {
    const ev = { workflowId: 'wf_ev', workflowJson: wf([start({ triggerType: 'workEvent', workEventWorkflowId: 'wf_app', workEvents: ['inbox_row'] })]) }
    const evBlank = { workflowId: 'wf_ev2', workflowJson: wf([start({ triggerType: 'workEvent' })]) }
    assert.equal(pickNonAppWorkflow([ev, evBlank, app, chat])?.workflowId, 'wf_chat')
    assert.equal(pickNonAppWorkflow([ev]), null)
  })
  it('none when only work apps exist', () => {
    assert.equal(pickNonAppWorkflow([app]), null)
    assert.equal(pickNonAppWorkflow([]), null)
  })
  it('🔴 skips unreadable bodies (fail-closed) - missing, broken, no nodes', () => {
    assert.equal(pickNonAppWorkflow([{ workflowId: 'x', workflowJson: null }, chat])?.workflowId, 'wf_chat')
    assert.equal(pickNonAppWorkflow([{ workflowId: 'y', workflowJson: '{broken' }, chat])?.workflowId, 'wf_chat')
    assert.equal(pickNonAppWorkflow([{ workflowId: 'z', workflowJson: '{}' }, chat])?.workflowId, 'wf_chat')
  })
})

describe('validation - App is the only Start', () => {
  const edges: unknown[] = []
  it('APP_START_RULE when another Start sits beside an App', () => {
    const r = validateWorkflowJson(JSON.stringify({ nodes: [start({ triggerType: 'app' }), start({}, { id: 's2' })], edges }), 'structural', 'main')
    assert.ok(r.issues.some((i) => i.code === 'APP_START_RULE'), JSON.stringify(r.issues))
  })
  it('no such rule with a single App', () => {
    const r = validateWorkflowJson(JSON.stringify({ nodes: [start({ triggerType: 'app' })], edges }), 'structural', 'main')
    assert.ok(!r.issues.some((i) => i.code === 'APP_START_RULE'))
  })
  it('App in a sub-workflow is blocked by the sub rule', () => {
    const r = validateWorkflowJson(JSON.stringify({ nodes: [start({ triggerType: 'app' })], edges }), 'structural', 'sub')
    assert.ok(r.issues.some((i) => i.code === 'SUB_WORKFLOW_RULE'))
  })
  it('near-miss values (\'App\', \'app \', \'APP\') are rejected on save - exactly \'app\'', () => {
    for (const tt of ['App', 'app ', 'APP']) {
      const r = validateWorkflowJson(JSON.stringify({ nodes: [start({ triggerType: tt })], edges }), 'structural', 'main')
      assert.ok(r.issues.some((i) => i.code === 'APP_START_RULE' && i.field === 'triggerType'), tt)
    }
  })
})

describe('check - Start / App connection slots and document space shape (flow.md §15-2 F2-3)', () => {
  const run = (data: Record<string, unknown>) => validateWorkflowJson(JSON.stringify({ nodes: [start({ triggerType: 'app', ...data })], edges: [] }), 'structural', 'main').issues
  const bad = (field: string) => (issues: ReturnType<typeof run>) => issues.some((i) => i.code === 'APP_START_RULE' && i.field === field)
  it('valid shape or none = passes', () => {
    for (const d of [{}, { connections: {} }, { connections: { email: { mail: 'cm1' } } }, { connections: { email: {}, http: { api: 'cm2' } } }, { ragSpaceId: 3 }, { ragSpaceId: '12' }, { ragSpaceId: null }, { ragSpaceId: '' }]) {
      const r = run(d)
      assert.ok(!bad('connections')(r) && !bad('ragSpaceId')(r), JSON.stringify(d))
    }
  })
  it('connection id null, empty text, number, list, slot as text = refused', () => {
    for (const c of [{ email: { mail: null } }, { email: { mail: '' } }, { email: { mail: '  ' } }, { email: { mail: 42 } }, { email: ['cm1'] }, { email: 'cm1' }, [], 'x', { email: { mail: 'x'.repeat(65) } }]) {
      assert.ok(bad('connections')(run({ connections: c })), JSON.stringify(c))
    }
  })
  it('document space 0, negative, fraction, text, true = refused', () => {
    for (const v of [0, -1, 1.5, 'abc', ' 3', true, [1]]) assert.ok(bad('ragSpaceId')(run({ ragSpaceId: v })), JSON.stringify(v))
  })
})

describe('work app event (Start / workEvent) - match and check (flow.md §16 D-2)', () => {
  const ev = (data: Record<string, unknown>, more: unknown[] = []) => JSON.stringify({ nodes: [start({ triggerType: 'workEvent', ...data }), ...more], edges: [] })
  const codes = (json: string, level: 'structural' | 'deployable' = 'structural') => validateWorkflowJson(json, level, 'main').issues.filter((i) => i.code === 'WORK_EVENT_RULE')
  it('match - only when work app and kind match, unknown kinds dropped', () => {
    assert.deepEqual(workEventStart(ev({ workEventWorkflowId: 'wf_a', workEvents: ['sealed', 'x'] })), { appWorkflowId: 'wf_a', events: ['sealed'] })
    for (const d of [{}, { workEventWorkflowId: 'wf_a' }, { workEventWorkflowId: 'wf_a', workEvents: [] }, { workEventWorkflowId: '', workEvents: ['sealed'] }, { workEventWorkflowId: 5, workEvents: ['sealed'] }, { workEventWorkflowId: 'wf_a', workEvents: ['bogus'] }]) {
      assert.equal(workEventStart(ev(d)), null, JSON.stringify(d))
    }
    assert.equal(workEventStart(JSON.stringify({ nodes: [start({ triggerType: 'workEvent', workEventWorkflowId: 'wf_a', workEvents: ['sealed'] }), start({}, { id: 's2' })] })), null, 'Start 둘 = 받지 않음')
  })
  it('check - empty while editing, required on deploy', () => {
    assert.equal(codes(ev({})).length, 0)
    const dep = codes(ev({}), 'deployable')
    assert.ok(dep.some((i) => i.field === 'workEventWorkflowId') && dep.some((i) => i.field === 'workEvents'), JSON.stringify(dep))
    assert.equal(codes(ev({ workEventWorkflowId: 'wf_a', workEvents: ['sealed'] }), 'deployable').length, 0)
  })
  it('check - wrong shape, two Starts, Wait, with App, work app node inside a work app, date shape', () => {
    assert.ok(codes(ev({ workEvents: 'sealed' })).some((i) => i.field === 'workEvents'))
    assert.ok(codes(ev({ workEvents: ['sealed', 'bad'] })).some((i) => i.field === 'workEvents'))
    assert.ok(codes(ev({ workEventWorkflowId: 42 })).some((i) => i.field === 'workEventWorkflowId'))
    assert.ok(codes(JSON.stringify({ nodes: [start({ triggerType: 'workEvent' }), start({}, { id: 's2' })], edges: [] })).length > 0)
    assert.ok(codes(ev({}, [{ id: 'w', type: 'custom', data: { nodeType: 'wait' } }])).some((i) => i.nodeId === 'w'))
    const appWithStep = JSON.stringify({ nodes: [start({ triggerType: 'app' }), { id: 'k', type: 'custom', data: { nodeType: 'workAppStep', targetWorkflowId: 'x', action: 'open_task' } }], edges: [] })
    assert.ok(codes(appWithStep).some((i) => i.nodeId === 'k'))
    for (const pd of ['event_end', 'event_start', 'today', '2026-12-31', '', null]) {
      assert.equal(codes(ev({}, [{ id: 'k', type: 'custom', data: { nodeType: 'workAppStep', periodDate: pd } }])).filter((i) => i.field === 'periodDate').length, 0, String(pd))
    }
    for (const pd of ['2026-02-29', 'yesterday', 5]) {
      assert.ok(codes(ev({}, [{ id: 'k', type: 'custom', data: { nodeType: 'workAppStep', periodDate: pd } }])).some((i) => i.field === 'periodDate'), String(pd))
    }
  })
})

describe('boundary - null inside nodes', () => {
  it('judges without throwing (resolveNodeType receives null)', () => {
    assert.equal(isAppWorkflow(JSON.stringify({ nodes: [null, start({ triggerType: 'app' })] })), true)
    assert.equal(isAppWorkflow(JSON.stringify({ nodes: [null] })), false)
  })
})
