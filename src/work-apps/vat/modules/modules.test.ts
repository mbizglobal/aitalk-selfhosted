
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { WorkError } from '@/lib/work/errors'
import { templateSchema, validateTemplateRegistry } from '@/lib/work/sheet-templates'
import { appTemplates, builtinSheetTemplates, workModules } from '@/lib/work/registry'
import { validateModuleRegistry } from '@/lib/work/modules'
import { computeVatReturn } from '../estv'
import { VAT_FAMILY, VAT_SHEET_TEMPLATES, invoiceDedupKey } from '../templates'
import { toVatReturnInput, transitionItems, type SheetPairLike, type SheetRowLike } from './boxes'
import { chainEnds } from './balance-check'
import { reconcileBalance } from '../bank/balance'
import { classifyBankRow, computeBankPlan } from './bank-import'
import { parseUbsCsv } from '../bank/ubs'

const T = (f: string) => VAT_SHEET_TEMPLATES.find((t) => t.family === f)!
const code = (fn: () => unknown) => {
  try { fn() } catch (e) { return e instanceof WorkError ? e.code : `other:${(e as Error).message}` }
  return 'ok'
}

describe('registry', () => {
  it('the 10 VAT templates (including the reading guide) pass the registry rules - module needs point to templates present in code', () => {
    assert.equal(builtinSheetTemplates().length, 10)
    validateTemplateRegistry(builtinSheetTemplates())
    validateModuleRegistry(workModules(), builtinSheetTemplates())
  })
  it('all template sheets and default-on modules of the app template exist in code', () => {
    for (const b of appTemplates()) {
      for (const s of b.sheets) assert.ok(builtinSheetTemplates().some((t) => `${t.name}@${t.version}` === s.template), s.template)
      for (const m of b.modules) assert.ok(workModules().some((x) => x.id === m), m)
      assert.ok(!b.calcModule || b.modules.includes(b.calcModule.id))
    }
  })
  it('using an unknown template in needs stops', () => {
    assert.equal(code(() => validateModuleRegistry([{ ...workModules()[0], needs: ['vat.nope>=1'] }], builtinSheetTemplates())), 'TEMPLATE_UNKNOWN')
    assert.equal(code(() => validateModuleRegistry([{ ...workModules()[0], needs: ['vat.transactions>=2'] }], builtinSheetTemplates())), 'TEMPLATE_UNKNOWN')
  })
})

