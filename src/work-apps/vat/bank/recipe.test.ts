
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { BankFormatError } from './parse-csv'
import { fingerprintWith, headerFingerprint, parseRecipe, parseRecipeAmount, parseRecipeDate, readWithRecipe, recipeHash, type BankRecipe } from './recipe'

const buf = (s: string) => Buffer.from(s, 'utf8')
const codes = (x: { issues: Array<{ code: string }> }) => x.issues.map((i) => i.code)

const WISE_HEAD = '"TransferWise ID",Date,Amount,Currency,Description,"Running Balance","Payer Name","Payee Name","Total fees"'
const wise = (rows: string[]) => [WISE_HEAD, ...rows].join('\n')
const WISE: unknown = {
  v: 1, bank: 'wise', delimiter: ',', encoding: 'utf-8',
  headerColumns: ['TransferWise ID', 'Date', 'Amount', 'Running Balance'],
  date: { column: 'Date', format: 'DD-MM-YYYY' },
  amount: { signed: 'Amount' },
  number: { decimal: '.', thousands: '' },
  currency: { column: 'Currency' },
  txNo: 'TransferWise ID',
  balanceAfter: 'Running Balance',
  counterparty: ['Payee Name', 'Payer Name'],
  details: ['Description'],
}

const REV_HEAD = 'Date started (UTC),Date completed (UTC),ID,Type,State,Description,Payment currency,Amount,Fee,Total amount,Balance,Account'
const rev = (rows: string[]) => [REV_HEAD, ...rows].join('\n')
const REV: unknown = {
  v: 1, bank: 'revolut', delimiter: ',', encoding: 'utf-8',
  headerColumns: ['Date started (UTC)', 'State', 'Payment currency', 'Balance'],
  date: { column: 'Date completed (UTC)', format: 'YYYY-MM-DD', timezone: 'UTC' },
  amount: { signed: 'Total amount' },
  number: { decimal: '.', thousands: '' },
  currency: { column: 'Payment currency' },
  keep: [{ column: 'State', in: ['COMPLETED'] }],
  account: 'Account',
  txNo: 'ID',
  balanceAfter: 'Balance',
  counterparty: ['Description'],
  bankType: 'Type',
}

describe('\'recipe validation\'', () => {
  it('\'returns a valid recipe after normalizing it\'', () => {
    const r = parseRecipe(WISE)
    assert.equal(r.bank, 'wise')
    assert.deepEqual(r.amount, { signed: 'Amount' })
  })
  const broken: Array<[string, Record<string, unknown>]> = [
    ['모르는 키', { extra: 1 }],
    ['v 가 1 아님', { v: 2 }],
    ['모르는 은행', { bank: 'ing' }],
    ['모르는 구분자', { delimiter: '|' }],
    ['모르는 날짜 형식', { date: { column: 'Date', format: 'D.M.YY' } }],
    ['UTC 말고 다른 시간대', { date: { column: 'Date', format: 'DD-MM-YYYY', timezone: 'CET' } }],
    ['금액 두 방식 섞음', { amount: { signed: 'Amount', debit: 'D' } }],
    ['출금 칸만', { amount: { debit: 'D' } }],
    ['방향 값이 겹침', { amount: { value: 'A', direction: { column: 'T', in: ['X'], out: ['X'] } } }],
    ['소수점 = 천 단위', { number: { decimal: '.', thousands: '.' } }],
    ['고정 통화가 소문자', { currency: { fixed: 'chf' } }],
    ['통화 두 방식', { currency: { column: 'C', fixed: 'CHF' } }],
    ['빈 칸 이름', { txNo: ' ' }],
    ['칸 이름이 글이 아님', { counterparty: [1] }],
    ['거르기 값 없음', { keep: [{ column: 'State', in: [] }] }],
    ['거르기 값이 빈 글', { keep: [{ column: 'State', in: [' '] }] }],
    ['방향 값이 빈 글', { amount: { value: 'A', direction: { column: 'T', in: [''], out: ['OUT'] } } }],
    ['머리 칸 없음', { headerColumns: [] }],
    ['너무 큼', { details: Array.from({ length: 20 }, () => 'x'.repeat(200)), counterparty: Array.from({ length: 20 }, () => 'y'.repeat(200)) }],
  ]
  for (const [what, patch] of broken) {
    it(`rejects - ${what}`, () => {
      assert.throws(() => parseRecipe({ ...(WISE as object), ...patch }), (e: unknown) => e instanceof BankFormatError && e.code === 'recipe_invalid')
    })
  }
  it('\'no regex or code fields - unknown key regex rejected\'', () => {
    assert.throws(() => parseRecipe({ ...(WISE as object), keep: [{ column: 'State', in: ['A'], regex: '.*' }] }), /unknown key regex/)
  })
  it('\'same recipe gives the same fingerprint - regardless of key order\'', () => {
    const a = parseRecipe(WISE)
    const b = parseRecipe(Object.fromEntries(Object.entries(WISE as object).reverse()))
    assert.equal(recipeHash(a), recipeHash(b))
    assert.notEqual(recipeHash(a), recipeHash(parseRecipe({ ...(WISE as object), txNo: 'Date' })))
  })
})

