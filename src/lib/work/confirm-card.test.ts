import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cardFingerprint } from './confirm-card'
import { closeWorkAppRun, openWorkAppRun, recordWorkAppProposal } from './app-scope'

const k1 = Buffer.alloc(32, 1)
const k2 = Buffer.alloc(32, 2)
const r = (id: string, d: Record<string, unknown>) => ({ id, sheetId: 's', data: d })

test('same fingerprint in any row order - one changed field gives a different fingerprint', () => {
  const a = [r('1', { k: 'a' }), r('2', { k: 'b' })]
  assert.equal(cardFingerprint(k1, a), cardFingerprint(k1, [...a].reverse()))
  assert.notEqual(cardFingerprint(k1, a), cardFingerprint(k1, [r('1', { k: 'a' }), r('2', { k: 'c' })]))
})
test('the confirm field is not in the fingerprint - a different account key = a different fingerprint', () => {
  const a = [{ ...r('1', { k: 'a' }), confirmed: false }]
  const b = [{ ...r('1', { k: 'a' }), confirmed: true }]
  assert.equal(cardFingerprint(k1, a), cardFingerprint(k1, b))
  assert.notEqual(cardFingerprint(k1, a), cardFingerprint(k2, a))
})
test('one confirm card per sheet (the last one) - different sheets keep both', () => {
  openWorkAppRun('run1')
  const card = (sheetId: string, n: number) => ({ type: 'confirm_rows' as const, sheetId, rowIds: ['x'], fingerprint: 'f'.repeat(64), count: n, detail: '' })
  recordWorkAppProposal('run1', card('s1', 1))
  recordWorkAppProposal('run1', card('s1', 2))
  recordWorkAppProposal('run1', card('s2', 3))
  const list = closeWorkAppRun('run1')
  assert.deepEqual(list.map((p) => (p.type === 'confirm_rows' ? [p.sheetId, p.count] : null)), [['s1', 2], ['s2', 3]])
})
