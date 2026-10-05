import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 300
export const dynamic = 'force-dynamic'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]/route'
import { PrismaClient } from '@prisma/client'
import { OpenAI } from 'openai'
import { GoogleGenAI } from '@google/genai'
import { decryptDataKey, decryptDataKeyWithLegacy, decrypt } from '@/lib/encryption'
import { describeCaughtError } from '@/lib/log-mask'
import { storageSSE } from '@/lib/storageSSE'
import { getLanguageFromHeaders, getTranslations, getErrorMessage } from '@/lib/translations/dashboard'
import { RAGProviderType } from '@/lib/rag-providers/types'
import { PineconeClient, PineconeConnectionConfig } from '@/lib/rag-providers/clients/pinecone'
import { getKnowledgeStore, knowledgeTargetFor } from '@/lib/knowledge'
import { HTTP_SEARCH_NO_INGEST } from '@/lib/knowledge/http'
import { isSelfHosted } from '@/lib/edition'
import { isBinaryFileType, isBinaryFileExtension } from '@/lib/managed/doc-intelligence'
import { resolveRagSpaceId, RagSpaceError } from '@/lib/rag-space'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: ['error', 'warn'],
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

const ALLOWED_FILE_TYPES = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/json': '.json',
  'text/markdown': '.md',
  'text/x-markdown': '.md',
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'text/x-tex': '.tex',
  'text/plain': '.txt',
  'image/jpeg': '.jpg',
  'image/png': '.png',
}

const MIN_FILE_SIZE = 20 // 20 bytes minimum
const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20MB per file