describe('template row rules', () => {
  const tx = { accountKey: 'a', bankRowKey: 'tx:1', date: '2026-07-01', currency: 'CHF', amount: '10.00', direction: 'in', type: 'income', vatCode: 'ch_standard' }
  it('transactions: value list - negative amount - rate on only one side', () => {
    assert.equal(T('vat.transactions').checkRow!(tx), null)
    assert.match(T('vat.transactions').checkRow!({ ...tx, direction: 'IN' })!, /direction/)
    assert.match(T('vat.transactions').checkRow!({ ...tx, amount: '-1.00' })!, /amount/)
    assert.match(T('vat.transactions').checkRow!({ ...tx, fxRate: '0.940000' })!, /fxRate and fxUnit/)
    assert.match(T('vat.transactions').checkRow!({ ...tx, fxRate: '0.000000', fxUnit: 1 })!, /positive/)
  })
  it('invoices: tax date of sent invoices = issue date - codes by direction', () => {
    const inv = { direction: 'issued', invoiceDate: '2026-07-01', taxDate: '2026-07-01', currency: 'CHF', amountGross: '100.00', vatCode: 'ch_standard', dedupKey: 'k' }
    assert.equal(T('vat.invoices').checkRow!(inv), null)
    assert.match(T('vat.invoices').checkRow!({ ...inv, taxDate: '2026-07-02' })!, /taxDate/)
    assert.match(T('vat.invoices').checkRow!({ ...inv, vatCode: 'acquisition_383' })!, /vatCode/)
    assert.equal(T('vat.invoices').checkRow!({ ...inv, direction: 'received', taxDate: '2026-07-05', vatCode: 'acquisition_383' }), null)
  })
  it('method only from January 1 - transition list uses the previous year 12-31 and the new year 1-1', () => {
    assert.match(T('vat.basis').checkRow!({ from: '2026-04-01', basis: 'cash', fxMethod: 'monthly' })!, /January 1/)
    assert.equal(T('vat.basis').checkRow!({ from: '2026-01-01', basis: 'agreed', fxMethod: 'daily' }), null)
    const tr = { bookDate: '2027-01-01', transitionDate: '2026-12-31', fromBasis: 'cash', toBasis: 'agreed', items: [] }
    assert.equal(T('vat.transitions').checkRow!(tr), null)
    assert.match(T('vat.transitions').checkRow!({ ...tr, transitionDate: '2026-12-30' })!, /December 31/)
    assert.match(T('vat.transitions').checkRow!({ ...tr, toBasis: 'cash' })!, /different/)
  })
  it('amountInv on payment pair rows must be positive - transition list entries only those with invoiceId', () => {
    const pay = { date: '2026-07-01', kind: 'payment', amountTx: '1.00' }
    assert.equal(T('vat.payments').checkRow!(pay), null)
    assert.match(T('vat.payments').checkRow!({ ...pay, amountInv: '0.00' })!, /amountInv/)
    assert.match(T('vat.payments').checkRow!({ ...pay, amountInv: '-1.00' })!, /amountInv/)
    const tr = { bookDate: '2027-01-01', transitionDate: '2026-12-31', fromBasis: 'cash', toBasis: 'agreed' }
    assert.match(T('vat.transitions').checkRow!({ ...tr, items: [null] })!, /items/)
    assert.equal(code(() => transitionItems({ id: 'x', data: { items: [{ invoiceId: 'i', direction: 'issued', vatCode: 'ch_standard', ref: '999' }] }, confirmed: true })), 'MODULE_STOPPED')
    assert.equal(code(() => transitionItems({ id: 'x', data: { items: [{ invoiceId: 'i', direction: 'issued', vatCode: 'ch_standard', ref: ['235'] }] }, confirmed: true })), 'MODULE_STOPPED') // R2 grok
  })
  it('invoice unique key - throws on empty number, and "|" inside a number does not mix with other cells', () => {
    const k = Buffer.alloc(32, 7)
    const f = { direction: 'issued', invoiceDate: '2026-01-01', amountGross: '1.00', currency: 'CHF' }
    assert.throws(() => invoiceDedupKey(k, { ...f, number: '  ' }))
    assert.notEqual(invoiceDedupKey(k, { ...f, number: 'a|2026-01-01' }), invoiceDedupKey(k, { ...f, number: 'a', invoiceDate: '2026-01-01|2026-01-01' }))
  })
  it('rule match cannot be empty', () => {
    assert.match(T('vat.rules').checkRow!({ priority: 1, field: 'counterparty', match: '  ', type: 'income', vatCode: 'ch_standard' })!, /blank/)
  })
})

