
import { BaseNodeExecutor, NodeExecutionResult } from './base'
import { WorkflowNode, WorkflowContext } from '../types'
import { PrismaClient } from '@prisma/client'
import { PineconeClient, PineconeConnectionConfig } from '@/lib/rag-providers/clients/pinecone'
import { tryGetKnowledgeStore } from '@/lib/knowledge'
import { isSelfHosted } from '@/lib/edition'
import { decryptDataKey, decryptDataKeyWithLegacy, decrypt } from '@/lib/encryption'
import OpenAI from 'openai'
import { canReadTemplatePath } from '../template-scope'

type RAGProviderType = 'none' | 'openai_vector_store' | 'gemini_file_search' | 'pinecone' | 'azure_ai_search'

const STORE_WAIT_MS = 60_000

async function waitForStoredText(prisma: PrismaClient, id: number) {
  for (let waited = 0; waited < STORE_WAIT_MS; waited += 500) {
    const row = await prisma.storage.findUnique({ where: { id }, select: { status: true, ragStatus: true, errorMessage: true } })
    if (!row) return { status: 'failed', ragStatus: null, errorMessage: 'Document was removed while indexing' }
    if (row.status !== 'processing') return row
    await new Promise((r) => setTimeout(r, 500))
  }
  return null
}

export class StoreNodeExecutor extends BaseNodeExecutor {
  private isDev = process.env.NODE_ENV === 'development'

