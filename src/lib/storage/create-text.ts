
import { prisma } from '@/lib/prisma'
import { OpenAI } from 'openai'
import { decryptDataKey, decryptDataKeyWithLegacy, decrypt } from '@/lib/encryption'
import { describeCaughtError } from '@/lib/log-mask'
import { PineconeClient, PineconeConnectionConfig } from '@/lib/rag-providers/clients/pinecone'
import { getKnowledgeStore, knowledgeTargetFor, type KnowledgeStore } from '@/lib/knowledge'
import { HTTP_SEARCH_NO_INGEST } from '@/lib/knowledge/http'
import { isSelfHosted } from '@/lib/edition'
import { RAGProviderType } from '@/lib/rag-providers/types'
import { resolveRagSpaceId, RagSpaceError } from '@/lib/rag-space'

const MIN_FILE_SIZE = 20 // 20 bytes minimum

const PINECONE_EMBEDDING_MODELS = ['llama-text-embed-v2', 'multilingual-e5-large', 'pinecone-sparse-english-v0']

export type CreateTextResult =
  | { ok: true; storageId: number }
  | { ok: false; code: string; message: string }

export interface CreateTextParams {
  userId: string
  agentId: string
  title: string
  content: string
  requestRagProvider?: string | null
  ragSpaceIdInput?: number | string | null
  requireManaged?: boolean
}

export async function createTextSource(params: CreateTextParams): Promise<CreateTextResult> {
  const { userId, agentId, requestRagProvider, ragSpaceIdInput } = params
  const title = params.title
  const content = params.content

  if (!agentId) {
    return { ok: false, code: 'AGENT_ID_REQUIRED', message: 'Agent ID is required' }
  }
  if (!title?.trim()) {
    return { ok: false, code: 'TITLE_REQUIRED', message: 'Title is required' }
  }
  if (!content?.trim()) {
    return { ok: false, code: 'CONTENT_REQUIRED', message: 'Content is required' }
  }

  const contentSize = Buffer.byteLength(content.trim(), 'utf8')
  if (contentSize < MIN_FILE_SIZE) {
    return {
      ok: false,
      code: 'CONTENT_TOO_SMALL',
      message: `Content is too small (${contentSize} bytes). Minimum size is ${MIN_FILE_SIZE} bytes.`,
    }
  }

  const agent = await prisma.agent.findUnique({
    where: { agentId },
  })

  if (!agent || agent.userId !== userId) {
    return { ok: false, code: 'AGENT_NOT_FOUND', message: 'Agent not found or unauthorized' }
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      aiProviders: true,
      ragProviders: true,
      zki: true,
      subscription: isSelfHosted() ? false : { select: { serviceVariant: true, managedRegion: true, storagePerAgent: true } }
    }
  })

  const isManaged = user?.subscription?.serviceVariant === 'managed'
  const selfHosted = isSelfHosted()

  if (params.requireManaged && !isManaged && !selfHosted) {
    return {
      ok: false,
      code: 'UNSUPPORTED_SERVICE_VARIANT',
      message: 'Adding knowledge-base documents over MCP requires a managed subscription (indexing runs on Azure AI Search). Use the dashboard Storage page for this account.',
    }
  }

  if (!isManaged && !selfHosted && (!user || !user.encryptedDataKey)) {
    return {
      ok: false,
      code: 'USER_CONFIG_MISSING',
      message: 'User configuration not found. Please configure your settings first.',
    }
  }

  if (!user) {
    return {
      ok: false,
      code: 'USER_CONFIG_MISSING',
      message: 'User configuration not found. Please configure your settings first.',
    }
  }

  if (user.subscription?.storagePerAgent !== null && user.subscription?.storagePerAgent !== undefined) {
    const currentUsage = await prisma.storage.aggregate({
      where: { agentId, status: 'completed' },
      _sum: { fileSizeBytes: true }
    })
    if ((currentUsage._sum.fileSizeBytes || 0) + contentSize > user.subscription.storagePerAgent) {
      return { ok: false, code: 'STORAGE_LIMIT_EXCEEDED', message: 'Storage limit exceeded' }
    }
  }

  let ragProvider: RAGProviderType
  if (selfHosted) {
    if (knowledgeTargetFor(null)?.provider === 'http_search') return { ok: false, code: 'KNOWLEDGE_EXTERNAL', message: HTTP_SEARCH_NO_INGEST }
    ragProvider = 'pgvector'
  } else if (isManaged) {
    ragProvider = 'azure_ai_search' as RAGProviderType
  } else {
    ragProvider = (requestRagProvider || user.ragProviders?.defaultProvider || 'none') as RAGProviderType
  }

  if (ragProvider === 'none') {
    return {
      ok: false,
      code: 'RAG_PROVIDER_NOT_CONFIGURED',
      message: 'RAG Provider not configured. Please configure your RAG Provider in Settings.',
    }
  }

  const fileName = title.trim().endsWith('.txt') ? title.trim() : `${title.trim()}.txt`

  let ragSpaceId: number | null = null
  if ((isManaged && user?.subscription?.managedRegion) || selfHosted) {
    try {
      ragSpaceId = await resolveRagSpaceId(agentId, ragSpaceIdInput)
    } catch (e) {
      if (e instanceof RagSpaceError) return { ok: false, code: e.code, message: e.message }
      throw e
    }
  }

  switch (ragProvider) {
    case 'pgvector':
    case 'azure_ai_search':
      return await handleAzureAISearch(user, agent, userId, fileName, content.trim(), ragSpaceId)

    case 'openai_vector_store':
      return await handleOpenAIVectorStore(user, agent, fileName, content.trim())

    case 'gemini_file_search':
      return await handleGeminiFileSearch(user, agent, fileName, content.trim())

    case 'pinecone':
      return await handlePinecone(user, agent, fileName, content.trim())

    default:
      return {
        ok: false,
        code: 'UNSUPPORTED_RAG_PROVIDER',
        message: `Unsupported RAG Provider: ${ragProvider}`,
      }
  }
}

