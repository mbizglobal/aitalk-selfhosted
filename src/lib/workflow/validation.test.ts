import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateWorkflowJson } from './validation'

const SPEC_DEFAULTS: Record<string, Record<string, unknown>> = {
  ai: { model: 'gpt-4.1-mini' },
  smtp: { mode: 'forward', to: 'x@y.ch' },
  ifElse: { conditions: [{ id: 'if-0', type: 'if' }, { id: 'else', type: 'else' }] },
}
const node = (id: string, nodeType: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'custom',
  data: { nodeType, label: id, ...(SPEC_DEFAULTS[nodeType] ?? {}), ...extra },
  position: { x: 0, y: 0 },
})
const edge = (source: string, target: string, sourceHandle?: string) => ({
  id: `e-${source}-${target}`,
  source,
  target,
  ...(sourceHandle ? { sourceHandle } : {}),
})
const wf = (nodes: unknown[], edges: unknown[]) => JSON.stringify({ nodes, edges })


const expectWarning = (r: ReturnType<typeof validateWorkflowJson>, code: string, nodeId?: string) => {
  const found = r.issues.find(i => i.code === code && (nodeId === undefined || i.nodeId === nodeId))
  assert.ok(found, `${code}@${nodeId} 가 보고돼야: ${JSON.stringify(r.issues)}`)
  assert.equal(found!.severity, 'warning', `${code}@${nodeId} 는 warning 이어야(차단 X): ${JSON.stringify(found)}`)
  assert.equal(r.valid, true, `경고만 있으면 valid 여야: ${JSON.stringify(r.issues)}`)
}

const VALID_LINEAR = wf(
  [node('s', 'start'), node('a', 'ai'), node('e', 'end')],
  [edge('s', 'a'), edge('a', 'e')],
)

// ── structural ──────────────────────────────────────────

test('\'structural: valid graph, blank, and incomplete draft pass\'', () => {
  assert.equal(validateWorkflowJson(VALID_LINEAR, 'structural').valid, true)
  assert.equal(validateWorkflowJson('{"nodes":[],"edges":[]}', 'structural').valid, true)
  const incomplete = wf([node('a', 'ai')], [])
  assert.equal(validateWorkflowJson(incomplete, 'structural').valid, true)
})

test('\'structural: JSON parse failure = JSON_PARSE_ERROR\'', () => {
  const r = validateWorkflowJson('not json {', 'structural')
  assert.equal(r.valid, false)
  assert.equal(r.issues[0].code, 'JSON_PARSE_ERROR')
})

test('\'structural: root schema defense - array/missing/non-object = ROOT_SCHEMA_INVALID (no exception)\'', () => {
  for (const bad of ['[]', '"str"', 'null', '{}', '{"nodes":{}}', '{"nodes":[],"edges":"x"}']) {
    const r = validateWorkflowJson(bad, 'structural')
    assert.equal(r.valid, false, `${bad} 는 거부돼야`)
    assert.equal(r.issues[0].code, bad === 'not json {' ? 'JSON_PARSE_ERROR' : 'ROOT_SCHEMA_INVALID')
  }
})

test('\'structural: node/edge item shape defense\'', () => {
  const r1 = validateWorkflowJson('{"nodes":[{"type":"ai"}],"edges":[]}', 'structural')
  assert.equal(r1.issues[0].code, 'NODE_SHAPE_INVALID')
  const r2 = validateWorkflowJson('{"nodes":[],"edges":[{"source":"a"}]}', 'structural')
  assert.equal(r2.issues[0].code, 'EDGE_SHAPE_INVALID')
  const r3 = validateWorkflowJson(wf([{ id: 'a', data: 'oops' }], []), 'structural')
  assert.equal(r3.issues[0].code, 'NODE_SHAPE_INVALID')
})

test('\'structural: duplicate node ID = DUPLICATE_NODE_ID\'', () => {
  const r = validateWorkflowJson(wf([node('a', 'ai'), node('a', 'ai')], []), 'structural')
  assert.equal(r.valid, false)
  assert.equal(r.issues[0].code, 'DUPLICATE_NODE_ID')
  assert.equal(r.issues[0].nodeId, 'a')
})

test('\'structural: missing edge endpoints = EDGE_ENDPOINT_MISSING (collects both sides)\'', () => {
  const r = validateWorkflowJson(wf([node('a', 'ai')], [edge('ghost1', 'ghost2')]), 'structural')
  assert.equal(r.valid, false)
  assert.equal(r.issues.length, 2)
  assert.ok(r.issues.every(i => i.code === 'EDGE_ENDPOINT_MISSING'))
})

test('\'structural: cycle = GRAPH_CYCLE - also catches cycles in graphs not reached from Start\'', () => {
  const r = validateWorkflowJson(
    wf(
      [node('s', 'start'), node('e', 'end'), node('x', 'ai'), node('y', 'ai')],
      [edge('s', 'e'), edge('x', 'y'), edge('y', 'x')],
    ),
    'structural',
  )
  assert.equal(r.valid, false)
  assert.equal(r.issues[0].code, 'GRAPH_CYCLE')
})

test('\'structural: tools/miniapps attachment edges are excluded from the cycle check\'', () => {
  const r = validateWorkflowJson(
    wf(
      [node('s', 'start'), node('a', 'ai'), node('e', 'end'), { id: 't', type: 'tool', data: { toolType: 'source' } }],
      [edge('s', 'a'), edge('a', 'e'), edge('a', 't', 'tools'), edge('t', 'a')],
    ),
    'structural',
  )
  assert.equal(r.valid, true, JSON.stringify(r.issues))
})

