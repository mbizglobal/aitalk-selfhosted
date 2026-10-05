import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PrismaClient } from '@prisma/client'
import { ifElseNodeExecutor } from './ifelse'
import { WorkflowEngine } from '../engine'
import { WorkflowContext, WorkflowNode } from '../types'

const prismaStub = undefined as unknown as PrismaClient

const ifElseNode = (id: string, conditions: unknown[]): WorkflowNode => ({
  id,
  type: 'custom',
  data: { nodeType: 'ifElse', label: id, conditions },
  position: { x: 0, y: 0 }
} as unknown as WorkflowNode)

const NO_MATCH_CONDITIONS = [{ id: 'if-0', type: 'if', conditionMode: 'simple' }]
const MATCH_MESSAGE_HELLO = [{
  id: 'if-0', type: 'if', conditionMode: 'simple',
  conditionField: 'message', conditionOperator: '==', conditionValue: 'hello'
}]

// ========================================
// ========================================

test('no match and no Else: returns exactly undefined, with no leftover previous ifElseResult', async () => {
  const staleContext = {
    message: 'x',
    ifElseResult: { matchedCondition: 'cond1', matchedHandle: 'cond1', conditionType: 'if' }
  } as WorkflowContext

  const result = await ifElseNodeExecutor.execute(
    ifElseNode('b', NO_MATCH_CONDITIONS), staleContext, prismaStub
  )

  assert.equal(result.context.ifElseResult, undefined,
    `stale ifElseResult 가 지워져야: ${JSON.stringify(result.context.ifElseResult)}`)
  assert.equal(result.debug?.output?.matched, false)
})

test('normal match: sets a new ifElseResult (regression)', async () => {
  const result = await ifElseNodeExecutor.execute(
    ifElseNode('a', MATCH_MESSAGE_HELLO),
    { message: 'hello' } as WorkflowContext,
    prismaStub
  )

  assert.equal(result.context.ifElseResult?.matchedHandle, 'if-0')
  assert.equal(result.debug?.output?.matched, true)
})

test('Else match: matchedHandle=else (regression)', async () => {
  const result = await ifElseNodeExecutor.execute(
    ifElseNode('a', [...NO_MATCH_CONDITIONS, { id: 'else-0', type: 'else' }]),
    { message: 'x' } as WorkflowContext,
    prismaStub
  )

  assert.equal(result.context.ifElseResult?.matchedHandle, 'else')
})

// ========================================
// ========================================

test('engine: in A (match) to B (no match), does not follow B\'s stale-handle edge and ends', async () => {
  const nodes = [
    { id: 'start', type: 'custom', data: { nodeType: 'start', label: 'start' }, position: { x: 0, y: 0 } },
    ifElseNode('a', MATCH_MESSAGE_HELLO),
    ifElseNode('b', NO_MATCH_CONDITIONS),
    { id: 'wrong', type: 'custom', data: { nodeType: 'end', label: 'wrong' }, position: { x: 0, y: 0 } }
  ] as unknown as WorkflowNode[]
  const edges = [
    { id: 'e1', source: 'start', target: 'a' },
    { id: 'e2', source: 'a', target: 'b', sourceHandle: 'if-0' },
    { id: 'e3', source: 'b', target: 'wrong', sourceHandle: 'if-0' }
  ]

  const engine = new WorkflowEngine()
  const result = await engine.execute(
    { nodes, edges } as never,
    { message: 'hello' } as WorkflowContext
  )

  assert.deepEqual(result.executionPath, ['start', 'a', 'b'],
    `B 에서 종료해야 (wrong 미실행): ${JSON.stringify(result.executionPath)}`)
  assert.equal(result.context?.ifElseResult, undefined,
    '최종 context 에 stale ifElseResult 가 남으면 안 됨')
})