describe('\'amount and date\'', () => {
  const dot = { decimal: '.', thousands: '' } as const
  it('\'sign and decimal places\'', () => {
    assert.equal(parseRecipeAmount('-12.5', dot), '-12.50')
    assert.equal(parseRecipeAmount('+7', dot), '7.00')
    assert.equal(parseRecipeAmount('-0.00', dot), '0.00')
    assert.equal(parseRecipeAmount('1.234', dot), null)
    assert.equal(parseRecipeAmount('1 2.00', dot), null)
    assert.equal(parseRecipeAmount('12.00 CHF', dot), null)
  })
  it('\'thousands separators only in groups of three\'', () => {
    assert.equal(parseRecipeAmount("1'234.50", { decimal: '.', thousands: "'" }), '1234.50')
    assert.equal(parseRecipeAmount("1'2.00", { decimal: '.', thousands: "'" }), null)
    assert.equal(parseRecipeAmount('1.234.567,8', { decimal: ',', thousands: '.' }), '1234567.80')
    assert.equal(parseRecipeAmount('-1234,56', { decimal: ',', thousands: '.' }), '-1234.56')
  })
  it('\'date format\'', () => {
    assert.deepEqual(parseRecipeDate('26-06-2026', 'DD-MM-YYYY'), { date: '2026-06-26', shifted: false })
    assert.deepEqual(parseRecipeDate('06/26/2026', 'MM/DD/YYYY'), { date: '2026-06-26', shifted: false })
    assert.deepEqual(parseRecipeDate('26.06.2026 10:36:40.958', 'DD.MM.YYYY'), { date: '2026-06-26', shifted: false })
    assert.deepEqual(parseRecipeDate('31-02-2026', 'DD-MM-YYYY'), { error: 'date' })
    assert.deepEqual(parseRecipeDate('2026-06-26', 'DD-MM-YYYY'), { error: 'date' })
  })
  it('\'UTC -> Zurich date, rollover marker, rejected if there is no time\'', () => {
    assert.deepEqual(parseRecipeDate('2026-06-30 23:30:00', 'YYYY-MM-DD', 'UTC'), { date: '2026-07-01', shifted: true })
    assert.deepEqual(parseRecipeDate('2026-06-30 21:59', 'YYYY-MM-DD', 'UTC'), { date: '2026-06-30', shifted: false })
    assert.deepEqual(parseRecipeDate('2026-12-31T23:00:00Z', 'YYYY-MM-DD', 'UTC'), { date: '2027-01-01', shifted: true })
    assert.deepEqual(parseRecipeDate('2026-06-30', 'YYYY-MM-DD', 'UTC'), { error: 'no_time' })
  })
  it('\'a trailing Z on a value is converted as UTC even if the recipe has no timezone\'', () => {
    assert.deepEqual(parseRecipeDate('2026-06-30T23:30:00Z', 'YYYY-MM-DD'), { date: '2026-07-01', shifted: true })
    assert.deepEqual(parseRecipeDate('2026-06-30 23:30:00', 'YYYY-MM-DD'), { date: '2026-06-30', shifted: false })
  })
  it('"the thousands separator \' also accepts the curly one"', () => {
    assert.equal(parseRecipeAmount('1’234’567.50', { decimal: '.', thousands: "'" }), '1234567.50')
    assert.equal(parseRecipeAmount('1’2.00', { decimal: '.', thousands: "'" }), null)
  })
})

