
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isAppWorkflow, isChatStartTrigger, pickNonAppWorkflow } from './start-trigger'
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

describe('boundary - null inside nodes', () => {
  it('judges without throwing (resolveNodeType receives null)', () => {
    assert.equal(isAppWorkflow(JSON.stringify({ nodes: [null, start({ triggerType: 'app' })] })), true)
    assert.equal(isAppWorkflow(JSON.stringify({ nodes: [null] })), false)
  })
})