describe('sheet rows -> calculation core input (vat.boxes)', () => {
  const row = (id: string, data: Record<string, unknown>, confirmed: boolean | null = true): SheetRowLike => ({ id, data, confirmed })
  const pair = (id: string, fromRowId: string, toRowId: string, kind: string, confirmed = true): SheetPairLike => ({ id, fromRowId, toRowId, kind, confirmed })
  const txs = [row('t1', { date: '2026-07-10', currency: 'CHF', amount: '108.10', direction: 'out', type: 'expense', vatCode: 'ch_standard' })]
  const invs = [row('i1', { direction: 'received', invoiceDate: '2026-07-01', taxDate: '2026-07-01', currency: 'CHF', amountGross: '108.10', invoiceVat: '8.10', vatCode: 'ch_standard', dedupKey: 'k' })]
  const pays = [row('p1', { date: '2026-07-10', kind: 'payment', amountTx: '108.10' })]
  const opts = { basis: 'cash' as const, roundTo5Rappen: false, period: { start: '2026-07-01', end: '2026-09-30' }, declare383: false, box415: null, fx: () => null }
  const base = { transactions: txs, invoices: invs, payments: pays, adjustments: [], transitions: [] }

  it('payment pair row -> VatPaymentInput as a pair (transaction, invoice) - fills amountInv when currencies are the same - input tax = invoice VAT', () => {
    const input = toVatReturnInput({ ...base, pairs: [pair('x1', 'p1', 't1', 'tx'), pair('x2', 'p1', 'i1', 'invoice')] }, opts)
    assert.deepEqual(input.payments![0], { id: 'p1', invoiceId: 'i1', transactionId: 't1', txDate: '2026-07-10', kind: 'payment', amountTx: '108.10', amountInv: '108.10', confirmed: true })
    const r = computeVatReturn(input)
    assert.equal(r.boxes![400], BigInt(810))
    assert.deepEqual(r.unconfirmed, [])
  })
  it('if the pair is unconfirmed the payment pair is also unconfirmed - the calculation core raises that transaction as unconfirmed', () => {
    const r = computeVatReturn(toVatReturnInput({ ...base, pairs: [pair('x1', 'p1', 't1', 'tx', false), pair('x2', 'p1', 'i1', 'invoice')] }, opts))
    assert.ok(r.unconfirmed.some((u) => u.kind === 'payment' && u.id === 'p1'))
  })
  it('stops on wrong pair shape - no transaction - two transactions - unread invoice', () => {
    assert.equal(code(() => toVatReturnInput({ ...base, pairs: [pair('x2', 'p1', 'i1', 'invoice')] }, opts)), 'MODULE_STOPPED')
    assert.equal(code(() => toVatReturnInput({ ...base, pairs: [pair('x1', 'p1', 't1', 'tx'), pair('x3', 'p1', 't1', 'tx')] }, opts)), 'MODULE_STOPPED')
    assert.equal(code(() => toVatReturnInput({ ...base, pairs: [pair('x1', 'p1', 't1', 'tx'), pair('x2', 'p1', 'iX', 'invoice')] }, opts)), 'MODULE_STOPPED')
  })
  it('payment row date != transaction date = calculation core throws (txDate rule)', () => {
    const bad = { ...base, payments: [row('p1', { date: '2026-07-11', kind: 'payment', amountTx: '108.10' })], pairs: [pair('x1', 'p1', 't1', 'tx'), pair('x2', 'p1', 'i1', 'invoice')] }
    assert.throws(() => computeVatReturn(toVatReturnInput(bad, opts)), /txDate/)
  })
  it('prepayment offset correction must point to one prepayment row and checks its confirmation - other corrections cannot point to a prepayment', () => {
    const issued = row('i9', { direction: 'issued', invoiceDate: '2026-07-01', taxDate: '2026-07-01', currency: 'CHF', amountGross: '100.00', vatCode: 'ch_standard', dedupKey: 'k9' })
    const adv = row('a1', { date: '2026-06-01', kind: 'advance', amountTx: '10.00' }, false)
    const adj = (kind: string) => row('j1', { date: '2026-07-02', kind, amountChf: '10.00', vatChf: '0.75' })
    const agreed = { ...opts, basis: 'agreed' as const }
    const advTx = row('ta', { date: '2026-06-01', currency: 'CHF', amount: '10.00', direction: 'in', type: 'income', vatCode: 'ch_standard' })
    const rowsOf = (kind: string, links: SheetPairLike[], advances = [adv], withTx = true) =>
      ({ transactions: [advTx], invoices: [issued], payments: [], adjustments: [adj(kind)], transitions: [], advances, pairs: [pair('y1', 'j1', 'i9', 'invoice'), ...(withTx ? [pair('y3', 'a1', 'ta', 'tx')] : []), ...links] })
    assert.equal(code(() => toVatReturnInput(rowsOf('advance_offset', []), agreed)), 'MODULE_STOPPED')
    assert.equal(code(() => toVatReturnInput(rowsOf('advance_offset', [pair('y2', 'j1', 'a1', 'advance')], [adv], false), agreed)), 'MODULE_STOPPED')
    const ok = toVatReturnInput(rowsOf('advance_offset', [pair('y2', 'j1', 'a1', 'advance')]), agreed)
    assert.equal(ok.adjustments![0].confirmed, false)
    assert.equal(code(() => toVatReturnInput(rowsOf('discount', [pair('y2', 'j1', 'a1', 'advance')]), agreed)), 'MODULE_STOPPED')
    assert.equal(code(() => toVatReturnInput(rowsOf('advance_offset', [pair('y2', 'j1', 'a1', 'advance')], [row('a1', { date: '2026-06-01', kind: 'payment', amountTx: '10.00' })]), agreed)), 'MODULE_STOPPED')
  })
  it('rechecks row rules - stops even if a value that did not pass the template arrives', () => {
    assert.equal(code(() => toVatReturnInput({ ...base, transactions: [row('t1', { ...txs[0].data, direction: 'x' })], pairs: [] }, opts)), 'MODULE_STOPPED')
  })
})