async function handleOpenAIVectorStore(
  user: any,
  agent: any,
  fileName: string,
  content: string
): Promise<CreateTextResult> {
  if (!user.aiProviders?.providers) {
    return {
      ok: false,
      code: 'API_KEY_MISSING',
      message: 'OpenAI API key not configured. Please configure your API key first.',
    }
  }

  let userApiKey: string
  try {
    const providersConfig = JSON.parse(user.aiProviders.providers)
    if (!providersConfig.openai?.apiKey) {
      return {
        ok: false,
        code: 'API_KEY_MISSING',
        message: 'OpenAI API key not configured. Please configure your API key first.',
      }
    }
    let dek: Buffer
    if (user.zkiId && user.zki?.masterKey) {
      dek = decryptDataKeyWithLegacy(Buffer.from(user.encryptedDataKey), user.zki.masterKey)
    } else {
      dek = await decryptDataKey(Buffer.from(user.encryptedDataKey))
    }
    userApiKey = decrypt(Buffer.from(providersConfig.openai.apiKey, "base64"), dek)
  } catch (error) {
    return {
      ok: false,
      code: 'API_KEY_DECRYPT_FAILED',
      message: 'Failed to decrypt API key. Please reconfigure your API key.',
    }
  }

  if (!agent.vectorStoreId) {
    return {
      ok: false,
      code: 'VECTOR_STORE_MISSING',
      message: 'Vector Store not configured for this agent',
    }
  }

  const storageItem = await prisma.storage.create({
    data: {
      agentId: agent.agentId,
      type: 'file',
      status: 'processing',
      title: fileName,
      fileSizeBytes: Buffer.byteLength(content, 'utf8'),
      mimeType: 'text/plain',
      content: content,
      ragProvider: 'openai_vector_store',
      processingLog: JSON.stringify({
        startTime: new Date().toISOString(),
        source: 'create_text_modal'
      }),
    },
  })

  processOpenAITextUpload(
    storageItem.id,
    fileName,
    content,
    userApiKey,
    agent.vectorStoreId
  ).catch(error => {
    console.error('Background OpenAI text processing failed:', error)
  })

  return { ok: true, storageId: storageItem.id }
}