// ── deployable ──────────────────────────────────────────

test('\'deployable: a valid linear graph passes, blank is rejected for missing Start/End\'', () => {
  assert.equal(validateWorkflowJson(VALID_LINEAR, 'deployable').valid, true)
  const r = validateWorkflowJson('{"nodes":[],"edges":[]}', 'deployable')
  assert.equal(r.valid, false)
  assert.deepEqual(r.issues.map(i => i.code).sort(), ['END_NODE_MISSING', 'START_NODE_MISSING'])
})

test('\'deployable: orphan = ORPHAN_NODE, second default edge target = UNREACHABLE_NODE\'', () => {
  const r = validateWorkflowJson(
    wf(
      [node('s', 'start'), node('a', 'ai'), node('e', 'end'), node('orphan', 'ai'), node('dead', 'ai')],
      [edge('s', 'a'), edge('a', 'e'), edge('a', 'dead')],
    ),
    'deployable',
  )
  assert.equal(r.valid, false)
  const codes = r.issues.map(i => `${i.code}:${i.nodeId}`)
  assert.ok(codes.includes('ORPHAN_NODE:orphan'), JSON.stringify(codes))
  assert.ok(codes.includes('UNREACHABLE_NODE:dead'), JSON.stringify(codes))
  assert.equal(codes.filter(c => c.endsWith(':orphan')).length, 1, JSON.stringify(codes))
})

test('\'deployable: a direct while loop body is legal even as a terminal (isLoopTool required)\'', () => {
  const r = validateWorkflowJson(
    wf(
      [
        node('s', 'start'), node('w', 'while'),
        node('body1', 'ai', { isLoopTool: true, loopOrder: 0 }),
        node('e', 'end'),
      ],
      [edge('s', 'w'), edge('w', 'body1', 'loop'), edge('w', 'e', 'exit')],
    ),
    'deployable',
  )
  assert.equal(r.valid, true, JSON.stringify(r.issues))
})

test('\'deployable: a loop target without isLoopTool = warning (the engine silently skips it)\'', () => {
  const r = validateWorkflowJson(
    wf(
      [node('s', 'start'), node('w', 'while'), node('body1', 'ai'), node('e', 'end')],
      [edge('s', 'w'), edge('w', 'body1', 'loop'), edge('w', 'e', 'exit')],
    ),
    'deployable',
  )
  expectWarning(r, 'NODE_SPEC_VIOLATION', 'body1')
  assert.ok(r.issues.some(i => /isLoopTool/.test(i.message)), JSON.stringify(r.issues))
})

test('\'deployable: miniapps edges consume only the quiz shape - others are warnings (pretend attached)\'', () => {
  const mk = (m: unknown) => wf(
    [node('s', 'start'), node('ai', 'ai'), node('e', 'end'), m],
    [edge('s', 'ai'), edge('ai', 'e'), edge('ai', 'm', 'miniapps')],
  )
  const bad = validateWorkflowJson(mk({ id: 'm', type: 'tool', data: { toolType: 'source' }, position: { x: 0, y: 0 } }), 'deployable')
  expectWarning(bad, 'NODE_SPEC_VIOLATION', 'm')
  assert.ok(bad.issues.some(i => /miniapps handle/.test(i.message)), JSON.stringify(bad.issues))

  const good = validateWorkflowJson(
    mk({ id: 'm', type: 'tool', data: { toolType: 'miniapp', nodeType: 'miniapp', miniAppType: 'quiz' }, position: { x: 0, y: 0 } }),
    'deployable',
  )
  assert.equal(good.valid, true, JSON.stringify(good.issues))
})

test('\'deployable: the normal edge chain of a loop body node is not reachable - separated from the main queue\'', () => {
  const r = validateWorkflowJson(
    wf(
      [
        node('s', 'start'),
        node('w', 'while', { loopMode: 'forEach', forEachSource: 'a.b' }),
        node('body1', 'ai', { isLoopTool: true, loopOrder: 0 }),
        node('body2', 'telegram', { chatId: '1', message: 'never' }),
        node('e', 'end'),
      ],
      [edge('s', 'w'), edge('w', 'body1', 'loop'), edge('body1', 'body2'), edge('body2', 'e'), edge('w', 'e', 'exit')],
    ),
    'deployable',
  )
  expectWarning(r, 'UNREACHABLE_NODE', 'body2')
})

test('\'deployable: nodes after End are also traversed as main flow (the engine does not stop at End)\'', () => {
  const r = validateWorkflowJson(
    wf(
      [
        node('s', 'start'),
        node('w', 'while', { loopMode: 'forEach', forEachSource: 'a.b' }),
        { id: 'br', type: 'ifElse', data: { nodeType: 'branch', isLoopTool: true, loopOrder: 0, conditions: [{ id: 'if-0', type: 'if' }, { id: 'else', type: 'else' }] }, position: { x: 0, y: 0 } },
        node('sk', 'telegram', { chatId: '2', message: 'y' }),
        node('after', 'telegram', { chatId: '1', message: 'x' }),
        node('e', 'end'),
      ],
      [
        edge('s', 'w'), edge('w', 'br', 'loop'),
        edge('br', 'e', 'if-0'), edge('br', 'sk', 'else'),
        edge('e', 'after'), edge('w', 'e', 'exit'),
      ],
    ),
    'deployable',
  )
  assert.ok(r.issues.some(i => i.code === 'DEAD_END_NODE' && i.nodeId === 'after'), JSON.stringify(r.issues))
  assert.ok(!r.issues.some(i => i.code === 'UNREACHABLE_NODE' && i.nodeId === 'after'), `End 뒤는 도달 가능해야: ${JSON.stringify(r.issues)}`)
})

