import { isSelfHosted } from '@/lib/edition'
import type { AzureAISearchConfig } from '@/lib/rag-providers/clients/azure-ai-search'
import { createAzureKnowledgeStore } from './azure'
import { createPgvectorKnowledgeStore, type PgvectorRef } from './pgvector'

export function selfHostedKnowledgeKind(env: Record<string, string | undefined> = process.env): 'pgvector' | 'http_search' {
  const v = (env.KNOWLEDGE_STORE ?? '').trim().toLowerCase()
  if (!v || v === 'pgvector') return 'pgvector'
  if (v === 'http') {
    if (!env.KNOWLEDGE_HTTP_URL?.trim() || !env.KNOWLEDGE_HTTP_SECRET?.trim()) throw new KnowledgeStoreUnavailable('KNOWLEDGE_STORE=http needs KNOWLEDGE_HTTP_URL and KNOWLEDGE_HTTP_SECRET')
    return 'http_search'
  }
  throw new KnowledgeStoreUnavailable(`KNOWLEDGE_STORE must be "pgvector" or "http" (got "${v.slice(0, 20)}")`)
}

export const SELFHOSTED_REGION = 'local'

export function knowledgeTargetFor(sub: { serviceVariant?: string | null; managedRegion?: string | null } | null | undefined):
  { provider: KnowledgeProvider; regionId: string } | null {
  if (isSelfHosted()) return { provider: selfHostedKnowledgeKind(), regionId: SELFHOSTED_REGION }
  if (sub?.serviceVariant === 'managed' && sub.managedRegion) return { provider: 'azure_ai_search', regionId: sub.managedRegion }
  return null
}

async function selfHostedKnowledgeStore(): Promise<KnowledgeStore> {
  if (selfHostedKnowledgeKind() === 'http_search') {
    const { createHttpSearchKnowledgeStore } = await import('./http')
    return createHttpSearchKnowledgeStore({ url: process.env.KNOWLEDGE_HTTP_URL!.trim(), secret: process.env.KNOWLEDGE_HTTP_SECRET!.trim(), installId: process.env.KNOWLEDGE_HTTP_INSTALL_ID?.trim() || 'default' })
  }
  const { prisma } = await import('@/lib/prisma')
  return createPgvectorKnowledgeStore({
    db: prisma,
    readImages: async () => {
      const { defaultAiConnectionDeps, resolveAiConnection, createConnectionClient } = await import('@/lib/ai-connections')
      const r = await resolveAiConnection(await defaultAiConnectionDeps())
      if (!r.ok || !r.connection.imageModel) return null
      const { makeImageReader } = await import('@/lib/workflow/nodes/ai/read-images')
      return makeImageReader(createConnectionClient(r.connection), r.connection.imageModel, {} as never)
    },
  })
}

export interface KnowledgeScope {
  agentId: string
  ragSpace?: { id: string; includeNull: boolean }
}

export interface KnowledgeSource {
  storageId: string | null
  title: string
  chunkIndex: number | null
  version: string | null
  blobPath?: string
  external?: { id: string; url?: string }
}

export interface KnowledgeHit {
  id: string
  content: string
  score: number
  source: KnowledgeSource
}

export interface AzureKnowledgeRef { indexName: string; fileId: string; chunkCount: number; contentHash: string }
export type KnowledgeProviderRef = AzureKnowledgeRef | PgvectorRef

export type KnowledgeProvider = 'azure_ai_search' | 'pgvector' | 'http_search'

export interface KnowledgeIngestDoc {
  userId: string
  storageId: string | number
  fileName: string
  file: Buffer | Blob
  mimeType?: string
  blobPath?: string
  ragSpace?: string
}

export interface KnowledgeIngestResult<R extends KnowledgeProviderRef = KnowledgeProviderRef> {
  chunkCount: number
  pageCount?: number
  textSize?: number
  providerRef: R
}