async function handleGeminiFileSearch(
  user: any,
  agent: any,
  fileName: string,
  content: string
): Promise<CreateTextResult> {
  if (!user.aiProviders?.providers) {
    return {
      ok: false,
      code: 'API_KEY_MISSING',
      message: 'Gemini API key not configured. Please configure your API key first.',
    }
  }

  let geminiApiKey: string
  try {
    const providersConfig = JSON.parse(user.aiProviders.providers)
    if (!providersConfig.gemini?.apiKey) {
      return {
        ok: false,
        code: 'API_KEY_MISSING',
        message: 'Gemini API key not configured. Please configure your API key first.',
      }
    }
    let dek: Buffer
    if (user.zkiId && user.zki?.masterKey) {
      dek = decryptDataKeyWithLegacy(Buffer.from(user.encryptedDataKey), user.zki.masterKey)
    } else {
      dek = await decryptDataKey(Buffer.from(user.encryptedDataKey))
    }
    geminiApiKey = decrypt(Buffer.from(providersConfig.gemini.apiKey, "base64"), dek)
  } catch (error) {
    return {
      ok: false,
      code: 'API_KEY_DECRYPT_FAILED',
      message: 'Failed to decrypt API key. Please reconfigure your API key.',
    }
  }

  const storageItem = await prisma.storage.create({
    data: {
      agentId: agent.agentId,
      type: 'file',
      status: 'processing',
      title: fileName,
      fileSizeBytes: Buffer.byteLength(content, 'utf8'),
      mimeType: 'text/plain',
      content: content,
      ragProvider: 'gemini_file_search',
      processingLog: JSON.stringify({
        startTime: new Date().toISOString(),
        source: 'create_text_modal'
      }),
    },
  })

  processGeminiTextUpload(
    storageItem.id,
    fileName,
    content,
    geminiApiKey,
    agent.agentId
  ).catch(error => {
    console.error('Background Gemini text processing failed:', error)
  })

  return { ok: true, storageId: storageItem.id }
}

async function handlePinecone(
  user: any,
  agent: any,
  fileName: string,
  content: string
): Promise<CreateTextResult> {
  if (!user.ragProviders?.providers) {
    return {
      ok: false,
      code: 'PINECONE_NOT_CONFIGURED',
      message: 'Pinecone not configured. Please configure Pinecone in Settings.',
    }
  }

  let pineconeConfig: any
  try {
    const providersConfig = JSON.parse(user.ragProviders.providers)
    pineconeConfig = providersConfig.pinecone
    if (!pineconeConfig?.apiKey || !pineconeConfig?.indexName) {
      return {
        ok: false,
        code: 'PINECONE_NOT_CONFIGURED',
        message: 'Pinecone not configured. Please configure Pinecone API Key and Index Name in Settings.',
      }
    }
  } catch (error) {
    return {
      ok: false,
      code: 'PINECONE_CONFIG_INVALID',
      message: 'Failed to parse Pinecone configuration.',
    }
  }

  const embeddingModel = pineconeConfig.embeddingModel || 'llama-text-embed-v2'
  const isPineconeEmbedding = PINECONE_EMBEDDING_MODELS.includes(embeddingModel)

  let openaiApiKey: string | undefined
  if (!isPineconeEmbedding) {
    if (!user.aiProviders?.providers) {
      return {
        ok: false,
        code: 'API_KEY_MISSING',
        message: 'OpenAI API key required for OpenAI embedding models. Please configure your API key first.',
      }
    }
    try {
      const aiProvidersConfig = JSON.parse(user.aiProviders.providers)
      if (!aiProvidersConfig.openai?.apiKey) {
        return {
          ok: false,
          code: 'API_KEY_MISSING',
          message: 'OpenAI API key required for OpenAI embedding models. Please configure your API key first.',
        }
      }
      let dek: Buffer
      if (user.zkiId && user.zki?.masterKey) {
        dek = decryptDataKeyWithLegacy(Buffer.from(user.encryptedDataKey), user.zki.masterKey)
      } else {
        dek = await decryptDataKey(Buffer.from(user.encryptedDataKey))
      }
      openaiApiKey = decrypt(Buffer.from(aiProvidersConfig.openai.apiKey, "base64"), dek)
    } catch (error) {
      return {
        ok: false,
        code: 'API_KEY_DECRYPT_FAILED',
        message: 'Failed to decrypt OpenAI API key.',
      }
    }
  }

  const storageItem = await prisma.storage.create({
    data: {
      agentId: agent.agentId,
      type: 'file',
      status: 'processing',
      title: fileName,
      fileSizeBytes: Buffer.byteLength(content, 'utf8'),
      mimeType: 'text/plain',
      content: content,
      ragProvider: 'pinecone',
      processingLog: JSON.stringify({
        startTime: new Date().toISOString(),
        source: 'create_text_modal'
      }),
    },
  })

  processPineconeTextUpload(
    storageItem.id,
    fileName,
    content,
    pineconeConfig,
    openaiApiKey,
    agent.agentId
  ).catch(error => {
    console.error('Background Pinecone text processing failed:', error)
  })

  return { ok: true, storageId: storageItem.id }
}

