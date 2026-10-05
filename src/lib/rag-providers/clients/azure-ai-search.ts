
import { randomUUID } from 'crypto'
import { BaseRAGClient } from './base'
import {
  RAGSearchResult,
  RAGUploadResult,
  RAGStoreInfo,
} from '../types'
import { describeCaughtError, describeUpstreamError, safeLogDigest } from '@/lib/log-mask'
import {
  isBinaryFileType,
  isBinaryFileExtension,
  extractTextFromBinary,
  type DocIntelligenceResult,
} from '@/lib/managed/doc-intelligence'

const AZURE_SEARCH_API_VERSION = '2024-07-01'
const EMBEDDING_MODEL = 'text-embedding-3-small'

const RETRYABLE_INDEX_STATUS = new Set([409, 422, 429, 503])

const sleepBackoff = (attempt: number) => new Promise(r => setTimeout(r, 500 * 2 ** (attempt - 1)))

export function azureDocKeyAgentPrefix(agentId: string): string {
  const prefix = agentId.substring(0, 15)
  return prefix.startsWith('_') ? `-${prefix.slice(1)}` : prefix
}
const EMBEDDING_DIMENSION = 1536
const CHUNK_SOFT_LIMIT = 1500
const CHUNK_HARD_LIMIT = 2000
const CHUNK_OVERLAP = 200

const ragSpaceFieldEnsured = new Map<string, Promise<void>>()

export function normalizeChunkIndex(v: unknown): number {
  return Number.isInteger(v) ? (v as number) : -1
}

export interface AzureAISearchConfig {
  searchApiKey: string
  searchEndpoint: string   // e.g. https://xxx.search.windows.net
  openaiApiKey: string     // Azure OpenAI API Key
  openaiEndpoint: string   // e.g. https://germanywestcentral.api.cognitive.microsoft.com
  openaiApiVersion: string // e.g. 2024-12-01-preview
  regionId: string
  docIntelligenceKey?: string      // Document Intelligence API Key
  docIntelligenceEndpoint?: string
}

export interface AzureUploadMeta {
  userId: string
  agentId: string
  storageId: string
  blobPath?: string
  ragSpace?: string
}

export class AzureAISearchClient extends BaseRAGClient {
  private config: AzureAISearchConfig

  constructor(config: AzureAISearchConfig) {
    super(config.searchApiKey, 'azure_ai_search')
    this.config = config
  }

  getSharedIndexName(): string {
    const sanitized = this.config.regionId.replace(/[^a-z0-9-]/gi, '').toLowerCase()
    return `managed-${sanitized}`
  }

