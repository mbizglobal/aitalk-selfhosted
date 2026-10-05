import crypto from 'node:crypto'
import { AzureAISearchClient, type AzureAISearchConfig } from '@/lib/rag-providers/clients/azure-ai-search'
import type { AzureKnowledgeRef, KnowledgeStore } from './index'
import { attachSources, type StorageLookup } from './sources'

function requireAgent(agentId: string): string {
  if (!agentId) throw new Error('[Knowledge] agentId is required for data isolation')
  return agentId
}

export function contentHashOf(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)
}

export function createAzureKnowledgeStore(config: AzureAISearchConfig, client = new AzureAISearchClient(config), lookup?: StorageLookup): KnowledgeStore<AzureKnowledgeRef> {
  const spaceOpts = (s?: { id: string; includeNull: boolean }) =>
    s ? { ragSpace: s.id, includeNullSpace: s.includeNull } : undefined

  return {
    provider: 'azure_ai_search',

    async ingest(scope, doc, opts) {
      const agentId = requireAgent(scope.agentId)
      const buffer = Buffer.isBuffer(doc.file) ? doc.file : Buffer.from(await (doc.file as Blob).arrayBuffer())
      const indexName = client.getSharedIndexName()
      const r = await client.uploadFile(indexName, buffer, doc.fileName, doc.mimeType, {
        userId: doc.userId,
        agentId,
        storageId: String(doc.storageId),
        ...(doc.blobPath !== undefined && { blobPath: doc.blobPath }),
        ...(doc.ragSpace !== undefined && { ragSpace: doc.ragSpace }),
      }, opts?.signal ? { signal: opts.signal } : undefined)
      return {
        chunkCount: r.chunkCount || 0,
        pageCount: r.pageCount,
        textSize: r.textSize,
        providerRef: { indexName, fileId: r.fileId, chunkCount: r.chunkCount || 0, contentHash: contentHashOf(buffer) },
      }
    },

    async search(scope, query, topK) {
      const agentId = requireAgent(scope.agentId)
      const raw = await client.search(agentId, query, topK, spaceOpts(scope.ragSpace))
      const hits = raw.map((h) => ({
        id: h.id,
        content: h.content,
        score: h.score,
        source: {
          storageId: h.metadata?.storageId != null && h.metadata.storageId !== '' ? String(h.metadata.storageId) : null,
          title: h.metadata?.title ?? '',
          chunkIndex: Number.isInteger(h.metadata?.chunkIndex) ? (h.metadata!.chunkIndex as number) : null,
          version: null,
          ...(h.metadata?.blobPath && { blobPath: h.metadata.blobPath as string }),
        },
      }))
      return attachSources(agentId, hits, lookup)
    },

    async deleteDoc(scope, storageId, ref, opts) {
      const agentId = requireAgent(scope.agentId)
      if (ref?.fileId && ref.chunkCount > 0) {
        opts?.onStep?.('chunks-by-key')
        await client.deleteChunksByKey(agentId, ref.fileId, ref.chunkCount, opts?.signal ? { signal: opts.signal } : undefined)
      }
      opts?.onStep?.('chunks-by-filter')
      await client.deleteFile(agentId, storageId, opts?.signal ? { signal: opts.signal } : undefined)
    },

    deleteAgent: (agentId) => client.deleteByAgent(requireAgent(agentId)),

    async deleteUser(userId) {
      if (!userId) throw new Error('[Knowledge] userId is required')
      await client.deleteByUser(userId)
    },

    listChunks: (scope, opts) => client.listChunks(requireAgent(scope.agentId), { ...spaceOpts(scope.ragSpace), ...opts }),
  }
}
