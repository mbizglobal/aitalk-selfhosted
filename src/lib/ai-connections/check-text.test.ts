import { test } from 'node:test'
import assert from 'node:assert/strict'
import { maskSecrets } from './check'
import { translations as en } from '@/lib/translations/dashboard/en'
import { translations as de } from '@/lib/translations/dashboard/de'
import { translations as fr } from '@/lib/translations/dashboard/fr'
import { translations as ko } from '@/lib/translations/dashboard/ko'

test('check result error message - masks key-like strings', () => {
  assert.equal(maskSecrets('401 — Incorrect API key provided: sk-proj-abc123*******xyz9.'), '401 — Incorrect API key provided: [hidden]')
  assert.match(maskSecrets('key xai-AbCdEf123456 bad'), /\[hidden\]/)
  assert.match(maskSecrets('token abcdefghijklmnopqrstuvwxyz0123 here'), /\[hidden\]/)
  assert.equal(maskSecrets('404 model not found'), '404 model not found')
  assert.equal(maskSecrets('header Authorization: Bearer abc.def'), 'header Authorization: Bearer [hidden]')
  assert.match(maskSecrets('token eyJhbGciOi.eyJzdWIiOi/x+y=z123456 end'), /token \[hidden\] end/)
})

test('translations - AI connection keys exist identically in all four languages', () => {
  const keys = (t: any) => Object.keys(t[Object.keys(t)[0]]).filter((k) => k.startsWith('aic_') || k === 'settings_tab_ai_connections').sort()
  const [a, b, c, d] = [en, de, fr, ko].map(keys)
  assert.ok(a.length >= 40, String(a.length))
  assert.deepEqual(b, a); assert.deepEqual(c, a); assert.deepEqual(d, a)
})
