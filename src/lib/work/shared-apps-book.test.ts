import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bookRelation, decideBookLink, type BookGroups, type SharedAppChoice, type UnpickableSharedApp } from './shared-apps'

const app = (id: string): SharedAppChoice => ({ appWorkflowId: id, projectId: `p_${id}`, appName: id, canvasWorkflowId: `c_${id}`, canvasName: id, agentId: 'a', agentName: 'a', alone: false })
const groups = (g: Partial<Record<keyof BookGroups, string[]>>): BookGroups => ({ same: (g.same ?? []).map(app), none: (g.none ?? []).map(app), mixed: (g.mixed ?? []).map(app), other: (g.other ?? []).map(app) })
const draft: UnpickableSharedApp = { why: 'draft', canvasWorkflowId: 'd', canvasName: 'd', appName: 'd' }
const removed: UnpickableSharedApp = { why: 'removed_node', canvasWorkflowId: 'r', canvasName: 'r', appName: 'r' }
const lk = (unpickable: UnpickableSharedApp[] = [], legacy = 0) => ({ unpickable, legacy })

test('comparing books - exactly {L} = same - two read = mixed - none = none - no L = other', () => {
  assert.equal(bookRelation(['L'], 'L'), 'same')
  assert.equal(bookRelation(['A', 'L'], 'L'), 'mixed')
  assert.equal(bookRelation([], 'L'), 'none')
  assert.equal(bookRelation(['A'], 'L'), 'other')
  assert.equal(bookRelation(['A', 'B'], 'L'), 'other')
})

test('order table - the first matching row from the top', () => {
  assert.deepEqual(decideBookLink(lk([draft]), groups({ same: ['x'], none: ['y'] })), { link: app('x') })
  assert.deepEqual(decideBookLink(lk(), groups({ same: ['x', 'z'], none: ['y'] })), { note: 'LINK_CHOOSE' })
  assert.deepEqual(decideBookLink(lk([draft]), groups({ none: ['y'] })), { note: 'LINK_DRAFT_ONLY' })
  assert.deepEqual(decideBookLink(lk([draft]), groups({ other: ['o'] })), { note: 'LINK_DRAFT_ONLY' })
  assert.deepEqual(decideBookLink(lk(), groups({ none: ['y'], other: ['o'] })), { note: 'LINK_ATTACH' })
  assert.deepEqual(decideBookLink(lk(), groups({ mixed: ['m'] })), { note: 'LINK_CHOOSE' })
  assert.deepEqual(decideBookLink(lk([removed]), groups({ other: ['o'] })), { note: 'LINK_DETACHED_ONLY', detail: 'removed_node' })
  assert.deepEqual(decideBookLink(lk([], 1), groups({})), { note: 'LINK_CHOOSE' })
  assert.deepEqual(decideBookLink(lk(), groups({})), { create: true })
  assert.deepEqual(decideBookLink(lk(), groups({ other: ['o', 'p'] })), { create: true })
})
