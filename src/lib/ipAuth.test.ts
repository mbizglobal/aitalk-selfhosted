import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clientIpFromHeaders } from './ipAuth'

const h = (o: Record<string, string>) => new Headers(o)
const prod = { trustForwarded: false }

test('prod - trusts only the nginx value and does not read the first X-Forwarded-For', () => {
  assert.equal(clientIpFromHeaders(h({ 'x-aitalk-client-ip': '203.0.113.9', 'x-forwarded-for': '198.51.100.1, 203.0.113.9' }), prod), '203.0.113.9')
  assert.equal(clientIpFromHeaders(h({ 'x-forwarded-for': '198.51.100.1', 'x-real-ip': '192.0.2.10' }), prod), '192.0.2.10')
})
test('prod - when nginx says untrusted, keep it (on no allow list)', () => {
  assert.equal(clientIpFromHeaders(h({ 'x-aitalk-client-ip': '-', 'x-forwarded-for': '198.51.100.1' }), prod), '-')
})
test('prod - no header means the server itself', () => {
  assert.equal(clientIpFromHeaders(h({}), prod), '127.0.0.1')
})
test('development and Self-hosted - no proxy, so the first X-Forwarded-For', () => {
  assert.equal(clientIpFromHeaders(h({ 'x-forwarded-for': '198.51.100.1, 10.0.0.1', 'x-real-ip': '10.0.0.2' }), { trustForwarded: true }), '198.51.100.1')
})
