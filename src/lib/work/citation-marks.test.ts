import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stripCitationMarks } from './citation-marks'

test('citation mark removal — complete · half while streaming · single characters · normal text unchanged', () => {
  assert.equal(stripCitationMarks('60일입니다. citeStandard contract terms.txt'), '60일입니다.')
  assert.equal(stripCitationMarks('A citex B citey'), 'A  B')
  assert.equal(stripCitationMarks('60일입니다. citeStand'), '60일입니다.')
  assert.equal(stripCitationMarks('abc'), 'abc')
  const plain = '가격은 €100 입니다.\n- 줄 둘'
  assert.equal(stripCitationMarks(plain), plain)
  assert.equal(stripCitationMarks(''), '')
})
