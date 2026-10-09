
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import '@/lib/agent-lock-test-no-db'
import { WorkflowEngine } from './engine'
import { findReachableCycle } from './validation'
import { createStepBudget, defaultStepLimit, rewindLimit, clampMaxIterations, clampRestoredIteration } from './engine/step-budget'

const n = (id: string, nodeType: string, data: Record<string, unknown> = {}) =>
  ({ id, type: 'custom', data: { nodeType, label: id, ...data }, position: { x: 0, y: 0 } }) as any

const ctx = () => ({ message: 'x', agentId: 'a1', userId: 'u1' }) as any

describe('engine: main loop step limit (engine_safety axis 2)', () => {
  it('a cyclic graph ends with nodeError instead of looping forever', async () => {
    const nodes = [n('start', 'start'), n('a', 'webhook'), n('b', 'webhook')]
    const edges = [
      { id: 'e1', source: 'start', target: 'a' },
      { id: 'e2', source: 'a', target: 'b' },
      { id: 'e3', source: 'b', target: 'a' },
    ]

    const result: any = await new WorkflowEngine().execute({ nodes, edges } as never, ctx())

    assert.ok(result.nodeError, '사이클인데 nodeError 가 없다 — 조용히 성공으로 끝나면 안 된다')
    assert.match(
      String(result.nodeError.error),
      /maximum of \d+ steps/,
      `상한 초과 메시지가 아니다: ${result.nodeError.error}`,
    )

    const expectedLimit = Math.max(nodes.length * 10, 100)
    assert.ok(
      result.executionPath.length <= expectedLimit,
      `상한(${expectedLimit})보다 많이 실행됐다: ${result.executionPath.length}`,
    )
  })

  it('an edge pointing to itself (self-loop) also ends', async () => {
    const nodes = [n('start', 'start'), n('a', 'webhook')]
    const edges = [
      { id: 'e1', source: 'start', target: 'a' },
      { id: 'e2', source: 'a', target: 'a' },
    ]

    const result: any = await new WorkflowEngine().execute({ nodes, edges } as never, ctx())

    assert.ok(result.nodeError, 'self-loop 인데 nodeError 가 없다')
    assert.match(String(result.nodeError.error), /maximum of \d+ steps/)
  })

  it('a normal (acyclic) graph does not hit the limit; guards against false rejection regression', async () => {
    const nodes = [n('start', 'start'), n('a', 'webhook'), n('b', 'webhook')]
    const edges = [
      { id: 'e1', source: 'start', target: 'a' },
      { id: 'e2', source: 'a', target: 'b' },
    ]

    const result: any = await new WorkflowEngine().execute({ nodes, edges } as never, ctx())

    assert.equal(result.nodeError, undefined, `정상 그래프가 거부됐다: ${JSON.stringify(result.nodeError)}`)
    assert.deepEqual(result.executionPath, ['start', 'a', 'b'])
  })
})

