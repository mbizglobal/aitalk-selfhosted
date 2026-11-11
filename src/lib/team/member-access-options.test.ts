import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAccessChange, parseInviteAccess, type AccessOptions } from './member-access-options'

const options: AccessOptions = { workApps: [{ workflowId: 'wf_a', name: 'A', group: null }, { workflowId: 'wf_b', name: 'B', group: 'Canvas' }], teamChats: [{ workflowId: 'wf_c', name: 'C', group: null }] }

test('change - adds only ids in the list - removes any id - the same id twice = one', () => {
  assert.deepEqual(parseAccessChange({ add: ['wf_a', 'wf_a', 'wf_x'], remove: ['wf_gone'] }, options), { add: ['wf_a'], remove: ['wf_gone'] })
  assert.deepEqual(parseAccessChange({ add: [], remove: [] }, options), { add: [], remove: [] })
})

test('change - empty body, old all shape, same id on both sides, non-text id = rejected', () => {
  for (const b of [null, {}, { accessAll: true }, { add: ['wf_a'] }, { add: ['wf_a'], remove: ['wf_a'] }, { add: [1], remove: [] }, { add: 'wf_a', remove: [] }]) assert.equal(parseAccessChange(b, options), null, JSON.stringify(b))
})

test('invite - the whole list - drops workflows not of that agent - the all shape is rejected', () => {
  const agentWfs = new Set(['wf_a', 'wf_b', 'wf_c', 'wf_d'])
  assert.deepEqual(parseInviteAccess({ workflowIds: ['wf_c', 'wf_x', 'wf_c', 'wf_d'] }, agentWfs), { workflowIds: ['wf_c', 'wf_d'] })
  assert.deepEqual(parseInviteAccess({ workflowIds: [] }, agentWfs), { workflowIds: [] })
  for (const b of [null, { accessAll: true }, { workflowIds: 'wf_a' }]) assert.equal(parseInviteAccess(b, agentWfs), null, JSON.stringify(b))
})
