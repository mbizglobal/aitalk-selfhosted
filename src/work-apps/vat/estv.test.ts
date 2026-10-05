
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  allocateInvoiceVat,
  buildTransitionItems,
  computeVatReturn,
  formatCents,
  parseCents,
  parseMicros,
  reverseVat,
  roundDiv,
  toChf,
  type FxLookup,
  type FxQuote,
  type VatAdjustmentInput,
  type VatBoxes,
  type VatInvoiceInput,
  type VatPaymentInput,
  type VatReturnInput,
  type VatTxInput,
} from './estv'

const b = (n: number) => BigInt(n)
const Q1 = { start: '2027-01-01', end: '2027-03-31' }
const Q3 = { start: '2026-07-01', end: '2026-09-30' }

const RATES: Record<string, FxQuote> = {
  EUR: { rate: '0.940000', unit: 1 },
  JPY: { rate: '0.550000', unit: 100 },
}
const fxTable: FxLookup = (cur) => RATES[cur] ?? null
const noFx: FxLookup = () => null

let seq = 0
function tx(p: Partial<VatTxInput>): VatTxInput {
  return {
    id: p.id ?? `t${++seq}`, date: '2026-08-01', currency: 'CHF', amount: '0.00', direction: 'in',
    type: 'income', vatCode: 'ch_standard', confirmed: true, ...p,
  }
}
function inv(p: Partial<VatInvoiceInput>): VatInvoiceInput {
  return {
    id: p.id ?? `i${++seq}`, direction: 'issued', invoiceDate: '2026-08-01', currency: 'CHF', amountGross: '0.00',
    invoiceVat: null, vatCode: 'ch_standard', confirmed: true, ...p,
  }
}
function pay(p: Partial<VatPaymentInput> & { transactionId: string }): VatPaymentInput {
  return { id: `p${++seq}`, invoiceId: null, txDate: '2026-08-01', kind: 'payment', amountTx: '0.00', amountInv: null, confirmed: true, ...p }
}
function adj(p: Partial<VatAdjustmentInput>): VatAdjustmentInput {
  return {
    id: `a${++seq}`, kind: 'discount', invoiceId: null, invoiceDirection: 'issued', invoiceVatCode: 'ch_standard',
    amountChf: '0.00', vatChf: '0.00', confirmed: true, ...p,
  }
}
function run(p: Partial<VatReturnInput>) {
  return computeVatReturn({
    basis: 'cash', roundTo5Rappen: false, period: Q3, transactions: [], declare383: false, box415: null, fx: fxTable, ...p,
  })
}
function boxes(r: ReturnType<typeof computeVatReturn>): VatBoxes {
  assert.ok(r.boxes, `boxes 가 null — fxMissing=${JSON.stringify(r.fxMissing)}`)
  return r.boxes
}
const chf = (s: string) => parseCents(s)
type BuildArgs = Omit<Parameters<typeof buildTransitionItems>[0], 'transactions'> & { transactions?: VatTxInput[] }
const build = (a: BuildArgs) => buildTransitionItems({ ...a, transactions: a.transactions ?? txsFor(a.payments, a.invoices) })

function txsFor(payments: VatPaymentInput[], invoices: VatInvoiceInput[]): VatTxInput[] {
  return payments.map((p) => {
    const i = invoices.find((x) => x.id === p.invoiceId)
    const issued = !i || i.direction === 'issued'
    const positive = !i || parseCents(i.amountGross) > b(0)
    return tx({
      id: p.transactionId, date: p.txDate, currency: i?.currency ?? 'CHF', amount: p.amountTx,
      type: issued ? 'income' : 'expense', direction: issued === positive ? 'in' : 'out',
    })
  })
}

describe('integer tools - half-up - BigInt conversion (section 4 rounding table)', () => {
  it('roundDiv: 0 - positive/negative 0.5 boundary rounds up in absolute value', () => {
    assert.equal(roundDiv(b(0), b(7)), b(0))
    assert.equal(roundDiv(b(5), b(10)), b(1))
    assert.equal(roundDiv(b(-5), b(10)), b(-1))
    assert.equal(roundDiv(b(4), b(10)), b(0))
    assert.equal(roundDiv(b(-4), b(10)), b(0))
    assert.equal(roundDiv(b(15), b(10)), b(2))
    assert.throws(() => roundDiv(b(1), b(0)))
  })

  it('0.005 boundary: 0.01 x 0.5 = 0.005 -> 0.01, negative gives -0.01', () => {
    const half = { micros: parseMicros('0.500000'), unit: b(1) }
    assert.equal(toChf(b(1), half), b(1))
    assert.equal(toChf(b(-1), half), b(-1))
    const under = { micros: parseMicros('0.499999'), unit: b(1) }
    assert.equal(toChf(b(1), under), b(0))
  })

  it('EUR 1.00 x 0.940500 = 0.94 (0.9405 has 0 in the third decimal) - x 0.945000 = 0.95 (truncating gives 0.94)', () => {
    assert.equal(toChf(chf('1.00'), { micros: parseMicros('0.940500'), unit: b(1) }), b(94))
    assert.equal(toChf(chf('1.00'), { micros: parseMicros('0.945000'), unit: b(1) }), b(95))
    assert.equal(toChf(chf('1.00'), { micros: parseMicros('0.940000'), unit: b(1) }), b(94))
  })

  it('JPY unit=100: 10,000 JPY x 0.55/100 = 55.00 CHF - manual rate unit=1', () => {
    assert.equal(toChf(chf('10000.00'), { micros: parseMicros('0.550000'), unit: b(100) }), chf('55.00'))
    assert.equal(toChf(chf('10.00'), { micros: parseMicros('1.100000'), unit: b(1) }), chf('11.00'))
  })

  it('parse: rejects excess decimal places, rejects bad format, format round trip', () => {
    assert.throws(() => parseCents('1.005'))
    assert.throws(() => parseMicros('0.1234567'))
    assert.throws(() => parseCents('1,00'))
    assert.equal(parseCents('-0.5'), b(-50))
    assert.equal(formatCents(b(-5)), '-0.05')
    assert.equal(formatCents(b(123456)), '1234.56')
    assert.equal(formatCents(b(0)), '0.00')
  })

  it('back-calculated VAT: 108.10 -> 8.10 - 0 -> 0 - negative -> negative', () => {
    assert.equal(reverseVat(chf('108.10')), chf('8.10'))
    assert.equal(reverseVat(b(0)), b(0))
    assert.equal(reverseVat(chf('-108.10')), chf('-8.10'))
  })
})

