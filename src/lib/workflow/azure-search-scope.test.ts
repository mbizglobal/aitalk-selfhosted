
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { managedIndexName } from './azure-search-scope'
import { tryGetKnowledgeStore } from '@/lib/knowledge'
import { AzureAISearchClient } from '@/lib/rag-providers/clients/azure-ai-search'

describe('tryGetKnowledgeStore: fail-closed (contract of the old createManagedSearchClient)', () => {
  it('returns null when there is no regionId (does not throw)', async () => {
    assert.equal(await tryGetKnowledgeStore({ regionId: undefined }), null)
    assert.equal(await tryGetKnowledgeStore({ regionId: '' }), null)
  })

  it('an unknown region returns null; skips only RAG without killing the node', async () => {
    assert.equal(await tryGetKnowledgeStore({ regionId: 'no-such-region-xyz' }), null)
  })
})

describe('managedIndexName: rules do not diverge from the client', () => {
  const sample = ['switzerlandnorth', 'swedencentral', 'Switzerland North', 'eu-west_1']

  for (const regionId of sample) {
    it(`"${regionId}": same value as getSharedIndexName()`, () => {
      const client = new AzureAISearchClient({
        searchApiKey: 'x',
        searchEndpoint: 'https://example.invalid',
        openaiApiKey: 'x',
        openaiEndpoint: 'https://example.invalid',
        openaiApiVersion: 'x',
        regionId,
      } as any)

      assert.equal(
        managedIndexName(regionId),
        client.getSharedIndexName(),
        '인덱스명 규칙이 갈렸다 — 조회는 성공하는데 결과가 0건이 된다',
      )
    })
  }
})
