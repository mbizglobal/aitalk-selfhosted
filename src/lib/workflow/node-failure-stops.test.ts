
import { test } from 'node:test'
import assert from 'node:assert/strict'

import '@/lib/agent-lock-test-no-db'
import { WorkflowEngine } from './engine'
import { WhileLoopExecutor } from './nodes/while'
import { WorkflowContext, WorkflowNode } from './types'

const node = (id: string, nodeType: string, data: Record<string, unknown> = {}): WorkflowNode => ({
  id,
  type: 'custom',
  data: { nodeType, label: id, ...data },
  position: { x: 0, y: 0 },
} as unknown as WorkflowNode)

const edge = (source: string, target: string, sourceHandle?: string) => ({
  id: `e-${source}-${target}${sourceHandle ? '-' + sourceHandle : ''}`,
  source,
  target,
  ...(sourceHandle ? { sourceHandle } : {}),
})

const run = (
  nodes: WorkflowNode[],
  edges: unknown[],
  ctx: Partial<WorkflowContext>,
  options?: { onNodeComplete?: (log: { nodeId: string }) => void },
) => new WorkflowEngine().execute({ nodes, edges } as never, ctx as WorkflowContext, options as never)

test('axis 4: when an action node fails, later nodes are not run and execution stops', async () => {
  const nodes = [
    node('start', 'start'),
    node('fail', 'dataSheets', { operation: 'insert' }),
    node('end', 'end'),
  ]
  const edges = [edge('start', 'fail'), edge('fail', 'end')]

  const result = await run(nodes, edges, { message: 'hi' })

  assert.ok(result.nodeError, `실패가 nodeError 로 안 올라왔다 — 조용히 성공하면 안 된다`)
  assert.equal(result.nodeError!.nodeId, 'fail')
  assert.match(result.nodeError!.error, /sheetId/i)

  assert.ok(
    !result.executionPath.includes('end'),
    `실패 뒤에도 End 가 실행됐다 — 중단이 안 된 것이다: ${JSON.stringify(result.executionPath)}`,
  )
  assert.deepEqual(result.executionPath, ['start', 'fail'])
})

test('axis 4 control: with no failure it runs to the end and there is no nodeError', async () => {
  const nodes = [node('start', 'start'), node('end', 'end')]
  const edges = [edge('start', 'end')]

  const result = await run(nodes, edges, { message: 'hi' })

  assert.equal(
    result.nodeError,
    undefined,
    `정상 그래프가 거부됐다: ${JSON.stringify(result.nodeError)}`,
  )
  assert.deepEqual(result.executionPath, ['start', 'end'])
})

// ========================================
//
//
// ========================================

const failLoopTool = (id: string) =>
  node(id, 'dataSheets', { operation: 'insert', isLoopTool: true, loopOrder: 0 })

const okLoopTool = (id: string) =>
  node(id, 'ifElse', { isLoopTool: true, loopOrder: 0, conditions: [{ id: `${id}-0`, type: 'if', conditionMode: 'simple' }] })

const countCompletions = (nodeId: string) => {
  const hits: string[] = []
  return {
    onNodeComplete: (log: { nodeId: string }) => { if (log.nodeId === nodeId) hits.push(log.nodeId) },
    get count() { return hits.length },
  }
}

test('axis 4 (loop): when an action node in a ForEach body fails, remaining items are not processed and execution stops', async () => {
  const nodes = [
    node('start', 'start'),
    node('loop', 'while', { loopMode: 'forEach', forEachSource: 'items', forEachItemVar: 'item', maxIterations: 5 }),
    failLoopTool('fail'),
    node('end', 'end'),
  ]
  const edges = [edge('start', 'loop'), edge('loop', 'fail', 'loop'), edge('loop', 'end', 'exit')]

  const probe = countCompletions('fail')
  const result = await run(nodes, edges, { message: 'hi', items: [1, 2, 3] }, probe)

  assert.ok(result.nodeError, '루프 안 실패가 nodeError 로 안 올라왔다 — 조용히 성공하면 안 된다')
  assert.equal(result.nodeError!.nodeId, 'fail')
  assert.match(result.nodeError!.error, /sheetId/i)

  assert.equal(probe.count, 1, `첫 실패 뒤에도 루프가 계속 돌았다 (${probe.count}회 실행)`)

  assert.ok(
    !result.executionPath.includes('end'),
    `실패 뒤에도 End 가 실행됐다: ${JSON.stringify(result.executionPath)}`,
  )
})