describe('cash - one bank transaction row (section 4)', () => {
  it('domestic sales + domestic purchases: 200, 303, tax amount, 400, 500', () => {
    const r = run({
      transactions: [
        tx({ amount: '1081.00' }),
        tx({ type: 'expense', direction: 'out', amount: '108.10' }),
      ],
    })
    const x = boxes(r)
    assert.equal(x[200], chf('1081.00'))
    assert.equal(x[303], chf('1081.00'))
    assert.equal(x['303_tax'], chf('81.00'))
    assert.equal(x[299], x[303])
    assert.equal(x[400], chf('8.10'))
    assert.equal(x[479], chf('8.10'))
    assert.equal(x[500], chf('72.90'))
    assert.equal(x[510], b(0))
    assert.deepEqual(r.errors, [])
  })

  it('sign table: sales refund (income out) is also subtracted from 221 - supplier refund (expense in) reduces 400', () => {
    const x = boxes(run({
      transactions: [
        tx({ currency: 'EUR', amount: '100.00', vatCode: 'foreign_income' }),
        tx({ currency: 'EUR', amount: '10.00', vatCode: 'foreign_income', direction: 'out' }),
        tx({ type: 'expense', direction: 'out', amount: '108.10' }),
        tx({ type: 'expense', direction: 'in', amount: '21.62' }),
      ],
    }))
    assert.equal(x[200], chf('84.60')) // 94.00 − 9.40
    assert.equal(x[221], chf('84.60'))
    assert.equal(x[299], b(0))
    assert.equal(x[400], chf('8.10') - chf('1.62'))
    assert.equal(x[510], chf('6.48'))
  })

  it('JPY sales: unit=100 is included in the total', () => {
    const x = boxes(run({ transactions: [tx({ currency: 'JPY', amount: '10000.00', vatCode: 'foreign_income' })] }))
    assert.equal(x[221], chf('55.00'))
  })

  it('JPY domestic purchase: tax amount also uses rate/unit', () => {
    const x = boxes(run({ transactions: [tx({ type: 'expense', direction: 'out', currency: 'JPY', amount: '10810.00' })] }))
    assert.equal(x[400], chf('4.46'))
  })

  it('no rate -> boxes null + "rate required" - internal is not blocked without a rate - rate 0 also counts as missing', () => {
    const r1 = run({
      fx: noFx,
      transactions: [tx({ id: 'fx1', currency: 'EUR', amount: '1.00', date: '2026-08-02' }), tx({ type: 'internal', currency: 'USD', amount: '5.00' })],
    })
    assert.equal(r1.boxes, null)
    assert.deepEqual(r1.fxMissing, [{ kind: 'tx', id: 'fx1', currency: 'EUR', date: '2026-08-02' }])

    const r2 = run({ fx: noFx, transactions: [tx({ type: 'internal', currency: 'USD', amount: '5.00' })] })
    assert.ok(r2.boxes)

    const r3 = run({ fx: () => ({ rate: '0', unit: 1 }), transactions: [tx({ currency: 'EUR', amount: '1.00' })] })
    assert.equal(r3.boxes, null)

    const r4 = run({ fx: () => ({ rate: '1.000000', unit: 0 }), transactions: [tx({ currency: 'EUR', amount: '1.00' })] })
    assert.equal(r4.boxes, null)
  })

  it('per-row rate override takes precedence over lookup', () => {
    const x = boxes(run({
      transactions: [tx({ currency: 'EUR', amount: '100.00', vatCode: 'foreign_income', fxOverride: { rate: '0.950000', unit: 1 } })],
    }))
    assert.equal(x[221], chf('95.00'))
  })

  it('303 tax amount is counted once in the total - may differ by 1 rappen from the sum of per-row back-calculations', () => {
    const lines = [tx({ amount: '0.20' }), tx({ amount: '0.20' }), tx({ amount: '0.20' })]
    const perLine = lines.reduce((s, t) => s + reverseVat(parseCents(t.amount)), b(0))
    const x = boxes(run({ transactions: lines }))
    assert.equal(perLine, b(3))
    assert.equal(x['303_tax'], b(4)) // 0.60 × 81/1081 = 0.04496 → 0.04
    assert.notEqual(x['303_tax'], perLine)
  })

  it('non-consideration income (non_consideration) is excluded from 200', () => {
    const x = boxes(run({ transactions: [tx({ amount: '71.00', vatCode: 'non_consideration' }), tx({ amount: '10.81' })] }))
    assert.equal(x[200], chf('10.81'))
    assert.equal(x[299], x[303])
  })

  it('quarter boundary: end date included, next day excluded', () => {
    const x = boxes(run({ transactions: [tx({ date: '2026-09-30', amount: '10.81' }), tx({ date: '2026-10-01', amount: '99.00' }), tx({ date: '2026-06-30', amount: '99.00' })] }))
    assert.equal(x[200], chf('10.81'))
  })

  it('a 0 transaction is 0', () => {
    const x = boxes(run({ transactions: [tx({ amount: '0.00' })] }))
    assert.equal(x[200], b(0))
    assert.equal(x[500], b(0))
    assert.equal(x[510], b(0))
  })

  it('exempt (no_vat) sales = out of scope -> 299 != 303 error', () => {
    const r = run({ transactions: [tx({ amount: '100.00', vatCode: 'no_vat' })] })
    assert.equal(r.errors.length, 1)
    assert.match(r.errors[0], /299/)
  })
})

describe('500 / 510 - 5 rappen (section 4 rounding table)', () => {
  const withNet = (net: string, round: boolean) =>
    boxes(run({ roundTo5Rappen: round, box415: parseFloat(net).toFixed(2) }))

  it('payment rounds down: 212.34 -> 212.30', () => {
    const x = withNet('212.34', true)
    assert.equal(x[500], chf('212.30'))
    assert.equal(x[510], b(0))
  })
  it('refund rounds up: 3.72 -> 3.75 - -0.01 -> 0.05 - -0.03 -> 0.05 - -0.05 -> 0.05', () => {
    assert.equal(withNet('-3.72', true)[510], chf('3.75'))
    assert.equal(withNet('-0.01', true)[510], chf('0.05'))
    assert.equal(withNet('-0.03', true)[510], chf('0.05'))
    assert.equal(withNet('-0.05', true)[510], chf('0.05'))
  })
  it('with the setting off, rappen stay as they are - if net amount is 0 both are 0', () => {
    assert.equal(withNet('212.34', false)[500], chf('212.34'))
    assert.equal(withNet('-3.72', false)[510], chf('3.72'))
    const z = withNet('0.00', true)
    assert.equal(z[500], b(0))
    assert.equal(z[510], b(0))
  })
})

describe('415 - 383 (section 4 box table)', () => {
  const base = [tx({ amount: '1081.00' }), tx({ type: 'expense', direction: 'out', amount: '108.10' })]

  it('415 empty box = 0 - 0 = 0 - 50.00 (positive, as on the form) reduces 479 - -50.00 increases it', () => {
    const empty = boxes(run({ transactions: base, box415: null }))
    const zero = boxes(run({ transactions: base, box415: '0' }))
    const pos = boxes(run({ transactions: base, box415: '50.00' }))
    const neg = boxes(run({ transactions: base, box415: '-50.00' }))
    assert.equal(empty[415], b(0))
    assert.equal(empty[479], chf('8.10'))
    assert.equal(zero[479], chf('8.10'))
    assert.equal(pos[415], chf('50.00'))
    assert.equal(pos[479], chf('-41.90'))
    assert.equal(pos[500], chf('122.90'))
    assert.equal(neg[479], chf('58.10'))
  })

  it('383 filled/not filled: 500 is the same - the target amount is always shown', () => {
    const lines = [...base, tx({ type: 'expense', direction: 'out', vatCode: 'acquisition_383', amount: '30.00' })]
    const off = run({ transactions: lines, declare383: false })
    const on = run({ transactions: lines, declare383: true })
    assert.equal(off.acquisition383Base, chf('30.00'))
    assert.equal(boxes(off)[383], b(0))
    assert.equal(boxes(on)[383], chf('30.00'))
    assert.equal(boxes(on)['383_tax'], chf('2.43'))
    assert.equal(boxes(on)[399], boxes(off)[399] + chf('2.43'))
    assert.equal(boxes(on)[400], boxes(off)[400] + chf('2.43'))
    assert.equal(boxes(on)[500], boxes(off)[500])
  })

  it('383 taxable base negative (refund) - 0', () => {
    const r = run({
      declare383: true,
      transactions: [
        tx({ type: 'expense', direction: 'out', vatCode: 'acquisition_383', amount: '10.00' }),
        tx({ type: 'expense', direction: 'in', vatCode: 'acquisition_383', amount: '30.00' }),
      ],
    })
    assert.equal(boxes(r)[383], chf('-20.00'))
    assert.equal(boxes(r)['383_tax'], chf('-1.62'))
    assert.equal(boxes(r)[500] + boxes(r)[510], b(0))
    const z = run({ declare383: true, transactions: [] })
    assert.equal(boxes(z)[383], b(0))
  })
})

