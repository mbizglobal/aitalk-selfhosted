
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  planToolNodes,
  makeSlotAllocator,
  buildManagedToolData,
  reconcileToolEdges,
  canonicalToolEdge,
  MODAL_TOOL_TYPES,
  splitAttachedTools,
  type PlanItem,
  type PlanEdge,
} from './tools-node-plan'

const GRID = [
  { x: 150, y: 150 }, { x: -150, y: 150 }, { x: 150, y: 250 }, { x: -150, y: 250 },
  { x: 150, y: 350 }, { x: -150, y: 350 }, { x: 150, y: 450 }, { x: -150, y: 450 },
  { x: 150, y: 550 }, { x: -150, y: 550 },
]
const ANCHOR = { x: 1000, y: 2000 }
const newId = (item: PlanItem, i: number) => `tool-${item.type}-NEW-${i}`

const item = (over: Partial<PlanItem> & Pick<PlanItem, 'id' | 'type'>): PlanItem => ({
  name: over.name ?? 'X',
  ...over,
})

const opts = (over: Partial<Parameters<typeof buildManagedToolData>[2]> = {}) => ({
  icon: 'ICON' as any,
  color: 'bg-x',
  isLoopTool: undefined,
  providerOf: () => undefined,
  ...over,
})

describe('planToolNodes - keep/remove/new decisions', () => {
  it('nodes that are already attached are kept (no regeneration = basis for position preservation)', () => {
    const p = planToolNodes(
      [item({ id: 'tool-source-1', type: 'source' }), item({ id: 'tool-sendgrid-2', type: 'sendgrid' })],
      ['tool-source-1', 'tool-sendgrid-2'],
      newId,
    )
    assert.deepEqual(p.entries.map(e => e.keep), [true, true])
    assert.deepEqual(p.entries.map(e => e.nodeId), ['tool-source-1', 'tool-sendgrid-2'])
    assert.deepEqual(p.removedIds, [], '변경이 없으면 아무것도 지우지 않는다')
  })

  it('only nodes dropped from the list go into removedIds', () => {
    const p = planToolNodes(
      [item({ id: 'tool-source-1', type: 'source' })],
      ['tool-source-1', 'tool-telegram-9'],
      newId,
    )
    assert.deepEqual(p.removedIds, ['tool-telegram-9'])
    assert.equal(p.entries[0].keep, true)
  })

  it('only items newly added in the modal get a new node id', () => {
    const p = planToolNodes(
      [item({ id: 'tool-source-1', type: 'source' }), item({ id: 'sendgrid-1755', type: 'sendgrid' })],
      ['tool-source-1'],
      newId,
    )
    assert.deepEqual(p.entries.map(e => e.keep), [true, false])
    assert.equal(p.entries[1].nodeId, 'tool-sendgrid-NEW-1')
    assert.deepEqual(p.removedIds, [])
  })

  it('detection is by whether a node is attached, not by the \'tool-\' prefix - placement is preserved even for ids outside the convention', () => {
    const p = planToolNodes(
      [item({ id: 'mcp-authored-abc', type: 'mcp' })],
      ['mcp-authored-abc'],
      newId,
    )
    assert.equal(p.entries[0].keep, true)
    assert.equal(p.entries[0].nodeId, 'mcp-authored-abc')
    assert.deepEqual(p.removedIds, [])
  })

  it('clearing everything removes all previously attached nodes', () => {
    const p = planToolNodes([], ['a', 'b'], newId)
    assert.deepEqual(p.removedIds.sort(), ['a', 'b'])
    assert.equal(p.keptIds.size, 0)
  })
})