test('\'deployable: a nested while (a while used as a loop body) is a runtime fatal - warning + that body is unreachable\'', () => {
  const r = validateWorkflowJson(
    wf(
      [
        node('s', 'start'),
        node('w1', 'while', { loopMode: 'forEach', forEachSource: 'a.b' }),
        node('w2', 'while', { loopMode: 'forEach', forEachSource: 'c.d', isLoopTool: true, loopOrder: 0 }),
        node('b2', 'ai', { isLoopTool: true, loopOrder: 0 }),
        node('e', 'end'),
      ],
      [edge('s', 'w1'), edge('w1', 'w2', 'loop'), edge('w2', 'b2', 'loop'), edge('w1', 'e', 'exit')],
    ),
    'deployable',
  )
  expectWarning(r, 'NODE_SPEC_VIOLATION', 'w2')
  expectWarning(r, 'UNREACHABLE_NODE', 'b2')
})

test('\'deployable: the loop body of an unreachable while is not counted as reachable (loopBody is per while)\'', () => {
  const r = validateWorkflowJson(
    wf(
      [
        node('s', 'start'),
        node('w1', 'while', { loopMode: 'forEach', forEachSource: 'a.b' }),
        node('b1', 'ai', { isLoopTool: true, loopOrder: 0 }),
        node('w2', 'while', { loopMode: 'forEach', forEachSource: 'c.d' }),
        node('b2', 'ai', { isLoopTool: true, loopOrder: 0 }),
        node('e', 'end'),
      ],
      [
        edge('s', 'w1'), edge('w1', 'b1', 'loop'), edge('w1', 'e', 'exit'),
        edge('w2', 'b2', 'loop'), edge('w2', 'e', 'exit'),
      ],
    ),
    'deployable',
  )
  assert.equal(r.valid, false)
  const codes = r.issues.map(i => `${i.code}:${i.nodeId}`)
  assert.ok(codes.includes('ORPHAN_NODE:w2'), JSON.stringify(codes))
  assert.ok(codes.some(c => c.endsWith(':b2')), `도달 불가 while 의 바디도 플래그돼야: ${JSON.stringify(codes)}`)
})

test('\'deployable: the main flow runs only the first edge - the second default edge target is unreachable\'', () => {
  const r = validateWorkflowJson(
    wf(
      [node('s', 'start'), node('e', 'end'), node('ghost', 'telegram', { chatId: '1', message: 'never' })],
      [edge('s', 'e'), edge('s', 'ghost'), edge('ghost', 'e')],
    ),
    'deployable',
  )
  expectWarning(r, 'UNREACHABLE_NODE', 'ghost')
})

test('\'deployable: drawing the same condition handle twice makes the second target unreachable\'', () => {
  const r = validateWorkflowJson(
    wf(
      [
        node('s', 'start'),
        { id: 'br', type: 'ifElse', data: { nodeType: 'branch', conditions: [{ id: 'if-0', type: 'if' }, { id: 'else', type: 'else' }] }, position: { x: 0, y: 0 } },
        node('first', 'end'), node('dup', 'telegram', { chatId: '1', message: 'never' }), node('e2', 'end'),
      ],
      [
        edge('s', 'br'),
        { id: 'h1', source: 'br', target: 'first', sourceHandle: 'if-0' },
        { id: 'h2', source: 'br', target: 'dup', sourceHandle: 'if-0' },
        edge('br', 'e2', 'else'),
      ],
    ),
    'deployable',
  )
  expectWarning(r, 'UNREACHABLE_NODE', 'dup')
})

test('\'security: if the source of a tools edge is not AI, nobody consumes it -> not an attachment\'', () => {
  const r = validateWorkflowJson(
    wf(
      [node('s', 'start'), node('e', 'end'), { id: 't', type: 'tool', data: { toolType: 'webSearch' }, position: { x: 0, y: 0 } }],
      [edge('s', 'e'), edge('s', 't', 'tools')],
    ),
    'deployable',
  )
  assert.equal(r.valid, false)
  assert.ok(r.issues.some(i => i.nodeId === 't'), JSON.stringify(r.issues))
})

test('\'security: even as a tools edge target, type!==tool is not an attachment - the engine ignores it\'', () => {
  const r = validateWorkflowJson(
    wf(
      [
        node('s', 'start'), node('ai', 'ai'), node('e', 'end'),
        { id: 'n', type: 'note', data: { toolType: 'webSearch' }, position: { x: 0, y: 0 } },
      ],
      [edge('s', 'ai'), edge('ai', 'e'), edge('ai', 'n', 'tools')],
    ),
    'deployable',
  )
  assert.equal(r.valid, false)
  assert.ok(r.issues.some(i => i.nodeId === 'n'), JSON.stringify(r.issues))
})

