import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gmailMustUseGoogle } from './google-login'

test('gmailMustUseGoogle: Cloud only - on Self-hosted Gmail is also a password account (one account per installation)', () => {
  assert.equal(gmailMustUseGoogle(' A@Gmail.com ', {}), true)
  assert.equal(gmailMustUseGoogle('a@example.com', {}), false)
  assert.equal(gmailMustUseGoogle('a@gmail.com', { AITALK_EDITION: 'selfhosted', GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'y' }), false)
})