describe('cash - invoice pairing (section 4-B)', () => {
  it('partial payment rappen allocation: the last payment that settles in full takes the remainder so the total is exactly equal', () => {
    const i = inv({ id: 'inv', direction: 'received', amountGross: '100.00', invoiceVat: '7.49' })
    const ps = [
      pay({ id: 'p3', invoiceId: 'inv', transactionId: 't3', txDate: '2026-09-01', amountTx: '33.34', amountInv: '33.34' }),
      pay({ id: 'p1', invoiceId: 'inv', transactionId: 't1', txDate: '2026-07-01', amountTx: '33.33', amountInv: '33.33' }),
      pay({ id: 'p2', invoiceId: 'inv', transactionId: 't2', txDate: '2026-08-01', amountTx: '33.33', amountInv: '33.33' }),
    ]
    const m = allocateInvoiceVat(i, ps)
    assert.equal(m.get('p1'), chf('2.50')) // 33.33 × 7.49/100 = 2.4964
    assert.equal(m.get('p2'), chf('2.49'))
    assert.equal(m.get('p3'), chf('2.50'))
    assert.equal([...m.values()].reduce((s, v) => s + v, b(0)), chf('7.49'))

    const x = boxes(run({
      invoices: [i], payments: ps,
      transactions: ['t1', 't2', 't3'].map((id, k) => tx({ id, type: 'expense', direction: 'out', date: ps.find((p) => p.transactionId === id)!.txDate, amount: ['33.33', '33.33', '33.34'][k] })),
    }))
    assert.equal(x[400], chf('7.49'))
  })

  it('invoice VAT 0 stays 0 (not replaced by back-calculation - the `??` rule)', () => {
    const i = inv({ id: 'z', direction: 'received', amountGross: '108.10', invoiceVat: '0.00' })
    const x = boxes(run({
      invoices: [i],
      payments: [pay({ invoiceId: 'z', transactionId: 'tz', amountTx: '108.10', amountInv: '108.10' })],
      transactions: [tx({ id: 'tz', type: 'expense', direction: 'out', amount: '108.10' })],
    }))
    assert.equal(x[400], b(0))
  })

  it('EUR invoice paid from a CHF account: box = EUR amount x payment-date rate, account CHF is not used', () => {
    const i = inv({ id: 'e', direction: 'issued', currency: 'EUR', amountGross: '100.00', vatCode: 'foreign_income' })
    const x = boxes(run({
      invoices: [i],
      payments: [pay({ invoiceId: 'e', transactionId: 'te', amountTx: '97.00', amountInv: '100.00' })],
      transactions: [tx({ id: 'te', currency: 'CHF', amount: '97.00', vatCode: 'foreign_income' })],
    }))
    assert.equal(x[221], chf('94.00'))
  })

  it('unpaired remaining share uses the transaction currency - back-calculated', () => {
    const i = inv({ id: 'h', direction: 'received', amountGross: '54.05', invoiceVat: '4.05' })
    const x = boxes(run({
      invoices: [i],
      payments: [pay({ invoiceId: 'h', transactionId: 'th', amountTx: '54.05', amountInv: '54.05' })],
      transactions: [tx({ id: 'th', type: 'expense', direction: 'out', amount: '162.15' })],
    }))
    assert.equal(x[400], chf('4.05') + chf('8.10'))
  })

  it('if currencies differ and amountInv is missing, throws instead of silently becoming 0', () => {
    const i = inv({ id: 'n', direction: 'received', currency: 'EUR', amountGross: '10.00' })
    assert.throws(() => run({
      invoices: [i],
      payments: [pay({ invoiceId: 'n', transactionId: 'tn', amountTx: '9.50', amountInv: null })],
      transactions: [tx({ id: 'tn', type: 'expense', direction: 'out', amount: '9.50' })],
    }))
  })

  it('throws when pairs sum above the transaction amount - both cash payment and agreed prepayment', () => {
    const i = inv({ id: 'o', direction: 'received', amountGross: '10.00' })
    assert.throws(() => run({
      invoices: [i],
      payments: [pay({ invoiceId: 'o', transactionId: 'to', amountTx: '10.00', amountInv: '10.00' })],
      transactions: [tx({ id: 'to', type: 'expense', direction: 'out', amount: '5.00' })],
    }), /넘는다/)
    assert.throws(() => run({
      basis: 'agreed',
      transactions: [tx({ id: 'a', amount: '100.00' })],
      payments: [pay({ kind: 'advance', transactionId: 'a', amountTx: '150.00' })],
    }), /넘는다/)
  })

  it('throws when invoice VAT sign differs from the total', () => {
    assert.throws(() => run({ basis: 'agreed', invoices: [inv({ direction: 'received', amountGross: '108.10', invoiceVat: '-8.10' })] }), /부호/)
    assert.ok(run({ basis: 'agreed', invoices: [inv({ direction: 'received', amountGross: '108.10', invoiceVat: '0.00' })] }).boxes)
  })

  it('one deposit settles a domestic and a foreign invoice: 303 and 221 separately per share', () => {
    const x = boxes(run({
      invoices: [
        inv({ id: 'd', amountGross: '1081.00' }),
        inv({ id: 'f', currency: 'EUR', amountGross: '100.00', vatCode: 'foreign_income' }),
      ],
      payments: [
        pay({ invoiceId: 'd', transactionId: 'both', amountTx: '1081.00', amountInv: '1081.00' }),
        pay({ invoiceId: 'f', transactionId: 'both', amountTx: '94.00', amountInv: '100.00' }),
      ],
      transactions: [tx({ id: 'both', amount: '1175.00', vatCode: 'ch_standard' })],
    }))
    assert.equal(x[303], chf('1081.00'))
    assert.equal(x[221], chf('94.00'))
    assert.equal(x[299], x[303])
  })

  it('one payment for a domestic purchase + a 383 invoice: 400 only for the domestic part, 383 only for the foreign part', () => {
    const r = run({
      declare383: true,
      invoices: [
        inv({ id: 'ch', direction: 'received', amountGross: '108.10', invoiceVat: '8.10' }),
        inv({ id: 'ab', direction: 'received', amountGross: '50.00', vatCode: 'acquisition_383' }),
      ],
      payments: [
        pay({ invoiceId: 'ch', transactionId: 'mix', amountTx: '108.10', amountInv: '108.10' }),
        pay({ invoiceId: 'ab', transactionId: 'mix', amountTx: '50.00', amountInv: '50.00' }),
      ],
      transactions: [tx({ id: 'mix', type: 'expense', direction: 'out', amount: '158.10' })],
    })
    assert.equal(r.acquisition383Base, chf('50.00'))
    assert.equal(boxes(r)[400], chf('8.10') + chf('4.05'))
  })

  it('cash purchase credit note pairing: supplier refund (expense in) reduces 400 - no double sign reversal', () => {
    const x = boxes(run({
      invoices: [inv({ id: 'cn', direction: 'received', amountGross: '-108.10', invoiceVat: '-8.10' })],
      payments: [pay({ invoiceId: 'cn', transactionId: 'ref', amountTx: '108.10', amountInv: '-108.10' })],
      transactions: [tx({ id: 'ref', type: 'expense', direction: 'in', amount: '108.10' })],
    }))
    assert.equal(x[400], chf('-8.10'))
  })

  it('cash later discount = 235 - bad-debt correction on cash is an error', () => {
    const r = run({
      transactions: [tx({ amount: '1081.00' })],
      adjustments: [adj({ kind: 'discount', amountChf: '108.10', vatChf: '8.10' })],
    })
    const x = boxes(r)
    assert.equal(x[235], chf('108.10'))
    assert.equal(x[289], chf('108.10'))
    assert.equal(x[303], chf('972.90'))
    assert.equal(x[299], x[303])
    assert.deepEqual(r.errors, [])

    const bad = run({ transactions: [], adjustments: [adj({ kind: 'bad_debt', amountChf: '1.00' })] })
    assert.equal(bad.errors.length, 1)
  })
})