async function handleAzureAISearch(
  user: any,
  agent: any,
  userId: string,
  fileName: string,
  content: string,
  ragSpaceId: number | null
): Promise<CreateTextResult> {
  const target = knowledgeTargetFor(user.subscription)
  const managedRegion = target?.regionId
  if (!target || !managedRegion) {
    return {
      ok: false,
      code: 'MANAGED_REGION_MISSING',
      message: 'Managed region not configured.',
    }
  }

  const storageItem = await prisma.storage.create({
    data: {
      agentId: agent.agentId,
      type: 'file',
      status: 'processing',
      title: fileName,
      fileSizeBytes: Buffer.byteLength(content, 'utf8'),
      mimeType: 'text/plain',
      content: content,
      ragProvider: target.provider,
      ragSpaceId,
      processingLog: JSON.stringify({
        startTime: new Date().toISOString(),
        source: 'create_text_modal'
      }),
    },
  })

  processAzureAISearchTextUpload(
    storageItem.id,
    fileName,
    content,
    managedRegion,
    agent.agentId,
    userId
  ).catch(error => {
    console.error('Background Azure AI Search text processing failed:', error)
  })

  return { ok: true, storageId: storageItem.id }
}

async function processAzureAISearchTextUpload(
  storageId: number,
  fileName: string,
  content: string,
  managedRegion: string,
  agentId: string,
  userId: string
) {
  let blobPath: string | undefined
  let store: KnowledgeStore | null = null
  const reclaimOwnArtifacts = async (
    withChunks: boolean,
    reason: string,
    uploaded?: { fileId: string; chunkCount: number },
  ) => {
    console.warn(`[CREATE_TEXT:AzureAISearch] storage ${storageId} ${reason} — 방금 생성한 청크/Blob 회수`)
    if (withChunks && store) {
      let step: 'chunks-by-key' | 'chunks-by-filter' | null = null
      try { await store.deleteDoc({ agentId }, String(storageId), uploaded ?? null, { onStep: (x) => { step = x } }) }
      catch (e) {
        if (step === 'chunks-by-key') {
          console.warn('[CREATE_TEXT:AzureAISearch] chunk cleanup by key failed (orphan possible):', describeCaughtError(e))
          try { await store.deleteDoc({ agentId }, String(storageId)) }
          catch (e2) { console.warn('[CREATE_TEXT:AzureAISearch] chunk cleanup by filter failed:', describeCaughtError(e2)) }
        } else {
          console.warn('[CREATE_TEXT:AzureAISearch] chunk cleanup by filter failed:', describeCaughtError(e))
        }
      }
    }
    if (blobPath) {
      try { const { deleteFromBlob } = await import('@/lib/managed/blob-storage'); await deleteFromBlob(managedRegion, blobPath) }
      catch (e) { console.warn('[CREATE_TEXT:AzureAISearch] blob cleanup failed:', describeCaughtError(e)) }
    }
  }
  try {
    await updateProcessingStatus(storageId, 'file_processing_uploading')

    store = await getKnowledgeStore({ regionId: managedRegion, allowSelfHosted: true })

    const preCheck = await prisma.storage.findUnique({ where: { id: storageId }, select: { status: true } })
    if (!preCheck || preCheck.status !== 'processing') {
      console.warn(`[CREATE_TEXT:AzureAISearch] storage ${storageId} gone/claimed before blob upload (status=${preCheck?.status ?? 'gone'}) — aborting`)
      return
    }

    const textBuffer = Buffer.from(content, 'utf-8')
    try {
      const { generateBlobPath, uploadToBlob } = await import('@/lib/managed/blob-storage')
      blobPath = generateBlobPath(userId, agentId, fileName)
      await uploadToBlob(managedRegion, blobPath, textBuffer, 'text/plain')
    } catch (blobError) {
      console.warn(`[CREATE_TEXT:AzureAISearch] Blob upload failed (continuing with indexing):`, blobError)
    }

    if (blobPath) { await prisma.storage.update({ where: { id: storageId }, data: { blobPath } }).catch(() => {}) }

    await updateProcessingStatus(storageId, 'file_processing_indexing')

    const spaceRow = await prisma.storage.findUnique({ where: { id: storageId }, select: { ragSpaceId: true, status: true } })
    if (!spaceRow || spaceRow.status !== 'processing') {
      console.warn(`[CREATE_TEXT:AzureAISearch] storage ${storageId} gone/claimed (status=${spaceRow?.status ?? 'gone'}) — aborting upload`)
      await reclaimOwnArtifacts(false, 'aborted before indexing')
      return
    }
    const result = await store.ingest({ agentId }, {
      userId,
      storageId,
      fileName,
      file: textBuffer,
      mimeType: 'text/plain',
      ragSpace: spaceRow.ragSpaceId != null ? String(spaceRow.ragSpaceId) : '',
      blobPath,
    })

    const finalized = await prisma.storage.updateMany({
      where: { id: storageId, status: 'processing' },
      data: {
        status: 'completed',
        sourceUrl: fileName,
        blobPath: blobPath || null,
        ...(result.textSize !== undefined && { fileSizeBytes: result.textSize }),
        ragStatus: JSON.stringify({
          [store.provider]: {
            ...result.providerRef,
            chunkCount: result.chunkCount || 0,
            status: 'completed',
            region: managedRegion,
            blobPath,
            createdAt: new Date().toISOString(),
          }
        }),
        processingLog: JSON.stringify({
          completedTime: new Date().toISOString(),
          finalStatus: 'completed',
          textSize: result.textSize,
          source: 'create_text_modal'
        }),
      },
    })
    if (finalized.count === 0) {
      await reclaimOwnArtifacts(true, 'deleted/claimed during indexing', 'fileId' in result.providerRef ? {
        fileId: result.providerRef.fileId,
        chunkCount: result.chunkCount ?? 0,
      } : undefined)
      return
    }

  } catch (error) {
    console.error(`[CREATE_TEXT:AzureAISearch] Failed:`, error)
    const marked = await prisma.storage.updateMany({
      where: { id: storageId, status: 'processing' },
      data: {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        blobPath: blobPath || null,
      },
    })
    if (marked.count === 0) {
      await reclaimOwnArtifacts(true, 'deleted/claimed before failure was recorded')
    }
  }
}

