
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'crypto'

import { decryptBuffer, decryptStrict, encrypt, encryptBuffer } from '@/lib/encryption'
import { looksLike } from './files'
import { decryptJson, encryptJson } from './sealed'

const KEY = crypto.randomBytes(32)
const OTHER_KEY = crypto.randomBytes(32)
const PDF = Buffer.from('%PDF-1.7\n합성 영수증\n%%EOF')
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('png body')])

describe('encryption: bytes; throws on failure', () => {
  it('round trip; a different key, tampering or truncation throws (does not return the text "Decryption failed")', () => {
    const sealed = encryptBuffer(PDF, KEY)
    assert.ok(decryptBuffer(sealed, KEY).equals(PDF))
    assert.throws(() => decryptBuffer(sealed, OTHER_KEY), /Decryption failed/)
    const tampered = Buffer.from(sealed)
    tampered[tampered.length - 1] ^= 1
    assert.throws(() => decryptBuffer(tampered, KEY))
    assert.throws(() => decryptBuffer(sealed.subarray(0, 20), KEY))
    assert.throws(() => decryptBuffer(Buffer.alloc(0), KEY))
  })

  it('decryptStrict is compatible with the existing string encrypt and throws on failure', () => {
    assert.equal(decryptStrict(encrypt('회사 이름', KEY), KEY), '회사 이름')
    assert.throws(() => decryptStrict(encrypt('x', KEY), OTHER_KEY))
  })

  it('sealed JSON round trip; a different key throws', () => {
    const b = encryptJson({ name: 'Firma', n: [1, 2] }, KEY)
    assert.deepEqual(decryptJson(b, KEY), { name: 'Firma', n: [1, 2] })
    assert.throws(() => decryptJson(b, OTHER_KEY))
  })
})

describe('looksLike: declared format versus actual bytes', () => {
  it('returns false on mismatch, and for formats outside the list', () => {
    assert.equal(looksLike('application/pdf', PDF), true)
    assert.equal(looksLike('application/pdf', PNG), false)
    assert.equal(looksLike('application/pdf', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), PDF])), true)
    assert.equal(looksLike('image/png', PNG), true)
    assert.equal(looksLike('application/zip', PDF), false)
    assert.equal(looksLike('text/csv', Buffer.from([0x61, 0x00, 0x62])), false)
    assert.equal(looksLike('text/csv', Buffer.from('a;b\n1;2\n')), true)
  })

  it('heic down to the brand, xlsx down to the workbook name', () => {
    const iso = (brand: string) => Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftyp' + brand), Buffer.alloc(12)])
    assert.equal(looksLike('image/heic', iso('heic')), true)
    assert.equal(looksLike('image/heic', iso('isom')), false)
    const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    const zip = (names: string) => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(names)])
    assert.equal(looksLike(XLSX, zip('evil.exe')), false)
    assert.equal(looksLike(XLSX, zip('[Content_Types].xml xl/workbook.xml')), true)
  })
})
