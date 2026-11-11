import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkHits, fieldsHash, normDate, normMoney, normValue, summarize, type FindField } from './doc-find'
import type { PageRec } from './doc-read'

test('dates — many shapes, one value', () => {
  for (const s of ['2028-03-31', '31.03.2028', '31/03/2028', '31 March 2028', 'March 31, 2028', '31. März 2028', '31 mars 2028', '31st March 2028']) assert.equal(normDate(s), '2028-03-31', s)
  assert.equal(normDate('1er mars 2028'), '2028-03-01')
  assert.equal(normDate('31.02.2028'), null)
  assert.equal(normDate('2028-13-01'), null)
  assert.equal(normDate('soon'), null)
  assert.equal(normDate(''), null)
})

test('money — thousands · decimals · currency', () => {
  assert.equal(normMoney("CHF 48'600.00"), '48600.00 CHF')
  assert.equal(normMoney('48600.00 CHF'), '48600.00 CHF')
  assert.equal(normMoney('CHF 48,600.00'), '48600.00 CHF')
  assert.equal(normMoney('EUR 1.234,50'), '1234.50 EUR')
  assert.equal(normMoney('€ 1 234,50'), '1234.50 EUR')
  assert.equal(normMoney("CHF 1'200.-"), '1200.00 CHF')
  assert.equal(normMoney('48600'), '48600.00')
  assert.equal(normMoney('USD 10', ['CHF']), null)
  assert.equal(normMoney('abc'), null)
})

test('yes/no · choice · text', () => {
  const yn: FindField = { key: 'a', label: 'A', kind: 'yesno' }
  assert.equal(normValue(yn, true), 'true')
  assert.equal(normValue(yn, 'Ja'), 'true')
  assert.equal(normValue(yn, 'maybe'), null)
  const ch: FindField = { key: 'c', label: 'C', kind: 'choice', options: ['Gold', 'Silver'] }
  assert.equal(normValue(ch, 'gold'), 'Gold')
  assert.equal(normValue(ch, 'Bronze'), null)
  assert.equal(normValue({ key: 't', label: 'T', kind: 'text' }, '  Muster  AG '), 'Muster AG')
  assert.equal(normValue({ key: 't', label: 'T', kind: 'text' }, null), null)
})

const page = (n: number, layer: string, engine: string | null = null): PageRec => ({ n, layer, engine, needsEngine: engine !== null, state: 'ok', fails: 0, path: engine ? 'layer+di' : 'layer' })
const F: FindField[] = [{ key: 'end', label: 'Expiry', kind: 'date' }, { key: 'supplier', label: 'Supplier', kind: 'text' }]
const P = [page(37, 'This Agreement shall expire on 31 March 2028 unless renewed in accordance with clause 12.'), page(38, 'Clause 12. Automatic renewal for twelve (12) months.')]

test('server check — false quotes · other columns · pages outside the batch · wrong kind values = dropped', () => {
  const hits = checkHits({ fields: {
    end: [
      { value: '2028-03-31', page: 37, quote: 'expire on 31 March 2028', source: 'page text' },
      { value: '2099-12-31', page: 37, quote: 'expire on 31 December 2099' },
      { value: '2028-03-31', page: 99, quote: 'expire on 31 March 2028' },
      { value: 'next year', page: 37, quote: 'expire on' },
    ],
    other: [{ value: 'x', page: 37, quote: 'This Agreement' }],
  } }, F, P)
  assert.deepEqual(hits.map((h) => `${h.key}:${h.value}:${h.page}`), ['end:2028-03-31:37'])
  assert.deepEqual(checkHits(null, F, P), [])
  assert.deepEqual(checkHits({ fields: [] }, F, P), [])
  assert.deepEqual(checkHits({ fields: { end: 'x' } }, F, P), [])
})

test('quotes — ignore spacing · case · accepted when on that page even with a wrong source', () => {
  const hits = checkHits({ fields: { end: [{ value: '31.03.2028', page: 37, quote: 'EXPIRE  ON 31 march2028', source: 'image text' }] } }, F, P)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].value, '2028-03-31')
  assert.equal(hits[0].source, 'page text')
})

