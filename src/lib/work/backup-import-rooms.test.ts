import { test } from 'node:test'
import assert from 'node:assert/strict'
import { importedMessageRoom } from './backup-import'

test('backup message rooms - old backup, team = team, owner private = owner private, other private, unknown = not imported', () => {
  assert.deepEqual(importedMessageRoom({}), {})
  assert.deepEqual(importedMessageRoom({ room: null }), {})
  assert.deepEqual(importedMessageRoom({ room: 'team', owner: null }), {})
  assert.deepEqual(importedMessageRoom({ room: 'private', owner: 'human' }), { room: 'private', owner: 'human' })
  assert.equal(importedMessageRoom({ room: 'private', owner: 'member:5' }), null)
  assert.equal(importedMessageRoom({ room: 'private' }), null)
  assert.equal(importedMessageRoom({ room: 'secret' }), null)
})