describe('entry checks - stop instead of being silently wrong', () => {
  it('same id twice -> throws (transaction, invoice, pair, correction)', () => {
    assert.throws(() => run({ transactions: [tx({ id: 'd' }), tx({ id: 'd' })] }), /두 번/)
    assert.throws(() => run({ basis: 'agreed', invoices: [inv({ id: 'A', amountGross: '100.00' }), inv({ id: 'A', amountGross: '100.00' })] }), /두 번/)
    assert.throws(() => run({ payments: [pay({ id: 'p', transactionId: 'x' }), pay({ id: 'p', transactionId: 'y' })] }), /두 번/)
    assert.throws(() => run({ adjustments: [adj({ id: 'a' }), adj({ id: 'a' })] }), /두 번/)
  })

  it('empty or invalid date -> throws (so it does not silently fall outside the quarter)', () => {
    assert.throws(() => run({ transactions: [tx({ date: '' })] }), /날짜/)
    assert.throws(() => run({ basis: 'agreed', invoices: [inv({ direction: 'received', amountGross: '108.10', receivedAt: '' })] }), /날짜/)
    assert.throws(() => run({ transactions: [tx({ date: '01-08-2026' })] }), /날짜/)
    assert.throws(() => run({ transactions: [tx({ date: '2026-02-31' })] }), /달력/)
    assert.throws(() => run({ transactions: [tx({ date: '2026-13-40' })] }), /달력/)
    assert.ok(run({ transactions: [tx({ date: '2028-02-29' })] }).boxes)
  })

  it('pair amountTx 0 or negative -> throws - throws if pair txDate differs from the transaction date', () => {
    const i = inv({ id: 'I', direction: 'received', amountGross: '108.10', invoiceVat: '8.10' })
    const t = tx({ id: 'T', type: 'expense', direction: 'out', amount: '108.10' })
    assert.throws(() => run({ invoices: [i], transactions: [t], payments: [pay({ invoiceId: 'I', transactionId: 'T', amountTx: '0.00', amountInv: '108.10' })] }), /양수/)
    assert.throws(() => run({ invoices: [i], transactions: [t], payments: [pay({ invoiceId: 'I', transactionId: 'T', amountTx: '-108.10', amountInv: '108.10' })] }), /양수/)
    assert.throws(() => run({ invoices: [i], transactions: [t], payments: [pay({ invoiceId: 'I', transactionId: 'T', txDate: '2026-08-02', amountTx: '108.10', amountInv: '108.10' })] }), /txDate/)
  })

  it('throws when the pair transaction type and invoice direction conflict', () => {
    assert.throws(() => run({
      invoices: [inv({ id: 'S', direction: 'issued', amountGross: '108.10' })],
      transactions: [tx({ id: 'X', type: 'expense', direction: 'out', amount: '108.10' })],
      payments: [pay({ invoiceId: 'S', transactionId: 'X', amountTx: '108.10', amountInv: '108.10' })],
    }), /방향/)
    assert.throws(() => run({
      invoices: [inv({ id: 'P', direction: 'received', amountGross: '100.00' })],
      transactions: [tx({ id: 'Y', amount: '100.00' })],
      payments: [pay({ invoiceId: 'P', transactionId: 'Y', amountTx: '100.00', amountInv: '100.00' })],
    }), /방향/)
  })

  it('credit note only on refund-direction transactions - quarter start > end -> throws', () => {
    assert.throws(() => run({
      invoices: [inv({ id: 'C', amountGross: '-108.10', invoiceVat: '-8.10' })],
      transactions: [tx({ id: 'I', amount: '108.10' })], // income·in
      payments: [pay({ invoiceId: 'C', transactionId: 'I', amountTx: '108.10', amountInv: '108.10' })],
    }), /부호/)
    assert.throws(() => run({
      invoices: [inv({ id: 'R', direction: 'received', amountGross: '-108.10', invoiceVat: '-8.10' })],
      transactions: [tx({ id: 'O', type: 'expense', direction: 'out', amount: '108.10' })],
      payments: [pay({ invoiceId: 'R', transactionId: 'O', amountTx: '108.10', amountInv: '108.10' })],
    }), /부호/)
    const ok = boxes(run({
      invoices: [inv({ id: 'C2', amountGross: '-108.10' })],
      transactions: [tx({ id: 'I2', direction: 'out', amount: '108.10' })],
      payments: [pay({ invoiceId: 'C2', transactionId: 'I2', amountTx: '108.10', amountInv: '108.10' })],
    }))
    assert.equal(ok[303], chf('-108.10'))
    assert.throws(() => run({ period: { start: '2026-09-30', end: '2026-07-01' } }), /늦다/)
  })

  it('transition list: non-consideration income and foreign purchases are excluded, exempt sales throw, unconfirmed deposits are reported', () => {
    const base = { toBasis: 'cash' as const, transitionDate: '2026-12-31', adjustmentsUpTo: [], fx: fxTable }
    const r = build({ ...base, payments: [], invoices: [
      inv({ id: 'nc', invoiceDate: '2026-12-01', amountGross: '500.00', vatCode: 'non_consideration' }),
      inv({ id: 'nv', direction: 'received', invoiceDate: '2026-12-01', amountGross: '100.00', vatCode: 'no_vat' }),
    ] })
    assert.deepEqual(r.items, [])
    assert.throws(() => build({ ...base, payments: [], invoices: [inv({ invoiceDate: '2026-12-01', amountGross: '1000.00', vatCode: 'no_vat' })] }), /범위 밖/)
    const i = inv({ id: 'W', invoiceDate: '2026-12-01', amountGross: '1081.00' })
    const p = pay({ invoiceId: 'W', transactionId: 'U', txDate: '2026-12-20', amountTx: '1081.00', amountInv: '1081.00' })
    const u = build({ ...base, invoices: [i], payments: [p], transactions: [tx({ id: 'U', date: '2026-12-20', amount: '1081.00', confirmed: false })] })
    assert.deepEqual(u.unconfirmed.map((x) => `${x.kind}:${x.id}`), ['tx:U'])
  })

  it('transition list: unconfirmed bad debt is reported - a fully paid exempt invoice does not break the list', () => {
    const base = { toBasis: 'cash' as const, transitionDate: '2026-12-31', fx: fxTable }
    const r = build({ ...base, payments: [],
      invoices: [inv({ id: 'K', invoiceDate: '2026-12-01', amountGross: '1000.00' })],
      adjustmentsUpTo: [{ id: 'bd', invoiceId: 'K', kind: 'bad_debt', confirmed: false, amountInv: '400.00' }],
    })
    assert.deepEqual(r.unconfirmed.map((u) => `${u.kind}:${u.id}`), ['adjustment:bd'])
    const paid = build({ ...base, adjustmentsUpTo: [],
      invoices: [inv({ id: 'N', invoiceDate: '2026-02-01', amountGross: '50.00', vatCode: 'no_vat' }), inv({ id: 'D', invoiceDate: '2026-12-10', amountGross: '1081.00' })],
      payments: [pay({ invoiceId: 'N', transactionId: 'x', txDate: '2026-02-02', amountTx: '50.00', amountInv: '50.00' })],
    })
    assert.deepEqual(paid.items.map((i) => i.invoiceId), ['D'])
  })

  it('transition list: ready=false if any invoice lacks a rate - exempt sales correction throws', () => {
    const r = build({ toBasis: 'cash', transitionDate: '2026-12-31', payments: [], adjustmentsUpTo: [], fx: noFx,
      invoices: [inv({ id: 'E', invoiceDate: '2026-12-01', currency: 'EUR', amountGross: '100.00' }), inv({ id: 'C', invoiceDate: '2026-12-10', amountGross: '1081.00' })] })
    assert.equal(r.ready, false)
    assert.deepEqual(r.items.map((i) => i.invoiceId), ['C'])
    assert.throws(() => run({ basis: 'agreed', adjustments: [adj({ kind: 'discount', invoiceVatCode: 'no_vat', amountChf: '100.00' })] }), /범위 밖/)
    assert.throws(() => run({ basis: 'agreed', adjustments: [adj({ kind: 'discount', invoiceDirection: 'received', invoiceVatCode: 'foreign_income', amountChf: '1.00' })] }), /쓸 수 없다/)
  })

  it('transition list: same correction twice -> throws', () => {
    assert.throws(() => build({
      toBasis: 'cash', transitionDate: '2026-12-31', payments: [], fx: fxTable,
      invoices: [inv({ id: 'K', invoiceDate: '2026-12-01', amountGross: '1000.00' })],
      adjustmentsUpTo: [{ id: 'x', invoiceId: 'K', kind: 'bad_debt', confirmed: true, amountInv: '600.00' }, { id: 'x', invoiceId: 'K', kind: 'bad_debt', confirmed: true, amountInv: '600.00' }],
    }), /두 번/)
  })

  it('transition list has the same entry checks - same-currency pair amount difference - pair without transaction - bad debt without amountInv', () => {
    const i = inv({ id: 'V', invoiceDate: '2026-12-01', amountGross: '100.00' })
    const p = pay({ invoiceId: 'V', transactionId: 'T', txDate: '2026-12-15', amountTx: '100.00', amountInv: '40.00' })
    assert.throws(() => build({ toBasis: 'cash', transitionDate: '2026-12-31', invoices: [i], payments: [p], adjustmentsUpTo: [], fx: fxTable }), /다르다/)
    assert.throws(() => build({ toBasis: 'cash', transitionDate: '2026-12-31', invoices: [i], payments: [p], transactions: [], adjustmentsUpTo: [], fx: fxTable }), /입력에 없다/)
    assert.throws(() => build({ toBasis: 'cash', transitionDate: '2026-12-31', invoices: [i], payments: [], adjustmentsUpTo: [{ id: 'bd', invoiceId: 'V', kind: 'bad_debt', confirmed: true, amountInv: null }], fx: fxTable }), /amountInv/)
  })

  it('negative transaction amount - pair pointing to a nonexistent invoice -> throws', () => {
    assert.throws(() => run({ transactions: [tx({ amount: '-108.10' })] }), /음수/)
    assert.throws(() => run({
      basis: 'agreed',
      transactions: [tx({ id: 'T', amount: '500.00' })],
      payments: [pay({ invoiceId: 'nope', transactionId: 'T', amountTx: '500.00', amountInv: '500.00' })],
    }), /입력에 없다/)
    assert.throws(() => run({
      basis: 'agreed',
      transactions: [tx({ id: 'T', amount: '500.00' })],
      payments: [pay({ invoiceId: null, transactionId: 'T', amountTx: '500.00' })],
    }), /인보이스가 없다/) // R7 codex
  })

  it('cash: if the payment pair is unconfirmed, that transaction is removed from the confirmed part', () => {
    const base = {
      invoices: [inv({ id: 'F', amountGross: '100.00', vatCode: 'foreign_income' as const })],
      transactions: [tx({ id: 'T', amount: '100.00' })],
      payments: [pay({ id: 'pp', invoiceId: 'F', transactionId: 'T', amountTx: '100.00', amountInv: '100.00', confirmed: false })],
    }
    const r = run({ ...base, onlyConfirmed: true })
    assert.equal(boxes(r)[200], b(0))
    assert.deepEqual(r.unconfirmed.map((u) => `${u.kind}:${u.id}`), ['payment:pp'])
    assert.equal(boxes(run(base))[221], chf('100.00'))
  })

  it('pair on a 0 invoice -> throws - in cash, if the pair invoice is unconfirmed, the transaction also drops out of the confirmed part', () => {
    assert.throws(() => run({
      invoices: [inv({ id: 'Z', direction: 'received', amountGross: '0.00' })],
      transactions: [tx({ id: 'T', type: 'expense', direction: 'in', amount: '108.10' })],
      payments: [pay({ invoiceId: 'Z', transactionId: 'T', amountTx: '108.10', amountInv: '108.10' })],
    }), /0원/)
    const base = {
      invoices: [inv({ id: 'F', amountGross: '100.00', vatCode: 'foreign_income' as const, confirmed: false })],
      transactions: [tx({ id: 'T', amount: '100.00' })],
      payments: [pay({ invoiceId: 'F', transactionId: 'T', amountTx: '100.00', amountInv: '100.00' })],
    }
    const r = run({ ...base, onlyConfirmed: true })
    assert.equal(boxes(r)[200], b(0))
    assert.deepEqual(r.unconfirmed.map((u) => `${u.kind}:${u.id}`), ['invoice:F'])
  })

  it('pair transaction not in the input - vatCode not matching the direction - VAT stated though not taxable -> throws', () => {
    assert.throws(() => run({
      invoices: [inv({ id: 'I', amountGross: '100.00', vatCode: 'foreign_income' })],
      transactions: [tx({ id: 'T', amount: '100.00' })],
      payments: [pay({ invoiceId: 'I', transactionId: 'nope', amountTx: '100.00', amountInv: '100.00' })],
    }), /거래 nope/)
    assert.throws(() => run({ basis: 'agreed', invoices: [inv({ direction: 'received', amountGross: '108.10', vatCode: 'foreign_income' })] }), /쓸 수 없다/)
    assert.throws(() => run({ basis: 'agreed', invoices: [inv({ direction: 'received', amountGross: '108.10', invoiceVat: '8.10', vatCode: 'no_vat' })] }), /ch_standard/)
  })

  it('same currency but amountTx != amountInv -> throws - negative discount or bad debt -> throws', () => {
    const i = inv({ id: 'I', direction: 'received', amountGross: '108.10', invoiceVat: '8.10' })
    const t = tx({ id: 'T', type: 'expense', direction: 'out', amount: '108.10' })
    assert.throws(() => run({ invoices: [i], transactions: [t], payments: [pay({ invoiceId: 'I', transactionId: 'T', amountTx: '108.10', amountInv: '54.05' })] }), /다르다/)
    assert.throws(() => run({ basis: 'agreed', adjustments: [adj({ kind: 'discount', amountChf: '-10.00' })] }), /음수/)
    assert.throws(() => run({ basis: 'agreed', adjustments: [adj({ kind: 'advance_offset', amountChf: '-100.00' })] }), /음수/)
    assert.ok(run({ period: Q1, adjustments: [adj({ kind: 'transition', toBasis: 'cash', ref: '400', invoiceDirection: 'received', amountChf: '-100.00', vatChf: '-8.10' })] }).boxes)
  })

  it('amountInv 0 on a pair with different currencies -> throws (so 221 does not silently become 0)', () => {
    assert.throws(() => run({
      invoices: [inv({ id: 'E', currency: 'EUR', amountGross: '100.00', vatCode: 'foreign_income' })],
      payments: [pay({ invoiceId: 'E', transactionId: 'T', amountTx: '94.00', amountInv: '0.00' })],
      transactions: [tx({ id: 'T', amount: '94.00', vatCode: 'foreign_income' })],
    }), /amountInv 가 0/)
  })
})

