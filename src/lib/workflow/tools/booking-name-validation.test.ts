import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isPlaceholderName,
  isPlaceholderPhone,
  isNameGroundedInUtterances,
  isNameGroundingApplicable,
  isPhoneGroundedInUtterances,
  normalizeForGrounding,
  spokenDigitsToNumeric,
  phoneNotGroundedMessage,
} from './booking-name-validation'

test('isPlaceholderName: obvious placeholder/generic names are true', () => {
  for (const n of ['Unknown', 'unknown user', 'N/A', 'none', 'TBD', 'test', 'customer', '顾客']) {
    assert.equal(isPlaceholderName(n), true, n)
  }
})

test('isPlaceholderName: generic after stripping English articles ("the customer") is blocked', () => {
  assert.equal(isPlaceholderName('the customer'), true)
  assert.equal(isPlaceholderName('a visitor'), true)
})

test('isPlaceholderName: Korean generic titles are blocked even with particles attached (startsWith root)', () => {
  assert.equal(isPlaceholderName('고객님은'), true)
  assert.equal(isPlaceholderName('예약자께서'), true)
})

test('isPlaceholderName: empty/blank/non-string is true', () => {
  assert.equal(isPlaceholderName(''), true)
  assert.equal(isPlaceholderName('   '), true)
  assert.equal(isPlaceholderName(undefined), true)
  assert.equal(isPlaceholderName(123), true)
})

test('isPlaceholderName: a real name is false', () => {
  assert.equal(isPlaceholderName('Anna'), false)
  assert.equal(isPlaceholderName('김철수'), false)
})

test('isPlaceholderPhone: a valid phone (7+ digits) is false', () => {
  assert.equal(isPlaceholderPhone('0791234567'), false)
  assert.equal(isPlaceholderPhone('1234567'), false)
})

test('isPlaceholderPhone: placeholder/short numbers are true', () => {
  assert.equal(isPlaceholderPhone('auto'), true)
  assert.equal(isPlaceholderPhone('123 456'), true) // 6 digit
  assert.equal(isPlaceholderPhone(''), true)
  assert.equal(isPlaceholderPhone(undefined), true)
})

test('normalizeForGrounding: strips whitespace/punctuation, keeps the name substring', () => {
  assert.equal(normalizeForGrounding('제 이름은, 김철수입니다.'), '제이름은김철수입니다')
  assert.equal(normalizeForGrounding('My Name is Anna!'), 'mynameisanna')
})

test('isNameGroundedInUtterances: true when contained in the utterance (even with particles attached)', () => {
  assert.equal(isNameGroundedInUtterances('김철수', ['제 이름은 김철수입니다']), true)
  assert.equal(isNameGroundedInUtterances('Anna', ['my name is anna']), true)
})

test('isNameGroundedInUtterances: false when absent from the utterance (blocks fabrication)', () => {
  assert.equal(isNameGroundedInUtterances('Bob', ['my name is anna']), false)
})

test('isNameGroundedInUtterances: no utterances / empty array gives false', () => {
  assert.equal(isNameGroundedInUtterances('Anna', undefined), false)
  assert.equal(isNameGroundedInUtterances('Anna', []), false)
})

test('isNameGroundedInUtterances: a 1-character name risks accidental matches, so false', () => {
  assert.equal(isNameGroundedInUtterances('A', ['a a a']), false)
})

test('isNameGroundingApplicable: STT+TTS (unset/model_input_asr) applies, true', () => {
  assert.equal(isNameGroundingApplicable(['제 이름은 김철수'], undefined), true)
  assert.equal(isNameGroundingApplicable(['제 이름은 김철수'], 'model_input_asr'), true)
})

test('isNameGroundingApplicable: Realtime (external_whisper) skips NAME grounding, false', () => {
  assert.equal(isNameGroundingApplicable(['임철수'], 'external_whisper'), false)
})

test('isNameGroundingApplicable: false when callerUtterances is not provided (chat etc.)', () => {
  assert.equal(isNameGroundingApplicable(undefined, undefined), false)
  assert.equal(isNameGroundingApplicable(undefined, 'model_input_asr'), false)
})

test('isPhoneGroundedInUtterances: true if the number is in the same utterance', () => {
  assert.equal(isPhoneGroundedInUtterances('0791234567', ['제 번호는 079-123-4567 입니다']), true)
})

test('isPhoneGroundedInUtterances: true even when the number is split across several turns (concat)', () => {
  assert.equal(isPhoneGroundedInUtterances('0791234567', ['079', '123 4567']), true)
})

test('isPhoneGroundedInUtterances: E.164 needle vs local utterance - matches the last 8 digits', () => {
  assert.equal(isPhoneGroundedInUtterances('+41791234567', ['0791234567']), true)
})

test('isPhoneGroundedInUtterances: false when the utterance has no number (blocks numbers from the summary)', () => {
  assert.equal(isPhoneGroundedInUtterances('0791234567', ['오늘 오후 2시 예약', 'bleh']), false)
})

test('isPhoneGroundedInUtterances: rejects needles shorter than 8 digits', () => {
  assert.equal(isPhoneGroundedInUtterances('1234567', ['1234567']), false)
})