async function processOpenAITextUpload(
  storageId: number,
  fileName: string,
  content: string,
  apiKey: string,
  vectorStoreId: string
) {
  let openaiFileId: string | null = null
  let vectorStoreFileId: string | null = null

  try {
    const openai = new OpenAI({ apiKey })

    await updateProcessingStatus(storageId, 'file_processing_uploading')

    const textBlob = new Blob([content], { type: 'text/plain' })
    const textFile = new File([textBlob], fileName, { type: 'text/plain' })

    const fileResponse = await openai.files.create({
      file: textFile as any,
      purpose: 'assistants',
    })

    openaiFileId = fileResponse.id

    await updateProcessingStatus(storageId, 'file_processing_vector_store')

    if (openai.vectorStores) {
      const vectorResponse = await openai.vectorStores.files.create(vectorStoreId, {
        file_id: fileResponse.id,
      })
      vectorStoreFileId = vectorResponse.id
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
        throw new Error(`HTTP ${response.status}: ${errorText}`)
      }

      const vectorResponse = await response.json()
      vectorStoreFileId = vectorResponse.id
    }

    await updateProcessingStatus(storageId, 'file_processing_indexing')
    await new Promise(resolve => setTimeout(resolve, 2000))

    await prisma.storage.update({
      where: { id: storageId },
      data: {
        status: 'completed',
        openaiFileId,
        vectorStoreFileId,
        sourceUrl: fileName,
        ragStatus: JSON.stringify({
          openai_vector_store: {
            fileId: openaiFileId,
            vectorFileId: vectorStoreFileId,
            status: 'completed',
            createdAt: new Date().toISOString()
          }
        }),
        processingLog: JSON.stringify({
          completedTime: new Date().toISOString(),
          finalStatus: 'completed',
          source: 'create_text_modal'
        }),
      },
    })

  } catch (error) {
    console.error(`[CREATE_TEXT:OpenAI] Failed:`, error)
    await prisma.storage.update({
      where: { id: storageId },
      data: {
        status: 'failed',
        openaiFileId,
        vectorStoreFileId,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      },
    })

    if (openaiFileId && apiKey) {
      try {
        const openai = new OpenAI({ apiKey })
        await openai.files.delete(openaiFileId)
      } catch (e) {}
    }
  }
}