test('\'deployable: a loop branch chain ends at End - nodes after it are not exempt\'', () => {
  const r = validateWorkflowJson(
    wf(
      [
        node('s', 'start'),
        node('w', 'while', { loopMode: 'forEach', forEachSource: 'x.items' }),
        { id: 'br', type: 'ifElse', data: { nodeType: 'branch', isLoopTool: true, loopOrder: 0, conditions: [{ id: 'if-0', type: 'if' }, { id: 'else', type: 'else' }] }, position: { x: 0, y: 0 } },
        node('sk', 'telegram', { chatId: '2', message: 'y' }),
        node('after', 'telegram', { chatId: '1', message: 'x' }),
        node('e', 'end'),
      ],
      [
        edge('s', 'w'), edge('w', 'br', 'loop'),
        edge('br', 'e', 'if-0'), edge('br', 'sk', 'else'),
        edge('e', 'after'),
        edge('w', 'e', 'exit'),
      ],
    ),
    'deployable',
  )
  expectWarning(r, 'DEAD_END_NODE', 'after')
})

test('\'deployable: the default output of a loop branch chain runs only the first edge - the rest are not exempt\'', () => {
  const r = validateWorkflowJson(
    wf(
      [
        node('s', 'start'),
        node('w', 'while', { loopMode: 'forEach', forEachSource: 'x.items' }),
        { id: 'br', type: 'ifElse', data: { nodeType: 'branch', isLoopTool: true, loopOrder: 0, conditions: [{ id: 'if-0', type: 'if' }, { id: 'else', type: 'else' }] }, position: { x: 0, y: 0 } },
        node('first', 'telegram', { chatId: '1', message: 'a' }),
        node('chainA', 'telegram', { chatId: '2', message: 'b' }),
        node('chainB', 'telegram', { chatId: '3', message: 'c' }),
        node('sk', 'telegram', { chatId: '4', message: 'd' }),
        node('e', 'end'),
      ],
      [
        edge('s', 'w'), edge('w', 'br', 'loop'),
        edge('br', 'first', 'if-0'), edge('br', 'sk', 'else'),
        edge('first', 'chainA'), edge('first', 'chainB'),
        edge('w', 'e', 'exit'),
      ],
    ),
    'deployable',
  )
  expectWarning(r, 'UNREACHABLE_NODE', 'chainB')
  assert.ok(!r.issues.some(i => i.nodeId === 'chainA'), `첫 기본출력은 정상: ${JSON.stringify(r.issues)}`)
})

test('\'deployable: an edge without a handle in a branch inside a loop is not executed -> not exempt\'', () => {
  const r = validateWorkflowJson(
    wf(
      [
        node('s', 'start'),
        node('w', 'while', { loopMode: 'forEach', forEachSource: 'x.items' }),
        { id: 'br', type: 'ifElse', data: { nodeType: 'branch', isLoopTool: true, loopOrder: 0, conditions: [{ id: 'if-0', type: 'if' }, { id: 'else', type: 'else' }] }, position: { x: 0, y: 0 } },
        node('tg', 'telegram', { chatId: '1', message: 'hi' }),
        node('sk', 'telegram', { chatId: '2', message: 'skip' }),
        node('ghost', 'telegram', { chatId: '3', message: 'never' }),
        node('e', 'end'),
      ],
      [
        edge('s', 'w'), edge('w', 'br', 'loop'),
        edge('br', 'tg', 'if-0'), edge('br', 'sk', 'else'),
        edge('br', 'ghost'),
        edge('w', 'e', 'exit'),
      ],
    ),
    'deployable',
  )
  expectWarning(r, 'UNREACHABLE_NODE', 'ghost')
})

test('\'deployable: with includeBranchesInLoop:false, outer branches are not executed -> not exempt\'', () => {
  const r = validateWorkflowJson(
    wf(
      [
        node('s', 'start'),
        node('w', 'while', { loopMode: 'forEach', forEachSource: 'x.items' }),
        { id: 'br', type: 'ifElse', data: { nodeType: 'branch', isLoopTool: true, loopOrder: 0, includeBranchesInLoop: false, conditions: [{ id: 'if-0', type: 'if' }, { id: 'else', type: 'else' }] }, position: { x: 0, y: 0 } },
        node('tg', 'telegram', { chatId: '1', message: 'hi' }),
        node('sk', 'telegram', { chatId: '2', message: 'skip' }),
        node('e', 'end'),
      ],
      [edge('s', 'w'), edge('w', 'br', 'loop'), edge('br', 'tg', 'if-0'), edge('br', 'sk', 'else'), edge('w', 'e', 'exit')],
    ),
    'deployable',
  )
  expectWarning(r, 'UNREACHABLE_NODE', 'tg')
})

test('\'deployable: a pure note is only an edgeless annotation - rejected if it sits in the flow\'', () => {
  const inFlow = validateWorkflowJson(
    wf(
      [node('s', 'start'), { id: 'n', type: 'note', data: { noteText: 'memo' }, position: { x: 0, y: 0 } }, node('e', 'end')],
      [edge('s', 'n'), edge('n', 'e', 'default')],
    ),
    'deployable',
  )
  assert.equal(inFlow.valid, false, '흐름에 낀 note 가 통과하면 안 된다')

  const floating = validateWorkflowJson(
    wf(
      [node('s', 'start'), node('e', 'end'), { id: 'memo', type: 'note', data: { noteText: 'hi' }, position: { x: 0, y: 0 } }],
      [edge('s', 'e')],
    ),
    'deployable',
  )
  assert.equal(floating.valid, true, JSON.stringify(floating.issues))
})

