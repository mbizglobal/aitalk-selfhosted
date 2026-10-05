import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CANVAS_NODE_TYPE_BY_NODE_TYPE, canvasNodeTypeOf } from './nodeUtils'

//
//

const REGISTERED = readFileSync(
  join(process.cwd(), 'src/app/app/agent-studio/components/WorkflowCanvas.tsx'),
  'utf8',
)

test('every target type in the mapping is actually registered in WorkflowCanvas nodeTypes', () => {
  const block = REGISTERED.slice(
    REGISTERED.indexOf('const nodeTypes: NodeTypes = {'),
    REGISTERED.indexOf('}', REGISTERED.indexOf('const nodeTypes: NodeTypes = {')),
  )
  assert.ok(block.length > 0, 'nodeTypes 블록을 못 찾았다 — 테스트가 낡았다')
  for (const target of new Set(Object.values(CANVAS_NODE_TYPE_BY_NODE_TYPE))) {
    assert.match(block, new RegExp(`\\b${target}\\s*:`), `nodeTypes 에 "${target}" 이 없다`)
  }
})

test('nodes with a dedicated component get their type corrected based on nodeType', () => {
  assert.equal(canvasNodeTypeOf({ type: 'custom', data: { nodeType: 'dataSheets' } }), 'dataSheets')
  assert.equal(canvasNodeTypeOf({ type: 'custom', data: { nodeType: 'branch' } }), 'ifElse')
  assert.equal(canvasNodeTypeOf({ type: 'custom', data: { nodeType: 'while' } }), 'while')
  assert.equal(canvasNodeTypeOf({ type: 'custom', data: { nodeType: 'wait' } }), 'wait')
  assert.equal(canvasNodeTypeOf({ type: 'custom', data: { nodeType: 'continue' } }), 'continue')
  assert.equal(canvasNodeTypeOf({ type: 'custom', data: { nodeType: 'note' } }), 'note')
})

test('corrects even when the type field is missing entirely - saved data from MCP authoring that omitted type', () => {
  assert.equal(canvasNodeTypeOf({ data: { nodeType: 'dataSheets' } }), 'dataSheets')
  assert.equal(canvasNodeTypeOf({ type: undefined, data: { nodeType: 'branch' } }), 'ifElse')
  assert.equal(canvasNodeTypeOf({ type: '', data: { nodeType: 'while' } }), 'while')
})

test('leaves an already-correct type alone (nodes made by the palette)', () => {
  assert.equal(canvasNodeTypeOf({ type: 'dataSheets', data: { nodeType: 'dataSheets' } }), 'dataSheets')
  assert.equal(canvasNodeTypeOf({ type: 'ifElse', data: { nodeType: 'branch' } }), 'ifElse')
})

test('does not change a node that already has a different dedicated type - changing it would change execution semantics', () => {
  assert.equal(canvasNodeTypeOf({ type: 'while', data: { nodeType: 'dataSheets' } }), 'while')
  assert.equal(canvasNodeTypeOf({ type: 'wait', data: { nodeType: 'branch' } }), 'wait')
  assert.equal(canvasNodeTypeOf({ type: 'note', data: { nodeType: 'while' } }), 'note')
})

test('nodes not in the mapping keep their original type - AI, End, SendGrid etc. are correctly CustomNode', () => {
  assert.equal(canvasNodeTypeOf({ type: 'custom', data: { nodeType: 'ai' } }), 'custom')
  assert.equal(canvasNodeTypeOf({ type: 'custom', data: { nodeType: 'end' } }), 'custom')
  assert.equal(canvasNodeTypeOf({ type: 'custom', data: { nodeType: 'sendgrid' } }), 'custom')
  assert.equal(canvasNodeTypeOf({ type: 'custom', data: { nodeType: 'httpRequest' } }), 'custom')
})

test('never changes tool-attached nodes - type:"tool" is the criterion for the engine and validator', () => {
  assert.equal(canvasNodeTypeOf({ type: 'tool', data: { toolType: 'subworkflow' } }), 'tool')
  assert.equal(canvasNodeTypeOf({ type: 'tool', data: { toolType: 'source' } }), 'tool')
  assert.equal(canvasNodeTypeOf({ type: 'tool', data: { toolType: 'microsoft_calendar', nodeType: 'microsoft_calendar' } }), 'tool')

  assert.equal(canvasNodeTypeOf({ type: 'tool', data: { toolType: 'source', nodeType: 'dataSheets' } }), 'tool')
  assert.equal(canvasNodeTypeOf({ type: 'tool', data: { nodeType: 'branch' } }), 'tool')
})

test('does not throw for nodes with no data or no nodeType', () => {
  assert.equal(canvasNodeTypeOf({ type: 'custom' }), 'custom')
  assert.equal(canvasNodeTypeOf({}), undefined)
  assert.equal(canvasNodeTypeOf(null), undefined)
})