export async function POST(request: NextRequest) {
  const language = getLanguageFromHeaders(request.headers)
  const t = getTranslations(language)

  try {
    const session = await getServerSession(authOptions as any) as any

    if (!session?.user?.id) {
      return NextResponse.json({ error: getErrorMessage('api_error_unauthorized', language) }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File
    const agentId = formData.get('agentId') as string
    let ragProvider = (formData.get('ragProvider') as RAGProviderType) || 'openai_vector_store'
    const ragSpaceIdInput = formData.get('ragSpaceId') as string | null
    const purpose = formData.get('purpose') as string | null
    const isMiniAppImage = purpose === 'miniapp_image'

    if (!file) {
      return NextResponse.json({ error: t.storage_upload_no_file }, { status: 400 })
    }

    if (!agentId) {
      return NextResponse.json({ error: t.storage_upload_agent_required }, { status: 400 })
    }

    const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase()
    const isAllowedType = Object.values(ALLOWED_FILE_TYPES).includes(fileExtension) ||
                         Object.keys(ALLOWED_FILE_TYPES).includes(file.type)

    if (!isMiniAppImage && !isAllowedType) {
      return NextResponse.json({
        error: t.storage_upload_unsupported_type
      }, { status: 400 })
    }

    if (file.size < MIN_FILE_SIZE) {
      return NextResponse.json({
        error: t.storage_upload_file_too_small
          .replace('{size}', file.size.toString())
          .replace('{minSize}', MIN_FILE_SIZE.toString())
      }, { status: 400 })
    }

    if (file.size > MAX_FILE_SIZE) {
      const maxSizeMB = MAX_FILE_SIZE / (1024 * 1024)
      return NextResponse.json({
        error: t.storage_upload_size_exceeded.replace('{maxSize}', maxSizeMB.toString())
      }, { status: 400 })
    }

    const agent = await prisma.agent.findUnique({
      where: { agentId },
    })

    if (!agent || agent.userId !== session.user.id) {
      return NextResponse.json({ error: t.storage_upload_agent_not_found }, { status: 404 })
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      include: { aiProviders: true, ragProviders: true, zki: true, subscription: { select: { id: true, serviceVariant: true, managedRegion: true, storagePerAgent: true, docPagesPerMonth: true, docPagesUsed: true, docPagesMonth: true } } }
    })

    if (user?.subscription?.storagePerAgent !== null && user?.subscription?.storagePerAgent !== undefined) {
      const currentUsage = await prisma.storage.aggregate({
        where: { agentId, status: 'completed' },
        _sum: { fileSizeBytes: true }
      })
      if ((currentUsage._sum.fileSizeBytes || 0) + file.size > user.subscription.storagePerAgent) {
        return NextResponse.json({
          error: getErrorMessage('api_error_storage_limit_exceeded', language),
          code: 'STORAGE_LIMIT_EXCEEDED'
        }, { status: 400 })
      }
    }

    const isManaged = user?.subscription?.serviceVariant === 'managed'
    const managedRegion = user?.subscription?.managedRegion
    const selfHosted = isSelfHosted()
    const knowledgeTarget = knowledgeTargetFor(user?.subscription)

    if (isManaged && !managedRegion) {
      return NextResponse.json({ error: 'Managed region not configured', code: 'MANAGED_REGION_UNCONFIGURED' }, { status: 400 })
    }

    if (isManaged) {
      ragProvider = 'azure_ai_search' as RAGProviderType
    }
    if (selfHosted) {
      if (knowledgeTarget?.provider === 'http_search') {
        return NextResponse.json({ error: (t as Record<string, string>).storage_upload_knowledge_external ?? HTTP_SEARCH_NO_INGEST, code: 'KNOWLEDGE_EXTERNAL' }, { status: 400 })
      }
      ragProvider = 'pgvector'
    }

    // ========================================
    // ========================================
    if (isMiniAppImage) {
      if (!isManaged || !managedRegion) {
        return NextResponse.json({
          error: 'Mini App images require a Managed plan',
          code: 'MINIAPP_MANAGED_ONLY'
        }, { status: 400 })
      }

      const MINIAPP_IMAGE_TYPES: Record<string, string[]> = {
        'image/png': ['.png'],
        'image/jpeg': ['.jpg', '.jpeg'],
        'image/webp': ['.webp'],
      }
      const imageTypeOk = Object.entries(MINIAPP_IMAGE_TYPES).some(
        ([mime, exts]) => file.type === mime && exts.includes(fileExtension)
      )
      if (!imageTypeOk) {
        return NextResponse.json({
          error: 'Only PNG, JPEG or WebP images are allowed for Mini App images',
          code: 'MINIAPP_IMAGE_TYPE'
        }, { status: 400 })
      }

      const MINIAPP_IMAGE_MAX = 5 * 1024 * 1024
      if (file.size > MINIAPP_IMAGE_MAX) {
        return NextResponse.json({
          error: 'Mini App images must be 5MB or smaller',
          code: 'MINIAPP_IMAGE_SIZE'
        }, { status: 400 })
      }

      const { generateBlobPath, uploadToBlob, deleteFromBlob } = await import('@/lib/managed/blob-storage')
      const blobPath = generateBlobPath(session.user.id, agentId, file.name, 'miniapp')
      await uploadToBlob(managedRegion, blobPath, file, file.type)

      const safeTitle = file.name
        .replace(/[\x00-\x1F\x7F"'`\\]/g, '')
        .trim()
        .slice(0, 120) || 'image'

      let storageItem
      try {
        storageItem = await prisma.storage.create({
          data: {
            agentId,
            type: 'miniapp_image',
            status: 'completed',
            title: safeTitle,
            fileSizeBytes: file.size,
            mimeType: file.type,
            blobPath,
          }
        })
      } catch (createError) {
        try { await deleteFromBlob(managedRegion, blobPath) }
        catch (e) { console.warn('[Storage] Mini App image blob 롤백 실패:', describeCaughtError(e)) }
        console.error('[Storage] Mini App image DB row 생성 실패 → blob 롤백:', createError)
        return NextResponse.json({ error: 'Failed to save image', code: 'MINIAPP_IMAGE_SAVE_FAILED' }, { status: 500 })
      }

      console.log(`[Storage] Mini App image uploaded: ${file.name} → ${blobPath} (storage id=${storageItem.id})`)
      return NextResponse.json({
        success: true,
        storage: {
          id: storageItem.id,
          title: storageItem.title,
          type: storageItem.type,
          status: storageItem.status,
          fileSizeBytes: storageItem.fileSizeBytes,
        }
      })
    }

    if (!isManaged && !selfHosted && (!user || !user.encryptedDataKey || !user.aiProviders?.providers)) {
      return NextResponse.json({
        error: t.storage_upload_api_key_not_configured
      }, { status: 400 })
    }

    if (!user) {
      return NextResponse.json({
        error: t.storage_upload_api_key_not_configured
      }, { status: 400 })
    }

    let pineconeConfig: PineconeConnectionConfig | null = null
    let openaiApiKeyForPinecone: string | null = null
    let pineconeApiKey: string | null = null

    const getDek = async () => {
      if (user.zkiId && user.zki?.masterKey) {
        return decryptDataKeyWithLegacy(Buffer.from(user.encryptedDataKey!), user.zki.masterKey)
      } else {
        return await decryptDataKey(Buffer.from(user.encryptedDataKey!))
      }
    }

    if (ragProvider === 'pinecone') {
      let ragProvidersConfig: any = {}
      if (user.ragProviders?.providers) {
        try {
          ragProvidersConfig = typeof user.ragProviders.providers === 'string'
            ? JSON.parse(user.ragProviders.providers)
            : user.ragProviders.providers
        } catch {
        }
      }
      if (!ragProvidersConfig?.pinecone?.apiKey || !ragProvidersConfig?.pinecone?.indexName) {
        return NextResponse.json({
          error: 'Pinecone is not configured. Please set up Pinecone in Settings.'
        }, { status: 400 })
      }

      const storedApiKey = ragProvidersConfig.pinecone.apiKey
      if (storedApiKey.startsWith('pcsk_')) {
        pineconeApiKey = storedApiKey
      } else {
        const dek = await getDek()
        pineconeApiKey = decrypt(Buffer.from(storedApiKey, "base64"), dek)

        if (pineconeApiKey === "Decryption failed") {
          return NextResponse.json({
            error: 'Failed to decrypt Pinecone API key.'
          }, { status: 400 })
        }
      }

      const embeddingModel = ragProvidersConfig.pinecone.embeddingModel || 'text-embedding-3-small'
      const isPineconeEmbedding = ['llama-text-embed-v2', 'multilingual-e5-large'].includes(embeddingModel)

      if (!isPineconeEmbedding) {
        const aiProvidersConfig = JSON.parse(user.aiProviders.providers)
        if (!aiProvidersConfig.openai?.apiKey) {
          return NextResponse.json({
            error: 'OpenAI API key is required for OpenAI embedding models. Please set up your OpenAI API key in Settings.'
          }, { status: 400 })
        }
        const dekForOpenai = await getDek()
        openaiApiKeyForPinecone = decrypt(Buffer.from(aiProvidersConfig.openai.apiKey, "base64"), dekForOpenai)
      }

      pineconeConfig = {
        host: ragProvidersConfig.pinecone.host || undefined,
        indexName: ragProvidersConfig.pinecone.indexName,
        namespace: ragProvidersConfig.pinecone.namespace || undefined,
        embeddingApiKey: openaiApiKeyForPinecone || undefined,
        embeddingModel: embeddingModel,
        dimension: ragProvidersConfig.pinecone.dimension || 1536,
      }
    }

    const requiredLlmProvider = ragProvider === 'gemini_file_search' ? 'gemini' : 'openai'

    let userApiKey: string = ''
    if (ragProvider !== 'pinecone' && !(isManaged && ragProvider === 'azure_ai_search') && !selfHosted) {
      try {
        const providersConfig = JSON.parse(user.aiProviders.providers)
        const providerApiKey = providersConfig[requiredLlmProvider]?.apiKey

        if (!providerApiKey) {
          const providerName = requiredLlmProvider === 'gemini' ? 'Gemini' : 'OpenAI'
          return NextResponse.json({
            error: `${providerName} API key is not configured. Please set up your API key in Settings.`
          }, { status: 400 })
        }

        const dek = await getDek()
        userApiKey = decrypt(Buffer.from(providerApiKey, "base64"), dek)

        if (userApiKey === "Decryption failed") {
          throw new Error("API key decryption returned failure message")
        }
      } catch {
        return NextResponse.json({
          error: t.storage_upload_decrypt_failed
        }, { status: 400 })
      }
    }

    if (ragProvider === 'openai_vector_store' && !agent.vectorStoreId) {
      return NextResponse.json({
        error: t.storage_upload_vector_store_not_configured
      }, { status: 400 })
    }

    if (ragProvider === 'gemini_file_search') {
      processGeminiFileUploadDirect(
        file,
        userApiKey,
        agentId,
        language
      ).catch(error => {
        console.error('Background Gemini file processing failed:', error)
      })

      return NextResponse.json({
        success: true,
        data: {
          message: t.storage_upload_started,
          geminiUpload: true,
        },
      })
    }

    let ragSpaceId: number | null = null
    if ((isManaged && managedRegion) || selfHosted) {
      try {
        ragSpaceId = await resolveRagSpaceId(agentId, ragSpaceIdInput)
      } catch (e) {
        if (e instanceof RagSpaceError) return NextResponse.json({ error: e.message, code: e.code }, { status: 400 })
        throw e
      }
    }

    const tenSecondsAgo = new Date(Date.now() - 10000)
    const recentDuplicate = await prisma.storage.findFirst({
      where: {
        agentId,
        title: file.name,
        fileSizeBytes: file.size,
        createdAt: { gte: tenSecondsAgo },
        ...(ragSpaceId != null ? { ragSpaceId } : {}),
      }
    })

    if (recentDuplicate) {
      return NextResponse.json({
        success: true,
        data: {
          id: recentDuplicate.id,
          message: t.storage_upload_started,
          duplicate: true,
        },
      })
    }

    const storageItem = await prisma.storage.create({
      data: {
        agentId,
        type: 'file',
        status: 'processing',
        title: file.name,
        sourceUrl: file.name,
        fileSizeBytes: file.size,
        mimeType: file.type || 'application/octet-stream',
        content: null,
        ragProvider,
        ragSpaceId,
        processingLog: JSON.stringify({
          startTime: new Date().toISOString(),
          ragProvider,
        }),
      },
    })

    if (selfHosted && knowledgeTarget) {
      processAzureAISearchFileUpload(
        storageItem.id,
        file,
        knowledgeTarget.regionId,
        agentId,
        session.user.id,
        language,
        undefined
      ).catch(error => {
        console.error('Background knowledge file processing failed:', error)
      })
    } else if (ragProvider === 'azure_ai_search' && isManaged && managedRegion) {
      processAzureAISearchFileUpload(
        storageItem.id,
        file,
        managedRegion,
        agentId,
        session.user.id,
        language,
        user?.subscription ? { id: user.subscription.id, docPagesPerMonth: user.subscription.docPagesPerMonth, docPagesUsed: user.subscription.docPagesUsed, docPagesMonth: user.subscription.docPagesMonth } : undefined
      ).catch(error => {
        console.error('Background Azure AI Search file processing failed:', error)
      })
    } else if (ragProvider === 'pinecone' && pineconeConfig && pineconeApiKey) {
      processPineconeFileUpload(
        storageItem.id,
        file,
        pineconeApiKey,
        pineconeConfig,
        agentId,
        language
      ).catch(error => {
        console.error('Background Pinecone file processing failed:', error)
      })
    } else {
      processFileUpload(
        storageItem.id,
        file,
        userApiKey,
        agent.vectorStoreId!,
        agentId,
        language
      ).catch(error => {
        console.error('Background file processing failed:', error)
      })
    }

    return NextResponse.json({
      success: true,
      data: {
        id: storageItem.id,
        message: t.storage_upload_started,
      },
    })

  } catch (error) {
    console.error('Failed to upload file:', error)
    return NextResponse.json(
      { error: t.storage_upload_failed },
      { status: 500 }
    )
  }
}

async function updateProcessingStatus(storageId: number, agentId: string, statusMessage: string, language: string, userMessage?: string) {
  try {
    const t = getTranslations(language)

    const messageMap: { [key: string]: string } = {
      'file_processing_uploading': t.storage_upload_processing_uploading,
      'file_processing_vector_store': t.storage_upload_processing_vector_store,
      'file_processing_indexing': t.storage_upload_processing_indexing,
      'file_processing_completed': t.storage_upload_processing_completed,
      'pinecone_extracting': t.storage_upload_pinecone_extracting,
      'pinecone_connecting': t.storage_upload_pinecone_connecting,
      'pinecone_indexing': t.storage_upload_pinecone_indexing,
      'gemini_uploading': t.storage_upload_gemini_uploading,
      'gemini_processing': t.storage_upload_gemini_processing,
    }

    const displayMessage = userMessage || messageMap[statusMessage] || statusMessage

    await prisma.storage.update({
      where: { id: storageId },
      data: {
        processingLog: JSON.stringify({
          startTime: new Date().toISOString(),
          currentStatus: statusMessage,
          displayMessage,
          updatedAt: new Date().toISOString()
        })
      }
    })

    storageSSE.sendFileUploadUpdate(
      storageId,
      agentId,
      'processing',
      displayMessage
    )
  } catch (error) {
    console.error('Failed to update processing status:', error)
  }
}

async function processFileUpload(
  storageId: number,
  file: File,
  apiKey: string,
  vectorStoreId: string,
  agentId: string,
  language: string
) {
  const t = getTranslations(language)
  let openaiFileId: string | null = null
  let vectorStoreFileId: string | null = null

  try {
    const openai = new OpenAI({
      apiKey,
      timeout: 300000,
      maxRetries: 3,
    })


    storageSSE.sendFileUploadUpdate(storageId, agentId, 'queued', t.storage_upload_queued)

    await updateProcessingStatus(storageId, agentId, 'file_processing_uploading', language)

    const fileResponse = await openai.files.create({
      file: file as any,
      purpose: 'assistants',
    })

    openaiFileId = fileResponse.id

    await updateProcessingStatus(storageId, agentId, 'file_processing_vector_store', language)

    try {
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
          body: JSON.stringify({
            file_id: fileResponse.id
          })
        })

        if (!response.ok) {
          const errorText = await response.text()
          throw new Error(`HTTP ${response.status}: ${errorText}`)
        }
        
        const vectorResponse = await response.json()
        vectorStoreFileId = vectorResponse.id
      }
    } catch (vectorError) {
      throw vectorError
    }

    if (!vectorStoreFileId) {
      throw new Error('Vector store file ID is missing after upload')
    }

    const ingestionStatus = await waitForVectorStoreIngestion(openai, vectorStoreId, vectorStoreFileId, apiKey, file.size)

    if (ingestionStatus.status !== 'completed') {
      const failureMessage = ingestionStatus.error
        ? `Vector Store ingestion failed: ${ingestionStatus.error}`
        : `Vector Store ingestion did not complete (status: ${ingestionStatus.status})`

      try {
        if (vectorStoreFileId) {
          if (openai.vectorStores?.files) {
            await openai.vectorStores.files.delete(vectorStoreFileId, {
              vector_store_id: vectorStoreId,
            })
          } else {
            await fetch(`https://api.openai.com/v1/vector_stores/${vectorStoreId}/files/${vectorStoreFileId}`, {
              method: 'DELETE',
              headers: {
                'Authorization': `Bearer ${apiKey}`,
                'OpenAI-Beta': 'assistants=v2'
              }
            })
          }
        }
      } catch (cleanupError) {
        console.error('[UPLOAD] Failed to cleanup vector store file after ingestion failure:', cleanupError)
      }

      if (openaiFileId) {
        try {
          await openai.files.delete(openaiFileId)
        } catch (cleanupError) {
          console.error('[UPLOAD] Failed to cleanup OpenAI file after ingestion failure:', cleanupError)
        }
      }

      throw new Error(failureMessage)
    }

    await updateProcessingStatus(storageId, agentId, 'file_processing_indexing', language)

    await new Promise(resolve => setTimeout(resolve, 2000))

    const ragStatus = {
      openai_vector_store: {
        fileId: openaiFileId,
        vectorFileId: vectorStoreFileId,
        status: 'completed',
        createdAt: new Date().toISOString(),
      }
    }

    await prisma.storage.update({
      where: { id: storageId },
      data: {
        status: 'completed',
        openaiFileId,
        vectorStoreFileId,
        ragStatus: JSON.stringify(ragStatus),
        sourceUrl: fileResponse.filename || file.name,
        processingLog: JSON.stringify({
          startTime: new Date().toISOString(),
          completedTime: new Date().toISOString(),
          openaiFileId,
          vectorStoreFileId,
          ragProvider: 'openai_vector_store',
          finalStatus: 'file_processing_completed'
        }),
      },
    })

    storageSSE.sendFileUploadUpdate(storageId, agentId, 'completed', t.storage_upload_processing_completed)


  } catch (error) {
    console.error(`[UPLOAD] Failed to process file:`, error)

    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'

    const ragStatusFailed = {
      openai_vector_store: {
        fileId: openaiFileId,
        vectorFileId: vectorStoreFileId,
        status: 'failed',
        error: errorMessage,
        createdAt: new Date().toISOString(),
      }
    }

    await prisma.storage.update({
      where: { id: storageId },
      data: {
        status: 'failed',
        openaiFileId,
        vectorStoreFileId,
        ragStatus: JSON.stringify(ragStatusFailed),
        errorMessage: errorMessage,
        processingLog: JSON.stringify({
          startTime: new Date().toISOString(),
          failedTime: new Date().toISOString(),
          error: errorMessage,
          ragProvider: 'openai_vector_store',
        }),
      },
    })

    storageSSE.sendFileUploadUpdate(storageId, agentId, 'failed', `Processing failed: ${errorMessage}`, errorMessage)

    if (openaiFileId && apiKey) {
      try {
        const openai = new OpenAI({ apiKey, timeout: 60000 })
        await openai.files.delete(openaiFileId)
      } catch (cleanupError) {
        console.error(`[UPLOAD] Failed to cleanup OpenAI file:`, cleanupError)
      }
    }
  }
}