test('gathering — one value · candidates · none', () => {
  const s = summarize(F, [
    { key: 'end', value: '2028-03-31', page: 37, quote: 'q', source: 'page text' },
    { key: 'end', value: '2028-03-31', page: 40, quote: 'q2', source: 'page text' },
  ], { complete: true, totalPages: 50, unreadablePages: [], pagesLeft: 0 })
  assert.deepEqual(s.fields.end, { status: 'found', value: '2028-03-31', page: 37, quote: 'q', source: 'page text', alsoOnPages: [40] })
  assert.deepEqual(s.fields.supplier, { status: 'not_found' })
  const c = summarize(F, [
    { key: 'end', value: '2028-03-31', page: 37, quote: 'q', source: 'page text' },
    { key: 'end', value: '2099-12-31', page: 12, quote: 'q3', source: 'image text' },
    { key: 'supplier', value: 'Muster AG', page: 1, quote: 'q', source: 'page text' },
    { key: 'supplier', value: 'MUSTER AG', page: 2, quote: 'q', source: 'page text' },
  ], { complete: true, totalPages: 50, unreadablePages: [], pagesLeft: 0 })
  assert.equal(c.fields.end.status, 'candidates')
  assert.equal(c.fields.supplier.status, 'found')
})

test('column fingerprint — order does not matter · changes when the description changes', () => {
  assert.equal(fieldsHash(F), fieldsHash([...F].reverse()))
  assert.notEqual(fieldsHash(F), fieldsHash([{ ...F[0], hint: 'end of term' }, F[1]]))
})

test('numbers — single dot thousands · symbols only · several dots (R3 grok)', async () => {
  const { normNumber, retryWaitMs, isFindShape } = await import('./doc-find')
  assert.equal(normNumber('48.600'), 48600)
  assert.equal(normNumber('1.234.567'), 1234567)
  assert.equal(normNumber('48.600.00'), 48600)
  assert.equal(normNumber('12.5'), 12.5)
  assert.equal(normNumber('0.125'), 0.125)
  assert.equal(normNumber('1,5'), 1.5)
  assert.equal(normNumber('1,234,567'), 1234567)
  for (const x of [',', ',,', '...', '-', '']) assert.equal(normNumber(x), null, x)
  assert.equal(normMoney('...'), null)
  assert.equal(normMoney('CHF 48.600'), '48600.00 CHF')
  assert.equal(normDate('31 août 2028'), '2028-08-31')
  assert.equal(normDate('1er août 2028'), '2028-08-01')
  assert.equal(retryWaitMs({ headers: new Headers({ 'retry-after': '60' }) }), 60_000)
  assert.equal(retryWaitMs({ headers: new Headers({ 'retry-after-ms': '1500' }) }), 1500)
  assert.equal(retryWaitMs({ retryAfterMs: 200 }), 200)
  assert.equal(retryWaitMs(new Error('x')), 5_000)
  assert.equal(isFindShape({ fields: {} }), true)
  for (const x of [{}, [], true, null, { fields: [] }]) assert.equal(isFindShape(x), false)
})

test('write check — money currency must match too (R5)', async () => {
  const { sameAsFound } = await import('./doc-find')
  const m: FindField = { key: 'amount', label: 'A', kind: 'money' }
  assert.equal(sameAsFound(m, { amount: 48600, amount_cur: 'chf ' }, '48600.00 CHF'), true)
  assert.equal(sameAsFound(m, { amount: '48600.00 CHF' }, '48600.00 CHF'), true)
  assert.equal(sameAsFound(m, { amount: 48600 }, '48600.00 CHF'), false)
  assert.equal(sameAsFound(m, { amount: 100, amount_cur: 'USD' }, '100.00'), false)
  assert.equal(sameAsFound(m, { amount: 100 }, '100.00'), true)
  assert.equal(sameAsFound(m, { amount: 48600, amount_cur: 'EUR' }, '48600.00 CHF'), false)
  assert.equal(sameAsFound({ key: 'end', label: 'E', kind: 'date' }, { end: '31.03.2028' }, '2028-03-31'), true)
})