export interface KnowledgeChunk { storageId: string; title: string; chunkIndex: number; content: string }

export interface KnowledgeStore<R extends KnowledgeProviderRef = KnowledgeProviderRef> {
  readonly provider: KnowledgeProvider
  ingest(scope: KnowledgeScope, doc: KnowledgeIngestDoc, opts?: { signal?: AbortSignal }): Promise<KnowledgeIngestResult<R>>
  search(scope: KnowledgeScope, query: string, topK: number): Promise<KnowledgeHit[]>
  deleteDoc(scope: KnowledgeScope, storageId: string, ref?: { fileId: string; chunkCount: number } | null,
    opts?: { signal?: AbortSignal; onStep?: (step: 'chunks-by-key' | 'chunks-by-filter') => void }): Promise<void>
  deleteAgent(agentId: string): Promise<void>
  deleteUser(userId: string): Promise<void>
  listChunks(scope: KnowledgeScope, opts?: { storageId?: number; maxChunks?: number }): Promise<KnowledgeChunk[]>
}

export interface KnowledgeContext {
  regionId?: string | null
  docIntelligence?: boolean
  allowSelfHosted?: boolean
}

export class KnowledgeStoreUnavailable extends Error {
  code = 'AZURE_SEARCH_NOT_CONFIGURED'
  constructor(message: string) { super(message); this.name = 'KnowledgeStoreUnavailable' }
}

export async function getKnowledgeStore(ctx: KnowledgeContext & { allowSelfHosted: true }): Promise<KnowledgeStore>
export async function getKnowledgeStore(ctx: KnowledgeContext): Promise<KnowledgeStore<AzureKnowledgeRef>>
export async function getKnowledgeStore(ctx: KnowledgeContext): Promise<KnowledgeStore> {
  if (isSelfHosted()) {
    if (ctx.allowSelfHosted) return selfHostedKnowledgeStore()
    throw new KnowledgeStoreUnavailable('Document search is not available here in the self-hosted version yet')
  }
  const regionId = ctx.regionId
  if (!regionId) throw new KnowledgeStoreUnavailable('No managed region — document search is not configured')
  const { getManagedAzureConfig } = await import('@/lib/managed/api-key')
  const cfg = await getManagedAzureConfig(regionId)
  if (!cfg.searchApiKey || !cfg.searchEndpoint) {
    throw new KnowledgeStoreUnavailable(`Azure AI Search is not configured for region ${regionId}`)
  }
  return createAzureKnowledgeStore({
    searchApiKey: cfg.searchApiKey,
    searchEndpoint: cfg.searchEndpoint,
    openaiApiKey: cfg.apiKey,
    openaiEndpoint: cfg.endpoint,
    openaiApiVersion: cfg.apiVersion,
    regionId,
    ...(ctx.docIntelligence && {
      docIntelligenceKey: cfg.docIntelligenceKey,
      docIntelligenceEndpoint: cfg.docIntelligenceEndpoint,
    }),
  })
}

export async function tryGetKnowledgeStore(ctx: KnowledgeContext & { allowSelfHosted: true }, label?: string): Promise<KnowledgeStore | null>
export async function tryGetKnowledgeStore(ctx: KnowledgeContext, label?: string): Promise<KnowledgeStore<AzureKnowledgeRef> | null>
export async function tryGetKnowledgeStore(ctx: KnowledgeContext, label = 'Knowledge'): Promise<KnowledgeStore | null> {
  try {
    return await getKnowledgeStore(ctx)
  } catch (e) {
    if (e instanceof KnowledgeStoreUnavailable) console.warn(`[${label}] document search skipped: ${e.message}`)
    else console.error(`[${label}] document search config lookup failed —`, e instanceof Error ? e.message : e)
    return null
  }
}

export function knowledgeStoreFromAzureConfig(config: AzureAISearchConfig): KnowledgeStore {
  return createAzureKnowledgeStore(config)
}
