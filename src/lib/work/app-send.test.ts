import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sendLinesOf } from './reference-lines'
import { APP_SEND_MAX_ROWS, APP_SEND_ROW_MAX_CHARS, normalizeAppSendRows } from './app-send'
import { appSendToolDefs } from './app-ai'
import { WorkError } from './errors'
import { summarizeDeployRisk } from '@/lib/workflow/deploy-summary'

const step = (id: string, wf?: string) => ({ id, type: 'workAppStep', data: { nodeType: 'workAppStep', label: `app ${id}`, action: 'open_task', ...(wf ? { targetWorkflowId: wf } : {}) } })
const send = (id: string, source: string, target: string, family?: string) => ({ id, source, target, sourceHandle: 'send', data: family === undefined ? {} : { inboxFamily: family } })

test('reading send lines - tail = sending app - head = receiving app - family', () => {
  const r = sendLinesOf({ nodes: [step('a', 'wfA'), step('b', 'wfB')], edges: [send('e1', 'a', 'b', ' orders ')] })
  assert.deepEqual(r, { lines: [{ edgeId: 'e1', fromWorkflowId: 'wfA', toWorkflowId: 'wfB', family: 'orders' }], problems: [] })
  assert.equal(sendLinesOf(JSON.stringify({ nodes: [step('a', 'wfA'), step('b', 'wfB')], edges: [send('e1', 'a', 'b', 'x')] })).lines.length, 1)
  assert.deepEqual(sendLinesOf('{not json'), { lines: [], problems: [] })
  assert.equal(sendLinesOf({ nodes: [step('a', 'wfA'), step('b', 'wfB')], edges: [{ id: 'r', source: 'a', target: 'b', sourceHandle: 'ref' }, { id: 'f', source: 'a', target: 'b' }] }).lines.length, 0)
})

test('send line problems - not a work app node, no app, itself, same route twice, empty family keeps the line and the check blocks', () => {
  const nodes = [step('a', 'wfA'), step('b', 'wfB'), step('c'), { id: 'x', type: 'ai', data: { nodeType: 'ai' } }, step('a2', 'wfA')]
  const r = sendLinesOf({ nodes, edges: [send('1', 'a', 'x', 'o'), send('2', 'a', 'c', 'o'), send('3', 'a', 'a2', 'o'), send('4', 'a', 'b', 'o'), send('5', 'a', 'b', 'o'), send('6', 'a', 'b', 'p'), send('7', 'b', 'a')] })
  assert.deepEqual(r.problems.map((p) => p.edgeId), ['1', '2', '3', '5'])
  assert.deepEqual(r.lines.map((l) => [l.edgeId, l.family]), [['4', 'o'], ['6', 'p'], ['7', '']])
})

test('row bundles - 0 rows, 21 rows, not an object, empty row, own fields cleared, size', () => {
  const bad = (rows: unknown, re: RegExp) => assert.throws(() => normalizeAppSendRows(rows, 'phone'), (e: unknown) => e instanceof WorkError && e.code === 'INVALID' && re.test(e.message))
  bad([], /1 or more/)
  bad(null, /1 or more/)
  bad({ a: 1 }, /1 or more/)
  bad(Array.from({ length: APP_SEND_MAX_ROWS + 1 }, () => ({ a: 1 })), /at most 20/)
  bad([{ a: 1 }, ['x']], /row 2 must be an object/)
  bad([{ a: 1 }, null], /row 2 must be an object/)
  bad([{}], /row 1 has no values/)
  bad([{ a: null, b: '  ', c: undefined }], /no values/)
  bad([{ phone: '+41790000000' }], /no values/)
  bad([{ a: 'x'.repeat(APP_SEND_ROW_MAX_CHARS) }], /too large/)
  assert.deepEqual(normalizeAppSendRows([{ item: 'A', qty: 0, done: false, phone: '+41790000000' }], 'phone'), [{ item: 'A', qty: 0, done: false }])
  assert.equal(normalizeAppSendRows(Array.from({ length: APP_SEND_MAX_ROWS }, (_, i) => ({ n: i })), 'phone').length, APP_SEND_MAX_ROWS)
})

test('AI tool - none without routes - field names per route - the word card', () => {
  assert.deepEqual(appSendToolDefs([]), [])
  const [d] = appSendToolDefs([{ route: 'wfB:orders', toName: 'Shop', sheetName: 'Orders', columns: [{ name: 'item', type: 'string', required: true }, { name: 'state', type: 'string', values: ['new', 'done'] }] }])
  assert.equal(d.name, 'work_send_app')
  assert.match(d.description, /route "wfB:orders" = work app "Shop", inbox sheet "Orders" — columns: item \(string, required\), state \(string: new \| done\)/)
  assert.match(d.description, /card/)
  assert.match(d.description, /unconfirmed/)
})

test('deploy review - shows send lines', () => {
  const s = summarizeDeployRisk(JSON.stringify({ nodes: [step('a', 'wfA'), step('b', 'wfB')], edges: [send('e', 'a', 'b', 'orders'), { id: 'r', source: 'a', target: 'b', sourceHandle: 'ref' }] }))
  assert.deepEqual(s.egress, [{ node: 'app a', kindKey: 'workAppSend', target: 'app a → app b (orders)' }])
})

test('save and deploy checks - send lines are not flow lines - empty family rejects only deploy - a node with only send lines is not an orphan', async () => {
  const { validateWorkflowJson } = await import('@/lib/workflow/validation')
  const blocking = (r: ReturnType<typeof validateWorkflowJson>) => r.issues.filter((i) => i.severity !== 'warning')
  const g = (family?: string) => JSON.stringify({
    nodes: [{ id: 's', type: 'start', data: { nodeType: 'start', triggerType: 'workEvent', workEventWorkflowId: 'wfA', workEvents: ['sealed'] } }, step('a', 'wfA'), step('b', 'wfB'), { id: 'e', type: 'end', data: { nodeType: 'end' } }],
    edges: [{ id: 'f1', source: 's', target: 'a' }, { id: 'f2', source: 'a', target: 'e' }, send('x', 'a', 'b', family)],
  })
  const deploy = blocking(validateWorkflowJson(g(), 'deployable'))
  assert.ok(deploy.some((i) => i.edgeId === 'x' && /choose the inbox/.test(i.message)), JSON.stringify(deploy))
  assert.ok(!blocking(validateWorkflowJson(g(), 'structural')).some((i) => i.edgeId === 'x'))
  const ok = blocking(validateWorkflowJson(g('orders'), 'deployable'))
  assert.deepEqual(ok.filter((i) => i.edgeId === 'x' || i.nodeId === 'b'), [], JSON.stringify(ok))
  const self = JSON.stringify({ nodes: [step('a', 'wfA'), step('a2', 'wfA')], edges: [send('y', 'a', 'a2', 'o')] })
  assert.ok(blocking(validateWorkflowJson(self, 'structural')).some((i) => i.edgeId === 'y'))
})
