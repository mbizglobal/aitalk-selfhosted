import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateWorkflowJson } from './validation'

//
//

const node = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, data: { nodeType: type, ...data } })
const edge = (source: string, target: string, sourceHandle?: string) => ({ id: `${source}-${target}`, source, target, ...(sourceHandle ? { sourceHandle } : {}) })
const json = (nodes: unknown[], edges: unknown[] = []) => JSON.stringify({ nodes, edges })

const subStart = (data: Record<string, unknown> = {}) => node('start-1', 'start', { triggerType: 'subworkflow', toolName: 'add_points', ...data })
const endOk = node('end-1', 'end', { message: 'Points added: {{context.dataSheetsResult.row.points}}' })

const codes = (r: ReturnType<typeof validateWorkflowJson>, onlyBlocking = true) =>
  r.issues.filter(i => !onlyBlocking || i.severity !== 'warning').map(i => i.code)

test('\'sub: Start/Sub-workflow -> Data Sheets -> End(message) passes structural\'', () => {
  const r = validateWorkflowJson(json(
    [subStart(), node('ds-1', 'dataSheets', { sheetId: 's', operation: 'upsert' }), endOk],
    [edge('start-1', 'ds-1'), edge('ds-1', 'end-1')],
  ), 'structural', 'sub')
  assert.equal(r.valid, true, JSON.stringify(r.issues))
  assert.deepEqual(codes(r, false), [])
})

test('\'sub: rejected if Start is a channel trigger (pstn)\'', () => {
  const r = validateWorkflowJson(json([node('start-1', 'start', { triggerType: 'pstn' }), endOk], [edge('start-1', 'end-1')]), 'structural', 'sub')
  assert.equal(r.valid, false)
  assert.ok(codes(r).includes('SUB_WORKFLOW_RULE'))
})

test('\'sub: rejected if there are two Start/Sub-workflow\'', () => {
  const r = validateWorkflowJson(json([subStart(), { ...subStart(), id: 'start-2' }, endOk], [edge('start-1', 'end-1'), edge('start-2', 'end-1')]), 'structural', 'sub')
  assert.equal(r.valid, false)
})

test('\'sub: rejected if toolName is missing or breaks the rules (field=toolName)\'', () => {
  const r = validateWorkflowJson(json([subStart({ toolName: 'Bad Name' }), endOk], [edge('start-1', 'end-1')]), 'structural', 'sub')
  assert.equal(r.valid, false)
  assert.ok(r.issues.some(i => i.code === 'SUB_WORKFLOW_RULE' && i.field === 'toolName'))
})

test('\'sub: AI nodes are rejected (v1)\'', () => {
  const r = validateWorkflowJson(json([subStart(), node('ai-1', 'ai', { model: 'gpt-5.1' }), endOk], [edge('start-1', 'ai-1'), edge('ai-1', 'end-1')]), 'structural', 'sub')
  assert.equal(r.valid, false)
  assert.ok(r.issues.some(i => i.code === 'SUB_WORKFLOW_RULE' && i.nodeId === 'ai-1'))
})

test('\'sub: wait and pstn nodes are rejected\'', () => {
  for (const t of ['wait', 'pstn']) {
    const r = validateWorkflowJson(json([subStart(), node('x-1', t), endOk], [edge('start-1', 'x-1'), edge('x-1', 'end-1')]), 'structural', 'sub')
    assert.equal(r.valid, false, t)
  }
})

test('\'sub: nodes with tools attached (including sub-in-sub tools) are rejected - depth 1\'', () => {
  const r = validateWorkflowJson(json(
    [subStart(), node('ai-1', 'ai'), { id: 'tool-1', type: 'tool', data: { toolType: 'subworkflow', subWorkflowId: 'wf_x' } }, endOk],
    [edge('start-1', 'ai-1'), edge('ai-1', 'end-1'), edge('ai-1', 'tool-1', 'tools')],
  ), 'structural', 'sub')
  assert.equal(r.valid, false)
  assert.ok(r.issues.some(i => i.nodeId === 'tool-1' && i.code === 'SUB_WORKFLOW_RULE'))
})

test('\'sub: a pure note is allowed, an unknown type is rejected as UNKNOWN_NODE_TYPE\'', () => {
  const ok = validateWorkflowJson(json([subStart(), endOk, { id: 'n', type: 'note', data: { text: 'hi' } }], [edge('start-1', 'end-1')]), 'structural', 'sub')
  assert.equal(ok.valid, true, JSON.stringify(ok.issues))
  const bad = validateWorkflowJson(json([subStart(), node('z', 'zzz'), endOk], [edge('start-1', 'z'), edge('z', 'end-1')]), 'structural', 'sub')
  assert.equal(bad.valid, false)
  assert.ok(codes(bad).includes('UNKNOWN_NODE_TYPE'))
})

