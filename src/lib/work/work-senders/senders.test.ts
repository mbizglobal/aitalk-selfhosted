import { test } from 'node:test'
import assert from 'node:assert/strict'
import { outcomeOfStatus, outcomeOfError } from './index'
import { smtpOutcome, smtpErrorOutcome } from './email'
import { authHeaders } from './http'
import { recipientValid } from '../sends'

test('HTTP response to status: 2xx sent, 4xx failed, 5xx unknown', () => {
  assert.equal(outcomeOfStatus(202, '').status, 'sent')
  assert.equal(outcomeOfStatus(200, '').status, 'sent')
  for (const s of [400, 401, 403, 404, 413, 429]) assert.equal(outcomeOfStatus(s, '').status, 'failed', String(s))
  for (const s of [500, 502, 503, 504]) assert.equal(outcomeOfStatus(s, '').status, 'unknown', String(s))
  assert.equal(outcomeOfStatus(401, '').code, 'HTTP_401')
})

test('exception = unknown (may have gone out), timeout = TIMEOUT', () => {
  const t = new Error('t'); t.name = 'TimeoutError'
  assert.deepEqual([outcomeOfError(t).status, outcomeOfError(t).code], ['unknown', 'TIMEOUT'])
  assert.equal(outcomeOfError(Object.assign(new Error('x'), { code: 'ETIMEDOUT' })).code, 'TIMEOUT')
  assert.deepEqual([outcomeOfError(new TypeError('fetch failed')).status, outcomeOfError(new TypeError('fetch failed')).code], ['unknown', 'NO_RESPONSE'])
})

test('SMTP - accepted sent, all rejected failed, rejected by code, auth failed, timeout, dropped unknown', () => {
  assert.equal(smtpOutcome({ accepted: ['a@example.com'], rejected: [] }).status, 'sent')
  assert.equal(smtpOutcome({ accepted: ['a@example.com'], rejected: ['b@example.com'] }).status, 'sent')
  assert.equal(smtpOutcome({ accepted: [], rejected: ['b@example.com'] }).status, 'failed')
  assert.equal(smtpOutcome({}).status, 'unknown')
  assert.equal(smtpOutcome({ accepted: [], rejected: [] }).status, 'unknown')
  assert.equal(smtpErrorOutcome({ responseCode: 550, message: 'no such user' }).status, 'failed')
  assert.equal(smtpErrorOutcome({ responseCode: 451, message: 'try later' }).status, 'failed')
  assert.equal(smtpErrorOutcome({ code: 'EAUTH', message: 'bad login' }).status, 'failed')
  assert.equal(smtpErrorOutcome({ code: 'ETIMEDOUT', message: 'timeout' }).status, 'unknown')
  assert.equal(smtpErrorOutcome({ code: 'ESOCKET', message: 'socket closed' }).status, 'unknown')
  assert.equal(smtpErrorOutcome(new Error('Connection closed')).status, 'unknown')
})

test('recipient format - email, telegram, http', () => {
  for (const ok of ['a@example.com', 'kim.lee+tax@sub.example.ch']) assert.ok(recipientValid('email', ok), ok)
  for (const bad of ['a', 'a@b', 'a b@example.com', 'a@example.com, b@example.com', '<a@example.com>', 'a@@example.com']) assert.ok(!recipientValid('email', bad), bad)
  for (const ok of ['123456789', '-1001234567890', '@my_channel']) assert.ok(recipientValid('telegram', ok), ok)
  for (const bad of ['abc', '@ab', '12 34', 'https://t.me/x', '']) assert.ok(!recipientValid('telegram', bad), bad)
  assert.ok(recipientValid('http', 'https://hooks.example.com/x?y=1'))
  for (const bad of ['http://hooks.example.com/x', 'ftp://x.example.com', 'https://user:pw@example.com/', 'not a url', 'javascript:alert(1)']) assert.ok(!recipientValid('http', bad), bad)
})

test('server call auth header - none, apiKey, bearer, basic / hmac = none (null)', () => {
  assert.deepEqual(authHeaders({}), {})
  assert.deepEqual(authHeaders({ authType: 'none' }), {})
  assert.deepEqual(authHeaders({ authType: 'apiKey', authHeaderName: 'X-Key', authHeaderValue: 'k' }), { 'X-Key': 'k' })
  assert.deepEqual(authHeaders({ authType: 'apiKey', authHeaderValue: 'k' }), { Authorization: 'k' })
  assert.deepEqual(authHeaders({ authType: 'bearer', bearerToken: 't' }), { Authorization: 'Bearer t' })
  assert.deepEqual(authHeaders({ authType: 'basic', basicUser: 'u', basicPassword: 'p' }), { Authorization: `Basic ${Buffer.from('u:p').toString('base64')}` })
  assert.equal(authHeaders({ authType: 'hmac', hmacSecret: 's' }), null)
})