  async execute(
    node: WorkflowNode,
    context: WorkflowContext,
    prisma: PrismaClient
  ): Promise<NodeExecutionResult> {
    const startTime = Date.now()

    try {
      const {
        content = '',
        documentIdMode = 'auto',
        documentIdTemplate = '',
        customMetadata = [],
      } = node.data

      const resolvedContent = this.substituteVariables(content, context)

      if (!resolvedContent.trim()) {
        return this.createErrorResult(context, 'Store content is empty after variable substitution', {
          content,
          resolvedContent: '(empty)',
        })
      }

      if (this.isDev) {
        console.log(`[Store] Content length: ${resolvedContent.length} chars`)
      }

      if (isSelfHosted()) return await this.storeSelfHosted(node, context, prisma, resolvedContent, startTime)

      let ragProvider: RAGProviderType = 'openai_vector_store'

      if (context.ragProvider && context.ragProvider !== 'none') {
        ragProvider = context.ragProvider as RAGProviderType
      } else {
        const subscription = await prisma.subscription.findUnique({
          where: { id: context.userId },
          select: { serviceVariant: true, managedRegion: true }
        })
        if (subscription?.serviceVariant === 'managed' && subscription.managedRegion) {
          ragProvider = 'azure_ai_search' as RAGProviderType
        } else {
          const userRagProviders = await prisma.ragProviders.findUnique({
            where: { id: context.userId }
          })
          if (userRagProviders?.defaultProvider) {
            ragProvider = userRagProviders.defaultProvider as RAGProviderType
          }
        }
      }

      if (ragProvider === 'none') {
        return this.createErrorResult(context, 'RAG Provider not configured. Please configure in Settings.', {
          ragProvider: 'none',
        })
      }

      console.log(`[Store] RAG Provider: ${ragProvider}`)

      const timestamp = Date.now()
      const random = Math.random().toString(36).substring(2, 8)
      let documentId: string

      if (documentIdMode === 'template' && documentIdTemplate) {
        documentId = this.substituteVariables(documentIdTemplate, context)
      } else {
        documentId = `store_${timestamp}_${random}`
      }

      const metadata: Record<string, any> = {
        timestamp: new Date().toISOString(),
        agentId: context.agentId,
        source: 'workflow',
      }

      if (Array.isArray(customMetadata)) {
        for (const item of customMetadata) {
          if (item.key && item.value) {
            metadata[item.key] = this.substituteVariables(item.value, context)
          }
        }
      }

      let result: { success: boolean; documentCount: number; documentIds: string[]; error?: string }

      let preCreatedStorageId: number | null = null
      let writeSpaceId: number | null = null

      if (ragProvider === 'azure_ai_search') {
        const requestedSpaceId = node.data?.ragSpaceId
        const hasExplicitSpace = requestedSpaceId != null && Number.isInteger(Number(requestedSpaceId))
        try {
          if (hasExplicitSpace) {
            const s = await prisma.ragSpace.findFirst({
              where: { id: Number(requestedSpaceId), agentId: context.agentId }, select: { id: true },
            })
            writeSpaceId = s?.id ?? null
            if (!s) console.warn(`[Store] ragSpaceId=${requestedSpaceId} not found for agent=${context.agentId} → Default`)
          }
          if (writeSpaceId == null) {
            const def = await prisma.ragSpace.findFirst({ where: { agentId: context.agentId, isDefault: true }, select: { id: true } })
              ?? await prisma.ragSpace.create({ data: { agentId: context.agentId, name: 'Default', isDefault: true, sortOrder: 0 }, select: { id: true } })
                .catch(async () => prisma.ragSpace.findFirst({ where: { agentId: context.agentId, isDefault: true }, select: { id: true } }))
            writeSpaceId = def?.id ?? null
          }
        } catch (spaceErr) {
          console.error('[Store] RAG space resolve failed:', spaceErr)
          if (hasExplicitSpace) {
            throw new Error('Failed to resolve selected RAG space')
          }
        }

        try {
          const contentBytes = Buffer.byteLength(resolvedContent, 'utf8')
          const title = `RAG Store: ${documentId}.txt`
          const now = new Date().toISOString()

          const preStorage = await prisma.storage.create({
            data: {
              agentId: context.agentId,
              type: 'file',
              status: 'processing',
              title,
              fileSizeBytes: contentBytes,
              mimeType: 'text/plain',
              content: resolvedContent.length <= 10000 ? resolvedContent : resolvedContent.substring(0, 10000) + '...(truncated)',
              ragProvider,
              ragSpaceId: writeSpaceId,
              ragStatus: JSON.stringify({}),
              sourceUrl: `workflow://${context.agentId}/${documentId}`,
              processingLog: JSON.stringify({
                startTime: now,
                ragProvider,
                source: 'workflow_store',
                nodeId: node.id,
              }),
            },
          })
          preCreatedStorageId = preStorage.id
          console.log(`[Store] Pre-created Storage record id=${preCreatedStorageId} for Azure AI Search`)
        } catch (preErr) {
          console.warn('[Store] Failed to pre-create Storage record:', preErr)
        }
      }

      switch (ragProvider) {
        case 'openai_vector_store':
          result = await this.writeToOpenAI(context, prisma, resolvedContent, documentId, metadata)
          break
        case 'pinecone':
          result = await this.writeToPinecone(context, prisma, resolvedContent, documentId, metadata)
          break
        case 'gemini_file_search':
          result = await this.writeToGemini(context, prisma, resolvedContent, documentId, metadata)
          break
        case 'azure_ai_search':
          result = await this.writeToAzure(context, prisma, resolvedContent, documentId, metadata, preCreatedStorageId, writeSpaceId)
          break
        default:
          result = { success: false, documentCount: 0, documentIds: [], error: `Unsupported RAG provider: ${ragProvider}` }
      }

      const duration = Date.now() - startTime

      const updatedContext: WorkflowContext = {
        ...context,
        storeResult: {
          success: result.success,
          provider: ragProvider,
          documentCount: result.documentCount,
          documentIds: result.documentIds,
          error: result.error,
        },
      }

      if (result.success) {
        console.log(`[Store] Success: ${result.documentCount} documents stored via ${ragProvider} (${duration}ms)`)

        if (ragProvider === 'azure_ai_search' && preCreatedStorageId) {
          if (this.isDev) {
            console.log(`[Store] Azure AI Search Storage record already handled (id=${preCreatedStorageId})`)
          }
        } else try {
          const contentBytes = Buffer.byteLength(resolvedContent, 'utf8')
          const title = `RAG Store: ${documentId}.txt`
          const now = new Date().toISOString()

          let ragStatus: Record<string, any> = {}
          let openaiFileId: string | null = null
          let vectorStoreFileId: string | null = null

          if (ragProvider === 'openai_vector_store' && result.documentIds[0]) {
            openaiFileId = result.documentIds[0]
            ragStatus = {
              openai_vector_store: {
                fileId: openaiFileId,
                status: 'completed',
                createdAt: now,
                source: 'workflow_store',
              }
            }
          } else if (ragProvider === 'pinecone') {
            ragStatus = {
              pinecone: {
                vectorCount: result.documentCount,
                idPrefix: documentId,
                vectorIds: result.documentIds,
                chunkCount: result.documentCount,
                status: 'completed',
                createdAt: now,
                source: 'workflow_store',
              }
            }
          } else if (ragProvider === 'gemini_file_search' && result.documentIds[0]) {
            ragStatus = {
              gemini_file_search: {
                fileId: result.documentIds[0],
                status: 'completed',
                createdAt: now,
                source: 'workflow_store',
              }
            }
          }

          await prisma.storage.create({
            data: {
              agentId: context.agentId,
              type: 'file',
              status: 'completed',
              title,
              fileSizeBytes: contentBytes,
              mimeType: 'text/plain',
              content: resolvedContent.length <= 10000 ? resolvedContent : resolvedContent.substring(0, 10000) + '...(truncated)',
              openaiFileId,
              vectorStoreFileId,
              ragProvider,
              ragSpaceId: writeSpaceId,
              ragStatus: JSON.stringify(ragStatus),
              sourceUrl: `workflow://${context.agentId}/${documentId}`,
              processingLog: JSON.stringify({
                startTime: now,
                completedTime: now,
                ragProvider,
                source: 'workflow_store',
                nodeId: node.id,
                documentCount: result.documentCount,
              }),
            },
          })

          if (this.isDev) {
            console.log(`[Store] Storage record created: ${title}`)
          }
        } catch (storageError) {
          console.warn('[Store] Failed to create Storage record:', storageError)
        }

        return this.createSuccessResult(updatedContext, {
          input: {
            contentLength: resolvedContent.length,
            ragProvider,
            documentIdMode,
          },
          output: {
            success: true,
            provider: ragProvider,
            documentCount: result.documentCount,
            documentIds: result.documentIds,
            duration,
          },
        })
      } else {
        console.error(`[Store] Failed: ${result.error}`)
        return this.createErrorResult(updatedContext, result.error || 'Store failed', {
          contentLength: resolvedContent.length,
          ragProvider,
        })
      }
    } catch (error) {
      console.error('[Store] Exception:', error)
      const errorMessage = error instanceof Error ? error.message : 'Unknown store error'
      const updatedContext: WorkflowContext = {
        ...context,
        storeResult: {
          success: false,
          provider: 'unknown',
          documentCount: 0,
          documentIds: [],
          error: errorMessage,
        },
      }
      return this.createErrorResult(updatedContext, errorMessage, {})
    }
  }

