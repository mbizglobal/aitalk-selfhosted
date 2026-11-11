import { test } from 'node:test'
import { cloudOnly } from '@/lib/work/cloud-apps-for-tests'
import assert from 'node:assert/strict'
import { companyLimitFor, exceedsCompanyLimit } from './company-limit'
import { COMPANY_BOOK_KINDS, SHARED_APP_TEMPLATE_KINDS } from './app-template-kinds'

// docs/wf_app/00_core/company-limit.md §1 · §3

test('limit = price table - Starter 1, Standard 3, Pro 6 - a plan not in the table, no subscription = 1', cloudOnly, () => {
  assert.equal(companyLimitFor('starter'), 1)
  assert.equal(companyLimitFor('standard'), 3)
  assert.equal(companyLimitFor('pro'), 6)
  for (const p of ['free', 'growth'] as const) assert.equal(companyLimitFor(p), 1, p)
  assert.equal(companyLimitFor(null), 1)
})

test('check = grew and over the limit', () => {
  assert.equal(exceedsCompanyLimit(0, 1, 1), false, '0 → 1 (한도 1)')
  assert.equal(exceedsCompanyLimit(1, 2, 1), true, '정확히 N 에서 하나 더')
  assert.equal(exceedsCompanyLimit(0, 2, 1), true, '노드 둘짜리 캔버스 + 자리 하나')
  assert.equal(exceedsCompanyLimit(1, 1, 1), false, '바꿔 끼우기(그대로)')
  assert.equal(exceedsCompanyLimit(3, 3, 1), false, '넘은 계정 — 늘지 않는 저장')
  assert.equal(exceedsCompanyLimit(3, 2, 1), false, '넘은 계정 — 줄이기')
  assert.equal(exceedsCompanyLimit(2, 3, 1), true, '넘은 계정 — 비운 자리 다시 채우기')
  assert.equal(exceedsCompanyLimit(2, 3, 3), false, '한도까지 채우기')
  assert.equal(exceedsCompanyLimit(0, 9, null), false, '세지 않음(Self-hosted)')
})

test('company book = one bank ledger - payment approvals (shared app) is not', cloudOnly, () => {
  assert.deepEqual([...COMPANY_BOOK_KINDS], ['ledger'])
  assert.ok(SHARED_APP_TEMPLATE_KINDS.includes('approvals'))
  assert.ok(!COMPANY_BOOK_KINDS.includes('approvals'))
})
