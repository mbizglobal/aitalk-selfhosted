import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WorkflowEngine } from '../engine'
import { WorkflowContext, WorkflowNode } from '../types'

const node = (id: string, nodeType: string, data: Record<string, unknown> = {}): WorkflowNode => ({
  id,
  type: 'custom',
  data: { nodeType, label: id, ...data },
  position: { x: 0, y: 0 }
} as unknown as WorkflowNode)

const edge = (source: string, target: string, sourceHandle?: string) => ({
  id: `e-${source}-${target}${sourceHandle ? '-' + sourceHandle : ''}`,
  source,
  target,
  ...(sourceHandle ? { sourceHandle } : {})
})

const ALWAYS_TRUE = { conditionMode: 'simple', conditionField: 'message', conditionOperator: '==', conditionValue: 'go' }

const run = (nodes: WorkflowNode[], edges: unknown[], ctx: Partial<WorkflowContext>) =>
  new WorkflowEngine().execute({ nodes, edges } as never, ctx as WorkflowContext)

// ========================================
// ========================================

test('path 2: nested while with isLoopTool stops with nodeError', async () => {
  const nodes = [
    node('start', 'start'),
    node('outer', 'while', { loopMode: 'while', maxIterations: 3, ...ALWAYS_TRUE }),
    node('inner', 'while', { loopMode: 'while', maxIterations: 3, isLoopTool: true, loopOrder: 0 })
  ]
  const edges = [edge('start', 'outer'), edge('outer', 'inner', 'loop')]

  const result = await run(nodes, edges, { message: 'go' })

  assert.ok(result.nodeError, `중첩 while 은 nodeError 로 표면화돼야: ${JSON.stringify(result.nodeError)}`)
  assert.match(result.nodeError!.error, /nest/i)
  assert.equal(result.nodeError!.nodeId, 'inner')
})

test('path 1: nested while without isLoopTool is not silently excluded, and gives nodeError', async () => {
  const nodes = [
    node('start', 'start'),
    node('outer', 'while', { loopMode: 'while', maxIterations: 3, ...ALWAYS_TRUE }),
    node('inner', 'while', { loopMode: 'while', maxIterations: 3 })
  ]
  const edges = [edge('start', 'outer'), edge('outer', 'inner', 'loop')]

  const result = await run(nodes, edges, { message: 'go' })

  assert.ok(result.nodeError, `isLoopTool 없는 중첩 while 도 nodeError: ${JSON.stringify(result.nodeError)}`)
  assert.equal(result.nodeError!.nodeId, 'inner')
})

const IFELSE_MATCH_GO = (id: string) => ({
  id: `${id}-0`, type: 'if', conditionMode: 'simple',
  conditionField: 'message', conditionOperator: '==', conditionValue: 'go'
})

test('path 3: while in an If/Else outer branch chain gives nodeError', async () => {
  const nodes = [
    node('start', 'start'),
    node('outer', 'while', { loopMode: 'while', maxIterations: 3, ...ALWAYS_TRUE }),
    node('cond', 'ifElse', { isLoopTool: true, loopOrder: 0, conditions: [IFELSE_MATCH_GO('cond')] }),
    node('extWhile', 'while', { loopMode: 'while', maxIterations: 3 })
  ]
  const edges = [
    edge('start', 'outer'),
    edge('outer', 'cond', 'loop'),
    edge('cond', 'extWhile', 'cond-0')
  ]

  const result = await run(nodes, edges, { message: 'go' })

  assert.ok(result.nodeError, `If/Else 브랜치의 while 도 nodeError: ${JSON.stringify(result.nodeError)}`)
  assert.equal(result.nodeError!.nodeId, 'extWhile')
})

test('path 4: while in a multi-step If/Else outer branch (cond1 to cond2 to while) gives nodeError', async () => {
  const nodes = [
    node('start', 'start'),
    node('outer', 'while', { loopMode: 'while', maxIterations: 3, ...ALWAYS_TRUE }),
    node('cond1', 'ifElse', { isLoopTool: true, loopOrder: 0, conditions: [IFELSE_MATCH_GO('cond1')] }),
    node('cond2', 'ifElse', { conditions: [IFELSE_MATCH_GO('cond2')] }),
    node('extWhile', 'while', { loopMode: 'while', maxIterations: 3 })
  ]
  const edges = [
    edge('start', 'outer'),
    edge('outer', 'cond1', 'loop'),
    edge('cond1', 'cond2', 'cond1-0'),
    edge('cond2', 'extWhile', 'cond2-0')
  ]

  const result = await run(nodes, edges, { message: 'go' })

  assert.ok(result.nodeError, `다단 If/Else 뒤 while 도 nodeError: ${JSON.stringify(result.nodeError)}`)
  assert.equal(result.nodeError!.nodeId, 'extWhile')
})

// ========================================
// ========================================

test('regression: ForEach + ifElse loop body completes without a false fatal', async () => {
  const nodes = [
    node('start', 'start'),
    node('outer', 'while', { loopMode: 'forEach', forEachSource: 'items', forEachItemVar: 'item', maxIterations: 5 }),
    node('cond', 'ifElse', { isLoopTool: true, loopOrder: 0, conditions: [{ id: 'if-0', type: 'if', conditionMode: 'simple' }] })
  ]
  const edges = [edge('start', 'outer'), edge('outer', 'cond', 'loop')]

  const result = await run(nodes, edges, { items: [{ a: 1 }] })

  assert.equal(result.nodeError, undefined,
    `while 아닌 루프 바디는 fatal 이 아니어야: ${JSON.stringify(result.nodeError)}`)
})

test('regression: a normal single while (ending by max-iterations) completes without nodeError', async () => {
  const nodes = [
    node('start', 'start'),
    node('outer', 'while', { loopMode: 'while', maxIterations: 1, ...ALWAYS_TRUE })
  ]
  const edges = [edge('start', 'outer')]

  const result = await run(nodes, edges, { message: 'go' })

  assert.equal(result.nodeError, undefined)
})
