
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  DERIVED_TOOL_FLAGS,
  isAiNode,
  deriveToolFlags,
  selectedToolsEqual,
  applyDerivedToolFlags,
} from './derived-tool-flags'

const ai = (id = 'ai1', data: Record<string, any> = {}) =>
  ({ id, type: 'custom', position: { x: 0, y: 0 }, data: { nodeType: 'ai', label: 'AI', ...data } }) as any

const tool = (id: string, toolType: string) =>
  ({ id, type: 'tool', position: { x: 0, y: 0 }, data: { toolType } }) as any

const toolEdge = (target: string, source = 'ai1') =>
  ({ id: `e-${target}`, source, target, sourceHandle: 'tools' }) as any

describe('computation - builds flags from attached tool nodes', () => {
  it('every derived flag maps to exactly one toolType (prevents omissions)', () => {
    const byFlag: Record<string, string> = {
      source: 'source', mcp: 'mcp', webSearch: 'webSearch', functionCalling: 'functionCalling',
      sendgrid: 'sendgrid', telegram: 'telegram', sms: 'sms', smtp: 'smtp',
      googleCalendar: 'google_calendar', microsoftCalendar: 'microsoft_calendar',
      subworkflow: 'subworkflow', workApp: 'workApp',
    }
    assert.deepEqual(DERIVED_TOOL_FLAGS.slice().sort(), Object.keys(byFlag).sort())

    const tools = DERIVED_TOOL_FLAGS.map((f, i) => tool(`t${i}`, byFlag[f]))
    const edges = tools.map(t => toolEdge(t.id))
    const { selectedTools, hasToolsConnection } = deriveToolFlags(ai(), [ai(), ...tools], edges)

    assert.equal(hasToolsConnection, true)
    for (const flag of DERIVED_TOOL_FLAGS) assert.equal(selectedTools[flag], true, `${flag} 가 false`)
  })

  it('actually counts sms (a defect before the fix)', () => {
    const nodes = [ai(), tool('t1', 'sms')]
    const { selectedTools } = deriveToolFlags(ai(), nodes, [toolEdge('t1')])
    assert.equal(selectedTools.sms, true)
  })

  it('unattached ones are false; with no edges hasToolsConnection is false', () => {
    const { selectedTools, hasToolsConnection } = deriveToolFlags(ai(), [ai()], [])
    assert.equal(hasToolsConnection, false)
    for (const flag of DERIVED_TOOL_FLAGS) assert.equal(selectedTools[flag], false)
  })

  it('edges that are not on the tools handle are not counted', () => {
    const nodes = [ai(), tool('t1', 'sms')]
    const other = { id: 'e1', source: 'ai1', target: 't1', sourceHandle: 'miniapps' } as any
    const { selectedTools, hasToolsConnection } = deriveToolFlags(ai(), nodes, [other])
    assert.equal(hasToolsConnection, false)
    assert.equal(selectedTools.sms, false)
  })

  it('tools attached to other AI nodes are not counted', () => {
    const nodes = [ai('ai1'), ai('ai2'), tool('t1', 'sms')]
    const { selectedTools } = deriveToolFlags(ai('ai1'), nodes, [toolEdge('t1', 'ai2')])
    assert.equal(selectedTools.sms, false)
  })

  it('imageInput and pdfInput are inherited, not derived (recomputation must not drop them)', () => {
    const node = ai('ai1', { selectedTools: { imageInput: true }, pdfInput: true })
    const { selectedTools } = deriveToolFlags(node, [node], [])
    assert.equal(selectedTools.imageInput, true, 'selectedTools 안의 값에서')
    assert.equal(selectedTools.pdfInput, true, 'node.data 의 옛 위치에서')
  })
})

describe('comparison - iterates the same list as the computation', () => {
  it('catches differences in every derived flag (missing even one blocks the commit)', () => {
    const base: Record<string, boolean> = {}
    for (const f of DERIVED_TOOL_FLAGS) base[f] = false
    base.imageInput = false; base.pdfInput = false

    assert.equal(selectedToolsEqual(base, base), true)
    for (const flag of DERIVED_TOOL_FLAGS) {
      const changed = { ...base, [flag]: true }
      assert.equal(selectedToolsEqual(base, changed), false, `${flag} 차이를 못 잡는다`)
    }
  })

  it('also catches imageInput and pdfInput differences', () => {
    const a = { imageInput: false, pdfInput: false }
    assert.equal(selectedToolsEqual(a, { ...a, imageInput: true } as any), false)
    assert.equal(selectedToolsEqual(a, { ...a, pdfInput: true } as any), false)
  })

  it('a node with no keys at all (old saved data) is treated as different - so it gets updated once', () => {
    const next: Record<string, boolean> = {}
    for (const f of DERIVED_TOOL_FLAGS) next[f] = false
    next.imageInput = false; next.pdfInput = false
    assert.equal(selectedToolsEqual(undefined, next), false)
  })
})

describe('applied at load time', () => {
  it('fixes saved data that disagrees with the edges', () => {
    const node = ai('ai1', { selectedTools: { source: true }, hasToolsConnection: false })
    const nodes = [node, tool('t1', 'sms')]
    const out = applyDerivedToolFlags(nodes, [toolEdge('t1')])
    assert.equal(out[0].data.selectedTools.sms, true)
    assert.equal(out[0].data.selectedTools.source, false, '엣지에 없는 source 는 꺼진다')
    assert.equal(out[0].data.hasToolsConnection, true)
  })

  it('returns the same reference for nodes that are already correct (avoids needless re-render and change detection)', () => {
    const nodes = [ai('ai1'), tool('t1', 'sms')]
    const derived = applyDerivedToolFlags(nodes, [toolEdge('t1')])
    const again = applyDerivedToolFlags(derived, [toolEdge('t1')])
    assert.equal(again[0], derived[0], '두 번째 적용은 새 객체를 만들면 안 된다')
    assert.equal(again[1], derived[1], 'AI 가 아닌 노드도 그대로')
  })

  it('does not touch non-AI nodes', () => {
    const t = tool('t1', 'sms')
    const out = applyDerivedToolFlags([t], [])
    assert.equal(out[0], t)
  })

  it('old AI nodes without nodeType are also caught by label', () => {
    assert.equal(isAiNode({ data: { label: 'AI' } }), true)
    assert.equal(isAiNode({ data: { nodeType: 'ai' } }), true)
    assert.equal(isAiNode({ data: { label: 'End', nodeType: 'end' } }), false)
  })
})
