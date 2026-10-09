import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isWorkAppPath } from './GoogleAnalytics'

test('only Work App paths skip GA', () => {
  for (const p of ['/chat/abc/app', '/chat/abc/app/', '/chat/a%20b/app/x']) assert.equal(isWorkAppPath(p), true, p)
  for (const p of ['/chat/abc/team', '/chat/abc', '/chat/abc/apps', '/app/work', '/', null, '/chat/abc/team/app']) assert.equal(isWorkAppPath(p), false, String(p))
})