describe('confirmation - confirmed part / including unconfirmed (section 4 "relation between confirmation and numbers")', () => {
  it('unconfirmed are all included regardless of type - onlyConfirmed excludes unconfirmed rows', () => {
    const lines = [
      tx({ id: 'c', amount: '10.81' }),
      tx({ id: 'u', amount: '21.62', confirmed: false }),
      tx({ id: 'ui', type: 'internal', amount: '5.00', confirmed: false }),
    ]
    const all = run({ transactions: lines })
    const conf = run({ transactions: lines, onlyConfirmed: true })
    assert.deepEqual(all.unconfirmed.map((u) => u.id), ['u', 'ui'])
    assert.equal(boxes(all)[200], chf('32.43'))
    assert.equal(boxes(conf)[200], chf('10.81'))
  })
})

describe('agreed - the invoice creates the boxes (section 4-B)', () => {
  const runA = (p: Partial<VatReturnInput>) => run({ basis: 'agreed', ...p })

  it('issue-date quarter - received invoices use receivedAt quarter - rate on that date too', () => {
    const seen: string[] = []
    const fx: FxLookup = (c, d) => { seen.push(`${c}@${d}`); return RATES[c] ?? null }
    const x = boxes(runA({
      fx,
      invoices: [
        inv({ amountGross: '1081.00' }),
        inv({ currency: 'EUR', amountGross: '100.00', vatCode: 'foreign_income', invoiceDate: '2026-09-15' }),
        inv({ direction: 'received', amountGross: '108.10', invoiceDate: '2026-06-28', receivedAt: '2026-07-02' }),
        inv({ direction: 'received', amountGross: '216.20', invoiceDate: '2026-09-28', receivedAt: '2026-10-02' }),
      ],
    }))
    assert.equal(x[200], chf('1175.00'))
    assert.equal(x[221], chf('94.00'))
    assert.equal(x[303], chf('1081.00'))
    assert.equal(x[400], chf('8.10'))
    assert.deepEqual(seen, ['EUR@2026-09-15'])
  })

  it('credit note: issued negative = sales -, received negative = 400 -', () => {
    const x = boxes(runA({
      invoices: [
        inv({ amountGross: '1081.00' }),
        inv({ amountGross: '-108.10' }),
        inv({ direction: 'received', amountGross: '216.20' }),
        inv({ direction: 'received', amountGross: '-108.10', invoiceVat: '-8.10' }),
        inv({ amountGross: '0.00', confirmed: false }),
      ],
    }))
    assert.equal(x[200], chf('972.90'))
    assert.equal(x[303], chf('972.90'))
    assert.equal(x[400], chf('8.10'))
  })

  it('0 invoices are not in the unconfirmed list either - unconfirmed invoices are in the list', () => {
    const r = runA({ invoices: [inv({ id: 'zero', amountGross: '0.00', confirmed: false }), inv({ id: 'u', amountGross: '1.00', confirmed: false })] })
    assert.deepEqual(r.unconfirmed.map((u) => u.id), ['u'])
  })

  it('bad debt -> recovery: bad-debt quarter 235 +, recovery quarter 235 - (not added to 200)', () => {
    const q = runA({ adjustments: [adj({ kind: 'bad_debt', amountChf: '1081.00', vatChf: '81.00' })], invoices: [inv({ amountGross: '2162.00' })] })
    const x = boxes(q)
    assert.equal(x[200], chf('2162.00'))
    assert.equal(x[235], chf('1081.00'))
    assert.equal(x[303], chf('1081.00'))
    assert.equal(x[299], x[303])
    assert.equal(x['303_tax'], chf('81.00'))

    const rec = boxes(runA({ adjustments: [adj({ kind: 'recovery', amountChf: '1081.00', vatChf: '81.00' })] }))
    assert.equal(rec[200], b(0))
    assert.equal(rec[235], chf('-1081.00'))
    assert.equal(rec[303], chf('1081.00'))
    assert.equal(rec['303_tax'], chf('81.00'))
    assert.equal(rec[299], rec[303])
  })

  it('foreign sales bad debt and recovery go straight to 200 and 221, not 235', () => {
    const x = boxes(runA({
      invoices: [inv({ currency: 'EUR', amountGross: '100.00', vatCode: 'foreign_income' })],
      adjustments: [adj({ kind: 'bad_debt', invoiceVatCode: 'foreign_income', amountChf: '94.00' })],
    }))
    assert.equal(x[235], b(0))
    assert.equal(x[200], b(0))
    assert.equal(x[221], b(0))
    const r = boxes(runA({ adjustments: [adj({ kind: 'recovery', invoiceVatCode: 'foreign_income', amountChf: '94.00' })] }))
    assert.equal(r[200], chf('94.00'))
    assert.equal(r[221], chf('94.00'))
  })

  it('received discount (purchase side) = 400 decrease', () => {
    const x = boxes(runA({ adjustments: [adj({ kind: 'discount', invoiceDirection: 'received', amountChf: '108.10', vatChf: '8.10' })] }))
    assert.equal(x[400], chf('-8.10'))
  })

  it('prepayment > invoice: full prepayment in the deposit quarter, the invoice quarter is reduced by min(prepayment, total) so the remainder is not counted twice', () => {
    const t = tx({ id: 'adv', date: '2026-08-10', amount: '1000.00' })
    const i = inv({ id: 'late', invoiceDate: '2026-10-05', amountGross: '800.00' })
    const payments = [pay({ kind: 'advance', invoiceId: 'late', transactionId: 'adv', txDate: '2026-08-10', amountTx: '1000.00', amountInv: '1000.00' })]
    const q3 = boxes(runA({ transactions: [t], invoices: [i], payments }))
    const q4 = boxes(runA({ period: { start: '2026-10-01', end: '2026-12-31' }, transactions: [t], invoices: [i], payments }))
    assert.equal(q3[303], chf('1000.00'))
    assert.equal(q4[303], b(0)) // 800 − min(1000, 800)
    assert.equal(q3[303] + q4[303], chf('1000.00'))
  })

  it('prepayment < invoice: only the remainder in the invoice quarter', () => {
    const t = tx({ id: 'adv2', date: '2026-08-10', amount: '300.00' })
    const i = inv({ id: 'big', invoiceDate: '2026-10-05', amountGross: '1000.00' })
    const payments = [pay({ kind: 'advance', invoiceId: 'big', transactionId: 'adv2', txDate: '2026-08-10', amountTx: '300.00', amountInv: '300.00' })]
    const q4 = boxes(runA({ period: { start: '2026-10-01', end: '2026-12-31' }, transactions: [t], invoices: [i], payments }))
    assert.equal(q4[303], chf('700.00'))
  })

  it('EUR invoice prepayment received to a CHF account: deposit quarter box = EUR amountInv x deposit-date rate, foreign classification follows the invoice', () => {
    const t = tx({ id: 'advc', date: '2026-08-10', amount: '97.00', vatCode: 'ch_standard' })
    const i = inv({ id: 'eur', invoiceDate: '2026-10-05', currency: 'EUR', amountGross: '100.00', vatCode: 'foreign_income' })
    const payments = [pay({ kind: 'advance', invoiceId: 'eur', transactionId: 'advc', txDate: '2026-08-10', amountTx: '97.00', amountInv: '100.00' })]
    const x = boxes(runA({ transactions: [t], invoices: [i], payments }))
    assert.equal(x[221], chf('94.00'))
    assert.equal(x[303], b(0))
  })

  it('if the prepayment pair is unconfirmed, it is unconfirmed even when the transaction is confirmed', () => {
    const r = runA({
      transactions: [tx({ id: 'ad', amount: '10.00' })],
      payments: [pay({ kind: 'advance', transactionId: 'ad', amountTx: '10.00', confirmed: false })],
    })
    assert.deepEqual(r.unconfirmed.map((u) => `${u.kind}:${u.id}`), ['advance:ad'])
    assert.equal(boxes(runA({
      onlyConfirmed: true,
      transactions: [tx({ id: 'ad', amount: '10.00' })],
      payments: [pay({ kind: 'advance', transactionId: 'ad', amountTx: '10.00', confirmed: false })],
    }))[200], b(0))
  })

  it('deposit only partly assigned to invoices: the remainder is a prepayment candidate', () => {
    const r = runA({
      transactions: [tx({ id: 'part', amount: '1000.00' })],
      invoices: [inv({ id: 'y', amountGross: '600.00' })],
      payments: [pay({ invoiceId: 'y', transactionId: 'part', amountTx: '600.00', amountInv: '600.00' })],
    })
    assert.deepEqual(r.advanceCandidates, [{ id: 'part', remaining: chf('400.00') }])
  })

  it('only one of two prepayment pairs unconfirmed: confirmed part includes only the confirmed pair', () => {
    const base = {
      transactions: [tx({ id: 'two', amount: '300.00' })],
      payments: [
        pay({ kind: 'advance' as const, transactionId: 'two', amountTx: '100.00' }),
        pay({ kind: 'advance' as const, transactionId: 'two', amountTx: '200.00', confirmed: false }),
      ],
    }
    assert.equal(boxes(runA({ ...base, onlyConfirmed: true }))[200], chf('100.00'))
    assert.equal(boxes(runA(base))[200], chf('300.00'))
    assert.deepEqual(runA(base).unconfirmed.map((u) => u.id), ['two'])
  })

  it('unconfirmed prepayment: also shows as unconfirmed in the invoice quarter, confirmed part does not subtract the prepayment', () => {
    const t = tx({ id: 'T', date: '2026-08-10', amount: '300.00' })
    const i = inv({ id: 'I', invoiceDate: '2026-10-05', amountGross: '1000.00' })
    const payments = [pay({ id: 'adv', kind: 'advance', invoiceId: 'I', transactionId: 'T', txDate: '2026-08-10', amountTx: '300.00', amountInv: '300.00', confirmed: false })]
    const q4 = { start: '2026-10-01', end: '2026-12-31' }
    const conf = runA({ period: q4, onlyConfirmed: true, transactions: [t], invoices: [i], payments })
    assert.equal(boxes(conf)[303], chf('1000.00'))
    assert.deepEqual(conf.unconfirmed.map((u) => `${u.kind}:${u.id}`), ['advance:adv'])
    assert.equal(boxes(runA({ period: q4, transactions: [t], invoices: [i], payments }))[303], chf('700.00'))
  })

  it('wrongly attached prepayment throws at entry - in any quarter, any function', () => {
    assert.throws(() => runA({
      transactions: [tx({ id: 'A', amount: '100.00' })],
      invoices: [inv({ id: 'R', direction: 'received', invoiceDate: '2026-10-05', amountGross: '100.00' })],
      payments: [pay({ kind: 'advance', invoiceId: 'R', transactionId: 'A', amountTx: '100.00', amountInv: '100.00' })],
    }), /보낸 양수/)
    const cn = {
      transactions: [tx({ id: 'B', date: '2026-11-15', amount: '40.00' })],
      invoices: [inv({ id: 'C', invoiceDate: '2026-12-01', amountGross: '-100.00' })],
      payments: [pay({ kind: 'advance' as const, invoiceId: 'C', transactionId: 'B', txDate: '2026-11-15', amountTx: '40.00', amountInv: '40.00' })],
    }
    assert.throws(() => runA(cn), /보낸 양수/)
    assert.throws(() => build({ toBasis: 'cash', transitionDate: '2026-12-31', adjustmentsUpTo: [], fx: fxTable, ...cn }), /보낸 양수/)
    assert.throws(() => runA({
      period: { start: '2026-10-01', end: '2026-12-31' },
      transactions: [tx({ id: 'E', type: 'expense', direction: 'out', date: '2026-08-10', amount: '300.00' })],
      invoices: [inv({ id: 'I', invoiceDate: '2026-10-05', amountGross: '1000.00' })],
      payments: [pay({ kind: 'advance', invoiceId: 'I', transactionId: 'E', txDate: '2026-08-10', amountTx: '300.00', amountInv: '300.00' })],
    }), /매출 입금/)
    assert.throws(() => runA({
      transactions: [tx({ id: 'int', type: 'internal', amount: '500.00' })],
      payments: [pay({ kind: 'advance', transactionId: 'int', amountTx: '500.00' })],
    }), /매출 입금/)
  })

  it('prepayment with only the transaction unconfirmed: invoice quarter also unconfirmed, confirmed part does not subtract', () => {
    const q4 = { start: '2026-10-01', end: '2026-12-31' }
    const conf = runA({
      period: q4, onlyConfirmed: true,
      invoices: [inv({ id: 'I', invoiceDate: '2026-10-05', amountGross: '1000.00' })],
      transactions: [tx({ id: 'T', date: '2026-08-10', amount: '300.00', confirmed: false })],
      payments: [pay({ id: 'ap', kind: 'advance', invoiceId: 'I', transactionId: 'T', txDate: '2026-08-10', amountTx: '300.00', amountInv: '300.00' })],
    })
    assert.equal(boxes(conf)[303], chf('1000.00'))
    assert.deepEqual(conf.unconfirmed.map((u) => `${u.kind}:${u.id}`), ['advance:ap'])
  })

  it('deposit with no invoice or prepayment pair = prepayment candidate (a normal payment pair is not a candidate)', () => {
    const r = runA({
      transactions: [tx({ id: 'free', amount: '5.00' }), tx({ id: 'paid', amount: '10.00' }), tx({ id: 'out', type: 'expense', direction: 'out', amount: '1.00' })],
      invoices: [inv({ id: 'x', amountGross: '10.00' })],
      payments: [pay({ invoiceId: 'x', transactionId: 'paid', amountTx: '10.00', amountInv: '10.00' })],
    })
    assert.deepEqual(r.advanceCandidates, [{ id: 'free', remaining: chf('5.00') }])
    assert.equal(boxes(r)[200], chf('10.00'))
  })

  it('prepayment offset (advance_offset) is subtracted once from the current quarter taxable sales', () => {
    const x = boxes(runA({ adjustments: [adj({ kind: 'advance_offset', amountChf: '100.00' })] }))
    assert.equal(x[200], chf('-100.00'))
    assert.equal(x[303], chf('-100.00'))
    assert.equal(x[299], x[303])
  })
})