describe('findReachableCycle: Test panel entry gate contract (engine_safety axis 1)', () => {
  const json = (nodes: any[], edges: any[]) => JSON.stringify({ nodes, edges })

  it('catches a cycle reachable from Start', () => {
    const id = findReachableCycle(json(
      [n('start', 'start'), n('a', 'webhook'), n('b', 'webhook')],
      [
        { id: 'e1', source: 'start', target: 'a' },
        { id: 'e2', source: 'a', target: 'b' },
        { id: 'e3', source: 'b', target: 'a' },
      ],
    ))
    assert.ok(id, '도달 가능한 사이클을 못 잡았다')
  })

  it('🔴 catches a cycle even with other structural issues (broken edge); gate bypass regression', () => {
    const id = findReachableCycle(json(
      [n('start', 'start'), n('a', 'webhook'), n('b', 'webhook')],
      [
        { id: 'e1', source: 'start', target: 'a' },
        { id: 'e2', source: 'a', target: 'b' },
        { id: 'e3', source: 'b', target: 'a' },
        { id: 'dangling', source: 'a', target: 'NO_SUCH_NODE' },
      ],
    ))
    assert.ok(id, '끊긴 엣지가 있으면 사이클을 놓친다 — 게이트가 우회된다')
  })

  it('🔴 lets an orphan cycle unreachable from Start pass; false rejection regression', () => {
    const id = findReachableCycle(json(
      [n('start', 'start'), n('a', 'webhook'), n('x', 'webhook'), n('y', 'webhook')],
      [
        { id: 'e1', source: 'start', target: 'a' },
        { id: 'o1', source: 'x', target: 'y' },
        { id: 'o2', source: 'y', target: 'x' },
      ],
    ))
    assert.equal(id, null, `고아 사이클을 400 으로 오거부한다: ${id}`)
  })

  it('lets work-in-progress, empty canvas, no Start and broken JSON pass', () => {
    assert.equal(findReachableCycle(json(
      [n('start', 'start'), n('a', 'webhook'), n('orphan', 'webhook')],
      [{ id: 'e1', source: 'start', target: 'a' }],
    )), null)
    assert.equal(findReachableCycle(json([], [])), null)
    assert.equal(findReachableCycle(json([n('a', 'webhook')], [])), null)
    assert.equal(findReachableCycle('{ broken'), null)
  })

  it('🔴 also catches a cycle at the Run-from-here entry point; gate bypass regression', () => {
    const graph = json(
      [n('start', 'start'), n('a', 'webhook'), n('x', 'webhook'), n('y', 'webhook')],
      [
        { id: 'e1', source: 'start', target: 'a' },
        { id: 'o1', source: 'x', target: 'y' },
        { id: 'o2', source: 'y', target: 'x' },
      ],
    )
    assert.equal(findReachableCycle(graph), null, 'Start 기준으로는 고아 사이클이라 통과해야 한다')
    assert.ok(findReachableCycle(graph, ['x']), 'Run-from-here 진입점의 사이클을 놓쳤다')
    assert.ok(findReachableCycle(graph, [undefined, 'y']), 'resumeFromNodeId 진입점을 놓쳤다')
  })

  it('edges that attach tools are not counted as flow cycles', () => {
    const id = findReachableCycle(json(
      [n('start', 'start'), n('ai', 'ai'), n('t', 'webhook')],
      [
        { id: 'e1', source: 'start', target: 'ai' },
        { id: 'e2', source: 'ai', target: 't', sourceHandle: 'tools' },
        { id: 'e3', source: 't', target: 'ai' },
      ],
    ))
    assert.equal(id, null, '부착 엣지를 흐름으로 오인해 사이클로 판정했다')
  })
})

describe('StepBudget: does not falsely reject normal loops', () => {
  it('100 iterations x loop tool does not hit the budget', async () => {
    const nodes = [
      n('start', 'start'),
      n('loop', 'while', {
        maxIterations: 100,
        conditionMode: 'simple', conditionField: 'message', conditionOperator: '==', conditionValue: 'x',
      }),
      n('t1', 'webhook', { isLoopTool: true, loopOrder: 1 }),
    ]
    const edges = [
      { id: 'e1', source: 'start', target: 'loop' },
      { id: 'l1', source: 'loop', target: 't1', sourceHandle: 'loop' },
    ]
    const result: any = await new WorkflowEngine().execute({ nodes, edges } as never, ctx())

    assert.equal(
      result.nodeError, undefined,
      `정상 100회 반복이 사이클로 오거부됐다: ${JSON.stringify(result.nodeError)}`,
    )
    assert.equal(result.context.whileResult?.totalIterations, 100, '100회를 다 돌지 않았다')
  })

  it('forEach does not die on the same axis (short array, only checking the axis)', async () => {
    const nodes = [
      n('start', 'start'),
      n('loop', 'while', { loopMode: 'forEach', forEachSource: 'jsonData.rows', maxIterations: 100 }),
      n('t1', 'webhook', { isLoopTool: true, loopOrder: 1 }),
    ]
    const edges = [
      { id: 'e1', source: 'start', target: 'loop' },
      { id: 'l1', source: 'loop', target: 't1', sourceHandle: 'loop' },
    ]
    const result: any = await new WorkflowEngine().execute({ nodes, edges } as never, {
      ...ctx(),
      jsonData: { rows: Array.from({ length: 3 }, (_, i) => ({ i })) },
    } as any)
    assert.equal(result.nodeError, undefined, `forEach 가 오거부됐다: ${JSON.stringify(result.nodeError)}`)
  })
})

