
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { normalizeAmount, parseDelimited, BankFormatError } from './parse-csv'
import { parseUbsCsv } from './ubs'
import { assignBankRowKeys } from './row-key'
import { reconcileBalance } from './balance'

const HEAD = 'Trade date;Trade time;Booking date;Value date;Currency;Debit;Credit;Individual amount;Balance;Transaction no.;Description1;Description2;Description3;Footnotes;'

function ubs(rows: string[], opts: { opening?: string; closing?: string; count?: number; eol?: string } = {}) {
  const eol = opts.eol ?? '\n'
  const meta = [
    'Account number:;0000 11112222.01;',
    'IBAN:;CH00 0000 0000 0000 0000 0;',
    'From:;2026-07-01;',
    'Until:;2026-09-30;',
    `Opening balance:;${opts.opening ?? '1000.00'};`,
    `Closing balance:;${opts.closing ?? '2025.55'};`,
    'Valued in:;CHF;',
    `Numbers of transactions in this period:;${opts.count ?? rows.length};`,
    '',
  ]
  return '\uFEFF' + [...meta, HEAD, ...rows].join(eol) + eol
}

const ROWS = [
  '2026-09-30;;2026-09-30;2026-09-30;CHF;-20.00;;;2025.55;BA0001;Balance closing of service prices;;Transaction no. BA0001;;',
  '2026-08-31;;2026-08-31;2026-09-02;CHF;0.00;;;2045.55;BA0002;Balance closing of service prices;;Transaction no. BA0002;;',
  '2026-08-15;;2026-08-15;2026-08-15;CHF;-54.45;;;2045.55;TX0003;"Muster Telecom AG;Musterweg 1; 8000 Zürich; CH";multi e-banking order;"Reference no. QRR: 00 11111; Reason for payment: Rechnung 7";;',
  '2026-07-03;;2026-07-03;2026-07-03;CHF;;1\'100.00;;2100.00;TX0004;"Beispiel Kunde GmbH;Hauptstrasse 5; 6300 Zug; CH";credit;"Incoming SIC-payment";;',
]

describe('parse-csv', () => {
  it('strips BOM - keeps ; inside quotes - throws on an unclosed quote', () => {
    const t = parseDelimited('\uFEFFa;"b;c";d\n', ';')
    assert.deepEqual(t[0], ['a', 'b;c', 'd'])
    assert.throws(() => parseDelimited('a;"b;c\nd;e\n', ';'), BankFormatError)
  })

  it('amounts: thousands-separator quote - sign - one decimal place - -0.00 -> 0.00 - unknown format null', () => {
    assert.equal(normalizeAmount("1'340.00"), '1340.00')
    assert.equal(normalizeAmount('1’340.5'), '1340.50')
    assert.equal(normalizeAmount('-20'), '-20.00')
    assert.equal(normalizeAmount('-0.00'), '0.00')
    assert.equal(normalizeAmount('+5.00'), '5.00')
    assert.equal(normalizeAmount('1,00'), null)
    assert.equal(normalizeAmount('1.005'), null)
    assert.equal(normalizeAmount('1 2.00'), null)
    assert.equal(normalizeAmount("1'2.00"), null)
    assert.equal(normalizeAmount("'100.00"), null)
    assert.equal(normalizeAmount("12''3.00"), null)
    assert.equal(normalizeAmount("1'234'567.89"), '1234567.89')
    assert.equal(normalizeAmount("1234'567.00"), null)
    assert.equal(normalizeAmount(' 12.00 '), '12.00')
    assert.equal(normalizeAmount(''), null)
  })
})

