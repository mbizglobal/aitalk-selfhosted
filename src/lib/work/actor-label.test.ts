import { test } from 'node:test'
import assert from 'node:assert/strict'
import { actorBase, actorLabel, actorRequester, personOf } from './sheet-gate'

test('AI - the requester as a suffix - without one, the old text unchanged', () => {
  assert.equal(actorLabel({ type: 'ai', workflowId: 'wf_1' }), 'ai:wf_1')
  assert.equal(actorLabel({ type: 'ai', workflowId: 'wf_1', requestedBy: {} }), 'ai:wf_1|by:human')
  assert.equal(actorLabel({ type: 'ai', workflowId: 'wf_1', requestedBy: { memberId: 7 } }), 'ai:wf_1|by:member:7')
})

test('module called by the AI - suffix - a module pressed by a person has no suffix', () => {
  assert.equal(actorLabel({ type: 'module', id: 'vat.calc', version: 3, requestedBy: { memberId: 2 } }), 'module:vat.calc@3|by:member:2')
  assert.equal(actorLabel({ type: 'module', id: 'vat.calc', version: 3, person: { memberId: 2 } }), 'module:vat.calc@3')
})

test('strip the suffix - read the requester', () => {
  assert.equal(actorBase('ai:wf_1|by:member:7'), 'ai:wf_1')
  assert.equal(actorBase('ai:wf_1'), 'ai:wf_1')
  assert.equal(actorBase('member:7'), 'member:7')
  assert.equal(actorRequester('ai:wf_1|by:member:7'), 'member:7')
  assert.equal(actorRequester('module:x@1|by:human'), 'human')
  assert.equal(actorRequester('ai:wf_1'), null)
  assert.ok(actorLabel({ type: 'ai', workflowId: 'wf_1', requestedBy: { memberId: 7 } }).startsWith('ai:'))
})

test('a request is not a direct signature - personOf stays null', () => {
  assert.equal(personOf({ type: 'ai', workflowId: 'wf_1', requestedBy: { memberId: 7 } }), null)
  assert.equal(personOf({ type: 'module', id: 'x', version: 1, requestedBy: {} }), null)
})

test('the longest text fits the column - confirmed_by 80', () => {
  const longest = actorLabel({ type: 'ai', workflowId: 'x'.repeat(25), requestedBy: { memberId: 2_147_483_647 } })
  assert.ok(longest.length <= 80, String(longest.length))
})