  private async searchRequest(path: string, method: string, body?: any, signal?: AbortSignal): Promise<any> {
    const url = `${this.config.searchEndpoint}${path}?api-version=${AZURE_SEARCH_API_VERSION}`
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'api-key': this.config.searchApiKey,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    })

    if (!res.ok) {
      const errorSummary = describeUpstreamError(res.status, await res.text())
      const err = new Error(`Azure AI Search ${method} ${path} failed — ${errorSummary}`) as Error & { status?: number }
      err.status = res.status
      throw err
    }

    if (res.status === 204) return null
    return res.json()
  }

  private async getEmbeddings(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    const url = `${this.config.openaiEndpoint}/openai/deployments/${EMBEDDING_MODEL}/embeddings?api-version=${this.config.openaiApiVersion}`

    const results: number[][] = []
    const batchSize = 16
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize)
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.config.openaiApiKey,
        },
        body: JSON.stringify({ input: batch }),
        signal,
      })

      if (!res.ok) {
        const errorText = await res.text()
        throw new Error(`Azure OpenAI Embedding failed — ${describeUpstreamError(res.status, errorText)}`)
      }

      const data = await res.json()
      for (const item of data.data) {
        results.push(item.embedding)
      }
    }
    return results
  }

  private chunkText(text: string): string[] {
    const chunks: string[] = []

    const sections = this.splitBySections(text)

    let currentChunk = ''

    for (const section of sections) {
      const trimmed = section.trim()
      if (!trimmed) continue

      const isNewSection = /^#{1,6}\s|^[-*]{3,}\s*$/.test(trimmed.split('\n')[0])

      if (isNewSection && currentChunk.length > 0) {
        chunks.push(currentChunk)
        currentChunk = ''
      }

      if (currentChunk.length + trimmed.length + 2 <= CHUNK_SOFT_LIMIT) {
        currentChunk = currentChunk ? `${currentChunk}\n\n${trimmed}` : trimmed
        continue
      }

      if (currentChunk.length + trimmed.length + 2 <= CHUNK_HARD_LIMIT && !isNewSection) {
        currentChunk = currentChunk ? `${currentChunk}\n\n${trimmed}` : trimmed
        continue
      }

      if (currentChunk.length > 0) {
        chunks.push(currentChunk)
        currentChunk = ''
      }

      if (trimmed.length <= CHUNK_HARD_LIMIT) {
        currentChunk = trimmed
        continue
      }

      this.splitLargeSection(trimmed, chunks, (remaining) => { currentChunk = remaining })
    }

    if (currentChunk.trim().length > 0) {
      chunks.push(currentChunk)
    }

    return chunks.filter(c => c.trim().length > 0)
  }

  private splitBySections(text: string): string[] {
    const lines = text.split('\n')
    const sections: string[] = []
    let currentSection: string[] = []

    for (const line of lines) {
      const trimmedLine = line.trim()

      const isHeading = /^#{1,6}\s/.test(trimmedLine)
      const isDivider = /^[-*]{3,}\s*$/.test(trimmedLine) && trimmedLine.length >= 3

      if ((isHeading || isDivider) && currentSection.length > 0) {
        sections.push(currentSection.join('\n'))
        currentSection = []
      }

      if (isDivider) continue

      currentSection.push(line)
    }

    if (currentSection.length > 0) {
      sections.push(currentSection.join('\n'))
    }

    return sections
  }

  private splitLargeSection(
    text: string,
    chunks: string[],
    setRemaining: (remaining: string) => void
  ): void {
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0)
    let currentChunk = ''

    for (const paragraph of paragraphs) {
      const trimmed = paragraph.trim()

      if (currentChunk.length + trimmed.length + 2 <= CHUNK_SOFT_LIMIT) {
        currentChunk = currentChunk ? `${currentChunk}\n\n${trimmed}` : trimmed
        continue
      }

      if (currentChunk.length + trimmed.length + 2 <= CHUNK_HARD_LIMIT) {
        currentChunk = currentChunk ? `${currentChunk}\n\n${trimmed}` : trimmed
        continue
      }

      if (currentChunk.length > 0) {
        chunks.push(currentChunk)
        currentChunk = ''
      }

      if (trimmed.length <= CHUNK_HARD_LIMIT) {
        currentChunk = trimmed
        continue
      }

      this.splitBySentences(trimmed, chunks, (remaining) => { currentChunk = remaining })
    }

    setRemaining(currentChunk)
  }

  private splitBySentences(
    text: string,
    chunks: string[],
    setRemaining: (remaining: string) => void
  ): void {
    const sentences = text.split(/(?<=[.!?。！？\n])\s+/)
    let currentChunk = ''

    for (const sentence of sentences) {
      if (currentChunk.length + sentence.length + 1 <= CHUNK_SOFT_LIMIT) {
        currentChunk = currentChunk ? `${currentChunk} ${sentence}` : sentence
      } else if (currentChunk.length + sentence.length + 1 <= CHUNK_HARD_LIMIT) {
        currentChunk = currentChunk ? `${currentChunk} ${sentence}` : sentence
      } else {
        if (currentChunk.length > 0) {
          chunks.push(currentChunk)
        }
        if (sentence.length > CHUNK_HARD_LIMIT) {
          let start = 0
          while (start < sentence.length) {
            const end = Math.min(start + CHUNK_SOFT_LIMIT, sentence.length)
            chunks.push(sentence.substring(start, end))
            start += CHUNK_SOFT_LIMIT - CHUNK_OVERLAP
            if (start >= sentence.length) break
          }
          currentChunk = ''
        } else {
          currentChunk = sentence
        }
      }
    }

    setRemaining(currentChunk)
  }

  private async indexExists(indexName: string, signal?: AbortSignal): Promise<boolean> {
    try {
      const url = `${this.config.searchEndpoint}/indexes/${indexName}?api-version=${AZURE_SEARCH_API_VERSION}`
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'api-key': this.config.searchApiKey },
        signal,
      })
      return res.ok
    } catch (err: any) {
      if (signal?.aborted || err?.name === 'AbortError') throw err
      return false
    }
  }

  private async ensureIndex(indexName: string, signal?: AbortSignal): Promise<void> {
    if (await this.indexExists(indexName, signal)) return

    const indexDefinition = {
      name: indexName,
      fields: [
        { name: 'id', type: 'Edm.String', key: true, filterable: true },
        { name: 'userId', type: 'Edm.String', filterable: true, searchable: false, retrievable: true },
        { name: 'agentId', type: 'Edm.String', filterable: true, searchable: false, retrievable: true },
        { name: 'ragSpace', type: 'Edm.String', filterable: true, searchable: false, retrievable: true },
        { name: 'storageId', type: 'Edm.String', filterable: true, searchable: false, retrievable: true },
        { name: 'content', type: 'Edm.String', searchable: true, retrievable: true },
        { name: 'title', type: 'Edm.String', searchable: true, filterable: true, retrievable: true },
        { name: 'blobPath', type: 'Edm.String', retrievable: true, searchable: false },
        { name: 'chunkIndex', type: 'Edm.Int32', retrievable: true },
        { name: 'contentVector', type: 'Collection(Edm.Single)', searchable: true, retrievable: false,
          dimensions: EMBEDDING_DIMENSION, vectorSearchProfile: 'default-profile' },
        { name: 'createdAt', type: 'Edm.DateTimeOffset', filterable: true, sortable: true, retrievable: true },
      ],
      vectorSearch: {
        algorithms: [
          { name: 'hnsw-algo', kind: 'hnsw', hnswParameters: { m: 4, efConstruction: 400, efSearch: 500, metric: 'cosine' } }
        ],
        profiles: [
          { name: 'default-profile', algorithm: 'hnsw-algo' }
        ],
      },
      semantic: {
        defaultConfiguration: 'default-semantic',
        configurations: [
          {
            name: 'default-semantic',
            prioritizedFields: {
              prioritizedContentFields: [
                { fieldName: 'content' }
              ],
              titleField: { fieldName: 'title' },
            },
          },
        ],
      },
    }

    await this.searchRequest(`/indexes/${indexName}`, 'PUT', indexDefinition, signal)
    console.log(`[AzureAISearch] Created shared index: ${indexName}`)
  }

  async migrateIndexAddRagSpace(signal?: AbortSignal): Promise<{ added: boolean }> {
    const indexName = this.getSharedIndexName()
    if (!(await this.indexExists(indexName, signal))) {
      await this.ensureIndex(indexName, signal)
      return { added: true }
    }

    const url = `${this.config.searchEndpoint}/indexes/${indexName}?api-version=${AZURE_SEARCH_API_VERSION}`
    const res = await fetch(url, { method: 'GET', headers: { 'api-key': this.config.searchApiKey }, signal })
    if (!res.ok) throw new Error(`[AzureAISearch] migrate: failed to GET index ${indexName} (${res.status})`)
    const def: any = await res.json()

    if (Array.isArray(def.fields) && def.fields.some((f: any) => f.name === 'ragSpace')) {
      return { added: false }
    }

    const agentIdx = def.fields.findIndex((f: any) => f.name === 'agentId')
    const ragSpaceField = { name: 'ragSpace', type: 'Edm.String', filterable: true, searchable: false, retrievable: true }
    if (agentIdx >= 0) def.fields.splice(agentIdx + 1, 0, ragSpaceField)
    else def.fields.push(ragSpaceField)

    await this.searchRequest(`/indexes/${indexName}`, 'PUT', def, signal)
    console.log(`[AzureAISearch] Migrated index ${indexName}: added ragSpace field`)
    return { added: true }
  }

  private async ensureRagSpaceField(signal?: AbortSignal): Promise<void> {
    const indexName = this.getSharedIndexName()
    const key = `${this.config.searchEndpoint}::${indexName}`
    const cached = ragSpaceFieldEnsured.get(key)
    if (cached) return cached

    const p = this.migrateIndexAddRagSpace(signal).then(() => undefined)
    ragSpaceFieldEnsured.set(key, p)
    try {
      await p
    } catch (err) {
      ragSpaceFieldEnsured.delete(key)
      throw err
    }
  }

  // =============================================
  // =============================================

  async createStore(name: string): Promise<RAGStoreInfo> {
    const indexName = this.getSharedIndexName()
    await this.ensureIndex(indexName)
    return { id: indexName, name: indexName, provider: 'azure_ai_search' }
  }

  async deleteStore(storeId: string): Promise<void> {
    try {
      await this.searchRequest(`/indexes/${storeId}`, 'DELETE')
      console.log(`[AzureAISearch] Deleted index: ${storeId}`)
    } catch (error) {
      console.warn(`[AzureAISearch] Failed to delete index ${storeId}:`, describeCaughtError(error))
    }
  }

  async getStoreInfo(storeId: string): Promise<RAGStoreInfo> {
    const indexName = this.getSharedIndexName()
    const data = await this.searchRequest(`/indexes/${indexName}`, 'GET')
    return {
      id: indexName,
      name: data.name,
      provider: 'azure_ai_search',
    }
  }

  async uploadFile(
    storeId: string,
    file: Buffer | Blob,
    fileName: string,
    mimeType?: string,
    meta?: AzureUploadMeta,
    options?: { signal?: AbortSignal }
  ): Promise<RAGUploadResult> {
    if (!meta?.agentId) {
      throw new Error('[AzureAISearch] agentId is required for data isolation')
    }

    const signal = options?.signal
    const indexName = this.getSharedIndexName()
    await this.ensureIndex(indexName, signal)
    await this.ensureRagSpaceField(signal)

    let text: string
    let docIntelligenceResult: DocIntelligenceResult | null = null
    const isBinary = mimeType
      ? isBinaryFileType(mimeType)
      : isBinaryFileExtension(fileName)

    if (isBinary && this.config.docIntelligenceKey && this.config.docIntelligenceEndpoint) {
      const buffer = Buffer.isBuffer(file) ? file : Buffer.from(await (file as Blob).arrayBuffer())
      docIntelligenceResult = await extractTextFromBinary(
        buffer,
        this.config.docIntelligenceEndpoint,
        this.config.docIntelligenceKey,
        signal
      )
      text = docIntelligenceResult.text
    } else if (Buffer.isBuffer(file)) {
      text = file.toString('utf-8')
    } else {
      text = await (file as Blob).text()
    }

    const chunks = this.chunkText(text)
    if (chunks.length === 0) {
      return { fileId: fileName, status: 'completed', chunkCount: 0 }
    }

    const embeddings = await this.getEmbeddings(chunks, signal)

    const baseId = fileName.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 60)
    const timestamp = `${Date.now().toString(36)}${randomUUID().replace(/-/g, '')}`

    const documents = chunks.map((chunk, i) => ({
      '@search.action': 'upload',
      id: `${azureDocKeyAgentPrefix(meta.agentId)}_${baseId}_${timestamp}_${i}`,
      userId: meta.userId,
      agentId: meta.agentId,
      ragSpace: meta.ragSpace || '',
      storageId: meta.storageId,
      content: chunk,
      title: fileName,
      blobPath: meta.blobPath || '',
      chunkIndex: i,
      contentVector: embeddings[i],
      createdAt: new Date().toISOString(),
    }))

    await this.indexDocumentsOrRollback(indexName, documents, signal)

    console.log(`[AzureAISearch] Uploaded ${chunks.length} chunks for agent=${meta.agentId}, storage=${meta.storageId}`)

    return {
      fileId: `${baseId}_${timestamp}`,
      status: 'completed',
      chunkCount: chunks.length,
      textSize: Buffer.byteLength(text, 'utf-8'),
      ...(docIntelligenceResult && { pageCount: docIntelligenceResult.pageCount }),
    }
  }

  private async indexDocumentsOrRollback(
    indexName: string,
    documents: Array<Record<string, unknown>>,
    signal?: AbortSignal,
  ): Promise<void> {
    if (documents.length === 0) return
    const MAX_ATTEMPTS = 4
    const batchSize = 1000
    const allKeys = documents.map(d => String(d.id))

    const abortAndThrow = async (reason: string, cause?: unknown): Promise<never> => {
      const leftover = await this.rollbackKeys(indexName, allKeys)
      const suffix = leftover > 0
        ? ` (rollback incomplete — ${leftover} chunks may remain)`
        : ' (rolled back)'
      const err = new Error(`Azure indexing failed: ${reason}${suffix}`) as Error & { cause?: unknown }
      if (cause !== undefined) err.cause = cause
      throw err
    }

    for (let start = 0; start < documents.length; start += batchSize) {
      let batch = documents.slice(start, start + batchSize)

      for (let attempt = 1; ; attempt++) {
        let res: { value?: Array<Record<string, unknown>> } | null = null
        try {
          res = await this.searchRequest(`/indexes/${indexName}/docs/index`, 'POST', { value: batch }, signal)
        } catch (e) {
          const status = (e as { status?: number })?.status
          const aborted = signal?.aborted === true
          if (!aborted && status !== undefined && RETRYABLE_INDEX_STATUS.has(status) && attempt < MAX_ATTEMPTS) {
            console.warn(`[AzureAISearch] index batch HTTP ${status} — 재시도 ${attempt}/${MAX_ATTEMPTS}`)
            await sleepBackoff(attempt)
            continue
          }
          return await abortAndThrow(aborted ? 'aborted during indexing' : `request failed${status ? ` (HTTP ${status})` : ''}`, e)
        }

        const { permanent, retryable } = this.splitDocFailures(res, batch)
        if (permanent.length > 0) {
          return await abortAndThrow(
            `${permanent.length}/${documents.length} chunks rejected: ${permanent.slice(0, 3).join(', ')}`
          )
        }
        if (retryable.length === 0) break
        if (attempt >= MAX_ATTEMPTS) {
          return await abortAndThrow(`${retryable.length} chunks still failing after ${MAX_ATTEMPTS} attempts`)
        }
        console.warn(`[AzureAISearch] ${retryable.length} chunks failed (retryable) — 재시도 ${attempt}/${MAX_ATTEMPTS}`)
        batch = retryable
        await sleepBackoff(attempt)
      }
    }
  }

  private splitDocFailures(
    res: { value?: Array<Record<string, unknown>> } | null,
    batch: Array<Record<string, unknown>>,
  ): { permanent: string[]; retryable: Array<Record<string, unknown>> } {
    const byKey = new Map(batch.map(d => [String(d.id), d]))
    const permanent: string[] = []
    const retryable: Array<Record<string, unknown>> = []
    for (const doc of res?.value ?? []) {
      if (doc?.status !== false) continue
      const code = doc.statusCode as number | undefined
      if (code === 404) continue
      const original = byKey.get(String(doc.key))
      if (code !== undefined && RETRYABLE_INDEX_STATUS.has(code) && original) retryable.push(original)
      else permanent.push(`${doc.key}(${code})`)
    }
    return { permanent, retryable }
  }

  private async rollbackKeys(indexName: string, keys: string[]): Promise<number> {
    let leftover = 0
    const batchSize = 1000
    for (let i = 0; i < keys.length; i += batchSize) {
      const slice = keys.slice(i, i + batchSize)
      const value = slice.map(id => ({ '@search.action': 'delete', id }))
      try {
        const res = await this.searchRequest(`/indexes/${indexName}/docs/index`, 'POST', { value })
        const { permanent, retryable } = this.splitDocFailures(res, value)
        leftover += permanent.length + retryable.length
      } catch (e) {
        if ((e as { status?: number })?.status === 404) continue
        leftover += slice.length
        console.error('[AzureAISearch] rollback batch failed (orphan 가능):', describeCaughtError(e))
      }
    }
    if (leftover > 0) console.error(`[AzureAISearch] rollback incomplete — ${leftover}/${keys.length} chunks may remain`)
    else console.warn(`[AzureAISearch] rolled back ${keys.length} chunks after failed indexing`)
    return leftover
  }

  async deleteChunksByKey(
    agentId: string,
    fileId: string,
    chunkCount: number,
    options?: { signal?: AbortSignal }
  ): Promise<void> {
    if (chunkCount <= 0) return
    const indexName = this.getSharedIndexName()
    try {
      const actions = Array.from({ length: chunkCount }, (_, i) => ({
        '@search.action': 'delete',
        id: `${azureDocKeyAgentPrefix(agentId)}_${fileId}_${i}`,
      }))
      const batchSize = 1000
      const failed: string[] = []
      for (let i = 0; i < actions.length; i += batchSize) {
        const slice = actions.slice(i, i + batchSize)
        const res = await this.searchRequest(
          `/indexes/${indexName}/docs/index`, 'POST', { value: slice }, options?.signal
        )
        const { permanent, retryable } = this.splitDocFailures(res, slice)
        failed.push(...permanent, ...retryable.map(d => String(d.id)))
      }
      if (failed.length > 0) {
        throw new Error(`chunk delete partially failed (${failed.length}/${actions.length}): ${failed.slice(0, 3).join(', ')}`)
      }
      console.log(`[AzureAISearch] Deleted ${actions.length} chunks by key for agent=${agentId}, file=${safeLogDigest(fileId)}`)
    } catch (error) {
      if ((error as { status?: number })?.status === 404) {
        console.warn(`[AzureAISearch] index not found while deleting chunks (agent=${agentId}) — 정리할 대상 없음`)
        return
      }
      throw error
    }
  }

  async deleteFile(
    storeId: string,
    storageId: string,
    options?: { signal?: AbortSignal }
  ): Promise<void> {
    const indexName = this.getSharedIndexName()
    const signal = options?.signal

    try {
      // storeId = agentId
      const result = await this.searchRequest(`/indexes/${indexName}/docs/search`, 'POST', {
        search: '*',
        filter: `agentId eq '${storeId}' and storageId eq '${storageId}'`,
        select: 'id',
        top: 10000,
      }, signal)

      if (result?.value?.length > 0) {
        const deleteActions = result.value.map((doc: any) => ({
          '@search.action': 'delete',
          id: doc.id,
        }))
        const batchSize = 1000
        const failed: string[] = []
        for (let i = 0; i < deleteActions.length; i += batchSize) {
          const batch = deleteActions.slice(i, i + batchSize)
          const res = await this.searchRequest(`/indexes/${indexName}/docs/index`, 'POST', { value: batch }, signal)
          const { permanent, retryable } = this.splitDocFailures(res, batch)
          failed.push(...permanent, ...retryable.map(d => String(d.id)))
        }
        if (failed.length > 0) {
          throw new Error(`document delete partially failed (${failed.length}/${deleteActions.length}): ${failed.slice(0, 3).join(', ')}`)
        }
        console.log(`[AzureAISearch] Deleted ${deleteActions.length} chunks for agent=${storeId}, storage=${storageId}`)
      }
    } catch (error) {
      if ((error as { status?: number })?.status === 404) {
        console.warn(`[AzureAISearch] index not found while deleting (agent=${storeId}) — 정리할 대상 없음`)
        return
      }
      //
      throw error
    }
  }

  async deleteByAgent(agentId: string): Promise<void> {
    const indexName = this.getSharedIndexName()

    try {
      const result = await this.searchRequest(`/indexes/${indexName}/docs/search`, 'POST', {
        search: '*',
        filter: `agentId eq '${agentId}'`,
        select: 'id',
        top: 10000,
      })

      if (result?.value?.length > 0) {
        const deleteActions = result.value.map((doc: any) => ({
          '@search.action': 'delete',
          id: doc.id,
        }))
        const batchSize = 1000
        const failed: string[] = []
        for (let i = 0; i < deleteActions.length; i += batchSize) {
          const batch = deleteActions.slice(i, i + batchSize)
          const res = await this.searchRequest(`/indexes/${indexName}/docs/index`, 'POST', { value: batch })
          const { permanent, retryable } = this.splitDocFailures(res, batch)
          failed.push(...permanent, ...retryable.map(d => String(d.id)))
        }
        console.log(`[AzureAISearch] Deleted ${deleteActions.length - failed.length}/${deleteActions.length} chunks for agent=${agentId}`)
        if (failed.length > 0) {
          throw new Error(`agent document delete partially failed (${failed.length}/${deleteActions.length}): ${failed.slice(0, 3).join(', ')}`)
        }
      }
    } catch (error) {
      if ((error as { status?: number })?.status === 404) {
        console.warn(`[AzureAISearch] index not found while deleting agent=${agentId} — 정리할 대상 없음`)
        return
      }
      console.error(`[AzureAISearch] Failed to delete agent documents for ${agentId}:`, describeCaughtError(error))
      throw error
    }
  }

  async deleteByUser(userId: string): Promise<void> {
    const indexName = this.getSharedIndexName()

    try {
      const result = await this.searchRequest(`/indexes/${indexName}/docs/search`, 'POST', {
        search: '*',
        filter: `userId eq '${userId}'`,
        select: 'id',
        top: 10000,
      })

      if (result?.value?.length > 0) {
        const deleteActions = result.value.map((doc: any) => ({
          '@search.action': 'delete',
          id: doc.id,
        }))
        const batchSize = 1000
        const failed: string[] = []
        for (let i = 0; i < deleteActions.length; i += batchSize) {
          const batch = deleteActions.slice(i, i + batchSize)
          const res = await this.searchRequest(`/indexes/${indexName}/docs/index`, 'POST', { value: batch })
          const { permanent, retryable } = this.splitDocFailures(res, batch)
          failed.push(...permanent, ...retryable.map(d => String(d.id)))
        }
        console.log(`[AzureAISearch] Deleted ${deleteActions.length - failed.length}/${deleteActions.length} chunks for user=${userId}`)
        if (failed.length > 0) {
          throw new Error(`user document delete partially failed (${failed.length}/${deleteActions.length}): ${failed.slice(0, 3).join(', ')}`)
        }
      }
    } catch (error) {
      console.error(`[AzureAISearch] Failed to delete user documents for ${userId}:`, describeCaughtError(error))
      throw error
    }
  }

  private async rewriteQuery(query: string): Promise<string> {
    try {
      const url = `${this.config.openaiEndpoint}/openai/deployments/gpt-4o-mini/chat/completions?api-version=${this.config.openaiApiVersion}`
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'api-key': this.config.openaiApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [
            {
              role: 'system',
              content: 'You are a search query optimizer. Expand the user query into a search-optimized query by adding relevant keywords, synonyms, and related terms. Output ONLY the expanded query, nothing else. Keep the same language as the input.',
            },
            { role: 'user', content: query },
          ],
          max_tokens: 100,
          temperature: 0,
        }),
      })

      if (!res.ok) {
        console.warn(`[AzureAISearch] Query rewriting failed (${res.status}), using original query`)
        return query
      }

      const data = await res.json()
      const rewritten = data.choices?.[0]?.message?.content?.trim()
      if (rewritten) {
        console.log(`[AzureAISearch] Query rewritten (${query.length} → ${rewritten.length} chars)`)
        return rewritten
      }
      return query
    } catch (error) {
      console.warn('[AzureAISearch] Query rewriting error, using original query:', describeCaughtError(error))
      return query
    }
  }

  async search(
    storeId: string,
    query: string,
    topK: number = 10,
    opts?: { ragSpace?: string; includeNullSpace?: boolean }
  ): Promise<RAGSearchResult[]> {
    if (!storeId) {
      throw new Error('[AzureAISearch] agentId (storeId) is required for search isolation')
    }

    const indexName = this.getSharedIndexName()
    if (!(await this.indexExists(indexName))) {
      return []
    }
    if (opts?.ragSpace) {
      await this.ensureRagSpaceField()
    }

    let filter = `agentId eq '${storeId}'`
    if (opts?.ragSpace) {
      filter += opts.includeNullSpace
        ? ` and (ragSpace eq '${opts.ragSpace}' or ragSpace eq null or ragSpace eq '')`
        : ` and ragSpace eq '${opts.ragSpace}'`
    }

    // const expandedQuery = await this.rewriteQuery(query)

    const [queryEmbedding] = await this.getEmbeddings([query])

    const result = await this.searchRequest(`/indexes/${indexName}/docs/search`, 'POST', {
      search: query,
      queryType: 'semantic',
      semanticConfiguration: 'default-semantic',
      filter,
      vectorFilterMode: 'preFilter',
      vectorQueries: [{
        kind: 'vector',
        vector: queryEmbedding,
        fields: 'contentVector',
        k: topK,
      }],
      select: 'id,content,title,blobPath,chunkIndex,storageId',
      top: topK,
    })

    if (!result?.value) return []

    return result.value.map((doc: any) => ({
      id: doc.id,
      content: doc.content || '',
      score: doc['@search.score'] || 0,
      metadata: {
        title: doc.title,
        chunkIndex: doc.chunkIndex,
        blobPath: doc.blobPath,
        storageId: doc.storageId,
      },
    }))
  }

  async listChunks(
    agentId: string,
    opts?: { ragSpace?: string; includeNullSpace?: boolean; maxChunks?: number; storageId?: number }
  ): Promise<Array<{ storageId: string; title: string; chunkIndex: number; content: string }>> {
    if (!agentId) throw new Error('[AzureAISearch] agentId required')
    const indexName = this.getSharedIndexName()
    if (!(await this.indexExists(indexName))) return []
    if (opts?.ragSpace) await this.ensureRagSpaceField()

    let filter = `agentId eq '${agentId}'`
    if (opts?.ragSpace) {
      filter += opts.includeNullSpace
        ? ` and (ragSpace eq '${opts.ragSpace}' or ragSpace eq null or ragSpace eq '')`
        : ` and ragSpace eq '${opts.ragSpace}'`
    }
    if (opts?.storageId !== undefined) {
      if (!Number.isInteger(opts.storageId)) throw new Error('[AzureAISearch] storageId must be an integer')
      filter += ` and storageId eq '${opts.storageId}'`
    }

    const maxChunks = opts?.maxChunks ?? 3000
    const pageSize = 1000
    const out: Array<{ storageId: string; title: string; chunkIndex: number; content: string }> = []
    for (let skip = 0; skip < maxChunks; skip += pageSize) {
      const result = await this.searchRequest(`/indexes/${indexName}/docs/search`, 'POST', {
        search: '*',
        filter,
        select: 'storageId,title,chunkIndex,content',
        top: Math.min(pageSize, maxChunks - skip),
        skip,
      })
      const batch: any[] = result?.value ?? []
      for (const d of batch) {
        out.push({
          storageId: String(d.storageId ?? ''),
          title: d.title || '',
          chunkIndex: normalizeChunkIndex(d.chunkIndex),
          content: d.content || '',
        })
      }
      if (batch.length < pageSize) break
    }
    return out
  }

  async validateConnection(): Promise<boolean> {
    try {
      const url = `${this.config.searchEndpoint}/indexes?api-version=${AZURE_SEARCH_API_VERSION}&$select=name`
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'api-key': this.config.searchApiKey },
      })
      return res.ok
    } catch {
      return false
    }
  }
}
