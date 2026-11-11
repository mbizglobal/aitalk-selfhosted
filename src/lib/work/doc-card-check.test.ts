import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cardChecks, ibanValid, isDocCardMime, isStaleUnsupported, normalizeModelCard, referenceValid, textLooksGarbled, type ModelCard } from './doc-card-check'

const shifted = (s: string) => [...s].map((ch) => (/[A-Za-z]/.test(ch) ? String.fromCharCode(ch.charCodeAt(0) - 29) : ch)).join('')

test('broken text - shifted text layers are caught, ordinary invoices and receipts are not', () => {
  const plain = 'INVOICE Example Trading GmbH Sample Street 1 8000 Zurich Invoice number 1042 Date 2026-03-01 Description Consulting services Subtotal CHF 1000.00 VAT 8.1% CHF 81.00 Total CHF 1081.00 Payable within 30 days'
  assert.equal(textLooksGarbled(shifted(plain)), true)
  assert.equal(textLooksGarbled(shifted('INVOICE ' + plain)), true)
  assert.equal(textLooksGarbled(plain), false)
  assert.equal(textLooksGarbled('Quittung Bäckerei Muster Brot 4.50 Gipfeli 2.40 Total CHF 6.90 Besten Dank für Ihren Einkauf MWST 2.6% inbegriffen'), false)
  assert.equal(textLooksGarbled('Facture numéro 77 date échéance montant total TVA incluse merci de votre confiance'), false)
  assert.equal(textLooksGarbled('영수증 상호 예시상점 품목 커피 4,500원 합계 4,500원 부가세 포함 감사합니다 카드 결제'), false)
  assert.equal(textLooksGarbled("Rechnung Beratung Total CHF 1'081.00 Betrag 1'000.00 zahlbar innert 30 Tagen besten Dank"), false)
  assert.equal(textLooksGarbled('Счёт номер 15 дата оплаты сумма итого НДС включён спасибо'), false)
  assert.equal(textLooksGarbled('Invoice Invoice number: 123456 Details .............................................. Service fee .......... 10.00 Total due .......... 10.00 Thank you for your business'), false)
  assert.equal(textLooksGarbled("Example Bank\nHead office 8000 Zurich, Sample Street 1\nE-Mail info@example.ch\nMWST-Nr. CHE-000.000.000 MWST\nBIC/SWIFT EXMPCH2S\nAccount 100.200-0 101 / CHF\nIBAN CH00 0000 0000 0000 0000 0\nHolder Sample GmbH\nOpening balance as at 01.09.2026 CHF 1'000.00\nClosing balance as at 30.09.2026 CHF 988.00\nDate Posting text Debit Credit entry Balance CHF\n30.09.2026 Account fee CHF 12.00 988.00\nNo responsibility accepted for accuracy of information Page 1/1"), false)
  assert.equal(textLooksGarbled('청구 내역 합계 금액 공급 받는 상호 주소 품목 수량 단가 4,500원'), false)
  assert.equal(textLooksGarbled(',&( \'$7( 2FW'), false)
})

const baseCard = (o: Record<string, unknown> = {}) => ({
  docType: 'invoice', issuer: { name: 'Example Trading GmbH', address: null, vatId: null }, recipient: null, number: '1042',
  issueDate: '2026-03-01', dueDate: '2026-03-31', servicePeriod: { from: null, to: null }, currency: 'CHF',
  total: '1081.00', net: '1000.00', vat: [{ rate: '8.1', base: '1000.00', amount: '81.00' }], paid: 'unpaid', paidOn: null,
  paymentMethod: null, payTo: { iban: null, qrReference: null, reference: null }, refersTo: null, lines: [], language: 'en',
  textQuality: 'ok', uncertain: [], ...o,
})