test('isPhoneGroundedInUtterances: empty/missing input gives false', () => {
  assert.equal(isPhoneGroundedInUtterances('0791234567', undefined), false)
  assert.equal(isPhoneGroundedInUtterances('0791234567', []), false)
  assert.equal(isPhoneGroundedInUtterances(undefined, ['0791234567']), false)
})

test('isPhoneGroundedInUtterances: true for Korean spoken digits (sino) too', () => {
  assert.equal(isPhoneGroundedInUtterances('0791234567', ['김철수 공칠구일이삼사오육칠']), true)
})

test('isPhoneGroundedInUtterances: true for English spoken digits too', () => {
  assert.equal(isPhoneGroundedInUtterances('0791234567', ['zero seven nine one two three four five six seven']), true)
})

test('isPhoneGroundedInUtterances: false when spoken digits are a different number (not a misrecognition)', () => {
  assert.equal(isPhoneGroundedInUtterances('1234567890', ['공칠구일이삼사오육칠']), false)
})

test('spokenDigitsToNumeric: ko native numbers before sino single syllables (seven becomes 7, not 1)', () => {
  assert.equal(spokenDigitsToNumeric('일곱').replace(/\D/g, ''), '7')
  assert.equal(spokenDigitsToNumeric('공일이삼').replace(/\D/g, ''), '0123')
})

test('isPhoneGroundedInUtterances: German single-digit spoken numbers (test-measured transcript as is)', () => {
  assert.equal(isPhoneGroundedInUtterances('0795552343', ['Ich heiße Lukas Weber, meine Telefonnummer ist null sieben neun fünf fünf fünf zwei drei vier drei.']), true)
  assert.equal(isPhoneGroundedInUtterances('+41795552343', ['null sieben neun fünf fünf fünf', 'zwei drei vier drei']), true)
})

test('isPhoneGroundedInUtterances: Swiss two-digit grouping (de, fr, en)', () => {
  assert.equal(isPhoneGroundedInUtterances('0795552343', ['Null sieben neun, fünfhundertfünfundfünfzig, dreiundzwanzig, dreiundvierzig.']), true)
  assert.equal(isPhoneGroundedInUtterances('0795552343', ['zéro septante-neuf, cinq cinq cinq, vingt-trois, quarante-trois']), true)
  assert.equal(isPhoneGroundedInUtterances('0799971234', ['zéro soixante-dix-neuf, quatre-vingt-dix-neuf, sept, douze, trente-quatre']), true)
  assert.equal(isPhoneGroundedInUtterances('0795552343', ['zero seven nine, five five five, twenty three, forty-three']), true)
})

test('isPhoneGroundedInUtterances: false for de/fr spoken digits that are an invented number', () => {
  assert.equal(isPhoneGroundedInUtterances('0791234567', ['null sieben neun fünf fünf fünf zwei drei vier drei']), false)
  assert.equal(isPhoneGroundedInUtterances('0791234567', ['zéro sept neuf cinq cinq cinq vingt-trois quarante-trois']), false)
})

test('spokenDigitsToNumeric: leaves non-digit words alone', () => {
  assert.equal(spokenDigitsToNumeric('ein Termin et Stunde Kunden constructor toString'), 'ein Termin et Stunde Kunden constructor toString')
  assert.equal(spokenDigitsToNumeric('einundzwanzig hundert zwo'), '21 100 2')
})

test('spokenDigitsToNumeric: French spaced two-digit numbers, hyphenated single digits, decomposed letters', () => {
  const d = (x: string) => spokenDigitsToNumeric(x).replace(/\D/g, '')
  assert.equal(d('zéro sept neuf cinq cinq cinq vingt trois quarante trois'), '0795552343')
  assert.equal(d('soixante dix sept, quatre vingt dix neuf, vingt et un'), '779921')
  assert.equal(d('cinq-cinq-cinq'), '555')
  assert.equal(d('neuf-huit-sept six-cinq-quatre'), '987654')
  assert.equal(d('soixante-seize quatre-vingt-onze septante-et-un'), '769171')
  assert.equal(d('vingt six, trente-six, quatre-vingt-six'), '263686')
  assert.equal(d('nonante neuf dix vingt trois quatre'), '991023' + '4')
  assert.equal(d('dix deux, quatre dix neuf'), '102419')
  assert.equal(d('quatre-vingts'), '80')
  assert.equal(d('fu\u0308nf ze\u0301ro'), '50')
})

test('phoneNotGroundedMessage: web voice reads back + recommends the number field from the first refusal (spoken numbers are also accepted); chatbot keeps the old wording', () => {
  const web = phoneNotGroundedMessage('web_voice')
  assert.match(web, /one digit at a time/)
  assert.match(web, /phone box/)
  assert.match(web, /type their number into the phone box on their screen — that is the most reliable way/)
  assert.match(web, /never refuse a spoken number/)
  assert.match(web, /a plain "yes" is not enough/)
  assert.match(web, /Do NOT call book_calendar_event again until the caller has given the number again/)
  const chat = phoneNotGroundedMessage('chat_widget')
  assert.doesNotMatch(chat, /phone box|one digit at a time/)
  assert.match(chat, /until the caller has spoken the number/)
})