describe('UBS reading (section 8)', () => {
  it('header - rows - direction - date = trade date - counterparty = first piece of Description1 - no chain or count problems', () => {
    const st = parseUbsCsv(ubs(ROWS))
    assert.deepEqual(st.problems, [])
    assert.equal(st.accountNumber, '000011112222.01')
    assert.equal(st.currency, 'CHF')
    assert.equal(st.opening, '1000.00')
    assert.equal(st.closing, '2025.55')
    assert.equal(st.from, '2026-07-01')
    assert.equal(st.rows.length, 4)
    const [fee, zero, pay, credit] = st.rows
    assert.deepEqual([fee.direction, fee.amount, fee.counterparty, fee.bankType], ['out', '20.00', '', 'Balance closing of service prices'])
    assert.equal(zero.amount, '0.00')
    assert.equal(zero.date, '2026-08-31')
    assert.deepEqual([pay.direction, pay.amount, pay.counterparty, pay.bankType], ['out', '54.45', 'Muster Telecom AG', 'multi e-banking order'])
    assert.match(pay.details, /Rechnung 7/)
    assert.deepEqual([credit.direction, credit.amount, credit.bankTxNo], ['in', '1100.00', 'TX0004'])
    assert.equal(credit.lineNo, 14)
  })

  it('CRLF line endings behave the same', () => {
    assert.deepEqual(parseUbsCsv(ubs(ROWS, { eol: '\r\n' })).rows.map((r) => r.amount), ['20.00', '0.00', '54.45', '1100.00'])
  })

  it('skips individual-amount rows with empty Debit/Credit and reports them (so they are not counted twice with the parent row)', () => {
    const child = '2026-08-15;;2026-08-15;2026-08-15;CHF;;;-10.00;;;"Kind AG;x";;;;'
    const st = parseUbsCsv(ubs([...ROWS.slice(0, 3), child, ROWS[3]], { count: 4 }))
    assert.equal(st.rows.length, 4)
    assert.equal(st.problems.length, 1)
    assert.match(st.problems[0], /개별 금액/)
  })

  it('rows with both - negative Credit - missing date - unreadable amount = skipped and reported', () => {
    const bad = [
      '2026-08-01;;2026-08-01;2026-08-01;CHF;-1.00;1.00;;;X1;a;b;c;;',
      '2026-08-01;;2026-08-01;2026-08-01;CHF;;-1.00;;;X2;a;b;c;;',
      ';;;2026-08-01;CHF;-1.00;;;;X3;a;b;c;;',
      '2026-08-01;;2026-08-01;2026-08-01;CHF;-1,00;;;;X4;a;b;c;;',
    ]
    const st = parseUbsCsv(ubs(bad, { count: 0, opening: '1000.00', closing: '1000.00' }))
    assert.equal(st.rows.length, 0)
    assert.equal(st.problems.length, 4)
  })

  it('uses only the trade date - dates not in the calendar - positive Debit - empty/broken balance cell = reported', () => {
    const noTrade = ';;2026-08-01;2026-08-01;CHF;-1.00;;;;X1;a;b;c;;'
    const badDay = '2026-02-30;;2026-02-30;2026-02-30;CHF;-1.00;;;;X2;a;b;c;;'
    const posDebit = '2026-08-01;;2026-08-01;2026-08-01;CHF;5.00;;;;X3;a;b;c;;'
    const st = parseUbsCsv(ubs([noTrade, badDay, posDebit], { count: 0, opening: '1000.00', closing: '1000.00' }))
    assert.equal(st.rows.length, 0)
    assert.deepEqual(st.problems.map((p) => p.replace(/^\d+번 줄: /, '')), ['거래일(Trade date)을 읽지 못해 건너뛰었다', '거래일(Trade date)을 읽지 못해 건너뛰었다', 'Debit 이 양수라 건너뛰었다'])

    const blank = [...ROWS]
    blank[1] = blank[1].replace(';2045.55;BA0002', ';;BA0002')
    assert.ok(parseUbsCsv(ubs(blank)).problems.some((p) => /잔액·거래번호 칸이 이상해/.test(p)))
    const junk = [...ROWS]
    junk[1] = junk[1].replace(';2045.55;BA0002', ';20x5;BA0002')
    assert.ok(parseUbsCsv(ubs(junk)).problems.some((p) => /잔액·거래번호 칸이 이상해/.test(p)))
    const shifted = parseUbsCsv(ubs(['2026-03-15;;2026-03-15;2026-03-15;CHF;-80.00;;;;920.00;TX1;Acme;Payment;;'], { opening: '1000.00', closing: '1000.00', count: 0 }))
    assert.equal(shifted.rows.length, 0)
    const tail = parseUbsCsv(ubs(['2026-03-15;;2026-03-15;2026-03-15;CHF;-80.00;;;920.00;Acme;Payment;note;;;extra'], { opening: '1000.00', closing: '1000.00', count: 0 }))
    assert.equal(tail.rows.length, 0)
    const noTrailing = parseUbsCsv(ubs(['2026-03-15;;2026-03-15;2026-03-15;CHF;-80.00;;;920.00;TX1;a;b;c;'], { opening: '1000.00', closing: '920.00' }))
    assert.deepEqual([noTrailing.rows.length, noTrailing.problems], [1, []])
    const noTx = parseUbsCsv(ubs(['2026-03-15;;2026-03-15;2026-03-15;CHF;-80.00;;;920.00;;TX1;Acme;Payment;;'], { opening: '1000.00', closing: '1000.00', count: 0 }))
    assert.equal(noTx.rows.length, 0)
    const kZero = parseUbsCsv(ubs(["2026-03-15;;2026-03-15;2026-03-15;CHF;-1'234.00;0'000.00;;8766.00;TX9;a;b;c;;"], { opening: '10000.00', closing: '8766.00' }))
    assert.deepEqual([kZero.rows.length, kZero.problems], [1, []])
    const numericTx = parseUbsCsv(ubs(['2026-03-01;;2026-03-01;2026-03-01;CHF;-1.00;;;999.00;000123;a;b;c;;'], { opening: '1000.00', closing: '999.00' }))
    assert.deepEqual([numericTx.rows.length, numericTx.rows[0]?.bankTxNo, numericTx.problems], [1, '000123', []])
    const z3 = parseUbsCsv(ubs(['2026-03-01;;2026-03-01;2026-03-01;CHF;-40.00;0.000;;960.00;T1;a;b;c;;'], { opening: '1000.00', closing: '960.00' }))
    assert.deepEqual([z3.rows.length, z3.problems], [1, []])
    const dup = parseUbsCsv(ubs(['2026-03-01;;2026-03-01;2026-03-01;CHF;0.00;;;900.00;T1;a;b;c;;', '2026-03-01;;2026-03-01;2026-03-01;CHF;-100.00;;;900.00;T1;a;b;c;;'], { opening: '1000.00', closing: '900.00' }))
    assert.ok(dup.problems.some((p) => /거래번호가 \d+번 줄과 같다/.test(p)))
  })

  it('a row with one side 0 uses the other side amount - rows with too few cells rejected - one-day oldest-on-top file chain - zero rows but balance differs - empty header values', () => {
    const zeroCredit = ubs(['2026-08-01;;2026-08-01;2026-08-01;CHF;-40.00;0.00;;960.00;T1;a;b;c;;'], { opening: '1000.00', closing: '960.00' })
    const z = parseUbsCsv(zeroCredit)
    assert.deepEqual(z.problems, [])
    assert.deepEqual([z.rows[0].direction, z.rows[0].amount], ['out', '40.00'])

    const short = parseUbsCsv(ubs(['2026-03-15;CHF;-80.00;;920.00;TX1;Acme;Payment;note;x;y'], { count: 0, opening: '1000.00', closing: '1000.00' }))
    assert.equal(short.rows.length, 0)
    assert.match(short.problems[0], /칸 수가 머리와 달라/)

    const oldestFirst = parseUbsCsv(ubs([
      '2026-04-01;;2026-04-01;2026-04-01;CHF;;10.00;;1010.00;T1;a;b;c;;',
      '2026-04-01;;2026-04-01;2026-04-01;CHF;-4.00;;;1006.00;T2;a;b;c;;',
    ], { opening: '1000.00', closing: '1006.00' }))
    assert.deepEqual(oldestFirst.problems, [])

    const missing = parseUbsCsv(ubs(['2026-03-15;;2026-03-15;2026-03-15;CHF;-80.00;;920.00;TX1;Acme;Payment;note;;'], { opening: '1000.00', closing: '1000.00', count: 0 }))
    assert.equal(missing.rows.length, 0)
    assert.ok(missing.problems.some((p) => /밀렸을 수 있다/.test(p)))
    const extra = parseUbsCsv(ubs(['2026-03-15;;2026-03-15;2026-03-15;CHF;;-80.00;;;920.00;TX1;Acme;Payment;note;;'], { opening: '1000.00', closing: '1000.00', count: 0 }))
    assert.equal(extra.rows.length, 0)
    assert.match(extra.problems[0], /칸 수가 머리와 달라/)
    const usd = parseUbsCsv(ubs(['2026-03-01;;2026-03-01;2026-03-01;USD;;50.00;;1050.00;T1;a;b;c;;'], { opening: '1000.00', closing: '1000.00', count: 0 }))
    assert.equal(usd.rows.length, 0)
    const ind = parseUbsCsv(ubs(['2026-03-01;;2026-03-01;2026-03-01;CHF;0.00;;60.00;1000.00;T9;a;b;c;;'], { opening: '1000.00', closing: '1000.00' }))
    assert.ok(ind.problems.some((p) => /개별 금액 칸이 채워져/.test(p)))

    const noCur = parseUbsCsv(ubs(['2026-08-01;;2026-08-01;2026-08-01;;-1.00;;;999.00;T9;a;b;c;;'], { opening: '1000.00', closing: '999.00' }).replace('Valued in:;CHF;', 'Valued in:;;'))
    assert.equal(noCur.rows.length, 0)
    assert.ok(noCur.problems.some((p) => /통화를 읽지 못해/.test(p)))

    const empty = parseUbsCsv(ubs([], { opening: '1000.00', closing: '940.00' }))
    assert.ok(empty.problems.some((p) => /거래가 없는데/.test(p)))

    const blankOpening = parseUbsCsv(ubs(ROWS).replace('Opening balance:;1000.00;', 'Opening balance:;;1000.00;'))
    assert.equal(blankOpening.opening, null)
    assert.ok(blankOpening.problems.some((p) => /값이 비어/.test(p)))
  })

  it('reports when the header count differs from the row count', () => {
    const st = parseUbsCsv(ubs(ROWS, { count: 5 }))
    assert.ok(st.problems.some((p) => /건수 5/.test(p)))
    const junk = parseUbsCsv(ubs(ROWS).replace('period:;4;', 'period:;four;'))
    assert.ok(junk.problems.some((p) => /건수를 읽지 못했다/.test(p)))
  })

  it('reports the row where the balance chain breaks - reports when the final balance differs', () => {
    const broken = [...ROWS]
    broken[2] = broken[2].replace(';2045.55;TX0003', ';2045.50;TX0003')
    assert.ok(parseUbsCsv(ubs(broken)).problems.some((p) => /사슬/.test(p)))
    assert.ok(parseUbsCsv(ubs(ROWS, { closing: '2025.50' })).problems.some((p) => /끝 잔액/.test(p)))
  })

  it('throws when the table header is not found (e.g. other-language export) - throws when a required column is missing', () => {
    assert.throws(() => parseUbsCsv('Abschlussdatum;Buchungsdatum;Belastung\n'), BankFormatError)
    assert.throws(() => parseUbsCsv(ubs([]).replace('Transaction no.;', 'Txn;')), /Transaction no\./)
  })
})

