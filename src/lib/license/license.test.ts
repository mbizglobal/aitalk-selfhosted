import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import https from 'node:https'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { verifyLicenseText, getLicenseState, isEeFeatureEnabled, describeLicenseState, type LicensePayload } from './index'
import { LICENSE_PUBLIC_KEYS } from './public-keys'

const pair = () => generateKeyPairSync('ed25519')
const A = pair()
const B = pair()
const spki = (k: KeyObject) => k.export({ format: 'der', type: 'spki' }).toString('base64')
const KEYS = { t1: spki(A.publicKey) }

const base: LicensePayload = {
  v: 1, kid: 't1', licenseId: 'L-T-1', licensee: 'Muster Treuhand AG',
  issuedAt: '2026-11-01', expiresAt: '2027-10-31', features: ['approval'], clientCompanies: 10,
}
const enc = (o: unknown) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64url')
function issue(payload: unknown, key: KeyObject = A.privateKey): string {
  const body = enc(payload)
  return `${body}.${sign(null, Buffer.from(body, 'ascii'), key).toString('base64url')}`
}
const at = (iso: string) => new Date(iso)
const check = (text: string, now = '2027-01-01T00:00:00Z') => verifyLicenseText(text, { now: at(now), publicKeys: KEYS })

test('real key = active; features; customer-company count is only recorded', () => {
  const s = check(issue(base))
  assert.equal(s.status, 'active')
  if (s.status !== 'active') return
  assert.deepEqual(s.features, ['approval'])
  assert.equal(s.payload.clientCompanies, 10)
})

test('forged, wrong key, malformed: all invalid', () => {
  const good = issue(base)
  const [body, sig] = good.split('.')
  const forged = enc({ ...base, licensee: 'Other AG' }) + '.' + sig
  assert.deepEqual(check(forged), { status: 'invalid', reason: 'signature_mismatch' })
  const flipped = body + '.' + (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1)
  assert.equal(check(flipped).status, 'invalid')
  assert.deepEqual(check(issue(base, B.privateKey)), { status: 'invalid', reason: 'signature_mismatch' })
  for (const bad of ['', '   ', 'abc', 'a.b.c', `${body}.`, `.${sig}`, `${body}.!!!`, 'x'.repeat(9000)]) {
    assert.equal(check(bad).status, 'invalid', JSON.stringify(bad.slice(0, 20)))
  }
  assert.equal(check(`  ${good}\n`).status, 'active')
})

test('kid: unknown, missing, name not in key list (prototype names)', () => {
  assert.deepEqual(check(issue({ ...base, kid: 'zz' })), { status: 'invalid', reason: 'kid_unknown' })
  const { kid: _k, ...noKid } = base
  assert.deepEqual(check(issue(noKid)), { status: 'invalid', reason: 'kid_missing' })
  assert.deepEqual(check(issue({ ...base, kid: '__proto__' })), { status: 'invalid', reason: 'kid_unknown' })
  assert.deepEqual(check(issue({ ...base, kid: 'toString' })), { status: 'invalid', reason: 'kid_unknown' })
})

test('payload fields: invalid when shape is wrong even if signature matches', () => {
  const cases: [Record<string, unknown>, string][] = [
    [{ ...base, v: 2 }, 'unknown_version'],
    [{ ...base, licensee: '  ' }, 'licensee_missing'],
    [{ ...base, licenseId: '' }, 'license_id_missing'],
    [{ ...base, features: [] }, 'features_invalid'],
    [{ ...base, features: 'approval' }, 'features_invalid'],
    [{ ...base, features: ['approval', 3] }, 'features_invalid'],
    [{ ...base, expiresAt: '2027-02-30' }, 'expires_at_invalid'],
    [{ ...base, expiresAt: '2027-1-31' }, 'expires_at_invalid'],
    [{ ...base, issuedAt: undefined }, 'issued_at_invalid'],
    [{ ...base, clientCompanies: -1 }, 'client_companies_invalid'],
    [{ ...base, clientCompanies: 1.5 }, 'client_companies_invalid'],
    [{ ...base, licensee: 'Muster AG\n[License] Enterprise — Fake' }, 'text_invalid'],
    [{ ...base, licenseId: 'L-1\r' }, 'text_invalid'],
    [{ ...base, licensee: 'A\u2028B' }, 'text_invalid'],
    [{ ...base, licensee: 'x'.repeat(201) }, 'text_invalid'],
  ]
  for (const [p, reason] of cases) assert.deepEqual(check(issue(p)), { status: 'invalid', reason }, reason)
  assert.equal(check(issue([1, 2])).status, 'invalid')
})

test('unknown features are ignored; only known ones are enabled', () => {
  const s = check(issue({ ...base, features: ['sso', 'approval', 'future'] }))
  assert.equal(s.status, 'active')
  if (s.status === 'active') assert.deepEqual(s.features, ['approval'])
  const none = check(issue({ ...base, features: ['sso'] }))
  assert.equal(none.status, 'active')
  if (none.status === 'active') assert.deepEqual(none.features, [])
})

