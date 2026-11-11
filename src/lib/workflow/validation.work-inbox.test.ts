import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateWorkflowJson } from './validation'

const node = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, data: { nodeType: type, ...data } })
const edge = (source: string, target: string, sourceHandle?: string) => ({ id: `${source}-${target}-${sourceHandle ?? ''}`, source, target, ...(sourceHandle ? { sourceHandle } : {}) })
const inbox = (id: string, data: Record<string, unknown> = { targetWorkflowId: 'wfapp1', inboxFamily: 'shop.orders' }) => ({ id, type: 'tool', data: { toolType: 'workInbox', ...data } })
const graph = (tools: unknown[], ai: Record<string, unknown> = {}) => JSON.stringify({
  nodes: [node('start-1', 'start', { triggerType: 'chat' }), node('ai-1', 'ai', { model: 'gpt-6-luna', ...ai }), node('end-1', 'end'), ...tools],
  edges: [edge('start-1', 'ai-1'), edge('ai-1', 'end-1'), ...(tools as Array<{ id: string }>).map((t) => edge('ai-1', t.id, 'tools'))],
})
const blocking = (r: ReturnType<typeof validateWorkflowJson>) => r.issues.filter((i) => i.severity !== 'warning')

test('one inbox = deploy check passes', () => {
  const r = validateWorkflowJson(graph([inbox('t1')]), 'deployable')
  assert.deepEqual(blocking(r).filter((i) => i.nodeId === 't1' || /inbox/i.test(i.message)), [], JSON.stringify(r.issues))
})

test('two inboxes on one AI node = refused at save (same or different target)', () => {
  for (const second of [inbox('t2'), inbox('t2', { targetWorkflowId: 'wfapp2', inboxFamily: 'shop.orders' })]) {
    const r = validateWorkflowJson(graph([inbox('t1'), second]), 'structural')
    assert.ok(blocking(r).some((i) => i.nodeId === 'ai-1' && /only one Work inbox tool/.test(i.message)), JSON.stringify(r.issues))
  }
})

test('empty target or family = deploy refused, draft save passes', () => {
  for (const data of [{ inboxFamily: 'shop.orders' }, { targetWorkflowId: 'wfapp1' }, {}]) {
    const json = graph([inbox('t1', data)])
    assert.ok(blocking(validateWorkflowJson(json, 'deployable')).some((i) => i.nodeId === 't1'), JSON.stringify(data))
    assert.ok(!blocking(validateWorkflowJson(json, 'structural')).some((i) => i.nodeId === 't1'), JSON.stringify(data))
  }
})

test('telegram identity column is a reserved saveAs name', () => {
  for (const key of ['telegramUserId', 'telegramChatId', 'isTelegramWebhook']) {
    const r = validateWorkflowJson(graph([], { saveAs: key }), 'structural')
    assert.ok(blocking(r).some((i) => i.nodeId === 'ai-1'), `${key}: ${JSON.stringify(r.issues)}`)
  }
})

test('inbox inside a work app (Start / App) = refused', () => {
  const json = JSON.stringify({
    nodes: [node('start-1', 'start', { triggerType: 'app' }), node('ai-1', 'ai', { model: 'gpt-6-luna' }), node('end-1', 'end'), inbox('t1')],
    edges: [edge('start-1', 'ai-1'), edge('ai-1', 'end-1'), edge('ai-1', 't1', 'tools')],
  })
  assert.ok(blocking(validateWorkflowJson(json, 'structural')).some((i) => /cannot be attached inside a work app/.test(i.message)))
})

test('inbox on a start without a customer (work app event, schedule) = refused - events creating events', () => {
  for (const start of [{ triggerType: 'workEvent', workEventWorkflowId: 'wfapp1', workEvents: ['inbox_row'] }, { triggerType: 'schedule' }]) {
    const json = JSON.stringify({
      nodes: [node('start-1', 'start', start), node('ai-1', 'ai', { model: 'gpt-6-luna' }), node('end-1', 'end'), inbox('t1')],
      edges: [edge('start-1', 'ai-1'), edge('ai-1', 'end-1'), edge('ai-1', 't1', 'tools')],
    })
    assert.ok(blocking(validateWorkflowJson(json, 'structural')).some((i) => /work app event or a schedule/.test(i.message)), start.triggerType)
  }
})