describe('\'Wise shape\'', () => {
  const file = wise([
    'T3,29-06-2026,-20.00,EUR,Card,80.00,,Shop,0',
    'T2,20-06-2026,-50.00,EUR,Sent,100.00,,Alice,1.00',
    'T1,10-06-2026,150.00,EUR,Received,150.00,Bob,,0',
  ])
  it('\'one batch, direction, counterparty, balance chain matches\'', () => {
    const r = readWithRecipe(buf(file), parseRecipe(WISE))
    assert.equal(r.groups.length, 1)
    const g = r.groups[0]
    assert.equal(g.id, 'EUR|')
    assert.deepEqual(g.st.rows.map((x) => [x.date, x.amount, x.direction, x.counterparty, x.bankTxNo]), [
      ['2026-06-29', '20.00', 'out', 'Shop', 'T3'],
      ['2026-06-20', '50.00', 'out', 'Alice', 'T2'],
      ['2026-06-10', '150.00', 'in', 'Bob', 'T1'],
    ])
    assert.deepEqual(codes(g.st), [])
    assert.deepEqual(codes(r), [])
    assert.equal(g.st.from, '2026-06-10')
    assert.equal(g.st.until, '2026-06-29')
  })
  it('\'🔴 picking the wrong amount column (fee column) breaks the balance chain\'', () => {
    const r = readWithRecipe(buf(file), parseRecipe({ ...(WISE as object), amount: { signed: 'Total fees' } }))
    assert.ok(codes(r.groups[0].st).includes('bank_chain_broken'))
  })
  it('\'lines with a different column count, unreadable dates and amounts are skipped and reported (not replaced by another column)\'', () => {
    const r = readWithRecipe(buf(wise([
      'T3,29-06-2026,-20.00,EUR,Card,80.00,,Shop,0',
      'T2,2026-06-20,-50.00,EUR,Sent,100.00,,Alice,1.00',
      'T1,10-06-2026,abc,EUR,Received,150.00,Bob,,0',
      'T0,01-06-2026,1.00,EUR',
    ])), parseRecipe(WISE))
    assert.deepEqual(codes(r), ['bank_line_date', 'bank_line_amount', 'bank_line_columns'])
    assert.equal(r.groups[0].st.rows.length, 1)
  })
  it('\'pointing at a missing column stops before reading lines\'', () => {
    assert.throws(() => readWithRecipe(buf(file), parseRecipe({ ...(WISE as object), txNo: 'Reference' })), (e: unknown) => e instanceof BankFormatError && e.code === 'bank_column_missing')
  })
  it('\'stops if the table header cannot be found\'', () => {
    assert.throws(() => readWithRecipe(buf('a,b\n1,2'), parseRecipe(WISE)), (e: unknown) => e instanceof BankFormatError && e.code === 'bank_header_not_found')
  })
  it('\'recognition marker - same if the header is the same, different if one column is added\'', () => {
    const r = parseRecipe(WISE)
    assert.equal(fingerprintWith(buf(file), r), readWithRecipe(buf(file), r).fingerprint)
    assert.equal(fingerprintWith(buf(file), r), headerFingerprint(WISE_HEAD.split(',').map((c) => c.replace(/"/g, ''))))
    assert.notEqual(fingerprintWith(buf(`${WISE_HEAD},Note\n`), r), fingerprintWith(buf(file), r))
    assert.equal(fingerprintWith(buf('x,y\n'), r), null)
  })
  it('\'card refunds (same number, opposite direction, same amount) are not reported\'', () => {
    const r = readWithRecipe(buf(wise(['C1,13-07-2026,25.00,EUR,Card,125.00,,Shop,0', 'C1,03-07-2026,-25.00,EUR,Card,100.00,,Shop,0', 'T0,01-07-2026,125.00,EUR,Sent,125.00,,Alice,0'])), parseRecipe(WISE))
    assert.ok(!codes(r.groups[0].st).includes('bank_line_dup_txno'))
  })
  it('\'the same transaction number within a file is reported\'', () => {
    const r = readWithRecipe(buf(wise(['T1,29-06-2026,-20.00,EUR,Card,80.00,,Shop,0', 'T1,20-06-2026,100.00,EUR,Sent,100.00,,Alice,0'])), parseRecipe(WISE))
    assert.ok(codes(r.groups[0].st).includes('bank_line_dup_txno'))
  })
})

describe('\'Revolut shape\'', () => {
  const file = rev([
    '2026-06-01 08:00:00,2026-06-01 08:00:05,R1,TOPUP,COMPLETED,From UBS,EUR,1000.00,0.00,1000.00,1000.00,Main EUR',
    '2026-06-02 09:00:00,2026-06-02 09:00:05,R2,CARD_PAYMENT,DECLINED,Shop,EUR,-30.00,0.00,-30.00,,Main EUR',
    '2026-06-10 10:00:00,2026-06-10 10:00:05,R3,EXCHANGE,COMPLETED,To CHF,EUR,-100.00,0.00,-100.00,900.00,Main EUR',
    '2026-06-10 10:00:00,2026-06-10 10:00:05,R3,EXCHANGE,COMPLETED,From EUR,CHF,95.00,0.00,95.00,95.00,Main CHF',
    '2026-06-30 23:30:00,2026-06-30 23:30:01,R4,FEE,COMPLETED,Plan fee,CHF,-10.00,0.00,-10.00,85.00,Main CHF',
  ])
  it('\'split by currency/account, filtered line count, UTC date rollover, the same transaction number in a different account is fine\'', () => {
    const r = readWithRecipe(buf(file), parseRecipe(REV))
    assert.deepEqual(r.groups.map((g) => [g.id, g.st.rows.length]), [['CHF|Main CHF', 2], ['EUR|Main EUR', 2]])
    assert.equal(r.filtered, 1)
    assert.deepEqual(codes(r), ['bank_tz_shift'])
    assert.equal(r.groups[0].st.rows[1].date, '2026-07-01')
    for (const g of r.groups) assert.deepEqual(codes(g.st), [])
  })
  it('\'applying UTC to a date without time reports and skips that line\'', () => {
    const r = readWithRecipe(buf(rev(['2026-06-01,2026-06-01,R1,TOPUP,COMPLETED,x,EUR,1.00,0,1.00,1.00,A'])), parseRecipe(REV))
    assert.deepEqual(codes(r), ['bank_line_no_time'])
  })
  it('\'a line with an empty balance column = the line is kept and reported (no chain comparison)\'', () => {
    const r = readWithRecipe(buf(file.replace(',900.00,Main EUR', ',,Main EUR')), parseRecipe(REV))
    assert.ok(codes(r).includes('bank_line_balance'))
    const eur = r.groups.find((g) => g.currency === 'EUR')!
    assert.equal(eur.st.rows.length, 2)
    assert.equal(eur.st.rows[1].balanceAfter, null)
  })
})

describe('\'other shapes\'', () => {
  it('\'separate withdrawal/deposit columns, ; separator, decimal comma, fixed currency\'', () => {
    const recipe = parseRecipe({
      v: 1, bank: 'other', delimiter: ';', encoding: 'utf-8', headerColumns: ['Datum', 'Belastung', 'Gutschrift'],
      date: { column: 'Datum', format: 'DD.MM.YYYY' }, amount: { debit: 'Belastung', credit: 'Gutschrift' },
      number: { decimal: ',', thousands: "'" }, currency: { fixed: 'CHF' }, balanceAfter: 'Saldo',
    } satisfies Record<string, unknown>)
    const r = readWithRecipe(buf('Konto;123\n\nDatum;Text;Belastung;Gutschrift;Saldo\n01.06.2026;Lohn;;1\'000,00;1\'000,00\n02.06.2026;Miete;-400,00;0,00;600,00\n'), recipe)
    assert.deepEqual(r.groups[0].st.rows.map((x) => [x.amount, x.direction]), [['1000.00', 'in'], ['400.00', 'out']])
    assert.deepEqual(codes(r.groups[0].st), [])
  })
  it('\'value + direction column\'', () => {
    const recipe = parseRecipe({
      v: 1, bank: 'other', delimiter: ',', encoding: 'utf-8', headerColumns: ['date', 'amount', 'direction'],
      date: { column: 'date', format: 'YYYY-MM-DD' }, amount: { value: 'amount', direction: { column: 'direction', in: ['IN'], out: ['OUT'] } },
      number: { decimal: '.', thousands: '' }, currency: { fixed: 'EUR' },
    } satisfies Record<string, unknown>)
    const r = readWithRecipe(buf('date,amount,direction\n2026-06-01,5.00,IN\n2026-06-02,-3.00,IN\n2026-06-03,2.00,SIDEWAYS\n2026-06-04,7.00,OUT\n'), recipe)
    assert.deepEqual(codes(r), ['bank_line_sign', 'bank_line_direction'])
    assert.deepEqual(r.groups[0].st.rows.map((x) => x.direction), ['in', 'out'])
  })
  it('\'windows-1252 file - a recipe written in UTF-8 is rejected\'', () => {
    const latin = Buffer.from([...Buffer.from('date,amount,who\n2026-06-01,5.00,Z'), 0xfc, ...Buffer.from('rich\n')])
    const base = {
      v: 1, bank: 'other', delimiter: ',', headerColumns: ['date', 'amount'], date: { column: 'date', format: 'YYYY-MM-DD' },
      amount: { signed: 'amount' }, number: { decimal: '.', thousands: '' }, currency: { fixed: 'CHF' }, counterparty: ['who'],
    }
    assert.throws(() => readWithRecipe(latin, parseRecipe({ ...base, encoding: 'utf-8' })), (e: unknown) => e instanceof BankFormatError && e.code === 'bank_encoding')
    assert.equal(readWithRecipe(latin, parseRecipe({ ...base, encoding: 'windows-1252' })).groups[0].st.rows[0].counterparty, 'Zürich')
  })
})