  // ========================================
  // ========================================

  private async storeSelfHosted(
    node: WorkflowNode,
    context: WorkflowContext,
    prisma: PrismaClient,
    content: string,
    startTime: number,
  ): Promise<NodeExecutionResult> {
    const { documentIdMode = 'auto', documentIdTemplate = '' } = node.data
    const documentId = documentIdMode === 'template' && documentIdTemplate
      ? this.substituteVariables(documentIdTemplate, context)
      : `store_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`

    const requested = node.data?.ragSpaceId
    let ragSpaceIdInput: number | null = null
    if (requested != null && Number.isInteger(Number(requested))) {
      const space = await prisma.ragSpace.findFirst({ where: { id: Number(requested), agentId: context.agentId }, select: { id: true } })
      ragSpaceIdInput = space?.id ?? null
      if (!space) console.warn(`[Store] ragSpaceId=${requested} not found for agent=${context.agentId} → Default`)
    }

    const { createTextSource } = await import('@/lib/storage/create-text')
    const created = await createTextSource({ userId: context.userId, agentId: context.agentId, title: `RAG Store: ${documentId}`, content, ragSpaceIdInput })
    let error: string | undefined
    let documentCount = 0
    let storageId = created.ok ? created.storageId : null
    if (!created.ok) {
      error = created.message
    } else {
      const row = await waitForStoredText(prisma, created.storageId)
      if (!row) {
        const { deleteStorageItem } = await import('@/lib/storage/delete-item')
        const cancelled = await deleteStorageItem({ userId: context.userId, agentId: context.agentId, storageId: created.storageId }).catch(() => null)
        error = `Document indexing did not finish within ${STORE_WAIT_MS / 1000}s and was cancelled`
        if (cancelled?.ok) storageId = null
        else error += ' — cancelling failed; the document may still appear later'
      } else if (row.status !== 'completed') {
        error = row.errorMessage || 'Indexing failed'
      } else {
        documentCount = await prisma.knowledgeChunk.count({ where: { storageId: created.storageId } })
        if (documentCount === 0) error = 'Document was stored but holds no searchable text'
      }
    }

    const success = !error
    const updatedContext: WorkflowContext = {
      ...context,
      storeResult: { success, provider: 'pgvector', documentCount, documentIds: storageId != null ? [String(storageId)] : [], error },
    }
    if (!success) {
      console.error(`[Store] Failed: ${error}`)
      return this.createErrorResult(updatedContext, error || 'Store failed', { contentLength: content.length, ragProvider: 'pgvector' })
    }
    console.log(`[Store] Success: ${documentCount} chunks stored via pgvector (${Date.now() - startTime}ms)`)
    return this.createSuccessResult(updatedContext, {
      input: { contentLength: content.length, ragProvider: 'pgvector', documentIdMode },
      output: { success: true, provider: 'pgvector', documentCount, documentIds: [String(storageId)], duration: Date.now() - startTime },
    })
  }

