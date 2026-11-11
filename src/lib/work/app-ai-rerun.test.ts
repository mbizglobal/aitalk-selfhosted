import { test } from 'node:test'
import { cloudOnly } from '@/lib/work/cloud-apps-for-tests'
import assert from 'node:assert/strict'
import { workAppRerunnable } from './app-ai'

test('work app - calls that may be repeated: reads, whole errors (not partial success or successful writes)', () => {
  assert.equal(workAppRerunnable('work_read_rows', '{"rows":[]}'), true)
  assert.equal(workAppRerunnable('work_overview', 'anything'), true)
  assert.equal(workAppRerunnable('work_run_module', '{"error":"MODULE_STOPPED: ye_min_fields"}'), true)
  assert.equal(workAppRerunnable('work_insert_rows', '{"done":0,"failed":2,"results":[]}'), true)
  assert.equal(workAppRerunnable('work_insert_rows', '{"done":1,"failed":1,"results":[]}'), false)
  assert.equal(workAppRerunnable('work_run_module', '{"output":{"ok":true}}'), false)
  assert.equal(workAppRerunnable('work_send', '{"sent":true}'), false)
  assert.equal(workAppRerunnable('work_run_module', '{"rows":[… [truncated'), false)
  assert.equal(workAppRerunnable('work_run_module', '{"error":"MODULE_STOPPED: ye_min_fields {\\"list\\":\\"chair… [truncated'), true)
  assert.equal(workAppRerunnable('work_insert_rows', '{"error":"x","done":1,"failed":1}'), false)
  assert.equal(workAppRerunnable('work_run_module', '{"error":""}'), false)
  assert.equal(workAppRerunnable('work_run_module', '{"next":"minutes"}', { moduleId: 'm', input: { action: 'status', taskId: 't' } }), true)
  assert.equal(workAppRerunnable('work_run_module', '{"fileId":"f"}', { moduleId: 'm', input: { action: 'minutes', taskId: 't' } }), false)
})

test('tools a package marks as reads are re-read - cards and write tools stay blocked', cloudOnly, () => {
  assert.equal(workAppRerunnable('invoices_profile', '{"profile":null,"sheetId":"s"}', {}, 'invoices'), true)
  assert.equal(workAppRerunnable('invoices_list_invoices', '{"invoices":[]}', {}, 'invoices'), true)
  assert.equal(workAppRerunnable('invoices_propose_issue', '{"proposed":true}', {}, 'invoices'), false)
  assert.equal(workAppRerunnable('invoices_save_draft', '{"ok":true}', {}, 'invoices'), false)
  assert.equal(workAppRerunnable('invoices_profile', '{"profile":null}'), false)
})
