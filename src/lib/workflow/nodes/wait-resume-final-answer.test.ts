import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PrismaClient } from '@prisma/client'
import { waitNodeExecutor } from './wait'
import { WorkflowEngine } from '../engine'
import { WorkflowContext, WorkflowNode } from '../types'

//
//

const prismaStub = undefined as unknown as PrismaClient

const waitNode = (id: string, data: Record<string, unknown> = {}): WorkflowNode => ({
  id,
  type: 'custom',
  data: { nodeType: 'wait', label: id, ...data },
  position: { x: 0, y: 0 }
} as unknown as WorkflowNode)

const STALE_NOTICE = 'Please review the data above and reply "confirm".'

// ========================================
// ========================================

test('resume: does not inherit the previous turn\'s wait notice (finalAnswer) and returns exactly undefined', async () => {
  const result = await waitNodeExecutor.execute(
    waitNode('wait-1'),
    {
      message: 'confirm',
      isResuming: true,
      waitingNodeId: 'wait-1',
      finalAnswer: STALE_NOTICE,
      aiResponse: 'Your order has been placed.'
    } as WorkflowContext,
    prismaStub
  )

  assert.equal(result.context.finalAnswer, undefined,
    `재개 context 에 stale 대기 안내가 남으면 안 됨: ${JSON.stringify(result.context.finalAnswer)}`)
  assert.equal(result.context.isResuming, false)
  assert.equal(result.context.waitingNodeId, undefined)
  assert.notEqual(result.shouldWait, true)
})

test('first run: puts the wait notice in finalAnswer and stops with shouldWait (contract kept)', async () => {
  const result = await waitNodeExecutor.execute(
    waitNode('wait-1', { waitMessage: 'Proceed?', displayMode: 'message' }),
    { message: 'order 3 items' } as WorkflowContext,
    prismaStub
  )

  assert.equal(result.context.finalAnswer, 'Proceed?')
  assert.equal(result.context.waitingNodeId, 'wait-1')
  assert.equal(result.shouldWait, true)
})

test('if the resume target is a different node, treats it as a first run (prevents misapplying the resume branch)', async () => {
  const result = await waitNodeExecutor.execute(
    waitNode('wait-2', { waitMessage: 'Second question?', displayMode: 'message' }),
    {
      message: 'confirm',
      isResuming: true,
      waitingNodeId: 'wait-1',
      finalAnswer: STALE_NOTICE
    } as WorkflowContext,
    prismaStub
  )

  assert.equal(result.shouldWait, true)
  assert.equal(result.context.finalAnswer, 'Second question?')
})

// ========================================
// ========================================

test('engine: Wait resume to End, the final response is the new AI answer, not the stale wait notice', async () => {
  const nodes = [
    { id: 'start', type: 'custom', data: { nodeType: 'start', label: 'start' }, position: { x: 0, y: 0 } },
    waitNode('wait-1'),
    { id: 'end', type: 'custom', data: { nodeType: 'end', label: 'end' }, position: { x: 0, y: 0 } }
  ] as unknown as WorkflowNode[]
  const edges = [
    { id: 'e1', source: 'start', target: 'wait-1' },
    { id: 'e2', source: 'wait-1', target: 'end' }
  ]

  const engine = new WorkflowEngine()
  const result = await engine.execute(
    { nodes, edges } as never,
    {
      message: 'confirm',
      isResuming: true,
      waitingNodeId: 'wait-1',
      finalAnswer: STALE_NOTICE,
      aiResponse: 'Your order has been placed.'
    } as WorkflowContext
  )

  assert.deepEqual(result.executionPath, ['wait-1', 'end'],
    `재개는 Wait 부터 시작해 End 로 끝나야 함: ${JSON.stringify(result.executionPath)}`)
  assert.equal(result.context?.finalAnswer, 'Your order has been placed.',
    `End 가 stale 대기 안내를 최종 응답으로 승격하면 안 됨: ${JSON.stringify(result.context?.finalAnswer)}`)
})