test('\'deployable: a branch target terminal of an ifElse inside a loop is legal - executeBranchNode runs it inline\'', () => {
  const r = validateWorkflowJson(
    wf(
      [
        node('s', 'start'),
        node('w', 'while', { loopMode: 'forEach', forEachSource: 'x.items' }),
        { id: 'br', type: 'ifElse', data: { nodeType: 'branch', isLoopTool: true, loopOrder: 0, conditions: [{ id: 'if-0', type: 'if' }, { id: 'else', type: 'else' }] }, position: { x: 0, y: 0 } },
        node('tg', 'telegram', { chatId: '1', message: 'hi' }),
        node('sk', 'telegram', { chatId: '2', message: 'skip' }),
        node('e', 'end'),
      ],
      [
        edge('s', 'w'), edge('w', 'br', 'loop'),
        edge('br', 'tg', 'if-0'), edge('br', 'sk', 'else'),
        edge('w', 'e', 'exit'),
      ],
    ),
    'deployable',
  )
  assert.equal(r.valid, true, JSON.stringify(r.issues))
})

test('\'deployable: nodes chained from a loop body are not exempt - the executor does not follow the chain\'', () => {
  const r = validateWorkflowJson(
    wf(
      [
        node('s', 'start'), node('w', 'while'),
        node('body1', 'ai', { isLoopTool: true, loopOrder: 0 }),
        node('body2', 'smtp'),
        node('e', 'end'),
      ],
      [edge('s', 'w'), edge('w', 'body1', 'loop'), edge('body1', 'body2'), edge('w', 'e', 'exit')],
    ),
    'deployable',
  )
  expectWarning(r, 'UNREACHABLE_NODE', 'body2')
})

test('\'security: an execution node disguised as note/tool cannot be hidden\'', () => {
  for (const disguise of ['note', 'tool']) {
    const r = validateWorkflowJson(
      wf(
        [
          node('s', 'start'),
          { id: 'x', type: disguise, data: { nodeType: 'httpRequest', mode: 'single' }, position: { x: 0, y: 0 } },
          node('e', 'end'),
        ],
        [edge('s', 'x'), edge('x', 'e')],
      ),
      'deployable',
    )
    assert.equal(r.valid, false, `type:'${disguise}' 위장이 통과하면 안 된다`)
    assert.ok(r.issues.some(i => i.code === 'NODE_SPEC_VIOLATION' && i.nodeId === 'x' && /url/.test(i.message)),
      `type:'${disguise}': ${JSON.stringify(r.issues)}`)
  }
})

test('\'security: an execution node cannot be hidden by double-connecting with a tools edge + a flow edge\'', () => {
  const r = validateWorkflowJson(
    wf(
      [
        node('s', 'start'), node('a', 'ai'),
        { id: 'x', type: 'custom', data: { nodeType: 'httpRequest', toolType: 'source', mode: 'single' }, position: { x: 0, y: 0 } },
        node('e', 'end'),
      ],
      [edge('s', 'a'), edge('a', 'x', 'tools'), edge('a', 'x'), edge('x', 'e')],
    ),
    'deployable',
  )
  assert.equal(r.valid, false)
  assert.ok(r.issues.some(i => i.code === 'NODE_SPEC_VIOLATION' && i.nodeId === 'x' && /url/.test(i.message)), JSON.stringify(r.issues))
})

test('\'deployable: tool/note nodes are excluded from the connectivity check\'', () => {
  const r = validateWorkflowJson(
    wf(
      [
        node('s', 'start'), node('a', 'ai'), node('e', 'end'),
        { id: 't', type: 'tool', data: { toolType: 'source', parentId: 'a' } },
        { id: 'memo', type: 'note', data: { label: 'memo' } },
      ],
      [edge('s', 'a'), edge('a', 'e'), edge('a', 't', 'tools')],
    ),
    'deployable',
  )
  assert.equal(r.valid, true, JSON.stringify(r.issues))
})

test('\'deployable: Start is not recognized by id convention alone - aligned with engine resolveNodeType\'', () => {
  const r = validateWorkflowJson(
    wf(
      [
        { id: '1', type: 'custom', data: { label: 'Chat' } },
        { id: '2', type: 'custom', data: { nodeType: 'ai', label: 'AI' } },
        { id: '3', type: 'custom', data: { label: 'End' } },
      ],
      [edge('1', '2'), edge('2', '3')],
    ),
    'deployable',
  )
  assert.equal(r.valid, false)
  assert.ok(r.issues.some(i => i.code === 'START_NODE_MISSING'), JSON.stringify(r.issues))
})

test('\'deployable: a detached component is UNREACHABLE_NODE - the engine runs only the first Start\'', () => {
  const r = validateWorkflowJson(
    wf(
      [node('s1', 'start'), node('e1', 'end'), node('s2', 'start'), node('a2', 'ai'), node('e2', 'end')],
      [edge('s1', 'e1'), edge('s2', 'a2'), edge('a2', 'e2')],
    ),
    'deployable',
  )
  expectWarning(r, 'UNREACHABLE_NODE', 'a2')
  expectWarning(r, 'UNREACHABLE_NODE', 'e2')
})

test('\'deployable: a second Start is a warning - Start1->End<-Start2\'', () => {
  const r = validateWorkflowJson(
    wf(
      [node('s1', 'start'), node('e', 'end'), node('s2', 'start')],
      [edge('s1', 'e'), edge('s2', 'e')],
    ),
    'deployable',
  )
  expectWarning(r, 'UNREACHABLE_NODE', 's2')
})

test('\'deployable: a second Start reached by an edge from a previous node is allowed (the engine runs it as a normal node)\'', () => {
  const r = validateWorkflowJson(
    wf(
      [node('s1', 'start'), node('s2', 'start'), node('e', 'end')],
      [edge('s1', 's2'), edge('s2', 'e')],
    ),
    'deployable',
  )
  assert.equal(r.valid, true, JSON.stringify(r.issues))
})