async function waitForVectorStoreIngestion(openai: OpenAI, vectorStoreId: string, vectorStoreFileId: string, apiKey: string, fileSize?: number) {
  const getMaxAttempts = (size?: number) => {
    if (!size) return 60
    if (size > 25 * 1024 * 1024) return 90
    if (size > 10 * 1024 * 1024) return 60
    return 30
  }
  const maxAttempts = getMaxAttempts(fileSize)
  const delayMs = 3000

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      let fileStatus: any

      if (openai.vectorStores?.files) {
        fileStatus = await openai.vectorStores.files.retrieve(vectorStoreFileId, {
          vector_store_id: vectorStoreId,
        })
      } else {
        const response = await fetch(`https://api.openai.com/v1/vector_stores/${vectorStoreId}/files/${vectorStoreFileId}`, {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'OpenAI-Beta': 'assistants=v2'
          }
        })

        if (!response.ok) {
          const text = await response.text()
          throw new Error(`Failed to fetch vector store file status: ${response.status} ${text}`)
        }

        fileStatus = await response.json()
      }

      if (fileStatus?.status === 'completed') {
        return { status: 'completed' as const }
      }

      if (fileStatus?.status === 'failed') {
        const errorMessage = fileStatus?.last_error?.message || 'Unknown vector store ingestion error'
        return { status: 'failed' as const, error: errorMessage }
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs))
    } catch (error) {
      console.error('[UPLOAD] Vector store ingestion status check failed:', error)
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  return { status: 'timeout' as const, error: 'Vector store ingestion timeout' }
}