describe('year transition - first quarter of the year the method changed (section 4-B, MWSTV 106)', () => {
  const invoices = [
    inv({ id: 'dom', invoiceDate: '2026-12-10', amountGross: '1081.00' }),
    inv({ id: 'for', invoiceDate: '2026-12-15', currency: 'EUR', amountGross: '100.00', vatCode: 'foreign_income' }),
    inv({ id: 'rec', direction: 'received', invoiceDate: '2026-12-20', amountGross: '216.20', invoiceVat: '16.20' }),
    inv({ id: 'done', invoiceDate: '2026-11-01', amountGross: '50.00' }),
    inv({ id: 'next', invoiceDate: '2027-01-03', amountGross: '50.00' }),
  ]
  const payments = [
    pay({ invoiceId: 'dom', transactionId: 'x1', txDate: '2026-12-31', amountTx: '81.00', amountInv: '81.00' }),
    pay({ invoiceId: 'dom', transactionId: 'x2', txDate: '2027-01-05', amountTx: '500.00', amountInv: '500.00' }),
    pay({ invoiceId: 'rec', transactionId: 'x3', txDate: '2026-12-21', amountTx: '108.10', amountInv: '108.10' }),
    pay({ invoiceId: 'done', transactionId: 'x4', txDate: '2026-11-02', amountTx: '50.00', amountInv: '50.00' }),
  ]

  it('list: balance as of 12-31 - invoices with 0 balance or after the transition date are excluded - boxes fixed', () => {
    const r = build({ toBasis: 'cash', transitionDate: '2026-12-31', invoices, payments, adjustmentsUpTo: [], fx: fxTable })
    assert.deepEqual(r.fxMissing, [])
    const byId = Object.fromEntries(r.items.map((i) => [i.invoiceId, i]))
    assert.deepEqual(Object.keys(byId).sort(), ['dom', 'for', 'rec'])
    assert.equal(byId.dom.openAmountInv, '1000.00')
    assert.equal(byId.dom.ref, '235')
    assert.equal(byId.for.baseChf, '94.00')
    assert.equal(byId.for.ref, '200+221')
    assert.equal(byId.rec.openAmountInv, '108.10')
    assert.equal(byId.rec.vatChf, '8.10')
    assert.equal(byId.rec.ref, '400')

    const again = build({ toBasis: 'cash', transitionDate: '2026-12-31', invoices, payments: [...payments, pay({ invoiceId: 'for', transactionId: 'y', txDate: '2027-02-01', amountTx: '100.00', amountInv: '100.00' })], adjustmentsUpTo: [], fx: fxTable })
    assert.deepEqual(again.items, r.items)
  })

  it('invoice -> deposit: in new-year Q1, domestic receivable 235 - foreign receivable 200, 221 - unpaid input tax 400 - - 299 = 303', () => {
    const { items } = build({ toBasis: 'cash', transitionDate: '2026-12-31', invoices, payments, adjustmentsUpTo: [], fx: fxTable })
    const adjs = items.map((it) => adj({
      kind: 'transition', toBasis: 'cash', ref: it.ref, invoiceId: it.invoiceId, invoiceDirection: it.direction, invoiceVatCode: it.vatCode,
      amountChf: it.baseChf, vatChf: it.vatChf,
    }))
    const r = run({
      period: Q1,
      transactions: [tx({ id: 'x2', date: '2027-01-05', amount: '500.00' }), tx({ date: '2027-02-01', currency: 'EUR', amount: '100.00', vatCode: 'foreign_income' })],
      adjustments: adjs,
    })
    const x = boxes(r)
    assert.equal(x[235], chf('1000.00'))
    assert.equal(x[200], chf('500.00')) // 500 + 94 − 94
    assert.equal(x[221], b(0))
    assert.equal(x[303], chf('-500.00'))
    assert.equal(x[299], x[303])
    assert.equal(x[400], chf('-8.10'))
    assert.deepEqual(r.errors, [])
  })

  it('deposit -> invoice: domestic receivable adds to 200, 303 - foreign adds to 200, 221 - unpaid input tax 400 +', () => {
    const { items } = build({ toBasis: 'agreed', transitionDate: '2026-12-31', invoices, payments, adjustmentsUpTo: [], fx: fxTable })
    assert.equal(items.find((i) => i.invoiceId === 'dom')!.ref, '200+303')
    const adjs = items.map((it) => adj({
      kind: 'transition', toBasis: 'agreed', ref: it.ref, invoiceId: it.invoiceId, invoiceDirection: it.direction, invoiceVatCode: it.vatCode,
      amountChf: it.baseChf, vatChf: it.vatChf,
    }))
    const x = boxes(run({ basis: 'agreed', period: Q1, adjustments: adjs }))
    assert.equal(x[200], chf('1094.00'))
    assert.equal(x[221], chf('94.00'))
    assert.equal(x[303], chf('1000.00'))
    assert.equal(x[299], x[303])
    assert.equal(x[400], chf('8.10'))
  })

  it('paid credit note: refund (positive payment) reduces the balance toward 0, and drops off the list when fully paid', () => {
    const cn = inv({ id: 'CN', direction: 'received', invoiceDate: '2026-12-15', amountGross: '-100.00', invoiceVat: '-8.10' })
    const part = build({
      toBasis: 'cash', transitionDate: '2026-12-31', invoices: [cn], adjustmentsUpTo: [], fx: fxTable,
      payments: [pay({ invoiceId: 'CN', transactionId: 'r1', txDate: '2026-12-20', amountTx: '40.00', amountInv: '40.00' })],
    })
    assert.equal(part.items[0].openAmountInv, '-60.00')
    assert.equal(part.items[0].vatChf, '-4.86')
    const full = build({
      toBasis: 'cash', transitionDate: '2026-12-31', invoices: [cn], adjustmentsUpTo: [], fx: fxTable,
      payments: [pay({ invoiceId: 'CN', transactionId: 'r1', txDate: '2026-12-20', amountTx: '100.00', amountInv: '100.00' })],
    })
    assert.deepEqual(full.items, [])
  })

  it('corrections follow the ref pinned in the list - boxes stay the same even if the invoice vatCode changes later', () => {
    const x = boxes(run({
      period: Q1,
      adjustments: [adj({ kind: 'transition', toBasis: 'cash', ref: '200+221', invoiceVatCode: 'ch_standard', amountChf: '94.00' })],
    }))
    assert.equal(x[200], chf('-94.00'))
    assert.equal(x[221], chf('-94.00'))
    assert.equal(x[235], b(0))
    assert.throws(() => run({ adjustments: [adj({ kind: 'transition', toBasis: 'cash', amountChf: '1.00' })] }))
    assert.throws(() => run({ adjustments: [adj({ kind: 'transition', toBasis: 'agreed', ref: '235', amountChf: '1.00' })] }))
  })

  it('reports when there are unconfirmed invoices - bad-debt correction reduces the balance', () => {
    const r = build({
      toBasis: 'cash', transitionDate: '2026-12-31',
      invoices: [inv({ id: 'u', invoiceDate: '2026-12-01', amountGross: '100.00', confirmed: false })],
      payments: [], adjustmentsUpTo: [{ id: 'bd', invoiceId: 'u', kind: 'bad_debt', confirmed: true, amountInv: '40.00' }], fx: fxTable,
    })
    assert.deepEqual(r.unconfirmed.map((u) => u.id), ['u'])
    assert.equal(r.items[0].openAmountInv, '60.00')

    const p = build({
      toBasis: 'cash', transitionDate: '2026-12-31', adjustmentsUpTo: [], fx: fxTable,
      invoices: [inv({ id: 'v', invoiceDate: '2026-12-01', amountGross: '100.00' })],
      payments: [pay({ id: 'pu', invoiceId: 'v', transactionId: 'x', txDate: '2026-12-02', amountTx: '30.00', amountInv: '30.00', confirmed: false })],
    })
    assert.deepEqual(p.unconfirmed.map((u) => `${u.kind}:${u.id}`), ['payment:pu']) // R3 codex
  })
})