test('axis 4 (loop): stops even when a node in an If/Else outer branch chain fails', async () => {
  const nodes = [
    node('start', 'start'),
    node('loop', 'while', { loopMode: 'forEach', forEachSource: 'items', forEachItemVar: 'item', maxIterations: 5 }),
    node('cond', 'ifElse', {
      isLoopTool: true, loopOrder: 0,
      conditions: [{ id: 'cond-0', type: 'if', conditionMode: 'simple', conditionField: 'message', conditionOperator: '==', conditionValue: 'go' }],
    }),
    node('extFail', 'dataSheets', { operation: 'insert' }),
    node('end', 'end'),
  ]
  const edges = [
    edge('start', 'loop'),
    edge('loop', 'cond', 'loop'),
    edge('cond', 'extFail', 'cond-0'),
    edge('loop', 'end', 'exit'),
  ]

  const probe = countCompletions('extFail')
  const result = await run(nodes, edges, { message: 'go', items: [1, 2, 3] }, probe)

  assert.ok(result.nodeError, '분기 체인의 실패가 nodeError 로 안 올라왔다')
  assert.equal(result.nodeError!.nodeId, 'extFail')
  assert.equal(probe.count, 1, `분기 노드 실패 뒤에도 루프가 계속 돌았다 (${probe.count}회 실행)`)
  assert.ok(!result.executionPath.includes('end'), `실패 뒤에도 End 가 실행됐다: ${JSON.stringify(result.executionPath)}`)
})

test('axis 4 (loop) control: when the body is healthy, all items run and nodes after exit run too', async () => {
  const nodes = [
    node('start', 'start'),
    node('loop', 'while', { loopMode: 'forEach', forEachSource: 'items', forEachItemVar: 'item', maxIterations: 5 }),
    okLoopTool('ok'),
    node('end', 'end'),
  ]
  const edges = [edge('start', 'loop'), edge('loop', 'ok', 'loop'), edge('loop', 'end', 'exit')]

  const probe = countCompletions('ok')
  const result = await run(nodes, edges, { message: 'hi', items: [1, 2] }, probe)

  assert.equal(result.nodeError, undefined, `정상 루프가 거부됐다: ${JSON.stringify(result.nodeError)}`)
  assert.equal(probe.count, 2, `항목 2개가 다 안 돌았다 (${probe.count}회)`)
  assert.ok(result.executionPath.includes('end'), `exit 뒤 End 가 안 돌았다: ${JSON.stringify(result.executionPath)}`)
})

// ----------------------------------------
//
// ----------------------------------------

const FOREACH = node('loop', 'while', {
  loopMode: 'forEach', forEachSource: 'items', forEachItemVar: 'item', maxIterations: 5,
})

const loopExecutor = (nodes: WorkflowNode[], edges: unknown[], executeNode: unknown) =>
  new WhileLoopExecutor(
    {} as never,
    nodes,
    edges,
    executeNode as never,
    ((n: WorkflowNode | null) => (n?.data?.nodeType ?? null)) as never,
  )