describe('clampMaxIterations: input validation', () => {
  it('clamps to the UI maximum (while 100, forEach 1000)', () => {
    assert.equal(clampMaxIterations(1e308, 'while'), 100)
    assert.equal(clampMaxIterations(1e308, 'forEach'), 1000)
  })

  it('uses the existing default when there is no value (same falsy branch as the old `raw || default`)', () => {
    assert.equal(clampMaxIterations(undefined, 'while'), 10)
    assert.equal(clampMaxIterations(null, 'while'), 10)
    assert.equal(clampMaxIterations(0, 'forEach'), 100)
    assert.equal(clampMaxIterations('', 'forEach'), 100)
  })

  it('🔴 explicitly abnormal values mean 0 runs; does not increase the amount of execution', () => {
    assert.equal(clampMaxIterations(-5, 'while'), 0)
    assert.equal(clampMaxIterations('abc', 'forEach'), 0)
    assert.equal(clampMaxIterations(Infinity, 'while'), 0)
    assert.equal(clampMaxIterations(NaN, 'while'), 10, 'NaN 은 falsy 라 기본값(구 동작과 동일)')
  })

  it('normal range passes through unchanged', () => {
    assert.equal(clampMaxIterations(50, 'while'), 50)
    assert.equal(clampMaxIterations(500, 'forEach'), 500)
  })

  it('🔴 also validates the iteration counter in the resume context; synchronous infinite loop regression', async () => {
    const nodes = [
      n('start', 'start'),
      n('loop', 'while', {
        maxIterations: 100,
        conditionMode: 'simple', conditionField: 'message', conditionOperator: '==', conditionValue: 'x',
      }),
    ]
    const edges = [{ id: 'e1', source: 'start', target: 'loop' }]

    const result: any = await new WorkflowEngine().execute({ nodes, edges } as never, ctx(), {
      initialContext: {
        isResuming: true,
        whileLoopContext: { whileNodeId: 'loop', currentIteration: -1e308 },
      },
    } as any)
    assert.ok(result, '끝나지 않았다 — 무한 루프')
  })

  it('normalization: abnormal restored values become 0, normal values are kept, over the cap becomes the cap', () => {
    assert.equal(clampRestoredIteration(-1e308, 100), 0)
    assert.equal(clampRestoredIteration(NaN, 100), 0)
    assert.equal(clampRestoredIteration(-5, 100), 0)
    assert.equal(clampRestoredIteration('abc', 100), 0)
    assert.equal(clampRestoredIteration(7, 100), 7)
    assert.equal(clampRestoredIteration(999, 100), 100)
  })

  it('🔴 a While with no body and a huge maxIterations ends immediately', async () => {
    const nodes = [n('start', 'start'), n('loop', 'while', { maxIterations: 1e308 })]
    const edges = [{ id: 'e1', source: 'start', target: 'loop' }]
    const result: any = await new WorkflowEngine().execute({ nodes, edges } as never, ctx())
    assert.ok(result, '끝나지 않았다')
  })
})

describe('StepBudget: per-component limits (engine_safety axis 2)', () => {
  it('returns false when exhausted', () => {
    const b = createStepBudget(3)
    assert.equal(b.consume(), true)
    assert.equal(b.consume(), true)
    assert.equal(b.consume(), true)
    assert.equal(b.consume(), false, '한도를 넘겼는데 계속 true 다')
  })

  it('graph traversal limit = node count x 10, minimum 100', () => {
    assert.equal(defaultStepLimit(3), 100)
    assert.equal(defaultStepLimit(50), 500)
  })

  it('rewind limit = loop tool count x 50, minimum 200 (a policy cap, not a proof of cycles)', () => {
    assert.equal(rewindLimit(1), 200)
    assert.equal(rewindLimit(10), 500)
  })
})

