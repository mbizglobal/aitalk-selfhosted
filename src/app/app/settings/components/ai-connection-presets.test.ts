import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AI_CONNECTION_PRESETS, ALL_AI_CONNECTION_PRESETS, connectionLabelOf, hasUrlPlaceholder, shouldShowModelSizeNote } from './ai-connection-presets'

test('shown connection type - company name - only own servers and others are OpenAI-compatible', () => {
  assert.equal(connectionLabelOf('openai_compatible', 'https://api.openai.com/v1'), 'openai')
  assert.equal(connectionLabelOf('openai_compatible', ' HTTPS://API.OPENAI.COM/v1 '), 'openai')
  assert.equal(connectionLabelOf('openai_compatible', 'https://generativelanguage.googleapis.com/v1beta/openai/'), 'gemini')
  assert.equal(connectionLabelOf('azure', 'https://x.openai.azure.com'), 'azure')
  assert.equal(connectionLabelOf('anthropic', 'https://api.anthropic.com'), 'claude')
  assert.equal(connectionLabelOf('openai_compatible', 'http://host.docker.internal:11434/v1'), 'openai_compatible')
  assert.equal(connectionLabelOf('openai_compatible', 'https://api.openai.com.evil.example/v1'), 'openai_compatible')
  assert.equal(connectionLabelOf('openai_compatible', ''), 'openai_compatible')
  assert.equal(connectionLabelOf('openai_compatible', 'not a url'), 'openai_compatible')
  assert.equal(connectionLabelOf('openai_compatible', 'https://maas.phoeniqs.com/v1'), 'phoeniqs')
  assert.equal(connectionLabelOf('openai_compatible', 'https://api.infomaniak.com/2/ai/123/openai/v1'), 'infomaniak')
  assert.deepEqual(['openai', 'azure', 'gemini', 'claude', 'phoeniqs', 'infomaniak', 'openai_compatible'].map((l) => shouldShowModelSizeNote(l as never)), [false, false, false, false, true, true, true])
})

test('button order and names - Azure OpenAI (first), OpenAI, Gemini, Claude, hosting (Switzerland), own server - shown connection type per button', () => {
  assert.deepEqual(AI_CONNECTION_PRESETS.map((p) => p.id), ['azure', 'openai', 'gemini', 'anthropic', 'infomaniak', 'own_server'])
  assert.deepEqual(ALL_AI_CONNECTION_PRESETS.filter((p) => p.off).map((p) => p.id), ['phoeniqs'])
  assert.deepEqual(AI_CONNECTION_PRESETS.map((p) => p.label).slice(0, 4), ['Azure OpenAI', 'OpenAI', 'Gemini', 'Claude'])
  assert.deepEqual(AI_CONNECTION_PRESETS.map((p) => connectionLabelOf(p.kind, p.baseUrl)), ['azure', 'openai', 'gemini', 'claude', 'infomaniak', 'openai_compatible'])
  assert.deepEqual(AI_CONNECTION_PRESETS.filter((p) => p.hosting).map((p) => `${p.hosting!.country}:${p.id}`), ['CH:infomaniak'])
})

test('address placeholder - <product_id>, other cases and encoded forms block saving, a real number passes', () => {
  for (const u of ['https://api.infomaniak.com/2/ai/<product_id>/openai/v1', 'https://api.infomaniak.com/2/ai/<Product_ID>/openai/v1', 'https://api.infomaniak.com/2/ai/%3Cproduct_id%3E/openai/v1', 'https://api.infomaniak.com/2/ai/%3cx%3e/openai/v1']) assert.equal(hasUrlPlaceholder(u), true, u)
  for (const u of ['https://api.infomaniak.com/2/ai/104233/openai/v1', 'https://maas.phoeniqs.com/v1', '']) assert.equal(hasUrlPlaceholder(u), false, u)
  assert.equal(hasUrlPlaceholder(AI_CONNECTION_PRESETS.find((p) => p.id === 'infomaniak')!.baseUrl), true)
})