test('axis 4 (loop): when a loop body node throws, it is not swallowed and execution stops', async () => {
  const nodes = [FOREACH, node('boom', 'sendgrid', { isLoopTool: true, loopOrder: 0 })]
  const edges = [edge('loop', 'boom', 'loop')]

  let calls = 0
  const result = await loopExecutor(nodes, edges, async () => {
    calls++
    throw new Error('SendGrid connection refused')
  }).executeLoop(FOREACH, { message: 'hi', items: [1, 2, 3] } as unknown as WorkflowContext)

  assert.ok(result.fatalError, '던진 예외가 삼켜졌다 — fatalError 로 올라와야 한다')
  assert.equal(result.fatalError!.nodeId, 'boom')
  assert.match(result.fatalError!.error, /connection refused/i)
  assert.equal(result.terminatedBy, 'error')
  assert.equal(calls, 1, `예외 뒤에도 루프가 계속 돌았다 (${calls}회 실행)`)
})

test('axis 4 (loop): stops even when an If/Else outer branch chain throws', async () => {
  const nodes = [
    FOREACH,
    node('cond', 'ifElse', { isLoopTool: true, loopOrder: 0 }),
    node('boom', 'sendgrid'),
  ]
  const edges = [edge('loop', 'cond', 'loop'), edge('cond', 'boom', 'cond-0')]

  let boomCalls = 0
  const result = await loopExecutor(nodes, edges, async (n: WorkflowNode, _t: string, ctx: WorkflowContext) => {
    if (n.id === 'boom') {
      boomCalls++
      throw new Error('SendGrid connection refused')
    }
    return { context: { ...ctx, ifElseResult: { matchedHandle: 'cond-0' } }, debug: { status: 'success', output: {} } }
  }).executeLoop(FOREACH, { message: 'hi', items: [1, 2, 3] } as unknown as WorkflowContext)

  assert.ok(result.fatalError, '분기 체인의 예외가 삼켜졌다')
  assert.equal(result.fatalError!.nodeId, 'boom')
  assert.equal(result.terminatedBy, 'error')
  assert.equal(boomCalls, 1, `예외 뒤에도 루프가 계속 돌았다 (${boomCalls}회 실행)`)
})

// ----------------------------------------
//
// ----------------------------------------

test('axis 4 (loop): stops even when an action node in a While-mode body fails', async () => {
  const nodes = [
    node('start', 'start'),
    node('loop', 'while', {
      loopMode: 'while', maxIterations: 3,
      conditionMode: 'simple', conditionField: 'message', conditionOperator: '==', conditionValue: 'go',
    }),
    failLoopTool('fail'),
    node('end', 'end'),
  ]
  const edges = [edge('start', 'loop'), edge('loop', 'fail', 'loop'), edge('loop', 'end', 'exit')]

  const probe = countCompletions('fail')
  const result = await run(nodes, edges, { message: 'go' }, probe)

  assert.ok(result.nodeError, 'While 모드 루프 실패가 nodeError 로 안 올라왔다')
  assert.equal(result.nodeError!.nodeId, 'fail')
  assert.equal(probe.count, 1, `첫 실패 뒤에도 While 루프가 계속 돌았다 (${probe.count}회 실행)`)
  assert.ok(!result.executionPath.includes('end'), `실패 뒤에도 End 가 실행됐다: ${JSON.stringify(result.executionPath)}`)
})

const SUCCESS_WRAPPED_FAILURES: Array<[string, Record<string, unknown>]> = [
  ['folderNotFound 절', { success: true, folderNotFound: true, error: 'Folder "Done" not found' }],
  ['success:false 절', { success: false, error: 'Move failed' }],
]