describe('rewind counting: engine level', () => {
  const graph = (branchTarget: string) => ({
    nodes: [
      n('start', 'start'),
      n('loop', 'while', {
        maxIterations: 30,
        conditionMode: 'simple', conditionField: 'message', conditionOperator: '==', conditionValue: 'x',
      }),
      n('t1', 'webhook', { isLoopTool: true, loopOrder: 1 }),
      n('cond', 'ifElse', {
        isLoopTool: true,
        loopOrder: 2,
        conditions: [{ id: 'c1', type: 'if', conditionMode: 'simple', conditionField: 'message', conditionOperator: '==', conditionValue: 'x' }],
      }),
      n('t3', 'webhook', { isLoopTool: true, loopOrder: 3 }),
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'loop' },
      { id: 'l1', source: 'loop', target: 't1', sourceHandle: 'loop' },
      { id: 'l2', source: 'loop', target: 'cond', sourceHandle: 'loop' },
      { id: 'l3', source: 'loop', target: 't3', sourceHandle: 'loop' },
      { id: 'b1', source: 'cond', target: branchTarget, sourceHandle: 'c1' },
    ],
  })

  const run = (branchTarget: string) =>
    new WorkflowEngine().execute(graph(branchTarget) as never, ctx())

  it('forward branches do not use budget, so 30 iterations survive', async () => {
    const result: any = await run('t3')
    assert.equal(
      result.nodeError, undefined,
      `전진 분기가 되감기로 오계수돼 오거부됐다: ${JSON.stringify(result.nodeError)}`,
    )
  })

  it('a backward jump ends at the limit (prevents infinite rewinding)', async () => {
    const result: any = await run('t1')
    assert.ok(result, '끝나지 않았다')
  })
})

describe('initialContext: reserved key blocking', () => {
  const runWith = (initialContext: Record<string, unknown>) =>
    new WorkflowEngine().execute(
      {
        nodes: [n('start', 'start'), n('a', 'webhook')],
        edges: [{ id: 'e1', source: 'start', target: 'a' }],
      } as never,
      { message: 'x', agentId: 'agent_1', userId: 'user_1', isTestMode: false, isManaged: false } as any,
      { initialContext } as any,
    )

  it('cannot overwrite the billing-exempt field', async () => {
    const r: any = await runWith({ skipAiCallCpa: true, isTestMode: true })
    assert.notEqual(r.context.skipAiCallCpa, true, 'CPA 차감 면제가 주입됐다')
    assert.notEqual(r.context.isTestMode, true, 'isTestMode 가 주입됐다')
  })

  it('cannot overwrite the platform credential selection', async () => {
    const r: any = await runWith({ isManaged: true, managedRegion: 'switzerlandnorth' })
    assert.notEqual(r.context.isManaged, true, 'Managed 자격증명 선택이 주입됐다')
    assert.equal(r.context.managedRegion, undefined)
  })

  it('cannot overwrite the attribution field', async () => {
    const r: any = await runWith({ workflowId: 'FORGED', scheduleRunKey: 'FORGED', isScheduledTrigger: true })
    assert.notEqual(r.context.workflowId, 'FORGED')
    assert.notEqual(r.context.scheduleRunKey, 'FORGED')
    assert.notEqual(r.context.isScheduledTrigger, true)
  })

  it('ownership is still restored (existing keepOwner guarantee)', async () => {
    const r: any = await runWith({ agentId: 'OTHER', userId: 'OTHER' })
    assert.equal(r.context.agentId, 'agent_1')
    assert.equal(r.context.userId, 'user_1')
  })

  it('normal fields are merged as is; resume snapshots do not break', async () => {
    const r: any = await runWith({ jsonData: { ok: 1 }, aiResponse: '이전 응답' })
    assert.deepEqual(r.context.jsonData, { ok: 1 })
    assert.equal(r.context.aiResponse, '이전 응답')
  })
})