describe('reversal (refund) key - the row already entered wins', () => {
  const schema = templateSchema(T('vat.transactions'))
  const acct = { id: 'a', sheetId: 's', data: { accountKey: 'A1', bank: 'wise', currency: 'USD' }, confirmed: null, createdAt: new Date(), updatedAt: new Date() }
  const file = { id: 'f', sha256: 'b'.repeat(64) }
  const row = (lineNo: number, date: string, direction: 'in' | 'out', amount = '25.00', txNo = 'C1') =>
    ({ lineNo, date, currency: 'USD', amount, direction, counterparty: 'Google Play', bankType: 'CARD', details: '', bankTxNo: txNo, balanceAfter: null })
  const stOf = (rows: ReturnType<typeof row>[]) => ({ accountNumber: null, currency: 'USD', from: null, until: null, opening: null, closing: null, rows, problems: [], issues: [] })
  const plan = (rows: ReturnType<typeof row>[], transactions: Array<{ id: string; sheetId: string; data: Record<string, unknown>; confirmed: boolean; createdAt: Date; updatedAt: Date }> = []) =>
    computeBankPlan({ periods: [], transactions, accounts: [acct] }, stOf(rows) as never, { accountKey: 'A1', file }, schema)
  const saved = (r: { rows: Array<Record<string, unknown>> }, from = 0) => r.rows.map((data, i) => ({ id: `r${from + i}`, sheetId: 's', data, confirmed: false, createdAt: new Date(), updatedAt: new Date() }))
  const keys = (r: { rows: Array<Record<string, unknown>> }) => r.rows.map((d) => d.bankRowKey)

  it('two rows in one file (newest first) - only the refund gets :rev - uploading again gives both already present', () => {
    const first = plan([row(1, '2026-07-13', 'in'), row(2, '2026-07-03', 'out')])
    assert.deepEqual(keys(first), ['tx:C1:rev', 'tx:C1'])
    const again = plan([row(1, '2026-07-13', 'in'), row(2, '2026-07-03', 'out')], saved(first)).plan
    assert.equal(again.insert.length, 0); assert.equal(again.existing.length, 2); assert.deepEqual(again.problems.filter((p) => p.code.startsWith('ubs_existing')), [])
  })
  it('refund across quarters - original row in an earlier file, this file has only the refund -> entered as :rev', () => {
    const q2 = plan([row(1, '2026-06-28', 'out')])
    const q3 = plan([row(1, '2026-07-02', 'in')], saved(q2))
    assert.equal(q3.plan.insert.length, 1); assert.deepEqual(keys(q3), ['tx:C1:rev'])
  })
  it('even if the refund file is entered first - the original row arriving later is :rev, and a two-row file has both already present', () => {
    const refund = plan([row(1, '2026-07-13', 'in')])
    const original = plan([row(1, '2026-07-03', 'out')], saved(refund))
    assert.deepEqual(keys(original), ['tx:C1:rev'])
    const both = plan([row(1, '2026-07-13', 'in'), row(2, '2026-07-03', 'out')], [...saved(refund), ...saved(original, 10)]).plan
    assert.equal(both.insert.length, 0); assert.equal(both.existing.length, 2)
  })
  it('same day - a two-row file does not stop even if the incoming row went in alone first', () => {
    const lone = plan([row(1, '2026-07-05', 'in', '25.00', 'C2')])
    const both = plan([row(1, '2026-07-05', 'in', '25.00', 'C2'), row(2, '2026-07-05', 'out', '25.00', 'C2')], saved(lone))
    assert.equal(both.plan.existing.length, 1); assert.equal(both.plan.insert.length, 1); assert.deepEqual(keys(both), ['tx:C2:rev'])
  })
  it('amount 0 pair is also a reversal - same rule within a file or across quarters (blocking it would stop the whole file)', () => {
    assert.deepEqual(keys(plan([row(1, '2026-07-02', 'in', '0.00'), row(2, '2026-06-28', 'out', '0.00')])), ['tx:C1:rev', 'tx:C1'])
    const q2 = plan([row(1, '2026-06-28', 'out', '0.00')])
    assert.deepEqual(keys(plan([row(1, '2026-07-02', 'in', '0.00')], saved(q2))), ['tx:C1:rev'])
  })
  it('partial refund (different amount) is not a reversal even across quarters - not entered, "content differs"', () => {
    const q2 = plan([row(1, '2026-06-28', 'out', '100.00')])
    const q3 = plan([row(1, '2026-07-02', 'in', '40.00')], saved(q2)).plan
    assert.equal(q3.insert.length, 0)
    assert.ok(q3.problems.some((p) => p.code === 'ubs_existing_differs'))
  })
})