test('date boundary (UTC): active through end of expiry day, 15-day grace from next day, expired at 00:00 on day 16', () => {
  const key = issue(base) // expiresAt 2027-10-31
  assert.equal(check(key, '2027-10-31T23:59:59.999Z').status, 'active')
  assert.equal(check(key, '2027-11-01T00:00:00Z').status, 'grace')
  assert.equal(check(key, '2027-11-15T23:59:59.999Z').status, 'grace')
  assert.equal(check(key, '2027-11-16T00:00:00Z').status, 'expired')
  const g = check(key, '2027-11-05T12:00:00Z')
  assert.equal(g.status, 'grace')
  if (g.status === 'grace') assert.equal(g.graceEndsAt.toISOString(), '2027-11-16T00:00:00.000Z')
  const leap = issue({ ...base, expiresAt: '2028-02-29' })
  assert.equal(check(leap, '2028-02-29T23:00:00Z').status, 'active')
  assert.equal(check(leap, '2028-03-01T00:00:00Z').status, 'grace')
})

test('install settings: Cloud does not read them; file, value, both, unreadable file', () => {
  const real = issue(base)
  const dir = mkdtempSync(join(tmpdir(), 'lic-'))
  const file = join(dir, 'k.license')
  writeFileSync(file, real + '\n')
  assert.deepEqual(getLicenseState({ AITALK_LICENSE: real }), { status: 'none' }) // Cloud
  assert.deepEqual(getLicenseState({ AITALK_EDITION: 'selfhosted' }), { status: 'none' })
  assert.deepEqual(getLicenseState({ AITALK_EDITION: 'selfhosted', AITALK_LICENSE_FILE: file }), { status: 'invalid', reason: 'kid_unknown' })
  assert.deepEqual(getLicenseState({ AITALK_EDITION: 'selfhosted', AITALK_LICENSE: real }), { status: 'invalid', reason: 'kid_unknown' })
  assert.deepEqual(getLicenseState({ AITALK_EDITION: 'selfhosted', AITALK_LICENSE: real, AITALK_LICENSE_FILE: file }), { status: 'invalid', reason: 'both_set' })
  assert.deepEqual(getLicenseState({ AITALK_EDITION: 'selfhosted', AITALK_LICENSE_FILE: join(dir, 'missing') }), { status: 'invalid', reason: 'file_unreadable' })
  const big = join(dir, 'big')
  writeFileSync(big, 'x'.repeat(10_000))
  assert.deepEqual(getLicenseState({ AITALK_EDITION: 'selfhosted', AITALK_LICENSE_FILE: big }), { status: 'invalid', reason: 'file_too_large' })
  for (const odd of [dir, '/dev/zero', '/dev/null']) {
    assert.deepEqual(getLicenseState({ AITALK_EDITION: 'selfhosted', AITALK_LICENSE_FILE: odd }), { status: 'invalid', reason: 'file_not_regular' }, odd)
  }
  assert.equal(isEeFeatureEnabled('approval', { AITALK_EDITION: 'selfhosted', AITALK_LICENSE: real }), false)
  assert.equal(isEeFeatureEnabled('approval', {}), false)
})

test('real public key: well-formed and different from the test key', () => {
  const kids = Object.keys(LICENSE_PUBLIC_KEYS)
  assert.ok(kids.length >= 1)
  for (const k of kids) assert.notEqual(LICENSE_PUBLIC_KEYS[k], KEYS.t1)
  assert.deepEqual(verifyLicenseText(issue({ ...base, kid: kids[0] }), { now: at('2027-01-01T00:00:00Z') }), { status: 'invalid', reason: 'signature_mismatch' })
})

test('zero outbound connections: no fetch or http(s) calls during verification', () => {
  const orig = { fetch: globalThis.fetch, h: http.request, hs: https.request }
  const boom = () => { throw new Error('network call during license check') }
  try {
    globalThis.fetch = boom as unknown as typeof fetch
    http.request = boom as unknown as typeof http.request
    https.request = boom as unknown as typeof https.request
    assert.equal(check(issue(base)).status, 'active')
    assert.equal(check('garbage').status, 'invalid')
  } finally {
    globalThis.fetch = orig.fetch
    http.request = orig.h
    https.request = orig.hs
  }
})

test('one log line: key text and signature never appear', () => {
  const key = issue(base)
  const line = describeLicenseState(check(key))
  assert.match(line, /Enterprise — Muster Treuhand AG \(L-T-1\) · until 2027-10-31 · features: approval/)
  for (const part of key.split('.')) assert.ok(!line.includes(part))
  assert.match(describeLicenseState(check(key, '2027-11-02T00:00:00Z')), /grace .* features off on 2027-11-16/)
  assert.match(describeLicenseState({ status: 'invalid', reason: 'kid_unknown' }), /invalid key — kid_unknown/)
})
