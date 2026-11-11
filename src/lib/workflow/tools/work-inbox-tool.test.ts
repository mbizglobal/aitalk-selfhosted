import { test } from 'node:test'
import assert from 'node:assert/strict'
import { channelIdentityKind, resolveInboxIdentity } from './work-inbox-tool'

const pstn = (callerNumber: unknown) => ({ callChannel: 'pstn' as const, callerNumber: callerNumber as string })

test('phone - only the number of a pstn call; hidden, malformed or long = none', () => {
  assert.deepEqual(resolveInboxIdentity('pstn', null, pstn('+41 79 123 45 67')), { by: 'phone', value: '+41791234567' })
  for (const bad of ['4:anonymous', 'anonymous', '', '   ', null, undefined, '+1234567', '+1234567890123456', '0041791234567', `+41${'1'.repeat(40)}`]) {
    assert.equal(resolveInboxIdentity('pstn', null, pstn(bad)), null, String(bad))
  }
  assert.equal(resolveInboxIdentity('pstn', null, undefined), null)
})

test('phone path but call context not pstn = none; web voice, chatbot, test = none', () => {
  assert.equal(resolveInboxIdentity('pstn', null, { callChannel: 'web_voice', callerNumber: '+41791234567' }), null)
  for (const ch of ['web_voice', 'chat', 'test'] as const) assert.equal(resolveInboxIdentity(ch, null, pstn('+41791234567')), null, ch)
})

test('telegram - only the value fixed at creation (call context number ignored)', () => {
  assert.deepEqual(resolveInboxIdentity('telegram', '12345', pstn('+41791234567')), { by: 'telegram', value: '12345' })
  assert.equal(resolveInboxIdentity('telegram', null, pstn('+41791234567')), null)
})

test('channels that get the read function - phone = phone, telegram = telegram, others = none', () => {
  assert.equal(channelIdentityKind('pstn'), 'phone')
  assert.equal(channelIdentityKind('telegram'), 'telegram')
  for (const ch of ['web_voice', 'chat', 'test', undefined] as const) assert.equal(channelIdentityKind(ch), null)
})