describe('UBS plan - row classification - fingerprint', () => {
  const csv = [
    'Account number:;0000 00000000.00X;',
    'IBAN:;CH00 0000 0000 0000 0000 0;',
    'From:;2026-06-28;',
    'Until:;2026-07-02;',
    'Opening balance:;100.00;',
    'Closing balance:;130.00;',
    'Valued in:;CHF;',
    'Numbers of transactions in this period:;3;',
    '',
    'Trade date;Trade time;Booking date;Value date;Currency;Debit;Credit;Individual amount;Balance;Transaction no.;Description1;Description2;Description3;Footnotes;',
    '2026-07-02;;2026-07-02;2026-07-02;CHF;;25.00;;130.00;T3;Kunde C;Zahlung;;;',
    '2026-07-01;;2026-07-01;2026-07-01;CHF;-5.00;;;105.00;T2;Lieferant B;Belastung;;;',
    '2026-06-30;;2026-06-30;2026-06-30;CHF;;10.00;;110.00;T1;Kunde A;Zahlung;;;',
  ].join('\n')
  const st = parseUbsCsv(csv)
  const schema = templateSchema(T('vat.transactions'))
  const acct = { id: 'a', sheetId: 's', data: { accountKey: 'A1', bank: 'ubs', currency: 'CHF' }, confirmed: null, createdAt: new Date(), updatedAt: new Date() }
  const file = { id: 'f', sha256: 'a'.repeat(64) }
  const empty = computeBankPlan({ periods: [], transactions: [], accounts: [acct] }, st, { accountKey: 'A1', file }, schema)

  it('empty project = enter all rows - no problems - both balance checks ok', () => {
    assert.deepEqual(st.problems, [])
    assert.equal(empty.plan.insert.length, 3)
    assert.deepEqual(empty.plan.problems, [])
    assert.deepEqual(empty.plan.balance, { file: 'ok', ledger: 'ok' })
  })
  it('locked Q2 (through 06-30) - missing rows are problems, only open rows are entered - chain of entered rows checked as 07-01 to 07-02', () => {
    const q2 = [{ start: '2026-04-01', end: '2026-06-30' }]
    const p = computeBankPlan({ periods: q2, transactions: [], accounts: [acct] }, st, { accountKey: 'A1', file }, schema).plan
    assert.equal(p.insert.length, 2)
    assert.equal(p.problems.length, 1)
    assert.match(p.problems[0].text, /잠긴 기간/)
    assert.equal(p.problems[0].code, 'ubs_locked_missing')
    assert.equal(p.balance.ledger, 'ok')
  })
  it('existing row = already present (even if locked) - differing content is a problem - fingerprint changes', () => {
    const existing = empty.rows.map((data, i) => ({ id: `r${i}`, sheetId: 's', data, confirmed: false, createdAt: new Date(), updatedAt: new Date() }))
    const again = computeBankPlan({ periods: [], transactions: existing, accounts: [acct] }, st, { accountKey: 'A1', file }, schema).plan
    assert.equal(again.insert.length, 0)
    assert.equal(again.existing.length, 3)
    assert.equal(again.balance.ledger, 'skipped')
    const changed = existing.map((r, i) => (i === 0 ? { ...r, data: { ...r.data, amount: '26.00' } } : r))
    const diff = computeBankPlan({ periods: [], transactions: changed, accounts: [acct] }, st, { accountKey: 'A1', file }, schema).plan
    assert.equal(diff.problems.length, 1)
    assert.notEqual(diff.digest, again.digest)
  })
  it('account with a different currency - unknown account', () => {
    const eur = { ...acct, data: { ...acct.data, currency: 'EUR' } }
    assert.match(computeBankPlan({ periods: [], transactions: [], accounts: [eur] }, st, { accountKey: 'A1', file }, schema).plan.problems[0].text, /통화/)
    assert.equal(code(() => computeBankPlan({ periods: [], transactions: [], accounts: [acct] }, st, { accountKey: 'B', file }, schema)), 'INVALID')
  })
  it('if a middle row is neither entered nor already present, ledger chain = mismatch', () => {
    const p = computeBankPlan({ periods: [{ start: '2026-07-01', end: '2026-07-01' }], transactions: [], accounts: [acct] }, st, { accountKey: 'A1', file }, schema).plan
    assert.equal(p.balance.ledger, 'mismatch')
  })
  it('classification rules - counterparty first - lower priority number first - ignoring case, whitespace and hyphens - matched rows keep the unconfirmed value as is - fingerprint changes when rules change', () => {
    const rule = (id: string, data: Record<string, unknown>) => ({ id, sheetId: 'rs', data, confirmed: null, createdAt: new Date(), updatedAt: new Date() })
    const byType = rule('r1', { priority: 1, field: 'bankType', match: 'zahlung', type: 'other', vatCode: 'no_vat' })
    const byParty = rule('r2', { priority: 9, field: 'counterparty', match: 'KUNDE-c', type: 'income', vatCode: 'ch_standard', category: 'sales' })
    const blank = rule('r0', { priority: 0, field: 'counterparty', match: ' - ', type: 'expense', vatCode: 'no_vat' })
    assert.equal(classifyBankRow([byType, byParty, blank], { counterparty: 'Kunde C', bankType: 'Zahlung' })?.ruleId, 'r2')
    assert.equal(classifyBankRow([byType, byParty, blank], { counterparty: 'Lieferant B', bankType: 'Zahlung' })?.ruleId, 'r1')
    assert.equal(classifyBankRow([byType, byParty, blank], { counterparty: 'Lieferant B', bankType: 'Belastung' }), null)
    const early = rule('r3', { priority: 2, field: 'counterparty', match: 'kunde', type: 'income', vatCode: 'foreign_income' })
    assert.equal(classifyBankRow([byParty, early], { counterparty: 'Kunde C' })?.ruleId, 'r3')

    const withRules = computeBankPlan({ periods: [], transactions: [], accounts: [acct], rules: [byParty] }, st, { accountKey: 'A1', file }, schema)
    const c = withRules.rows.find((r) => r.bankRowKey === empty.rows.find((x) => x.counterparty === 'Kunde C')?.bankRowKey)
    assert.ok(c, 'Kunde C 줄')
    assert.deepEqual([c!.type, c!.vatCode, c!.category], ['income', 'ch_standard', 'sales'])
    assert.equal(withRules.plan.classified, 1)
    assert.equal(empty.plan.classified, 0)
    assert.notEqual(withRules.plan.digest, empty.plan.digest)
    const otherRule = computeBankPlan({ periods: [], transactions: [], accounts: [acct], rules: [{ ...byParty, data: { ...byParty.data, vatCode: 'foreign_income' } }] }, st, { accountKey: 'A1', file }, schema)
    assert.notEqual(otherRule.plan.digest, withRules.plan.digest)
    const plan = (rules: typeof byParty[]) => computeBankPlan({ periods: [], transactions: [], accounts: [acct], rules }, st, { accountKey: 'A1', file }, schema).plan.digest
    assert.notEqual(plan([{ ...byParty, data: { ...byParty.data, match: 'kunde c' } }]), withRules.plan.digest)
    const nomatch = rule('r9', { priority: 5, field: 'counterparty', match: 'nobody', type: 'expense', vatCode: 'no_vat' })
    assert.notEqual(plan([byParty, nomatch]), plan([byParty, { ...nomatch, data: { ...nomatch.data, match: 'nobody2' } }]))
    assert.equal(plan([byParty, nomatch]), plan([nomatch, byParty]), '읽은 순서만 다르면 같은 지문')
    const umlaut = rule('r10', { priority: 1, field: 'counterparty', match: 'M\u00fcller\u2011AG', type: 'expense', vatCode: 'no_vat', category: '  office ' })
    const hitU = classifyBankRow([umlaut], { counterparty: 'Mu\u0308ller-AG Zürich' })
    assert.equal(hitU?.ruleId, 'r10')
    assert.equal(hitU?.category, 'office')
    assert.equal(classifyBankRow([{ ...umlaut, data: { ...umlaut.data, category: '   ' } }], { counterparty: 'Müller AG' })?.category, undefined)
    assert.equal(classifyBankRow([rule('r11', { priority: 1, field: 'counterparty', match: '\ufb01', type: 'expense', vatCode: 'no_vat' })], { counterparty: 'Firma AG' }), null)
  })
})