test('\'deployable: the loop edge target of a non-while node cannot run -> UNREACHABLE_NODE\'', () => {
  const r = validateWorkflowJson(
    wf(
      [node('s', 'start'), node('a', 'ai'), node('e', 'end'), node('x', 'smtp')],
      [edge('s', 'a'), edge('a', 'e'), edge('a', 'x', 'loop')],
    ),
    'deployable',
  )
  expectWarning(r, 'UNREACHABLE_NODE', 'x')
})

test('\'D0b: AI node model is not required - the executor has a default (do not over-validate)\'', () => {
  const r = validateWorkflowJson(
    wf(
      [node('s', 'start'), node('a', 'ai', { model: '' }), node('e', 'end')],
      [edge('s', 'a'), edge('a', 'e')],
    ),
    'deployable',
  )
  assert.equal(r.valid, true, JSON.stringify(r.issues))
})

test('\'D0b: missing httpRequest mode applies the single default rule -> url required (do not under-validate)\'', () => {
  const noUrl = validateWorkflowJson(
    wf(
      [node('s', 'start'), node('h', 'httpRequest'), node('e', 'end')],
      [edge('s', 'h'), edge('h', 'e')],
    ),
    'deployable',
  )
  assert.ok(noUrl.issues.some(i => i.code === 'NODE_SPEC_VIOLATION' && /url.*defaults to "single"/.test(i.message)), JSON.stringify(noUrl.issues))

  const withUrl = validateWorkflowJson(
    wf(
      [node('s', 'start'), node('h', 'httpRequest', { url: 'https://api.example.com' }), node('e', 'end')],
      [edge('s', 'h'), edge('h', 'e')],
    ),
    'deployable',
  )
  assert.equal(withUrl.valid, true, JSON.stringify(withUrl.issues))
})

test('\'D0b: httpRequest multi - blocks duplicate or empty aliases in enabled requests (engine_safety.md)\'', () => {
  const multi = (requests: unknown[]) =>
    validateWorkflowJson(
      wf(
        [node('s', 'start'), node('h', 'httpRequest', { mode: 'multi', baseUrl: 'https://api.example.com', requests }), node('e', 'end')],
        [edge('s', 'h'), edge('h', 'e')],
      ),
      'deployable',
    )

  const dup = multi([
    { alias: 'quote', method: 'GET', path: '/a', enabled: true },
    { alias: 'quote', method: 'GET', path: '/b', enabled: true },
  ])
  assert.equal(dup.valid, false, '중복 alias 는 차단돼야')
  assert.ok(dup.issues.some(i => i.code === 'NODE_SPEC_VIOLATION' && /duplicate request alias "quote"/.test(i.message)), JSON.stringify(dup.issues))

  const blank = multi([
    { alias: '', method: 'GET', path: '/a', enabled: true },
    { alias: '  ', method: 'GET', path: '/b', enabled: true },
  ])
  assert.equal(blank.valid, false, '빈 alias 는 차단돼야')
  assert.equal(blank.issues.filter(i => /empty "alias"/.test(i.message)).length, 2, JSON.stringify(blank.issues))

  const disabled = multi([
    { alias: 'quote', method: 'GET', path: '/a', enabled: true },
    { alias: 'quote', method: 'GET', path: '/b', enabled: false },
    { alias: '', method: 'GET', path: '/c', enabled: false },
  ])
  assert.equal(disabled.valid, true, JSON.stringify(disabled.issues))

  const ok = multi([
    { alias: 'quote', method: 'GET', path: '/a', enabled: true },
    { alias: 'stock', method: 'GET', path: '/b', enabled: true },
  ])
  assert.equal(ok.valid, true, JSON.stringify(ok.issues))

  const spaced = multi([
    { alias: 'quote', method: 'GET', path: '/a', enabled: true },
    { alias: ' quote ', method: 'GET', path: '/b', enabled: true },
  ])
  assert.equal(spaced.valid, true, JSON.stringify(spaced.issues))

  for (const bad of ['a.b', 'a}b', '__proto__', 'constructor', 'prototype', ' constructor ']) {
    const r = multi([{ alias: bad, method: 'GET', path: '/a', enabled: true }])
    assert.equal(r.valid, false, `alias "${bad}" 는 차단돼야: ${JSON.stringify(r.issues)}`)
    assert.ok(r.issues.some(i => /not usable as a result key/.test(i.message)), JSON.stringify(r.issues))
  }
  assert.equal(multi([{ alias: 'my-quote_2', method: 'GET', path: '/a', enabled: true }]).valid, true)

  assert.equal(
    validateWorkflowJson(
      wf(
        [node('s', 'start'), node('h', 'httpRequest', { mode: 'multi', baseUrl: 'https://x.ch', requests: [{ alias: '', enabled: true }] }), node('e', 'end')],
        [edge('s', 'h'), edge('h', 'e')],
      ),
      'structural',
    ).valid,
    true,
  )
})