async function processGeminiFileUpload(
  storageId: number,
  file: File,
  apiKey: string,
  agentId: string,
  language: string
) {
  const t = getTranslations(language)
  let geminiFileId: string | null = null

  try {
    const genAI = new GoogleGenAI({ apiKey })

    storageSSE.sendFileUploadUpdate(storageId, agentId, 'queued', t.storage_upload_gemini_uploading)

    await updateProcessingStatus(storageId, agentId, 'gemini_uploading', language)

    const arrayBuffer = await file.arrayBuffer()
    const blob = new Blob([arrayBuffer], { type: file.type || 'application/octet-stream' })

    const uploadResult = await genAI.files.upload({
      file: blob,
      config: {
        displayName: file.name,
        mimeType: file.type || 'application/octet-stream',
      },
    })

    geminiFileId = uploadResult.name || null

    if (!geminiFileId) {
      throw new Error('Failed to get Gemini file ID')
    }

    await updateProcessingStatus(storageId, agentId, 'gemini_processing', language)

    let fileInfo = uploadResult
    let attempts = 0
    const maxAttempts = 120

    while (fileInfo.state === 'PROCESSING' && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000))
      fileInfo = await genAI.files.get({ name: geminiFileId })
      attempts++

      if (attempts % 10 === 0) {
        storageSSE.sendFileUploadUpdate(
          storageId,
          agentId,
          'processing',
          `${t.storage_upload_gemini_processing} (${attempts}s)`
        )
      }
    }

    if (fileInfo.state === 'FAILED') {
      throw new Error('Gemini file processing failed')
    }

    if (fileInfo.state !== 'ACTIVE') {
      throw new Error(`Gemini file processing timeout (state: ${fileInfo.state})`)
    }

    const ragStatus = {
      gemini_file_search: {
        fileId: geminiFileId,
        fileUri: fileInfo.uri,
        status: 'completed',
        mimeType: fileInfo.mimeType,
        sizeBytes: fileInfo.sizeBytes,
        createdAt: new Date().toISOString(),
      }
    }

    await prisma.storage.update({
      where: { id: storageId },
      data: {
        status: 'completed',
        ragStatus: JSON.stringify(ragStatus),
        processingLog: JSON.stringify({
          startTime: new Date().toISOString(),
          completedTime: new Date().toISOString(),
          geminiFileId,
          geminiFileUri: fileInfo.uri,
          ragProvider: 'gemini_file_search',
          finalStatus: 'file_processing_completed'
        }),
      },
    })

    storageSSE.sendFileUploadUpdate(storageId, agentId, 'completed', 'File uploaded to Gemini successfully')

  } catch (error) {
    console.error(`[GEMINI UPLOAD] Failed to process file:`, error)

    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'

    const ragStatus = {
      gemini_file_search: {
        fileId: geminiFileId,
        status: 'failed',
        error: errorMessage,
        createdAt: new Date().toISOString(),
      }
    }

    await prisma.storage.update({
      where: { id: storageId },
      data: {
        status: 'failed',
        ragStatus: JSON.stringify(ragStatus),
        errorMessage: errorMessage,
        processingLog: JSON.stringify({
          startTime: new Date().toISOString(),
          failedTime: new Date().toISOString(),
          error: errorMessage,
          ragProvider: 'gemini_file_search',
        }),
      },
    })

    storageSSE.sendFileUploadUpdate(storageId, agentId, 'failed', `Gemini upload failed: ${errorMessage}`, errorMessage)

    if (geminiFileId && apiKey) {
      try {
        const genAI = new GoogleGenAI({ apiKey })
        await genAI.files.delete({ name: geminiFileId })
      } catch (cleanupError) {
        console.error(`[GEMINI UPLOAD] Failed to cleanup Gemini file:`, cleanupError)
      }
    }
  }
}