describe('balance check - post-transaction balance chain (chainEnds)', () => {
  const m = (date: string, amount: string, direction: 'in' | 'out', balanceAfter: string | null) => ({ date, amount, direction, balanceAfter })
  const ends = (xs: Parameters<typeof chainEnds>[0]) => { const e = chainEnds(xs); return e && { opening: e.opening, closing: e.closing } }
  it('connected chain = balance before first row - balance after last row (regardless of row order)', () => {
    // 100 → +50 = 150 → −30 = 120 → +5 = 125
    assert.deepEqual(ends([m('2026-07-20', '5.00', 'in', '125.00'), m('2026-07-01', '50.00', 'in', '150.00'), m('2026-07-10', '30.00', 'out', '120.00')]), { opening: '100.00', closing: '125.00' })
  })
  it('even if the same balance appears twice - or returns to the original balance - first and last days decide', () => {
    // 0 → +10 = 10 → −10 = 0 → +10 = 10
    assert.deepEqual(ends([m('2026-07-01', '10.00', 'in', '10.00'), m('2026-07-02', '10.00', 'out', '0.00'), m('2026-07-03', '10.00', 'in', '10.00')]), { opening: '0.00', closing: '10.00' })
    // 100 → +10 = 110 → −10 = 100
    assert.deepEqual(ends([m('2026-07-01', '10.00', 'in', '110.00'), m('2026-07-02', '10.00', 'out', '100.00')]), { opening: '100.00', closing: '100.00' })
  })
  it('several rows on the same day - first and last rows decided by values within that day', () => {
    assert.deepEqual(ends([m('2026-07-01', '5.00', 'out', '115.00'), m('2026-07-01', '20.00', 'in', '120.00')]), { opening: '100.00', closing: '115.00' })
  })
  it('finds the order even when the same-day balance returns to that day start amount', () => {
    assert.deepEqual(ends([m('2026-07-01', '300.00', 'in', '1300.00'), m('2026-07-01', '500.00', 'out', '1000.00'), m('2026-07-01', '500.00', 'in', '1500.00')]), { opening: '1000.00', closing: '1300.00' })
  })
  it('null if same-day rows are not connected (missing row)', () => {
    assert.equal(chainEnds([m('2026-07-01', '50.00', 'in', '150.00'), m('2026-07-01', '5.00', 'in', '135.00')]), null)
  })
  it('a chain connected backward in date is "mismatch" in the check', () => {
    const e = chainEnds([m('2026-07-01', '10.00', 'in', '110.00'), m('2026-07-02', '10.00', 'in', '100.00')])!
    assert.deepEqual({ opening: e.opening, closing: e.closing, openingDate: e.openingDate, closingDate: e.closingDate }, { opening: '100.00', closing: '100.00', openingDate: '2026-07-01', closingDate: '2026-07-02' })
    assert.equal(reconcileBalance(e.opening, e.closing, [{ amount: '10.00', direction: 'in' }, { amount: '10.00', direction: 'in' }]).status, 'mismatch')
  })
  it('missing transaction = broken chain - picks the earliest start and latest end so the check exposes the difference', () => {
    assert.deepEqual(ends([m('2026-07-01', '50.00', 'in', '150.00'), m('2026-07-20', '5.00', 'in', '135.00')]), { opening: '100.00', closing: '135.00' })
  })
  it('null if any row lacks a balance or there are no rows', () => {
    assert.equal(chainEnds([m('2026-07-01', '50.00', 'in', '150.00'), m('2026-07-02', '5.00', 'in', null)]), null)
    assert.equal(chainEnds([]), null)
  })
})