test('\'sub: rejected if End has no message (field=message) - prevents result tables/raw errors from being spoken\'', () => {
  const r = validateWorkflowJson(json([subStart(), node('end-1', 'end')], [edge('start-1', 'end-1')]), 'structural', 'sub')
  assert.equal(r.valid, false)
  assert.ok(r.issues.some(i => i.code === 'SUB_WORKFLOW_RULE' && i.nodeId === 'end-1' && i.field === 'message'))
  const blank = validateWorkflowJson(json([subStart(), node('end-1', 'end', { message: '   ' })], [edge('start-1', 'end-1')]), 'structural', 'sub')
  assert.equal(blank.valid, false)
})

test('\'sub: a terminal that does not reach End is a warning (non-blocking) - loop bodies are exempt\'', () => {
  const r = validateWorkflowJson(json(
    [subStart(), node('if-1', 'ifElse', { conditions: [{ id: 'c1', type: 'if' }, { id: 'e', type: 'else' }] }), node('ds-1', 'dataSheets', { sheetId: 's', operation: 'read' }), endOk],
    [edge('start-1', 'if-1'), edge('if-1', 'end-1', 'c1'), edge('if-1', 'ds-1', 'else')],
  ), 'structural', 'sub')
  assert.equal(r.valid, true, JSON.stringify(r.issues))
  assert.ok(r.issues.some(i => i.code === 'SUB_WORKFLOW_RULE' && i.nodeId === 'ds-1' && i.severity === 'warning'))

  const loop = validateWorkflowJson(json(
    [subStart(), node('w-1', 'while', { loopMode: 'forEach', forEachSource: 'input.items' }), node('body-1', 'dataSheets', { sheetId: 's', operation: 'read', isLoopTool: true, loopOrder: 1 }), endOk],
    [edge('start-1', 'w-1'), edge('w-1', 'body-1', 'loop'), edge('w-1', 'end-1', 'exit')],
  ), 'structural', 'sub')
  assert.equal(loop.valid, true, JSON.stringify(loop.issues))
  assert.equal(loop.issues.some(i => i.nodeId === 'body-1'), false)
})

test('\'main: Start triggerType subworkflow is rejected, a sub tool tool-node passes structural\'', () => {
  const bad = validateWorkflowJson(json([node('start-1', 'start', { triggerType: 'subworkflow', toolName: 'x_y' }), endOk], [edge('start-1', 'end-1')]), 'structural', 'main')
  assert.equal(bad.valid, false)
  assert.ok(bad.issues.some(i => i.code === 'SUB_WORKFLOW_RULE' && i.field === 'triggerType'))

  const caller = json(
    [node('start-1', 'start'), node('ai-1', 'ai', { model: 'gpt-5.1' }), { id: 'tool-1', type: 'tool', data: { toolType: 'subworkflow', subWorkflowId: 'wf_x' } }, node('end-1', 'end')],
    [edge('start-1', 'ai-1'), edge('ai-1', 'end-1'), edge('ai-1', 'tool-1', 'tools')],
  )
  assert.equal(validateWorkflowJson(caller, 'structural', 'main').valid, true)
  assert.equal(validateWorkflowJson(caller, 'deployable', 'main').valid, true)
})

test('\'main deployable: blocked when the sub tool has no subWorkflowId (catalog conditionalRequired)\'', () => {
  const caller = json(
    [node('start-1', 'start'), node('ai-1', 'ai', { model: 'gpt-5.1' }), { id: 'tool-1', type: 'tool', data: { toolType: 'subworkflow' } }, node('end-1', 'end')],
    [edge('start-1', 'ai-1'), edge('ai-1', 'end-1'), edge('ai-1', 'tool-1', 'tools')],
  )
  const r = validateWorkflowJson(caller, 'deployable', 'main')
  assert.equal(r.valid, false)
  assert.ok(r.issues.some(i => i.code === 'NODE_SPEC_VIOLATION' && i.nodeId === 'tool-1' && i.field === 'subWorkflowId'))
})

test('\'kind defaults to main - validating a sub JSON without kind skips the sub rules (why the caller must pass it)\'', () => {
  const sub = json([subStart(), node('ai-1', 'ai', { model: 'gpt-5.1' }), endOk], [edge('start-1', 'ai-1'), edge('ai-1', 'end-1')])
  assert.equal(validateWorkflowJson(sub, 'structural', 'sub').valid, false)
  const asMain = validateWorkflowJson(sub, 'structural')
  assert.equal(asMain.issues.some(i => i.nodeId === 'ai-1'), false)
})

test('\'sub: rejected (blocking) if there is no End node at all - such a sub always returns sub_workflow_no_answer\'', () => {
  const r = validateWorkflowJson(json(
    [subStart(), node('ds-1', 'dataSheets', { sheetId: 's', operation: 'upsert' })],
    [edge('start-1', 'ds-1')],
  ), 'structural', 'sub')
  assert.equal(r.valid, false)
  assert.ok(codes(r).includes('SUB_WORKFLOW_RULE'))
  assert.ok(r.issues.some(i => i.severity !== 'warning' && /at least one End/.test(i.message)))
})
