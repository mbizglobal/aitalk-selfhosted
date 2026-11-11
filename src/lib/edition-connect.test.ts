import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mailConnectTarget, mailErrorCode, MAIL_ERROR_TEXT } from './edition-connect'
import { DnsLookupError, resolveConnectAddress, SSRFError } from './ssrfGuard'

const lookup = (map: Record<string, string>) => async (h: string) => [{ address: map[h], family: map[h].includes(':') ? 6 : 4 }]

test('mail connection - connects to the checked IP, certificate name stays the original host', async () => {
  const r = (h: string) => resolveConnectAddress(h, { lookup: lookup({ 'smtp.example.com': '93.184.216.34' }) })
  assert.deepEqual(await mailConnectTarget(' smtp.example.com ', r), { host: '93.184.216.34', servername: 'smtp.example.com' })
  assert.deepEqual(await mailConnectTarget('93.184.216.34', (h) => resolveConnectAddress(h)), { host: '93.184.216.34' })
  for (const bad of ['', '   ', '[]', null, undefined, 25]) {
    await assert.rejects(mailConnectTarget(bad, (h) => resolveConnectAddress(h)), DnsLookupError, String(bad))
  }
})

test('mail connection - the Cloud check blocks private, loopback, metadata and blocklisted addresses', async () => {
  const cloud = (deny: string[] = []) => (h: string) => resolveConnectAddress(h, { deny, lookup: lookup({ 'evil.example.com': '10.0.0.5', 'mapped.example.com': '::ffff:127.0.0.1' }) })
  for (const host of ['127.0.0.1', '10.1.2.3', '169.254.169.254', 'evil.example.com', 'mapped.example.com', '[::1]']) {
    await assert.rejects(mailConnectTarget(host, cloud()), SSRFError, host)
  }
  await assert.rejects(mailConnectTarget('203.0.113.7', cloud(['203.0.113.7'])), SSRFError)
  const self = (h: string) => resolveConnectAddress(h, { allowPrivate: true })
  assert.equal((await mailConnectTarget('10.1.2.3', self)).host, '10.1.2.3')
  await assert.rejects(mailConnectTarget('169.254.169.254', self), SSRFError)
})

test('mail error branches - the response is a fixed message, the raw text is not included', () => {
  assert.equal(mailErrorCode(new SSRFError('h', '10.0.0.1', 'private')), 'ADDRESS_BLOCKED')
  assert.equal(mailErrorCode(new DnsLookupError('nope.invalid', 'ENOTFOUND')), 'MAIL_DNS')
  assert.equal(mailErrorCode({ code: 'EAUTH', message: 'Invalid login: 535' }), 'MAIL_AUTH')
  assert.equal(mailErrorCode(Object.assign(new Error('Command failed'), { authenticationFailed: true })), 'MAIL_AUTH')
  assert.equal(mailErrorCode({ code: 'ESOCKET', message: 'self-signed certificate in certificate chain' }), 'MAIL_TLS')
  assert.equal(mailErrorCode({ code: 'ESOCKET', message: 'connect ECONNREFUSED 1.2.3.4:25' }), 'MAIL_CONNECT')
  for (const t of Object.values(MAIL_ERROR_TEXT)) assert.ok(!/ENOTFOUND|getaddrinfo|\d+\.\d+\.\d+\.\d+/.test(t))
})