  // ========================================
  // ========================================

  private async writeToOpenAI(
    context: WorkflowContext,
    prisma: PrismaClient,
    content: string,
    documentId: string,
    metadata: Record<string, any>
  ): Promise<{ success: boolean; documentCount: number; documentIds: string[]; error?: string }> {
    const agent = await prisma.agent.findUnique({
      where: { agentId: context.agentId },
      select: { vectorStoreId: true }
    })

    const vectorStoreId = context.sourceVectorStoreId || agent?.vectorStoreId

    if (!vectorStoreId) {
      return { success: false, documentCount: 0, documentIds: [], error: 'No OpenAI Vector Store configured' }
    }

    const user = await prisma.user.findUnique({
      where: { id: context.userId },
      include: { aiProviders: true, zki: true }
    })

    if (!user?.encryptedDataKey || !user?.aiProviders?.providers) {
      return { success: false, documentCount: 0, documentIds: [], error: 'OpenAI API key not configured' }
    }

    let apiKey: string
    try {
      const providersConfig = JSON.parse(user.aiProviders.providers as string)
      if (!providersConfig.openai?.apiKey) {
        return { success: false, documentCount: 0, documentIds: [], error: 'OpenAI API key not configured' }
      }
      const dek = user.zkiId && user.zki?.masterKey
        ? decryptDataKeyWithLegacy(Buffer.from(user.encryptedDataKey), user.zki.masterKey)
        : await decryptDataKey(Buffer.from(user.encryptedDataKey))
      apiKey = decrypt(Buffer.from(providersConfig.openai.apiKey, "base64"), dek)
      if (apiKey === "Decryption failed") {
        return { success: false, documentCount: 0, documentIds: [], error: 'Failed to decrypt OpenAI API key' }
      }
    } catch {
      return { success: false, documentCount: 0, documentIds: [], error: 'Failed to decrypt OpenAI API key' }
    }

    try {
      const openai = new OpenAI({ apiKey })

      const fileName = `${documentId}.txt`
      const textBlob = new Blob([content], { type: 'text/plain' })
      const textFile = new File([textBlob], fileName, { type: 'text/plain' })

      const fileResponse = await openai.files.create({
        file: textFile as any,
        purpose: 'assistants',
      })

      if (openai.vectorStores) {
        await openai.vectorStores.files.create(vectorStoreId, {
          file_id: fileResponse.id,
        })
      } else {
        const response = await fetch(`https://api.openai.com/v1/vector_stores/${vectorStoreId}/files`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'OpenAI-Beta': 'assistants=v2'
          },
          body: JSON.stringify({ file_id: fileResponse.id })
        })
        if (!response.ok) {
          const errorText = await response.text()
          return { success: false, documentCount: 0, documentIds: [], error: `Vector Store upload failed: ${errorText}` }
        }
      }

