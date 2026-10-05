
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { compareNodes, compareEdges } from './deepEqual'

const node = (id: string, data: Record<string, any>, extra: Record<string, any> = {}) =>
  ({ id, type: 'custom', position: { x: 0, y: 0 }, data, ...extra }) as any

const edge = (id: string, extra: Record<string, any> = {}) =>
  ({ id, source: 'a', target: 'b', sourceHandle: 'tools', ...extra }) as any

describe('undefined-valued key = missing key (saved data is identical)', () => {
  it('edges: equal even with undefined keys produced by canonicalToolEdge', () => {
    const fresh = edge('e1', { type: 'toolEdge', animated: false })
    const canonical = edge('e1', {
      type: 'toolEdge',
      animated: false,
      targetHandle: undefined,
      className: undefined,
      markerEnd: undefined,
      style: undefined,
    })
    assert.equal(compareEdges([fresh], [canonical]), true)
    assert.equal(compareEdges([canonical], [fresh]), true)
  })

  it('also verifies the saved JSON is actually identical - pins the reasoning as a test', () => {
    const fresh = edge('e1', { type: 'toolEdge' })
    const canonical = edge('e1', { type: 'toolEdge', targetHandle: undefined })
    assert.equal(JSON.stringify(fresh), JSON.stringify(canonical))
  })

  it('node data: a missing key and an undefined key are equal', () => {
    const a = node('n1', { label: 'AI', selectedTools: { source: true } })
    const b = node('n1', { label: 'AI', selectedTools: { source: true }, vectorStoreId: undefined })
    assert.equal(compareNodes([a], [b]), true)
  })

  it('equal in nested objects too', () => {
    const a = node('n1', { selectedTools: { source: true } })
    const b = node('n1', { selectedTools: { source: true, sms: undefined } })
    assert.equal(compareNodes([a], [b]), true)
  })
})

describe('no over-acceptance - real changes are still caught', () => {
  it('differs when only one side has a value (ignoring undefined does not swallow values)', () => {
    const a = node('n1', { label: 'AI', maxTokens: 4096 })
    const b = node('n1', { label: 'AI' })
    assert.equal(compareNodes([a], [b]), false)
    assert.equal(compareNodes([b], [a]), false)
  })

  it('null is not undefined - it stays in the JSON, so it is a change', () => {
    const a = node('n1', { smsRecipient: null })
    const b = node('n1', {})
    assert.equal(compareNodes([a], [b]), false)
  })

  it('a value changing to undefined is a change (when a field is cleared)', () => {
    const before = node('n1', { smsRecipient: '+410000000000' })
    const after = node('n1', { smsRecipient: undefined })
    assert.equal(compareNodes([before], [after]), false)
  })

  it('does not miss nested value changes', () => {
    const a = node('n1', { selectedTools: { source: true, sms: false } })
    const b = node('n1', { selectedTools: { source: true, sms: true } })
    assert.equal(compareNodes([a], [b]), false)
  })

  it('arrays differ when lengths differ (JSON keeps undefined in arrays as null)', () => {
    const a = node('n1', { schemaProperties: [1] })
    const b = node('n1', { schemaProperties: [1, undefined] })
    assert.equal(compareNodes([a], [b]), false)
  })

  it('catches real field changes on edges', () => {
    const a = edge('e1', { type: 'toolEdge' })
    const b = edge('e1', { type: 'default' })
    assert.equal(compareEdges([a], [b]), false)
  })

  it('on edges, \'had a value -> undefined\' is a change (what canonicalToolEdge actually does)', () => {
    const before = edge('e1', { className: 'legacy', style: { stroke: '#666' }, targetHandle: 'in' })
    const after = edge('e1', { className: undefined, style: undefined, targetHandle: undefined })
    assert.equal(compareEdges([before], [after]), false)
    assert.equal(compareEdges([after], [before]), false)
    assert.notEqual(JSON.stringify(before), JSON.stringify(after))
  })

  it('differs when counts differ', () => {
    assert.equal(compareNodes([node('n1', {})], [node('n1', {}), node('n2', {})]), false)
    assert.equal(compareEdges([edge('e1')], []), false)
  })
})

describe('existing contract - pinned so it does not break along with the rest', () => {
  it('equal regardless of id order', () => {
    const a = [node('n2', { label: 'B' }), node('n1', { label: 'A' })]
    const b = [node('n1', { label: 'A' }), node('n2', { label: 'B' })]
    assert.equal(compareNodes(a, b), true)
  })

  it('selected, icon, hasToolsConnection and onAddTool in data are excluded from comparison', () => {
    const a = node('n1', { label: 'AI', selected: true, icon: {}, hasToolsConnection: true, onAddTool: () => {} })
    const b = node('n1', { label: 'AI', selected: false, icon: null, hasToolsConnection: false })
    assert.equal(compareNodes([a], [b]), true)
  })

  it('selected on edges is excluded from comparison', () => {
    assert.equal(compareEdges([edge('e1', { selected: true })], [edge('e1', { selected: false })]), true)
  })

  it('position is compared rounded (ignores tiny drag differences)', () => {
    const a = node('n1', {}, { position: { x: 10.4, y: 20.4 } })
    const b = node('n1', {}, { position: { x: 10.2, y: 20.1 } })
    assert.equal(compareNodes([a], [b]), true)
    const c = node('n1', {}, { position: { x: 11, y: 20 } })
    assert.equal(compareNodes([a], [c]), false)
  })

  it('catches node type changes', () => {
    assert.equal(compareNodes([node('n1', {})], [node('n1', {}, { type: 'tool' })]), false)
  })

  it('functions are not compared (new reference every render)', () => {
    const a = node('n1', { onChange: () => 1 })
    const b = node('n1', { onChange: () => 2 })
    assert.equal(compareNodes([a], [b]), true)
  })
})
