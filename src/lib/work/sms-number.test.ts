import { test } from 'node:test'
import assert from 'node:assert/strict'
import { countSmsSegments, normalizeSmsNumber, smsPriceFor, SMS_COUNTRIES } from './sms-number'

test('number — many Swiss shapes = the same E.164', () => {
  for (const raw of ['079 123 45 67', '+41 79 123 45 67', '0041791234567', '(079) 123-45-67', '079.123.45.67', ' 0791234567 ']) {
    const r = normalizeSmsNumber(raw)
    assert.ok(r.ok, raw)
    assert.equal(r.e164, '+41791234567')
    assert.equal(r.country, 'CH')
    assert.equal(r.display, '+41 79 123 45 67')
  }
  const a = normalizeSmsNumber('0791234567')
  assert.ok(a.ok && a.assumed)
  const b = normalizeSmsNumber('+41791234567')
  assert.ok(b.ok && !b.assumed)
})

test('number — Germany · France', () => {
  const de = normalizeSmsNumber('+49 170 1234567')
  assert.ok(de.ok && de.country === 'DE' && de.e164 === '+491701234567' && de.display === '+49 170 1234567')
  assert.ok(normalizeSmsNumber('+49 1512 3456789').ok)
  const fr = normalizeSmsNumber('+33 6 12 34 56 78')
  assert.ok(fr.ok && fr.country === 'FR' && fr.display === '+33 6 12 34 56 78')
  assert.ok(normalizeSmsNumber('0033712345678').ok)
})

test('number — French 07 without a country code = taken as Swiss (assumed) — the card shows it large', () => {
  const r = normalizeSmsNumber('0781234567')
  assert.ok(r.ok)
  assert.equal(r.country, 'CH')
  assert.equal(r.e164, '+41781234567')
  assert.equal(r.assumed, true)
})

test('number — refused', () => {
  const code = (raw: unknown) => { const r = normalizeSmsNumber(raw); return r.ok ? 'ok' : r.code }
  assert.equal(code(''), 'RECIPIENT_EMPTY')
  assert.equal(code('   '), 'RECIPIENT_EMPTY')
  assert.equal(code(null), 'RECIPIENT_EMPTY')
  assert.equal(code(41791234567), 'RECIPIENT_EMPTY')
  assert.equal(code('044 123 45 67'), 'NOT_MOBILE')
  assert.equal(code('+49 30 1234567'), 'NOT_MOBILE')
  assert.equal(code('+33 1 23 45 67 89'), 'NOT_MOBILE')
  assert.equal(code('+423 791 23 45'), 'COUNTRY_NOT_SUPPORTED')
  assert.equal(code('+39 312 345 6789'), 'COUNTRY_NOT_SUPPORTED')
  assert.equal(code('+44 7700 900123'), 'COUNTRY_NOT_SUPPORTED')
  assert.equal(code('+1 415 555 0100'), 'COUNTRY_NOT_SUPPORTED')
  assert.equal(code('0170 1234567'), 'NOT_MOBILE')
  assert.equal(code('079 123 45 6'), 'NOT_MOBILE')
  assert.equal(code('079 123 45 678'), 'NOT_MOBILE')
  assert.equal(code('079 12a 45 67'), 'RECIPIENT_INVALID')
  assert.equal(code('791234567'), 'RECIPIENT_INVALID')
  assert.equal(code('+41 79 123 45 67 ext 2'), 'RECIPIENT_INVALID')
})

test('parts — same as the Infobip preview', () => {
  const t = (s: string) => countSmsSegments(s)
  assert.deepEqual(t('Ihre Reparatur ist fertig. Abholung ab morgen 9 Uhr. Grüsse, Muster AG'), { encoding: 'GSM7', units: 70, segments: 1 })
  assert.deepEqual(t('Votre réparation est terminée. Ça vous convient ? Muster SA'), { encoding: 'GSM7', units: 59, segments: 1 })
  assert.deepEqual(t('수리가 끝났습니다. 내일 9시부터 찾아가세요.'), { encoding: 'UCS2', units: 25, segments: 1 })
  assert.deepEqual(t('Repair done 👍 pick up tomorrow'), { encoding: 'UCS2', units: 31, segments: 1 })
  assert.equal(t('a'.repeat(160)).segments, 1)
  assert.equal(t('a'.repeat(161)).segments, 2)
  assert.equal(t('가'.repeat(70)).segments, 1)
  assert.equal(t('가'.repeat(71)).segments, 2)
})

test('parts — edges · extended characters · characters outside GSM', () => {
  const t = (s: string) => countSmsSegments(s)
  assert.equal(t('a'.repeat(306)).segments, 2)
  assert.equal(t('a'.repeat(307)).segments, 3)
  assert.equal(t('a'.repeat(459)).segments, 3)
  assert.equal(t('a'.repeat(460)).segments, 4)
  assert.equal(t('가'.repeat(134)).segments, 2)
  assert.equal(t('가'.repeat(201)).segments, 3)
  assert.equal(t('가'.repeat(202)).segments, 4)
  assert.equal(t('€').units, 2)
  assert.equal(t('€'.repeat(80)).segments, 1)
  assert.equal(t('€'.repeat(81)).segments, 2)
  assert.equal(t('a'.repeat(152) + '€' + 'a'.repeat(152)).segments, 3)
  assert.equal(t('a'.repeat(151) + '€' + 'a'.repeat(153)).segments, 2)
  assert.equal(t('fenêtre').encoding, 'UCS2')
  assert.equal(t('garçon').encoding, 'UCS2')
  assert.equal(t('Ça').encoding, 'GSM7')
  assert.equal(t('a'.repeat(69) + 'ç').segments, 1)
  assert.equal(t('a'.repeat(70) + 'ç').segments, 2)
  assert.equal(t('').segments, 0)
})

test('price — country price × parts · France counts 20 more characters · cap', () => {
  assert.deepEqual(SMS_COUNTRIES, { CH: 12, DE: 14, FR: 15 })
  assert.deepEqual(smsPriceFor('CH', 'a'.repeat(160)), { country: 'CH', segments: 1, unit: 12, total: 12 })
  assert.deepEqual(smsPriceFor('CH', 'a'.repeat(161)), { country: 'CH', segments: 2, unit: 12, total: 24 })
  assert.deepEqual(smsPriceFor('DE', 'Hallo'), { country: 'DE', segments: 1, unit: 14, total: 14 })
  assert.deepEqual(smsPriceFor('FR', 'a'.repeat(140)), { country: 'FR', segments: 1, unit: 15, total: 15 })
  assert.deepEqual(smsPriceFor('FR', 'a'.repeat(141)), { country: 'FR', segments: 2, unit: 15, total: 30 }) // 141 + 20 = 161
  assert.equal(smsPriceFor('CH', 'a'.repeat(460)), null)
  assert.equal(smsPriceFor('FR', 'a'.repeat(450)), null) // 450 + 20 > 459
  assert.equal(smsPriceFor('CH', ''), null)
})