describe('makeSlotAllocator - slots for new nodes', () => {
  it('skips cells used by kept nodes (prevents overlapping creation)', () => {
    const kept = [
      { id: 'a', position: { x: ANCHOR.x + 150, y: ANCHOR.y + 150 } },
      { id: 'b', position: { x: ANCHOR.x + 150, y: ANCHOR.y + 250 } },
    ]
    const take = makeSlotAllocator(GRID, kept, ANCHOR)
    assert.deepEqual(take(), GRID[1], '0번은 점유 → 1번')
    assert.deepEqual(take(), GRID[3], '2번도 점유 → 3번')
    assert.deepEqual(take(), GRID[4])
  })

  it('with no kept nodes, allocates from slot 0 in order', () => {
    const take = makeSlotAllocator(GRID, [], ANCHOR)
    assert.deepEqual([take(), take()], [GRID[0], GRID[1]])
  })

  it('nodes moved off the grid occupy no cell (placement preservation takes priority)', () => {
    const kept = [{ id: 'a', position: { x: ANCHOR.x + 7, y: ANCHOR.y + 13 } }]
    const take = makeSlotAllocator(GRID, kept, ANCHOR)
    assert.deepEqual(take(), GRID[0])
  })

  it('when the grid is full, continues below it (existing fallback preserved)', () => {
    const take = makeSlotAllocator(GRID, [], ANCHOR)
    for (let i = 0; i < GRID.length; i++) take()
    assert.deepEqual(take(), { x: 0, y: 150 + 10 * 100 })
  })
})

describe('buildManagedToolData - rewrites only managed keys and preserves the rest', () => {
  it('values set in the panel survive', () => {
    const existing = { toEmail: 'a@b.ch', fromName: 'Shop', workingHoursStart: '09:00', label: '옛 이름' }
    const d = buildManagedToolData(
      item({ id: 'n1', type: 'sendgrid', name: '새 이름', connectionId: 'c1' }),
      existing,
      opts(),
    )
    assert.equal(d.toEmail, 'a@b.ch')
    assert.equal(d.fromName, 'Shop')
    assert.equal(d.workingHoursStart, '09:00')
    assert.equal(d.label, '새 이름', '관리 키는 덮어쓴다')
    assert.equal(d.connectionId, 'c1')
  })

  it('unlinking a connection leaves no connectionId behind (it must not come back)', () => {
    const d = buildManagedToolData(
      item({ id: 'n1', type: 'sendgrid', connectionId: '' }),
      { connectionId: 'OLD', mcpConnectionId: 'OLDM' },
      opts(),
    )
    assert.equal('connectionId' in d, false)
    assert.equal('mcpConnectionId' in d, false)
  })

  it('MCP connections are preserved', () => {
    const d = buildManagedToolData(
      item({ id: 'n1', type: 'mcp', mcpConnectionId: 'm1' }),
      {},
      opts(),
    )
    assert.equal(d.mcpConnectionId, 'm1')
  })

  it('only Apps tools get a nodeType (non-Apps are removed - existing behavior kept)', () => {
    const apps = buildManagedToolData(item({ id: 'n', type: 'telegram' }), { nodeType: 'x' }, opts())
    assert.equal(apps.nodeType, 'telegram')
    const src = buildManagedToolData(item({ id: 'n', type: 'source' }), { nodeType: 'x' }, opts())
    assert.equal('nodeType' in src, false)
  })

  it('SMS nodeType follows the provider', () => {
    const acs = buildManagedToolData(
      item({ id: 'n', type: 'sms', connectionId: 'c' }), {},
      opts({ providerOf: () => 'acs_sms' }),
    )
    assert.equal(acs.nodeType, 'sms_acs')
    const infobip = buildManagedToolData(
      item({ id: 'n', type: 'sms', connectionId: 'c' }), {},
      opts({ providerOf: () => 'infobip_sms' }),
    )
    assert.equal(infobip.nodeType, 'sms_infobip')
  })

  it('when the provider is unknown, the existing nodeType is preserved (ACS node description must not get swapped)', () => {
    const unknown = buildManagedToolData(
      item({ id: 'n', type: 'sms', connectionId: 'c' }),
      { nodeType: 'sms_acs' },
      opts({ providerOf: () => undefined }),
    )
    assert.equal(unknown.nodeType, 'sms_acs')
    const fresh = buildManagedToolData(
      item({ id: 'n', type: 'sms' }), {}, opts({ providerOf: () => undefined }),
    )
    assert.equal(fresh.nodeType, 'sms_infobip')
  })

  it('isLoopTool follows the AI node', () => {
    const d = buildManagedToolData(item({ id: 'n', type: 'source' }), { isLoopTool: true }, opts({ isLoopTool: false }))
    assert.equal(d.isLoopTool, false)
  })

  it('does not mutate the original object', () => {
    const existing = { toEmail: 'a@b.ch', connectionId: 'OLD' }
    buildManagedToolData(item({ id: 'n', type: 'sendgrid' }), existing, opts())
    assert.deepEqual(existing, { toEmail: 'a@b.ch', connectionId: 'OLD' })
  })
})

