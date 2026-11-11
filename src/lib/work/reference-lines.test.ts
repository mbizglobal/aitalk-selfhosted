import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { closesLongCycle } from './reference-lines'

const e = (...pairs: Array<[string, string]>) => pairs.map(([fromProjectId, toProjectId]) => ({ fromProjectId, toProjectId }))

describe('closesLongCycle', () => {
  it('mutual reference A<->B = allowed', () => {
    assert.equal(closesLongCycle(e(['A', 'B']), 'B', 'A'), false)
  })
  it('A to B to C then C to A = rejected', () => {
    assert.equal(closesLongCycle(e(['A', 'B'], ['B', 'C']), 'C', 'A'), true)
  })
  it('A<->B then B to C and C to A = rejected (loop of three apps)', () => {
    const g = e(['A', 'B'], ['B', 'A'], ['B', 'C'])
    assert.equal(closesLongCycle(g, 'C', 'A'), true)
  })
  it('A<->B and B<->C then A to C = rejected', () => {
    assert.equal(closesLongCycle(e(['A', 'B'], ['B', 'A'], ['B', 'C'], ['C', 'B']), 'A', 'C'), true)
  })
  it('A<->B and B<->C separately = allowed', () => {
    assert.equal(closesLongCycle(e(['A', 'B'], ['B', 'A'], ['B', 'C']), 'C', 'B'), false)
  })
  it('self = rejected', () => {
    assert.equal(closesLongCycle([], 'A', 'A'), true)
  })
  it('unconnected lines and an empty graph = allowed', () => {
    assert.equal(closesLongCycle([], 'A', 'B'), false)
    assert.equal(closesLongCycle(e(['C', 'D']), 'A', 'B'), false)
  })
})
