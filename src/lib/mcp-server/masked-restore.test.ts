import { test } from 'node:test'
import assert from 'node:assert/strict'
import { restoreMaskedSecrets } from './masked-restore'
import { maskSecrets } from './tools'

const MASK = '***masked***'
const asReturned = (data: unknown) => maskSecrets(structuredClone(data))

test('restore: an unchanged round trip fully restores the stored original values', () => {
  const stored = { nodes: [{ id: 'h1', data: { nodeType: 'httpRequest', bearerToken: 'sk-real-secret', url: 'https://api.example.com' } }] }
  const incoming = { nodes: [{ id: 'h1', data: asReturned(stored.nodes[0].data) }] }
  assert.equal((incoming.nodes[0].data as any).bearerToken, MASK, '전제: 반환본은 마스킹돼 있다')

  const issues = restoreMaskedSecrets(incoming, stored)
  assert.deepEqual(issues, [])
  assert.equal((incoming.nodes[0].data as any).bearerToken, 'sk-real-secret')
  assert.equal((incoming.nodes[0].data as any).url, 'https://api.example.com')
})

test('restore: an unchanged round trip of nested objects and arrays (header pairs) is also restored', () => {
  const stored = {
    nodes: [{ id: 'h1', data: { headers: [{ key: 'Authorization', value: 'Bearer real' }, { key: 'Accept', value: 'json' }] } }],
  }
  const incoming = { nodes: [{ id: 'h1', data: asReturned(stored.nodes[0].data) }] }
  const issues = restoreMaskedSecrets(incoming, stored)
  assert.deepEqual(issues, [])
  assert.equal((incoming.nodes[0].data as any).headers[0].value, 'Bearer real')
  assert.equal((incoming.nodes[0].data as any).headers[1].value, 'json')
})

test('security: editing a sibling field (url) cannot send a real secret to an attacker\'s server (exfiltration vector)', () => {
  const stored = { nodes: [{ id: 'h1', data: { nodeType: 'httpRequest', url: 'https://api.trusted.com/v1', bearerToken: 'sk-users-real-token' } }] }
  const evil = asReturned(stored.nodes[0].data) as Record<string, unknown>
  evil.url = 'https://evil.example/collect'
  const incoming = { nodes: [{ id: 'h1', data: evil }] }

  const issues = restoreMaskedSecrets(incoming, stored)
  assert.equal(issues.length, 1)
  assert.match(issues[0].message, /has been modified/)
  assert.equal((incoming.nodes[0].data as any).bearerToken, MASK, '실토큰이 복원되면 안 된다')
})

test('security: reordering an array does not cross-restore secrets (cross vector)', () => {
  const stored = {
    nodes: [{ id: 'h1', data: { headers: [{ key: 'Authorization', value: 'Bearer A' }, { key: 'X-API-Key', value: 'Key B' }] } }],
  }
  const returned = asReturned(stored.nodes[0].data) as any
  const swapped = { headers: [returned.headers[1], returned.headers[0]] }
  const incoming = { nodes: [{ id: 'h1', data: swapped }] }

  const issues = restoreMaskedSecrets(incoming, stored)
  assert.equal(issues.length, 1)
  assert.equal((incoming.nodes[0].data as any).headers[0].value, MASK, '교차 복원되면 안 된다')
})

test('security: a secret of another node cannot be stolen with the same key (mask laundering)', () => {
  const stored = {
    nodes: [
      { id: 'h1', data: { apiKey: 'sk-victim-secret' } },
      { id: 'h2', data: { note: 'no secret here' } },
    ],
  }
  const incoming = { nodes: [{ id: 'h2', data: { note: 'no secret here', apiKey: MASK } }] }
  const issues = restoreMaskedSecrets(incoming, stored)
  assert.equal(issues.length, 1)
  assert.equal((incoming.nodes[0].data as any).apiKey, MASK)
})

test('prevents silent discarding: editing another part of a string holding a secret is rejected (not silently reverted)', () => {
  const stored = { nodes: [{ id: 'a1', data: { systemMessage: 'Call https://x.com/?api_key=real123 then greet politely.' } }] }
  const returned = asReturned(stored.nodes[0].data) as any
  assert.ok(returned.systemMessage.includes(MASK), '전제: 프로즈 안 URL 비밀이 마스킹된다')
  const edited = { systemMessage: returned.systemMessage.replace('politely', 'WARMLY in German') }
  const incoming = { nodes: [{ id: 'a1', data: edited }] }

  const issues = restoreMaskedSecrets(incoming, stored)
  assert.equal(issues.length, 1)
  assert.match(issues[0].message, /has been modified/)
  assert.equal((incoming.nodes[0].data as any).systemMessage, edited.systemMessage, '편집을 조용히 덮어쓰지 않는다')
})

test('restore: a mask on a new node is rejected (cannot be resolved)', () => {
  const incoming = { nodes: [{ id: 'new-node', data: { apiKey: MASK } }] }
  const issues = restoreMaskedSecrets(incoming, { nodes: [{ id: 'other', data: { apiKey: 'real' } }] })
  assert.equal(issues.length, 1)
  assert.equal(issues[0].nodeId, 'new-node')
  assert.match(issues[0].message, /no stored node with this id/)
  assert.equal((incoming.nodes[0].data as any).apiKey, MASK)
})

test('restore: nodes without masks can be edited freely (pass through unchanged)', () => {
  const incoming = { nodes: [{ id: 'a', data: { systemMessage: 'hello', nested: { x: [1, 'two'] } } }] }
  const snapshot = JSON.stringify(incoming)
  const issues = restoreMaskedSecrets(incoming, { nodes: [] })
  assert.deepEqual(issues, [])
  assert.equal(JSON.stringify(incoming), snapshot)
})

test('restore: if the masked node is unchanged, edits to other nodes in the same request are allowed', () => {
  const stored = {
    nodes: [
      { id: 'h1', data: { bearerToken: 'sk-real' } },
      { id: 'a1', data: { systemMessage: 'old' } },
    ],
  }
  const incoming = {
    nodes: [
      { id: 'h1', data: asReturned(stored.nodes[0].data) },
      { id: 'a1', data: { systemMessage: 'new instructions' } },
    ],
  }
  const issues = restoreMaskedSecrets(incoming, stored)
  assert.deepEqual(issues, [])
  assert.equal((incoming.nodes[0].data as any).bearerToken, 'sk-real')
  assert.equal((incoming.nodes[1].data as any).systemMessage, 'new instructions')
})