describe('makeSlotAllocator - fallback slots outside the grid also count as occupied', () => {
  it('does not create on top of a kept node that uses a fallback slot', () => {
    const kept = [
      ...GRID.map((g, i) => ({ id: `g${i}`, position: { x: ANCHOR.x + g.x, y: ANCHOR.y + g.y } })),
      { id: 'f10', position: { x: ANCHOR.x + 0, y: ANCHOR.y + 150 + 10 * 100 } },
    ]
    const take = makeSlotAllocator(GRID, kept, ANCHOR)
    assert.deepEqual(take(), { x: 0, y: 150 + 11 * 100 }, 'slot 10 은 점유 → 11')
  })

  it('positions that do not fit the fallback grid are not counted as occupied (no over-counting)', () => {
    const kept = [{ id: 'x', position: { x: ANCHOR.x + 0, y: ANCHOR.y + 1187 } }]
    const take = makeSlotAllocator(GRID, kept, ANCHOR)
    assert.deepEqual(take(), GRID[0])
  })
})

describe('reconcileToolEdges - removal, duplicates, normalization', () => {
  const AI = 'ai-1'
  const toolsEdge = (id: string, target: string, over: Partial<PlanEdge> = {}): PlanEdge => ({
    id, source: AI, target, sourceHandle: 'tools', type: 'default',
    className: 'tool-edge-no-arrow',
    style: { stroke: '#666', strokeWidth: 2, strokeDasharray: '5, 5' },
    ...over,
  })

  it('duplicate tools edges to the same target are reduced to one (prevents Multi-Calendar mis-switching)', () => {
    const out = reconcileToolEdges(
      [toolsEdge('e1', 'cal'), toolsEdge('e2', 'cal')],
      { aiNodeId: AI, keptIds: new Set(['cal']), removedIds: [], isLoopTool: false },
    )
    assert.equal(out.length, 1)
    assert.equal(out[0].id, 'e1', '첫 엣지를 남긴다')
  })

  it('manually connected edges are normalized to the canonical form (dashes and width must not be lost)', () => {
    const out = reconcileToolEdges(
      [toolsEdge('e1', 't1')],
      { aiNodeId: AI, keptIds: new Set(['t1']), removedIds: [], isLoopTool: false },
    )
    assert.equal(out[0].type, 'toolEdge', 'ToolEdge 가 점선·굵기를 자체 기본값으로 그린다')
    assert.equal(out[0].style, undefined)
    assert.equal(out[0].className, undefined)
    assert.equal(out[0].markerEnd, undefined)
    assert.equal(out[0].id, 'e1', 'id 는 유지 — 바꾸면 캔버스가 흔들린다')
  })

  it('for a loop tool only the stroke is orange (dashes and width keep the ToolEdge defaults)', () => {
    const out = reconcileToolEdges(
      [toolsEdge('e1', 't1')],
      { aiNodeId: AI, keptIds: new Set(['t1']), removedIds: [], isLoopTool: true },
    )
    assert.deepEqual(out[0].style, { stroke: '#f97316' })
  })

  it('edges touching a removed node are deleted in both directions', () => {
    const out = reconcileToolEdges(
      [
        toolsEdge('e1', 'gone'),
        { id: 'e2', source: 'gone', target: 'other', sourceHandle: null },
        { id: 'e3', source: 'other', target: 'gone', sourceHandle: null },
        toolsEdge('e4', 'stay'),
      ],
      { aiNodeId: AI, keptIds: new Set(['stay']), removedIds: ['gone'], isLoopTool: false },
    )
    assert.deepEqual(out.map(e => e.id), ['e4'])
  })

  it('unrelated edges are left untouched', () => {
    const other: PlanEdge = { id: 'flow', source: 'start', target: 'ai-1', sourceHandle: null, type: 'default', style: { stroke: '#666' } }
    const out = reconcileToolEdges(
      [other],
      { aiNodeId: AI, keptIds: new Set(), removedIds: [], isLoopTool: false },
    )
    assert.equal(out[0], other, '동일 객체 그대로')
  })

  it('tools edges of other AI nodes are not touched', () => {
    const foreign = toolsEdge('e9', 't1', { source: 'ai-2' })
    const out = reconcileToolEdges(
      [foreign],
      { aiNodeId: AI, keptIds: new Set(['t1']), removedIds: [], isLoopTool: false },
    )
    assert.equal(out[0].type, 'default', '남의 엣지를 정규화하지 않는다')
  })

  it('canonicalToolEdge preserves source/target/sourceHandle', () => {
    const c = canonicalToolEdge(toolsEdge('e1', 't1', { targetHandle: 'ghost' }), false)
    assert.equal(c.source, AI)
    assert.equal(c.target, 't1')
    assert.equal(c.sourceHandle, 'tools')
    assert.equal(c.targetHandle, undefined, '툴 노드의 target 핸들은 id 없는 하나뿐')
  })
})

