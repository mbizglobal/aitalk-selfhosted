import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isChannelEnabledForCalendarNode } from './load-agent-tools'

test('\'existing channels are allowed when enabledChannels is absent\'', () => {
  assert.equal(isChannelEnabledForCalendarNode({}, 'chat_widget'), true)
  assert.equal(isChannelEnabledForCalendarNode({ enabledChannels: { pstn: false } }, 'web_voice'), true)
  assert.equal(isChannelEnabledForCalendarNode({ enabledChannels: { pstn: false } }, 'pstn'), false)
})

test('\'booking_widget is allowed only when explicitly true\'', () => {
  assert.equal(isChannelEnabledForCalendarNode({}, 'booking_widget'), false)
  assert.equal(isChannelEnabledForCalendarNode({ enabledChannels: {} }, 'booking_widget'), false)
  assert.equal(isChannelEnabledForCalendarNode({ enabledChannels: { bookingWidget: 'true' } }, 'booking_widget'), false)
  assert.equal(isChannelEnabledForCalendarNode({ enabledChannels: { bookingWidget: true } }, 'booking_widget'), true)
})