for (const [label, output] of SUCCESS_WRAPPED_FAILURES) {
  test(`axis 4 (loop): stops a failure inside a success result (${label}) in the direct loop tool`, async () => {
    const nodes = [FOREACH, node('imap', 'imap', { isLoopTool: true, loopOrder: 0 })]
    const edges = [edge('loop', 'imap', 'loop')]

    let calls = 0
    const result = await loopExecutor(nodes, edges, async (_n: WorkflowNode, _t: string, ctx: WorkflowContext) => {
      calls++
      return { context: ctx, debug: { status: 'success', output } }
    }).executeLoop(FOREACH, { message: 'hi', items: [1, 2, 3] } as unknown as WorkflowContext)

    assert.ok(result.fatalError, `${label} 이 조용히 성공 처리됐다`)
    assert.equal(result.fatalError!.nodeId, 'imap')
    assert.equal(result.terminatedBy, 'error')
    assert.equal(calls, 1, `실패 뒤에도 루프가 계속 돌았다 (${calls}회 실행)`)
  })

  test(`axis 4 (loop): stops a failure inside a success result (${label}) in the branch chain too`, async () => {
    const nodes = [
      FOREACH,
      node('cond', 'ifElse', { isLoopTool: true, loopOrder: 0 }),
      node('ext', 'imap'),
    ]
    const edges = [edge('loop', 'cond', 'loop'), edge('cond', 'ext', 'cond-0')]

    const result = await loopExecutor(nodes, edges, async (n: WorkflowNode, _t: string, ctx: WorkflowContext) => {
      if (n.id === 'ext') return { context: ctx, debug: { status: 'success', output } }
      return { context: { ...ctx, ifElseResult: { matchedHandle: 'cond-0' } }, debug: { status: 'success', output: {} } }
    }).executeLoop(FOREACH, { message: 'hi', items: [1, 2, 3] } as unknown as WorkflowContext)

    assert.ok(result.fatalError, `분기 체인의 ${label} 이 바깥 루프를 못 멈췄다`)
    assert.equal(result.fatalError!.nodeId, 'ext')
    assert.equal(result.terminatedBy, 'error')
  })
}

const archiveRetryOutput = { success: true, archiveFailed: true, failedUid: 42 }

test('axis 4 (loop) control: archiveFailed in the direct loop tool is a retry, not fatal', async () => {
  const nodes = [FOREACH, node('imap', 'imap', { isLoopTool: true, loopOrder: 0 })]
  const edges = [edge('loop', 'imap', 'loop')]

  const result = await loopExecutor(nodes, edges, async (_n: WorkflowNode, _t: string, ctx: WorkflowContext) => ({
    context: ctx,
    debug: { status: 'success', output: archiveRetryOutput },
  })).executeLoop(FOREACH, { message: 'hi', items: [1, 2, 3] } as unknown as WorkflowContext)

  assert.equal(result.fatalError, undefined, `재시도 신호가 fatal 로 뒤집혔다: ${JSON.stringify(result.fatalError)}`)
  assert.equal(result.needsRetry, true, '재시도 신호가 유실됐다')
  assert.equal(result.terminatedBy, 'archive-failed')
})

test('axis 4 (loop) control: archiveFailed in the branch chain is also passed on as a retry', async () => {
  const nodes = [
    FOREACH,
    node('cond', 'ifElse', { isLoopTool: true, loopOrder: 0 }),
    node('ext', 'imap'),
  ]
  const edges = [edge('loop', 'cond', 'loop'), edge('cond', 'ext', 'cond-0')]

  const result = await loopExecutor(nodes, edges, async (n: WorkflowNode, _t: string, ctx: WorkflowContext) => {
    if (n.id === 'ext') return { context: ctx, debug: { status: 'success', output: archiveRetryOutput } }
    return { context: { ...ctx, ifElseResult: { matchedHandle: 'cond-0' } }, debug: { status: 'success', output: {} } }
  }).executeLoop(FOREACH, { message: 'hi', items: [1, 2, 3] } as unknown as WorkflowContext)

  assert.equal(result.fatalError, undefined, `분기 체인 재시도가 fatal 로 뒤집혔다: ${JSON.stringify(result.fatalError)}`)
  assert.equal(result.needsRetry, true, '분기 체인의 재시도 신호가 유실됐다')
  assert.equal(result.terminatedBy, 'archive-failed')
})