async function processGeminiTextUpload(
  storageId: number,
  fileName: string,
  content: string,
  apiKey: string,
  agentId: string
) {
  try {
    await updateProcessingStatus(storageId, 'file_processing_uploading')

    const uploadResponse = await fetch(
      `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
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
      throw new Error(`Gemini upload failed: ${errorText}`)
    }

    const uploadResult = await uploadResponse.json()
    const geminiFileId = uploadResult.file?.name || uploadResult.name

    await updateProcessingStatus(storageId, 'file_processing_indexing')
    await new Promise(resolve => setTimeout(resolve, 1000))

    await prisma.storage.update({
      where: { id: storageId },
      data: {
        status: 'completed',
        openaiFileId: geminiFileId,
        sourceUrl: fileName,
        ragStatus: JSON.stringify({
          gemini_file_search: {
            fileId: geminiFileId,
            status: 'completed',
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
          }
        }),
        processingLog: JSON.stringify({
          completedTime: new Date().toISOString(),
          finalStatus: 'completed',
          source: 'create_text_modal'
        }),
      },
    })

  } catch (error) {
    console.error(`[CREATE_TEXT:Gemini] Failed:`, error)
    await prisma.storage.update({
      where: { id: storageId },
      data: {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      },
    })
  }
}

async function processPineconeTextUpload(
  storageId: number,
  fileName: string,
  content: string,
  pineconeConfig: any,
  openaiApiKey: string | undefined,
  agentId: string
) {
  try {
    await updateProcessingStatus(storageId, 'storage_upload_pinecone_connecting')

    const connectionConfig: PineconeConnectionConfig = {
      indexName: pineconeConfig.indexName,
      namespace: agentId,
      host: pineconeConfig.host,
      embeddingModel: pineconeConfig.embeddingModel || 'llama-text-embed-v2',
      dimension: pineconeConfig.dimension || 1024,
      embeddingApiKey: openaiApiKey,
    }

    const pineconeClient = new PineconeClient(pineconeConfig.apiKey, connectionConfig)

    await updateProcessingStatus(storageId, 'storage_upload_pinecone_indexing')

    const textBuffer = Buffer.from(content, 'utf-8')
    const result = await pineconeClient.uploadFile(agentId, textBuffer, fileName, 'text/plain')

    await prisma.storage.update({
      where: { id: storageId },
      data: {
        status: 'completed',
        openaiFileId: result.fileId,  // Pinecone file ID
        sourceUrl: fileName,
        ragStatus: JSON.stringify({
          pinecone: {
            indexName: pineconeConfig.indexName,
            namespace: agentId,
            vectorCount: result.chunkCount || 1,
            embeddingModel: pineconeConfig.embeddingModel || 'llama-text-embed-v2',
            status: 'completed',
            createdAt: new Date().toISOString()
          }
        }),
        processingLog: JSON.stringify({
          completedTime: new Date().toISOString(),
          finalStatus: 'completed',
          source: 'create_text_modal',
          chunkCount: result.chunkCount
        }),
      },
    })

  } catch (error) {
    console.error(`[CREATE_TEXT:Pinecone] Failed:`, error)
    await prisma.storage.update({
      where: { id: storageId },
      data: {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      },
    })
  }
}

async function updateProcessingStatus(storageId: number, statusMessage: string) {
  try {
    await prisma.storage.update({
      where: { id: storageId },
      data: {
        processingLog: JSON.stringify({
          currentStatus: statusMessage,
          updatedAt: new Date().toISOString(),
          source: 'create_text_modal'
        })
      }
    })
  } catch (error) {
    console.error('Failed to update processing status:', error)
  }
}