test('field check - a wrongly formatted field is null + uncertain (nothing invented) - a wrong shape is null', () => {
  const c = normalizeModelCard(baseCard({ total: 'CHF 1,081.00', issueDate: '01.03.2026', currency: 'chf', lines: [{ text: '  Beratung  ', amount: "1'000.00" }] }))!
  assert.equal(c.total, null)
  assert.equal(c.issueDate, null)
  assert.equal(c.currency, 'CHF')
  assert.deepEqual(c.lines, [{ text: 'Beratung', amount: '1000.00' }])
  assert.ok(c.uncertain.includes('total') && c.uncertain.includes('issueDate'))
  assert.equal(normalizeModelCard({ docType: 'love_letter' }), null)
  assert.equal(normalizeModelCard(null), null)
  assert.equal(normalizeModelCard([]), null)
  const long = normalizeModelCard(baseCard({ lines: [{ text: 'x'.repeat(500), amount: null }], uncertain: Array(9).fill('y'.repeat(300)) }))!
  assert.equal(long.lines[0].text.length, 120)
  assert.equal(long.uncertain.length, 8)
  const crowded = normalizeModelCard(baseCard({ total: 'abc', uncertain: Array.from({ length: 9 }, (_, i) => `m${i}`) }))!
  assert.equal(crowded.uncertain[0], 'total')
})

test('cross-check - a correct invoice = empty checks - total or tax mismatch = number mismatch', () => {
  const ok = normalizeModelCard(baseCard()) as ModelCard
  assert.deepEqual(cardChecks(ok), { checks: [], numeric: false })
  assert.deepEqual(cardChecks({ ...ok, total: '1180.00' }), { checks: ['total_mismatch'], numeric: true })
  assert.equal(cardChecks({ ...ok, vat: [{ rate: '8.1', base: '1000.00', amount: '18.00' }], total: '1018.00' }).checks.includes('vat_mismatch'), true)
  assert.deepEqual(cardChecks({ ...ok, net: null, total: '108.10', vat: [{ rate: '8.1', base: '108.10', amount: '8.10' }] }).checks, [])
})

test('cross-check - null fields are not mismatches (receipt without account, receipt without rate)', () => {
  const r = normalizeModelCard(baseCard({ docType: 'receipt', net: null, vat: [], dueDate: null, paid: 'paid' })) as ModelCard
  assert.deepEqual(cardChecks(r), { checks: [], numeric: false })
  const partVat = normalizeModelCard(baseCard({ vat: [{ rate: '8.1', base: null, amount: null }] })) as ModelCard
  assert.deepEqual(cardChecks(partVat).checks, [])
})

test('cross-check - IBAN, QR reference, RF reference check digits - due date before the issue date', () => {
  assert.equal(ibanValid('CH93 0076 2011 6238 5295 7'), true)
  assert.equal(ibanValid('CH93 0076 2011 6238 5295 8'), false)
  assert.equal(referenceValid('21 00000 00003 13947 14300 09017'), true)
  assert.equal(referenceValid('210000000003139471430009018'), false)
  assert.equal(referenceValid('RF18 5390 0754 7034'), true)
  assert.equal(referenceValid('RF19 5390 0754 7034'), false)
  assert.equal(referenceValid('INV-2026-1042'), null)
  const ok = normalizeModelCard(baseCard()) as ModelCard
  assert.deepEqual(cardChecks({ ...ok, payTo: { iban: 'CH9300762011623852958', qrReference: '210000000003139471430009018', reference: null } }).checks, ['iban_checksum', 'reference_checksum'])
  assert.deepEqual(cardChecks({ ...ok, dueDate: '2026-02-01' }).checks, ['due_before_issue'])
  assert.equal(cardChecks({ ...ok, dueDate: '2026-02-01' }).numeric, false)
})

test('XML (bank camt) is also a card target - XML once stuck as unreadable kind is a stale verdict', () => {
  for (const m of ['application/xml', 'text/xml', 'text/csv', 'text/plain', 'application/pdf', 'image/jpeg']) assert.equal(isDocCardMime(m), true, m)
  assert.equal(isDocCardMime('application/zip'), false)
  assert.equal(isStaleUnsupported('unsupported', 'application/xml'), true)
  assert.equal(isStaleUnsupported('unsupported', 'application/zip'), false)
  assert.equal(isStaleUnsupported('garbled', 'application/xml'), false)
})