async function processGeminiFileUploadDirect(
  file: File,
  apiKey: string,
  agentId: string,
  language: string
) {
  const t = getTranslations(language)

  try {
    const genAI = new GoogleGenAI({ apiKey })

    const arrayBuffer = await file.arrayBuffer()
    const blob = new Blob([arrayBuffer], { type: file.type || 'application/octet-stream' })

    const uploadResult = await genAI.files.upload({
      file: blob,
      config: {
        displayName: file.name,
        mimeType: file.type || 'application/octet-stream',
      },
    })

    const geminiFileId = uploadResult.name

    if (!geminiFileId) {
      throw new Error('Failed to get Gemini file ID')
    }

    let fileInfo = uploadResult
    let attempts = 0
    const maxAttempts = 120

    while (fileInfo.state === 'PROCESSING' && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000))
      fileInfo = await genAI.files.get({ name: geminiFileId })
      attempts++
    }

    if (fileInfo.state === 'FAILED') {
      throw new Error('Gemini file processing failed')
    }

    if (fileInfo.state !== 'ACTIVE') {
      throw new Error(`Gemini file processing timeout (state: ${fileInfo.state})`)
    }

    console.log(`[GEMINI UPLOAD DIRECT] File uploaded successfully: ${file.name} -> ${geminiFileId}`)

  } catch (error) {
    console.error(`[GEMINI UPLOAD DIRECT] Failed to process file:`, error)
  }
}