      return {
        success: true,
        documentCount: 1,
        documentIds: [fileResponse.id],
      }
    } catch (error: any) {
      return { success: false, documentCount: 0, documentIds: [], error: error.message || 'OpenAI upload failed' }
    }
  }

  // ========================================
  // ========================================

  private async writeToPinecone(
    context: WorkflowContext,
    prisma: PrismaClient,
    content: string,
    documentId: string,
    metadata: Record<string, any>
  ): Promise<{ success: boolean; documentCount: number; documentIds: string[]; error?: string }> {
    let pineconeApiKey = context.pineconeApiKey
    let pineconeConfig = context.pineconeConfig

    if (!pineconeApiKey || !pineconeConfig) {
      const loadResult = await this.loadPineconeConfig(context, prisma)
      if (loadResult.error) {
        return { success: false, documentCount: 0, documentIds: [], error: loadResult.error }
      }
      pineconeApiKey = loadResult.apiKey!
      pineconeConfig = loadResult.config!
    }

    try {
      const connectionConfig: PineconeConnectionConfig = {
        host: pineconeConfig.host,
        indexName: pineconeConfig.indexName,
        namespace: pineconeConfig.namespace || context.agentId,
        embeddingApiKey: pineconeConfig.embeddingApiKey,
        embeddingModel: pineconeConfig.embeddingModel,
        dimension: pineconeConfig.dimension,
      }

      const client = new PineconeClient(pineconeApiKey, connectionConfig)

      const chunks = content.length > 1000
        ? this.chunkText(content, 1000, 200)
        : [content]

      const documents = chunks.map((chunk, i) => ({
        id: chunks.length === 1 ? documentId : `${documentId}_${i}`,
        content: chunk,
        metadata: {
          ...metadata,
          chunkIndex: i,
          totalChunks: chunks.length,
        },
      }))

      await client.upsertDocuments(context.agentId, documents)

      return {
        success: true,
        documentCount: documents.length,
        documentIds: documents.map(d => d.id),
      }
    } catch (error: any) {
      return { success: false, documentCount: 0, documentIds: [], error: error.message || 'Pinecone upsert failed' }
    }
  }

  private async loadPineconeConfig(
    context: WorkflowContext,
    prisma: PrismaClient
  ): Promise<{ apiKey?: string; config?: PineconeConnectionConfig; error?: string }> {
    const user = await prisma.user.findUnique({
      where: { id: context.userId },
      include: { ragProviders: true, aiProviders: true, zki: true }
    })

    if (!user?.encryptedDataKey || !user?.ragProviders?.providers) {
      return { error: 'Pinecone settings not found' }
    }

    const ragProvidersConfig = typeof user.ragProviders.providers === 'string'
      ? JSON.parse(user.ragProviders.providers)
      : user.ragProviders.providers

    if (!ragProvidersConfig?.pinecone?.apiKey || !ragProvidersConfig?.pinecone?.indexName) {
      return { error: 'Pinecone API Key or Index Name not configured' }
    }

    const storedApiKey = ragProvidersConfig.pinecone.apiKey
    let pineconeApiKey: string

    if (storedApiKey.startsWith('pcsk_')) {
      pineconeApiKey = storedApiKey
    } else {
      let dek: Buffer
      if (user.zkiId && user.zki?.masterKey) {
        dek = decryptDataKeyWithLegacy(Buffer.from(user.encryptedDataKey), user.zki.masterKey)
      } else {
        dek = await decryptDataKey(Buffer.from(user.encryptedDataKey))
      }
      pineconeApiKey = decrypt(Buffer.from(storedApiKey, "base64"), dek)
      if (pineconeApiKey === "Decryption failed") {
        return { error: 'Failed to decrypt Pinecone API key' }
      }
    }

    const embeddingModel = ragProvidersConfig.pinecone.embeddingModel || 'text-embedding-3-small'
    const isPineconeEmbedding = ['llama-text-embed-v2', 'multilingual-e5-large'].includes(embeddingModel)

    let openaiApiKey: string | undefined
    if (!isPineconeEmbedding) {
      const aiProvidersConfig = user.aiProviders?.providers
        ? JSON.parse(user.aiProviders.providers as string)
        : null
      if (!aiProvidersConfig?.openai?.apiKey) {
        return { error: 'OpenAI API Key is required for OpenAI embedding models' }
      }
      const dekForOpenai = user.zkiId && user.zki?.masterKey
        ? decryptDataKeyWithLegacy(Buffer.from(user.encryptedDataKey), user.zki.masterKey)
        : await decryptDataKey(Buffer.from(user.encryptedDataKey))
      openaiApiKey = decrypt(Buffer.from(aiProvidersConfig.openai.apiKey, "base64"), dekForOpenai)
    }

    const config: PineconeConnectionConfig = {
      host: ragProvidersConfig.pinecone.host || undefined,
      indexName: ragProvidersConfig.pinecone.indexName,
      namespace: ragProvidersConfig.pinecone.namespace || undefined,
      embeddingApiKey: openaiApiKey,
      embeddingModel,
      dimension: ragProvidersConfig.pinecone.dimension || 1536,
    }

    return { apiKey: pineconeApiKey, config }
  }

  // ========================================
  // ========================================

  private async writeToGemini(
    context: WorkflowContext,
    prisma: PrismaClient,
    content: string,
    documentId: string,
    metadata: Record<string, any>
  ): Promise<{ success: boolean; documentCount: number; documentIds: string[]; error?: string }> {
    const user = await prisma.user.findUnique({
      where: { id: context.userId },
      include: { aiProviders: true, zki: true }
    })

    if (!user?.encryptedDataKey || !user?.aiProviders?.providers) {
      return { success: false, documentCount: 0, documentIds: [], error: 'Gemini API key not configured' }
    }

    let geminiApiKey: string
    try {
      const providersConfig = JSON.parse(user.aiProviders.providers as string)
      if (!providersConfig.gemini?.apiKey) {
        return { success: false, documentCount: 0, documentIds: [], error: 'Gemini API key not configured' }
      }
      const dek = user.zkiId && user.zki?.masterKey
        ? decryptDataKeyWithLegacy(Buffer.from(user.encryptedDataKey), user.zki.masterKey)
        : await decryptDataKey(Buffer.from(user.encryptedDataKey))
      geminiApiKey = decrypt(Buffer.from(providersConfig.gemini.apiKey, "base64"), dek)
      if (geminiApiKey === "Decryption failed") {
        return { success: false, documentCount: 0, documentIds: [], error: 'Failed to decrypt Gemini API key' }
      }
    } catch {
      return { success: false, documentCount: 0, documentIds: [], error: 'Failed to decrypt Gemini API key' }
    }

    try {
      const uploadResponse = await fetch(
        `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${geminiApiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain',
            'X-Goog-Upload-Protocol': 'raw',
            'X-Goog-Upload-Command': 'upload, finalize',
          },
          body: content,
        }
      )

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text()
        return { success: false, documentCount: 0, documentIds: [], error: `Gemini upload failed: ${errorText}` }
      }

      const uploadResult = await uploadResponse.json()
      const geminiFileId = uploadResult.file?.name || uploadResult.name

      return {
        success: true,
        documentCount: 1,
        documentIds: [geminiFileId],
      }
    } catch (error: any) {
      return { success: false, documentCount: 0, documentIds: [], error: error.message || 'Gemini upload failed' }
    }
  }

  // ========================================
  // Azure AI Search
  // ========================================

  private async writeToAzure(
    context: WorkflowContext,
    prisma: PrismaClient,
    content: string,
    documentId: string,
    metadata: Record<string, string>,
    preCreatedStorageId?: number | null,
    writeSpaceId?: number | null,
  ) {
    try {
      let regionId = context.azureSearchConfig?.regionId
      if (!regionId) {
        const subscription = await prisma.subscription.findUnique({
          where: { id: context.userId },
          select: { serviceVariant: true, managedRegion: true }
        })
        if (subscription?.serviceVariant !== 'managed' || !subscription.managedRegion) {
          return { success: false, documentCount: 0, documentIds: [], error: 'Azure AI Search is only available for Managed users' }
        }
        regionId = subscription.managedRegion
      }

      const store = await tryGetKnowledgeStore({ regionId }, 'Store')
      if (!store) {
        return { success: false, documentCount: 0, documentIds: [], error: 'Azure AI Search not configured for this region' }
      }

      const fileName = documentId || `store_${Date.now().toString(36)}`
      const buffer = Buffer.from(content, 'utf-8')

      const storageIdForIndex = preCreatedStorageId ? String(preCreatedStorageId) : fileName

      const uploadResult = await store.ingest({ agentId: context.agentId }, {
        userId: context.userId,
        storageId: storageIdForIndex,
        fileName,
        file: buffer,
        mimeType: 'text/plain',
        ragSpace: writeSpaceId != null ? String(writeSpaceId) : '',
        blobPath: '',
      })

      if (preCreatedStorageId) {
        try {
          const now = new Date().toISOString()
          await prisma.storage.update({
            where: { id: preCreatedStorageId },
            data: {
              status: 'completed',
              ragStatus: JSON.stringify({
                azure_ai_search: {
                  chunkCount: uploadResult.chunkCount || 1,
                  fileId: uploadResult.providerRef.fileId,
                  contentHash: uploadResult.providerRef.contentHash,
                  status: 'completed',
                  createdAt: now,
                  source: 'workflow_store',
                }
              }),
              processingLog: JSON.stringify({
                startTime: now,
                completedTime: now,
                ragProvider: 'azure_ai_search',
                source: 'workflow_store',
                documentCount: uploadResult.chunkCount || 1,
              }),
            },
          })
        } catch (updateErr) {
          console.warn('[Store] Failed to update pre-created Storage record:', updateErr)
        }
      }

      return {
        success: true,
        documentCount: uploadResult.chunkCount || 1,
        documentIds: [uploadResult.providerRef.fileId],
      }
    } catch (error: any) {
      if (preCreatedStorageId) {
        try {
          await prisma.storage.delete({ where: { id: preCreatedStorageId } })
          console.log(`[Store] Cleaned up pre-created Storage id=${preCreatedStorageId} after upload failure`)
        } catch (cleanErr) {
          console.warn('[Store] Failed to clean up pre-created Storage:', cleanErr)
        }
      }
      return { success: false, documentCount: 0, documentIds: [], error: error.message || 'Azure AI Search upload failed' }
    }
  }

  // ========================================
  // ========================================

  private substituteVariables(template: string, context: WorkflowContext): string {
    if (!template) return ''

    let result = template

    result = result.replace(/\{\{context\.([^}]+)\}\}/g, (match, path) => {
      if (!canReadTemplatePath(context, path)) return ''
      const value = this.getValueFromPath(context, path)
      if (value === undefined || value === null) return ''
      if (typeof value === 'object') return JSON.stringify(value)
      return String(value)
    })

    result = result.replace(/\{\{message\}\}/g, context.message || '')

    result = result.replace(/\{\{aiResponse\}\}/g, context.aiResponse || '')

    result = result.replace(/\{\{httpResult\}\}/g, () => {
      if (!context.httpResult) return ''
      return typeof context.httpResult === 'object' ? JSON.stringify(context.httpResult) : String(context.httpResult)
    })

    result = result.replace(/\{\{httpResult\.([^}]+)\}\}/g, (match, path) => {
      if (!context.httpResult) return ''
      const value = this.getValueFromPath(context.httpResult, path)
      if (value === undefined || value === null) return ''
      if (typeof value === 'object') return JSON.stringify(value)
      return String(value)
    })

    result = result.replace(/\{\{jsonData\.([^}]+)\}\}/g, (match, path) => {
      if (!context.jsonData) return ''
      const value = this.getValueFromPath(context.jsonData, path)
      if (value === undefined || value === null) return ''
      if (typeof value === 'object') return JSON.stringify(value)
      return String(value)
    })

    return result
  }

  private getValueFromPath(obj: any, path: string): any {
    if (!obj || !path) return undefined

    const parts = path.split('.')
    let current = obj

    for (const part of parts) {
      if (current === null || current === undefined) return undefined

      const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/)
      if (arrayMatch) {
        const [, arrayName, indexStr] = arrayMatch
        current = current[arrayName]
        if (!Array.isArray(current)) return undefined
        current = current[parseInt(indexStr, 10)]
      } else {
        current = current[part]
      }
    }

    return current
  }

  private chunkText(text: string, chunkSize: number = 1000, overlap: number = 200): string[] {
    const chunks: string[] = []
    const paragraphs = text.split(/\n\n+/)
    let currentChunk = ''

    for (const para of paragraphs) {
      if (currentChunk.length + para.length < chunkSize) {
        currentChunk += (currentChunk ? '\n\n' : '') + para
      } else {
        if (currentChunk) {
          chunks.push(currentChunk.trim())
        }
        if (para.length > chunkSize) {
          const sentences = para.match(/[^.!?]+[.!?]+/g) || [para]
          let sentenceChunk = ''
          for (const sentence of sentences) {
            if (sentenceChunk.length + sentence.length < chunkSize) {
              sentenceChunk += sentence
            } else {
              if (sentenceChunk) chunks.push(sentenceChunk.trim())
              sentenceChunk = sentence
            }
          }
          currentChunk = sentenceChunk || ''
        } else {
          currentChunk = para
        }
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk.trim())
    }

    if (overlap > 0 && chunks.length > 1) {
      const overlappedChunks: string[] = []
      for (let i = 0; i < chunks.length; i++) {
        let chunk = chunks[i]
        if (i > 0) {
          const prevChunk = chunks[i - 1]
          const overlapText = prevChunk.slice(-overlap)
          chunk = overlapText + ' ' + chunk
        }
        overlappedChunks.push(chunk)
      }
      return overlappedChunks
    }

    return chunks
  }
}