describe('UBS export without balances', () => {
  const noBal = ROWS.map((l) => l.replace(/;(-?[\d']+\.\d{2}|);;(2025\.55|2045\.55|2100\.00);/, ';$1;;;'))
  it('keeps the rows and leaves balances empty - empty header balance and chain are not counted as problems', () => {
    const st = parseUbsCsv(ubs(noBal, { opening: '', closing: '' }))
    assert.equal(st.rows.length, 4, JSON.stringify(st.problems))
    assert.ok(st.rows.every((r) => r.balanceAfter == null))
    assert.deepEqual(st.issues.map((i) => i.code), [])
    assert.equal(st.opening, null)
  })
  it('if only some rows have an empty balance, still skipped as column shift', () => {
    const st = parseUbsCsv(ubs([noBal[0], ...ROWS.slice(1)], { opening: '', closing: '' }))
    assert.equal(st.rows.length, 3)
    assert.ok(st.issues.some((i) => i.code === 'bank_line_shifted'))
  })
  it('a file without balances also skips rows whose transaction number is empty or looks like an amount', () => {
    const bad = noBal[2].replace('TX0003', '')
    const st = parseUbsCsv(ubs([noBal[0], noBal[1], bad, noBal[3]], { opening: '', closing: '' }))
    assert.equal(st.rows.length, 3)
    assert.ok(st.issues.some((i) => i.code === 'bank_line_shifted'))
  })
})

describe('bankRowKey (§5)', () => {
  const base = { currency: 'CHF', bankType: 'x', details: '', balanceAfter: null }
  const r = (lineNo: number, over: Partial<Parameters<typeof assignBankRowKeys>[0][number]> = {}) => ({
    lineNo, date: '2026-08-01', amount: '10.00', direction: 'out' as const, counterparty: 'Muster AG', bankTxNo: null, ...base, ...over,
  })

  it('uses the transaction number when present - throws if the same transaction number appears twice in a file', () => {
    assert.equal(assignBankRowKeys([r(1, { bankTxNo: 'TX1' })], 'acc')[0].bankRowKey, 'tx:TX1')
    assert.throws(() => assignBankRowKeys([r(1, { bankTxNo: 'TX1' }), r(2, { bankTxNo: 'TX1' })], 'acc'))
  })
  it('same number - opposite direction - same amount = reversal (refund) - only the later date gets :rev, the original row key stays', () => {
    const out = r(1, { bankTxNo: 'C1', date: '2026-07-03', direction: 'out' })
    const back = r(2, { bankTxNo: 'C1', date: '2026-07-13', direction: 'in' })
    assert.deepEqual(assignBankRowKeys([back, out], 'acc').map((x) => x.bankRowKey), ['tx:C1:rev', 'tx:C1'])
    assert.deepEqual(assignBankRowKeys([out, back], 'acc').map((x) => x.bankRowKey), ['tx:C1', 'tx:C1:rev'])
    const sameDay = assignBankRowKeys([r(1, { bankTxNo: 'C2', direction: 'in' }), r(2, { bankTxNo: 'C2', direction: 'out' })], 'acc')
    assert.deepEqual(sameDay.map((x) => x.bankRowKey), ['tx:C2:rev', 'tx:C2'])
  })
  it('same number that is not a reversal still stops - different amount - same direction - three rows', () => {
    assert.throws(() => assignBankRowKeys([r(1, { bankTxNo: 'C1', direction: 'out' }), r(2, { bankTxNo: 'C1', direction: 'in', amount: '1.00' })], 'acc'))
    assert.throws(() => assignBankRowKeys([r(1, { bankTxNo: 'C1' }), r(2, { bankTxNo: 'C1', date: '2026-07-20' })], 'acc'))
    assert.throws(() => assignBankRowKeys([r(1, { bankTxNo: 'C1', direction: 'out' }), r(2, { bankTxNo: 'C1', direction: 'in' }), r(3, { bankTxNo: 'C1', direction: 'out' })], 'acc'))
  })

  it('otherwise hash: same day, amount and counterparty on two rows = different keys - same file received again = same keys - whitespace differences ignored', () => {
    const a = assignBankRowKeys([r(1), r(2)], 'acc')
    assert.notEqual(a[0].bankRowKey, a[1].bankRowKey)
    const again = assignBankRowKeys([r(7), r(9, { counterparty: '  Muster   AG ' })], 'acc')
    assert.deepEqual(again.map((x) => x.bankRowKey), a.map((x) => x.bankRowKey))
  })

  it('different account exportKey = different key - empty exportKey throws', () => {
    assert.notEqual(assignBankRowKeys([r(1)], 'acc')[0].bankRowKey, assignBankRowKeys([r(1)], 'other')[0].bankRowKey)
    assert.throws(() => assignBankRowKeys([r(1)], ''))
  })
})

describe('balance check (section 8)', () => {
  const rows = [{ amount: '1100.00', direction: 'in' as const }, { amount: '54.45', direction: 'out' as const }]
  it('matches - mismatch (difference) - no_data if either side is missing (not treated as 0)', () => {
    assert.deepEqual(reconcileBalance('1000.00', '2045.55', rows), { status: 'ok', expectedClosing: '2045.55' })
    assert.deepEqual(reconcileBalance('1000.00', '2045.50', rows), { status: 'mismatch', expectedClosing: '2045.55', closing: '2045.50', diff: '-0.05' })
    assert.deepEqual(reconcileBalance(null, '2045.55', rows), { status: 'no_data' })
    assert.deepEqual(reconcileBalance('0.00', null, rows), { status: 'no_data' })
    assert.deepEqual(reconcileBalance('0.00', '0.00', []), { status: 'ok', expectedClosing: '0.00' })
    assert.deepEqual(reconcileBalance('', '10.00', []), { status: 'no_data' })
    assert.deepEqual(reconcileBalance('10.00', '   ', []), { status: 'no_data' })
    assert.deepEqual(reconcileBalance('abc', '10.00', []), { status: 'no_data' })
    assert.deepEqual(reconcileBalance("1'000.00", '1000.00', []), { status: 'ok', expectedClosing: '1000.00' })
  })

  it('checking against the whole file matches the header start and end', () => {
    const st = parseUbsCsv(ubs(ROWS))
    assert.equal(reconcileBalance(st.opening, st.closing, st.rows).status, 'ok')
  })
})
