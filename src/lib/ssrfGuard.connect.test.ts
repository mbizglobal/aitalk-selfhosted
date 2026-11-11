import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveConnectAddress, SSRFError, DnsLookupError } from './ssrfGuard'

const OURS = '20.20.20.20'
const APP_DB = '10.0.1.4'
const cloud = { deny: [OURS, APP_DB] }
const lookupOf = (ips: string[]) => async () => ips.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))

const blocked = async (host: string, opts: Parameters<typeof resolveConnectAddress>[1]) =>
  assert.rejects(resolveConnectAddress(host, opts), SSRFError, host)

test('Cloud - private, loopback, link-local, own addresses and mapped forms are refused', async () => {
  for (const h of ['10.0.1.4', '127.0.0.1', '::1', '::ffff:10.0.0.1', '169.254.169.254', '::ffff:169.254.169.254', OURS, `::ffff:${OURS}`, `[::ffff:${OURS}]`, '0.0.0.0', '::', 'fe80::1', '224.0.0.1', '255.255.255.255', '100.64.0.1']) {
    await blocked(h, cloud)
  }
})

test('Cloud - a name resolving to a private address, or mixing one in, is refused; public gives that IP', async () => {
  await blocked('db.example.com', { ...cloud, lookup: lookupOf(['10.1.2.3']) })
  await blocked('db.example.com', { ...cloud, lookup: lookupOf(['8.8.8.8', '192.168.0.1']) })
  await blocked('db.example.com', { ...cloud, lookup: lookupOf([OURS]) })
  assert.equal(await resolveConnectAddress('db.example.com', { ...cloud, lookup: lookupOf(['8.8.4.4', '8.8.8.8']) }), '8.8.4.4')
  assert.equal(await resolveConnectAddress('8.8.8.8', cloud), '8.8.8.8')
  assert.equal(await resolveConnectAddress('::ffff:8.8.8.8', cloud), '8.8.8.8')
})

test('the name is resolved only once', async () => {
  let n = 0
  await resolveConnectAddress('db.example.com', { lookup: async () => { n++; return [{ address: '8.8.8.8', family: 4 }] } })
  assert.equal(n, 1)
})

test('Self-hosted (allowPrivate) - private and loopback allowed, metadata and unspecified still refused', async () => {
  const sh = { allowPrivate: true }
  for (const h of ['10.0.1.4', '127.0.0.1', '::1', '192.168.1.10', 'fd00::1', '::ffff:10.0.0.1']) assert.ok(await resolveConnectAddress(h, sh))
  for (const h of ['169.254.169.254', '::ffff:169.254.169.254', '0.0.0.0', '::', 'fe80::1']) await blocked(h, sh)
})

test('empty address or unresolvable name = DnsLookupError', async () => {
  await assert.rejects(resolveConnectAddress('  ', {}), DnsLookupError)
  await assert.rejects(resolveConnectAddress('x.invalid', { lookup: async () => { throw new Error('ENOTFOUND') } }), DnsLookupError)
  await assert.rejects(resolveConnectAddress('x.invalid', { lookup: async () => [] }), DnsLookupError)
})