async function processPineconeFileUpload(
  storageId: number,
  file: File,
  pineconeApiKey: string,
  config: PineconeConnectionConfig,
  agentId: string,
  language: string
) {
  const t = getTranslations(language)

  try {
    await updateProcessingStatus(storageId, agentId, 'pinecone_extracting', language)

    const fileBuffer = Buffer.from(await file.arrayBuffer())
    const fileContent = await extractTextFromFile(fileBuffer, file.name, file.type)

    if (!fileContent || fileContent.trim().length === 0) {
      throw new Error('Failed to extract text content from file')
    }

    await updateProcessingStatus(storageId, agentId, 'pinecone_connecting', language)

    const pineconeClient = new PineconeClient(pineconeApiKey, config)

    await updateProcessingStatus(storageId, agentId, 'pinecone_indexing', language)

    const chunks = splitTextIntoChunks(fileContent, 1000, 200)

    const documents = chunks.map((chunk, index) => ({
      id: `${storageId}-${index}`,
      content: chunk,
      metadata: {
        storageId: storageId.toString(),
        agentId,
        fileName: file.name,
        chunkIndex: index,
        totalChunks: chunks.length,
      }
    }))

    await pineconeClient.upsertDocuments(agentId, documents)

    const ragStatus = {
      pinecone: {
        indexName: config.indexName,
        namespace: config.namespace || '',
        vectorCount: chunks.length,
        embeddingModel: config.embeddingModel,
        dimension: config.dimension,
        status: 'completed',
        createdAt: new Date().toISOString(),
      }
    }

    await prisma.storage.update({
      where: { id: storageId },
      data: {
        status: 'completed',
        ragStatus: JSON.stringify(ragStatus),
        processingLog: JSON.stringify({
          startTime: new Date().toISOString(),
          completedTime: new Date().toISOString(),
          ragProvider: 'pinecone',
          vectorCount: chunks.length,
          finalStatus: 'file_processing_completed'
        }),
      },
    })

    storageSSE.sendFileUploadUpdate(storageId, agentId, 'completed', `File indexed to Pinecone (${chunks.length} vectors)`)

  } catch (error) {
    console.error(`[PINECONE UPLOAD] Failed to process file:`, error)

    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'

    const ragStatus = {
      pinecone: {
        indexName: config.indexName,
        namespace: config.namespace || '',
        status: 'failed',
        error: errorMessage,
        createdAt: new Date().toISOString(),
      }
    }

    await prisma.storage.update({
      where: { id: storageId },
      data: {
        status: 'failed',
        ragStatus: JSON.stringify(ragStatus),
        errorMessage: errorMessage,
        processingLog: JSON.stringify({
          startTime: new Date().toISOString(),
          failedTime: new Date().toISOString(),
          error: errorMessage,
          ragProvider: 'pinecone',
        }),
      },
    })

    storageSSE.sendFileUploadUpdate(storageId, agentId, 'failed', `Pinecone upload failed: ${errorMessage}`, errorMessage)
  }
}