test('\'D0b: rejects httpRequest single + hmac - it would go out with authentication missing entirely\'', () => {
  const at = (data: Record<string, unknown>) =>
    validateWorkflowJson(
      wf(
        [node('s', 'start'), node('h', 'httpRequest', data), node('e', 'end')],
        [edge('s', 'h'), edge('h', 'e')],
      ),
      'deployable',
    )
  const rejected = (r: ReturnType<typeof at>) =>
    !r.valid && r.issues.some(i => i.code === 'NODE_SPEC_VIOLATION' && /authType "hmac" works in multi mode only/.test(i.message))

  const url = 'https://api.binance.com/api/v3/account'

  assert.ok(rejected(at({ mode: 'single', url, authType: 'hmac' })), '명시 single 은 차단돼야')
  assert.ok(rejected(at({ url, authType: 'hmac' })), 'mode 부재도 single 이라 차단돼야')
  assert.ok(rejected(at({ mode: 'nope', url, authType: 'hmac' })), '무효 mode 도 single 로 떨어지므로 차단돼야')

  assert.equal(
    at({ mode: 'multi', baseUrl: 'https://api.binance.com', requests: [{ alias: 'account', method: 'GET', path: '/api/v3/account', enabled: true, signed: true }], authType: 'hmac' }).valid,
    true,
  )
  for (const authType of ['none', 'apiKey', 'bearer', 'basic']) {
    assert.equal(at({ mode: 'single', url, authType }).valid, true, `single + ${authType} 는 통과해야`)
  }

  assert.equal(
    validateWorkflowJson(
      wf(
        [node('s', 'start'), node('h', 'httpRequest', { mode: 'single', url, authType: 'hmac' }), node('e', 'end')],
        [edge('s', 'h'), edge('h', 'e')],
      ),
      'structural',
    ).valid,
    true,
  )
})

test('\'D0b: enum violation (imap action) + conditional required (move -> targetFolder)\'', () => {
  const bad = validateWorkflowJson(
    wf(
      [node('s', 'start'), node('i', 'imap', { action: 'explode' }), node('e', 'end')],
      [edge('s', 'i'), edge('i', 'e')],
    ),
    'deployable',
  )
  assert.ok(bad.issues.some(i => i.code === 'NODE_SPEC_VIOLATION' && /must be one of/.test(i.message)), JSON.stringify(bad.issues))

  const moveNoTarget = validateWorkflowJson(
    wf(
      [node('s', 'start'), node('i', 'imap', { action: 'move', emailUid: '{{context.currentEmail.uid}}' }), node('e', 'end')],
      [edge('s', 'i'), edge('i', 'e')],
    ),
    'deployable',
  )
  assert.ok(moveNoTarget.issues.some(i => /targetFolder/.test(i.message)), JSON.stringify(moveNoTarget.issues))
})

test('\'D0b: unknown node type = UNKNOWN_NODE_TYPE (blocks nodes the engine silently skips)\'', () => {
  const r = validateWorkflowJson(
    wf(
      [node('s', 'start'), node('x', 'quantumFlux'), node('e', 'end')],
      [edge('s', 'x'), edge('x', 'e')],
    ),
    'deployable',
  )
  assert.ok(r.issues.some(i => i.code === 'UNKNOWN_NODE_TYPE' && i.nodeId === 'x'), JSON.stringify(r.issues))
})

test('\'D0b: non-executable stubs (webhook/email) = deploy rejected\'', () => {
  const r = validateWorkflowJson(
    wf(
      [node('s', 'start'), node('w', 'webhook'), node('e', 'end')],
      [edge('s', 'w'), edge('w', 'e')],
    ),
    'deployable',
  )
  assert.ok(r.issues.some(i => i.code === 'NODE_SPEC_VIOLATION' && /not executable/.test(i.message)), JSON.stringify(r.issues))
})

test('\'D0b: branch (canvas save convention) = validated with the ifElse spec, conditions required\'', () => {
  const withConditions = validateWorkflowJson(
    wf(
      [
        node('s', 'start'),
        { id: 'b', type: 'ifElse', data: { nodeType: 'branch', conditions: [{ id: 'if-0', type: 'if' }, { id: 'else', type: 'else' }] }, position: { x: 0, y: 0 } },
        node('e', 'end'), node('e2', 'end'),
      ],
      [edge('s', 'b'), edge('b', 'e', 'if-0'), edge('b', 'e2', 'else')],
    ),
    'deployable',
  )
  assert.equal(withConditions.valid, true, JSON.stringify(withConditions.issues))

  const noConditions = validateWorkflowJson(
    wf(
      [
        node('s', 'start'),
        { id: 'b', type: 'ifElse', data: { nodeType: 'branch' }, position: { x: 0, y: 0 } },
        node('e', 'end'),
      ],
      [edge('s', 'b'), edge('b', 'e', 'if-0')],
    ),
    'deployable',
  )
  assert.ok(noConditions.issues.some(i => i.code === 'NODE_SPEC_VIOLATION' && /conditions/.test(i.message)), JSON.stringify(noConditions.issues))
})

test('\'D0b: structural level does not validate node specs (preserves saving incomplete drafts)\'', () => {
  const r = validateWorkflowJson(
    wf([node('a', 'ai', { model: '' }), node('x', 'quantumFlux')], []),
    'structural',
  )
  assert.equal(r.valid, true, JSON.stringify(r.issues))
})

test('\'issue collection: does not stop at the first failure (for bulk fixing by an external AI)\'', () => {
  const r = validateWorkflowJson(
    wf(
      [node('a', 'ai'), node('a', 'ai')],
      [edge('ghost', 'a')],
    ),
    'structural',
  )
  assert.equal(r.valid, false)
  const codes = r.issues.map(i => i.code)
  assert.ok(codes.includes('DUPLICATE_NODE_ID'))
  assert.ok(codes.includes('EDGE_ENDPOINT_MISSING'))
})

