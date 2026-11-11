import { test } from 'node:test'
import assert from 'node:assert/strict'
import { countWebSearchCalls, recordWorkWebSearches } from './web-search-log'

test('counts only web_search_call - not an array = 0', () => {
  assert.equal(countWebSearchCalls([{ type: 'web_search_call' }, { type: 'message' }, { type: 'web_search_call' }, null]), 2)
  for (const x of [undefined, null, {}, 'x', []]) assert.equal(countWebSearchCalls(x), 0)
})

test('zero calls or outside a work app = does nothing (does not throw)', async () => {
  await recordWorkWebSearches({ userId: 'u', workflowId: 'w' }, 3, 0)
  await recordWorkWebSearches({ userId: 'u', workflowId: 'w', workScope: { projectId: 'p', taskId: null, runId: 'r' } }, 0, 1)
})
