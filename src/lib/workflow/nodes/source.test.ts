import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PrismaClient } from '@prisma/client'
import { sourceNodeExecutor, SourceNodeExecutor } from './source'
import { WorkflowContext, WorkflowNode } from '../types'

//
//

const STALE_AZURE_CONFIG = {
  regionId: 'swedencentral',
  indexName: 'managed-swedencentral',
  agentId: 'other-agent',
  ragSpace: '77',
  ragSpaceIncludeNull: false,
}

const sourceNode = (): WorkflowNode => ({
  id: 'source-1',
  type: 'tool',
  data: { nodeType: 'file-search', toolType: 'source', label: 'Source' },
  position: { x: 0, y: 0 },
} as unknown as WorkflowNode)

const staleContext = (): WorkflowContext => ({
  userId: 'user-1',
  agentId: 'agent-1',
  message: 'hello',
  azureSearchConfig: { ...STALE_AZURE_CONFIG },
} as unknown as WorkflowContext)

const ragGateOpen = (ctx: WorkflowContext) =>
  ctx.ragProvider === 'azure_ai_search' && !!ctx.azureSearchConfig

const prismaStub = (subscription: unknown, ragProviders: unknown = null) => ({
  ragProviders: { findUnique: async () => ragProviders },
  subscription: { findUnique: async () => subscription },
  agent: { findUnique: async () => null },
  ragSpace: { findFirst: async () => ({ id: 5, isDefault: true }), create: async () => ({ id: 5, isDefault: true }) },
}) as unknown as PrismaClient

const MANAGED = { serviceVariant: 'managed', managedRegion: 'switzerlandnorth' }

const executorWithAzureConfig = (loader: () => Promise<unknown>) =>
  new SourceNodeExecutor(loader as unknown as typeof import('@/lib/managed/api-key').getManagedAzureConfig)

// ========================================
// ========================================

test('Managed region not configured: the failure return drops the previous azureSearchConfig', async () => {
  const result = await sourceNodeExecutor.execute(
    sourceNode(),
    staleContext(),
    prismaStub({ serviceVariant: 'managed', managedRegion: null })
  )

  assert.equal(result.context.ragProvider, 'azure_ai_search')
  assert.equal(
    result.context.azureSearchConfig,
    undefined,
    'stale 설정이 남으면 옛 인덱스·ragSpace 로 검색이 성공해 엉뚱한 문서를 근거로 쓴다'
  )
  assert.equal(ragGateOpen(result.context), false, '소비 게이트가 닫혀야 한다')
})

test('Azure AI Search not configured in the region: the failure return drops the previous azureSearchConfig', async () => {
  const result = await executorWithAzureConfig(
    async () => ({ apiKey: 'k', endpoint: 'https://e', apiVersion: 'v' })
  ).execute(sourceNode(), staleContext(), prismaStub(MANAGED))

  assert.equal(result.context.ragProvider, 'azure_ai_search')
  assert.equal(result.context.azureSearchConfig, undefined)
  assert.equal(ragGateOpen(result.context), false)
})

test('Azure initialization exception: the failure return drops the previous azureSearchConfig', async () => {
  const result = await executorWithAzureConfig(
    async () => { throw new Error('region config unavailable') }
  ).execute(sourceNode(), staleContext(), prismaStub(MANAGED))

  assert.equal(result.context.ragProvider, 'azure_ai_search')
  assert.equal(result.context.azureSearchConfig, undefined)
  assert.equal(ragGateOpen(result.context), false)
})

test('a failure return does not mutate the context passed by the caller', async () => {
  const context = staleContext()
  const before = structuredClone(context)

  await sourceNodeExecutor.execute(
    sourceNode(),
    context,
    prismaStub({ serviceVariant: 'managed', managedRegion: null })
  )

  assert.deepEqual(context, before)
})

// ========================================
// ========================================

test('Azure success: overwrites stale with the current run\'s values and opens the gate', async () => {
  const result = await executorWithAzureConfig(
    async () => ({ apiKey: 'k', endpoint: 'https://e', apiVersion: 'v', searchApiKey: 's', searchEndpoint: 'https://s' })
  ).execute(sourceNode(), staleContext(), prismaStub(MANAGED))

  assert.equal(ragGateOpen(result.context), true)
  assert.deepEqual(result.context.azureSearchConfig, {
    regionId: 'switzerlandnorth',
    indexName: 'managed-switzerlandnorth',
    agentId: 'agent-1',
    ragSpace: '5',
    ragSpaceIncludeNull: true,
  })
  assert.notDeepEqual(
    result.context.azureSearchConfig,
    STALE_AZURE_CONFIG,
    'stale 이 그대로 살아남으면 안 된다'
  )
})

test('RAG not configured (none): does not erase the stale config, but the gate closes by provider', async () => {
  const result = await sourceNodeExecutor.execute(
    sourceNode(),
    staleContext(),
    prismaStub(
      { serviceVariant: 'self', managedRegion: null },
      { defaultProvider: 'none' }
    )
  )

  assert.equal(result.context.ragProvider, 'none')
  assert.deepEqual(result.context.azureSearchConfig, STALE_AZURE_CONFIG)
  assert.equal(ragGateOpen(result.context), false)
})