const branchWf = (conditions: unknown[]) =>
  wf(
    [node('s', 'start'), node('br', 'ifElse', { conditions }), node('e1', 'end'), node('e2', 'end')],
    [edge('s', 'br'), edge('br', 'e1', 'if-0'), edge('br', 'e2', 'else')],
  )

const whileWf = (data: Record<string, unknown>) =>
  wf(
    [
      node('s', 'start'),
      node('w', 'while', data),
      node('body', 'ai', { isLoopTool: true, loopOrder: 0 }),
      node('e', 'end'),
    ],
    [edge('s', 'w'), edge('w', 'body', 'loop'), edge('w', 'e', 'exit')],
  )

test('\'deployable: Code mode syntax error = blocking (not a warning)\'', () => {
  const r = validateWorkflowJson(
    branchWf([
      { id: 'if-0', type: 'if', conditionMode: 'code', customExpression: 'jsonData.n > 1 ? true : false' },
      { id: 'else', type: 'else' },
    ]),
    'deployable',
  )
  assert.equal(r.valid, false, JSON.stringify(r.issues))
  const found = r.issues.find(i => i.code === 'CONDITION_EXPRESSION_INVALID')
  assert.ok(found, JSON.stringify(r.issues))
  assert.equal(found!.nodeId, 'br')
  assert.notEqual(found!.severity, 'warning', '차단이어야 한다')
})

test('\'deployable: a normal Code mode expression passes - no over-rejection\'', () => {
  const r = validateWorkflowJson(
    branchWf([
      {
        id: 'if-0', type: 'if', conditionMode: 'code',
        customExpression: 'jsonData.amount > 100 && (jsonData.status == "pending" || jsonData.status == "review")',
      },
      { id: 'else', type: 'else' },
    ]),
    'deployable',
  )
  assert.equal(r.valid, true, JSON.stringify(r.issues))
})

test('\'deployable: customExpression left in simple/builder is not checked (the engine does not read it)\'', () => {
  const r = validateWorkflowJson(
    branchWf([
      {
        id: 'if-0', type: 'if', conditionMode: 'simple',
        conditionField: 'jsonData.x', conditionOperator: '==', conditionValue: '1',
        customExpression: 'x ? y : z',
      },
      { id: 'else', type: 'else' },
    ]),
    'deployable',
  )
  assert.equal(r.valid, true, JSON.stringify(r.issues))
})

test('\'deployable: else conditions are not evaluated at all, so they are not checked\'', () => {
  const r = validateWorkflowJson(
    branchWf([
      { id: 'if-0', type: 'if', conditionMode: 'code', customExpression: 'jsonData.ok == true' },
      { id: 'else', type: 'else', conditionMode: 'code', customExpression: '?? broken ??' },
    ]),
    'deployable',
  )
  assert.equal(r.valid, true, JSON.stringify(r.issues))
})

test('\'deployable: conditions **after** else are unreachable -> not checked\'', () => {
  const r = validateWorkflowJson(
    branchWf([
      { id: 'if-0', type: 'if', conditionMode: 'code', customExpression: 'jsonData.ok == true' },
      { id: 'else', type: 'else' },
      { id: 'if-1', type: 'if', conditionMode: 'code', customExpression: 'a ? b : c' },
    ]),
    'deployable',
  )
  assert.ok(
    !r.issues.some(i => i.code === 'CONDITION_EXPRESSION_INVALID'),
    `else 뒤 조건은 검사하지 않아야: ${JSON.stringify(r.issues)}`,
  )
})

test('\'deployable: a legacy alias condition goes through the same executor -> same check\'', () => {
  const r = validateWorkflowJson(
    wf(
      [
        node('s', 'start'),
        node('br', 'condition', {
          conditions: [
            { id: 'if-0', type: 'if', conditionMode: 'advanced', customExpression: 'a +' },
            { id: 'else', type: 'else' },
          ],
        }),
        node('e1', 'end'), node('e2', 'end'),
      ],
      [edge('s', 'br'), edge('br', 'e1', 'if-0'), edge('br', 'e2', 'else')],
    ),
    'deployable',
  )
  assert.ok(r.issues.some(i => i.code === 'CONDITION_EXPRESSION_INVALID' && i.nodeId === 'br'), JSON.stringify(r.issues))
})

test('\'deployable: While Code mode empty expression = blocking (the loop never runs once)\'', () => {
  const r = validateWorkflowJson(whileWf({ conditionMode: 'code', customExpression: '   ' }), 'deployable')
  assert.equal(r.valid, false, JSON.stringify(r.issues))
  assert.ok(r.issues.some(i => i.code === 'CONDITION_EXPRESSION_INVALID' && i.nodeId === 'w'), JSON.stringify(r.issues))
})

test('\'deployable: While forEach does not evaluate the condition -> not checked (no over-validation)\'', () => {
  const r = validateWorkflowJson(
    whileWf({
      loopMode: 'forEach', forEachSource: 'imapResult.emails',
      conditionMode: 'code', customExpression: 'a ? b : c',
    }),
    'deployable',
  )
  assert.equal(r.valid, true, JSON.stringify(r.issues))
})

test('\'structural (= draft save): a half-written Code expression passes - the "save work in progress" contract\'', () => {
  const half = branchWf([
    { id: 'if-0', type: 'if', conditionMode: 'code', customExpression: 'jsonData.amount >' },
    { id: 'else', type: 'else' },
  ])
  assert.equal(validateWorkflowJson(half, 'structural').valid, true, '초안 저장은 막지 않는다')
  assert.equal(validateWorkflowJson(half, 'deployable').valid, false, '라이브로 나가기 전엔 잡는다')
})