async function processAzureAISearchFileUpload(
  storageId: number,
  file: File,
  managedRegion: string,
  agentId: string,
  userId: string,
  language: string,
  subscription?: { docPagesPerMonth: number | null; docPagesUsed: number; docPagesMonth: number; id?: string }
) {
  try {
    const isBinary = isBinaryFileType(file.type) || isBinaryFileExtension(file.name)
    if (isBinary && subscription?.docPagesPerMonth !== null && subscription?.docPagesPerMonth !== undefined) {
      const currentMonth = new Date().getMonth() + 1 // 1~12

      if (subscription.docPagesMonth !== currentMonth) {
        await prisma.subscription.update({
          where: { id: subscription.id },
          data: { docPagesUsed: 0, docPagesMonth: currentMonth },
        })
        subscription.docPagesUsed = 0
        subscription.docPagesMonth = currentMonth
      }

      if (subscription.docPagesUsed >= subscription.docPagesPerMonth) {
        throw new Error(`DOC_PAGES_LIMIT_EXCEEDED:${subscription.docPagesUsed}/${subscription.docPagesPerMonth}`)
      }
    }

    storageSSE.sendFileUploadUpdate(storageId, agentId, 'processing', isSelfHosted() ? 'Reading document...' : 'Uploading to Azure AI Search...')

    const store = await getKnowledgeStore({ regionId: managedRegion, docIntelligence: true, allowSelfHosted: true })

    const preCheck = await prisma.storage.findUnique({ where: { id: storageId }, select: { id: true } })
    if (!preCheck) {
      console.warn(`[AzureAISearch] storage ${storageId} gone before blob upload (space deleted?) — aborting`)
      return
    }

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    let blobPath: string | undefined
    try {
      const { generateBlobPath, uploadToBlob } = await import('@/lib/managed/blob-storage')
      blobPath = generateBlobPath(userId, agentId, file.name)
      await uploadToBlob(managedRegion, blobPath, buffer, file.type)
    } catch (blobError) {
      console.warn(`[AzureAISearch] Blob upload failed (continuing with indexing):`, blobError)
    }

    if (blobPath) { await prisma.storage.update({ where: { id: storageId }, data: { blobPath } }).catch(() => {}) }

    storageSSE.sendFileUploadUpdate(storageId, agentId, 'processing', 'Indexing document...')

    const spaceRow = await prisma.storage.findUnique({ where: { id: storageId }, select: { ragSpaceId: true } })
    if (!spaceRow) {
      console.warn(`[AzureAISearch] storage ${storageId} no longer exists (space deleted?) — aborting upload`)
      if (blobPath) { try { const { deleteFromBlob } = await import('@/lib/managed/blob-storage'); await deleteFromBlob(managedRegion, blobPath) } catch (e) { console.warn('[AzureAISearch] blob cleanup failed:', describeCaughtError(e)) } }
      return
    }
    const result = await store.ingest({ agentId }, {
      userId,
      storageId,
      fileName: file.name,
      file: buffer,
      mimeType: file.type,
      ragSpace: spaceRow.ragSpaceId != null ? String(spaceRow.ragSpaceId) : '',
      blobPath,
    })
    const indexName = 'indexName' in result.providerRef ? result.providerRef.indexName : undefined

    const stillExists = await prisma.storage.findUnique({ where: { id: storageId }, select: { id: true } })
    if (!stillExists) {
      console.warn(`[AzureAISearch] storage ${storageId} deleted during indexing — cleaning up uploaded chunks/blob`)
      try { await store.deleteDoc({ agentId }, String(storageId)) } catch (e) { console.warn('[AzureAISearch] chunk cleanup failed (orphan possible):', describeCaughtError(e)) }
      if (blobPath) { try { const { deleteFromBlob } = await import('@/lib/managed/blob-storage'); await deleteFromBlob(managedRegion, blobPath) } catch (e) { console.warn('[AzureAISearch] blob cleanup failed:', describeCaughtError(e)) } }
      return
    }

    if (result.pageCount && result.pageCount > 0 && subscription?.id) {
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: { docPagesUsed: { increment: result.pageCount } },
      })
      console.log(`[AzureAISearch] Doc pages used: +${result.pageCount} (storage=${storageId})`)
    }

    const ragStatus = {
      [store.provider]: {
        ...result.providerRef,
        chunkCount: result.chunkCount || 0,
        pageCount: result.pageCount || 0,
        status: 'completed',
        region: managedRegion,
        createdAt: new Date().toISOString(),
      }
    }

    await prisma.storage.update({
      where: { id: storageId },
      data: {
        status: 'completed',
        ragProvider: store.provider,
        ragStatus: JSON.stringify(ragStatus),
        blobPath: blobPath || null,
        ...(result.textSize !== undefined && { fileSizeBytes: result.textSize }),
        processingLog: JSON.stringify({
          startTime: new Date().toISOString(),
          completedTime: new Date().toISOString(),
          ragProvider: store.provider,
          region: managedRegion,
          indexName,
          chunkCount: result.chunkCount,
          pageCount: result.pageCount,
          textSize: result.textSize,
          blobPath,
        }),
      },
    })

    storageSSE.sendFileUploadUpdate(storageId, agentId, 'completed', isSelfHosted() ? 'File added to document search' : 'File uploaded to Azure AI Search')

  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : 'Azure AI Search upload failed'
    const isDocPagesLimit = rawMessage.startsWith('DOC_PAGES_LIMIT_EXCEEDED')
    const errorMessage = isDocPagesLimit
      ? getErrorMessage('api_error_doc_pages_limit_exceeded', language)
      : rawMessage
    console.error(`[AzureAISearch] Upload failed for storage ${storageId}:`, error)

    await prisma.storage.update({
      where: { id: storageId },
      data: {
        status: 'failed',
        ragProvider: isSelfHosted() ? 'pgvector' : 'azure_ai_search',
        ragStatus: JSON.stringify({
          [isSelfHosted() ? 'pgvector' : 'azure_ai_search']: { status: 'failed', error: errorMessage, createdAt: new Date().toISOString() }
        }),
        errorMessage,
        blobPath: blobPath || null,
      },
    })

    storageSSE.sendFileUploadUpdate(storageId, agentId, 'failed', errorMessage, errorMessage)
  }
}

function splitTextIntoChunks(text: string, chunkSize: number, overlap: number): string[] {
  const chunks: string[] = []
  let start = 0

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length)
    chunks.push(text.slice(start, end))
    start = end - overlap
    if (start >= text.length - overlap) break
  }

  return chunks
}

async function extractTextFromFile(buffer: Buffer, fileName: string, mimeType: string): Promise<string> {
  const extension = fileName.split('.').pop()?.toLowerCase()

  if (extension === 'txt' || extension === 'md' || mimeType === 'text/plain' || mimeType === 'text/markdown') {
    return buffer.toString('utf-8')
  }

  if (extension === 'json' || mimeType === 'application/json') {
    try {
      const json = JSON.parse(buffer.toString('utf-8'))
      return JSON.stringify(json, null, 2)
    } catch {
      return buffer.toString('utf-8')
    }
  }

  if (extension === 'pdf') {
    throw new Error('PDF files require additional processing. Please convert to TXT or MD format.')
  }

  if (extension === 'docx') {
    throw new Error('Word documents require additional processing. Please convert to TXT or MD format.')
  }

  return buffer.toString('utf-8')
}