describe('MODAL_TOOL_TYPES - kinds the modal cannot show are not managed', () => {
  it('includes only the 9 kinds; functionCalling and webhook are excluded', () => {
    assert.equal(MODAL_TOOL_TYPES.size, 11)
    for (const t of ['source', 'mcp', 'webSearch', 'sendgrid', 'telegram', 'sms', 'smtp', 'google_calendar', 'microsoft_calendar', 'subworkflow', 'workApp']) {
      assert.ok(MODAL_TOOL_TYPES.has(t), t)
    }
    assert.equal(MODAL_TOOL_TYPES.has('functionCalling'), false)
    assert.equal(MODAL_TOOL_TYPES.has('webhook'), false)
  })
})

describe('splitAttachedTools - managed tools and slot/limit tools are different sets', () => {
  const n = (toolType?: string) => ({ data: toolType === undefined ? undefined : { toolType } })

  it('only kinds the modal knows go to managed', () => {
    const { managed, unmanaged } = splitAttachedTools([
      n('source'), n('functionCalling'), n('google_calendar'), n('webhook'), n(undefined),
    ])
    assert.equal(managed.length, 2)
    assert.equal(unmanaged.length, 3, 'functionCalling·webhook·toolType 없음')
  })

  it('unmanaged tools must also count toward the limit - if not counted, actual attachments exceed 10', () => {
    const attached = [n('functionCalling'), ...Array.from({ length: 10 }, () => n('source'))]
    const { managed, unmanaged } = splitAttachedTools(attached)
    assert.equal(managed.length + unmanaged.length, 11)
    assert.equal(unmanaged.length, 1, '이 1개를 안 세면 카운터가 10 이라고 답한다')
  })
})

describe('makeSlotAllocator - non-modal tools also occupy a slot', () => {
  it('does not create on top of a preserved functionCalling that sits in a grid cell', () => {
    const surviving = [
      { id: 'fc', position: { x: ANCHOR.x + 150, y: ANCHOR.y + 150 } },
      { id: 'src', position: { x: ANCHOR.x - 150, y: ANCHOR.y + 150 } },
    ]
    const take = makeSlotAllocator(GRID, surviving, ANCHOR)
    assert.deepEqual(take(), GRID[2], '0·1번 점유 → 2번')
  })
})
