import { PrismaClient } from '@prisma/client'
import { OpenAI } from 'openai'
import { GoogleGenAI } from '@google/genai'
import { decryptDataKey, decryptDataKeyWithLegacy, decrypt } from './encryption'
import { describeCaughtError } from '@/lib/log-mask'
import { RAGProviderType } from '@/lib/rag-providers/types'
import { PineconeClient, PineconeConnectionConfig } from '@/lib/rag-providers/clients/pinecone'
import { getKnowledgeStore } from '@/lib/knowledge'

const PINECONE_EMBEDDING_MODELS = ['llama-text-embed-v2', 'multilingual-e5-large', 'pinecone-sparse-english-v0']

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  googleDriveQueue: GoogleDriveQueue | undefined
}

interface GoogleDriveJob {
  storageId: number
  agentId: string
  fileName: string
  content: string | Buffer | ArrayBuffer | Blob
  mimeType: string
  vectorStoreId: string | null
  userApiKey: string
  ragProvider?: RAGProviderType
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'retrying'
  createdAt: Date
  attempts: number
  lastError?: string
  failureType?: 'timeout' | 'network' | 'api_error' | 'server_error' | 'unknown'
}

interface SSEUpdate {
  type: 'google_drive_update'
  storageId: number
  agentId: string
  status: string
  message: string
  progress?: number
  error?: string
}

class GoogleDriveQueue {
  private jobs = new Map<number, GoogleDriveJob>()
  private processing = new Set<number>()
  private isProcessing = false
  private maxConcurrent = 1
  private sseClients = new Set<(update: SSEUpdate) => void>()
  private prisma: PrismaClient

  constructor() {
    this.prisma = globalForPrisma.prisma ?? new PrismaClient({
      log: ['error', 'warn'],
    })
    
    if (process.env.NODE_ENV !== 'production') {
      globalForPrisma.prisma = this.prisma
    }

    this.recoverUnfinishedJobs()
  }

  addSSEClient(callback: (update: SSEUpdate) => void) {
    this.sseClients.add(callback)
  }

  removeSSEClient(callback: (update: SSEUpdate) => void) {
    this.sseClients.delete(callback)
  }

  private sendSSEUpdate(update: SSEUpdate) {
    this.sseClients.forEach(client => {
      try {
        client(update)
      } catch (error) {
        // Failed to send SSE update
      }
    })
  }

  private async recoverUnfinishedJobs() {
    try {
      
      const pendingJobs = await this.prisma.storage.findMany({
        where: {
          type: 'google_drive',
          status: 'processing'
        },
        include: {
          agent: true
        }
      })

      for (const job of pendingJobs) {
        if (job.agent.vectorStoreId) {
          await this.prisma.storage.update({
            where: { id: job.id },
            data: {
              status: 'processing',
              errorMessage: 'Server restart - retrying automatically',
              processingLog: JSON.stringify({
                status: 'queued',
                substatus: 'Server restart detected - will retry automatically',
                timestamps: {
                  startTime: new Date().toISOString(),
                  lastUpdate: new Date().toISOString(),
                }
              })
            }
          })

          await this.addJob({
            storageId: job.id,
            fileName: job.title,
            content: '',
            mimeType: job.mimeType || 'text/plain',
            agentId: job.agentId,
            vectorStoreId: job.agent.vectorStoreId,
            userApiKey: ''
          })
        }
      }

      // Recovery completed
    } catch (error) {
      // Failed to recover unfinished jobs
    }
  }

  async addJob(jobData: Omit<GoogleDriveJob, 'status' | 'createdAt' | 'attempts'>): Promise<void> {
    const job: GoogleDriveJob = {
      ...jobData,
      status: 'queued',
      createdAt: new Date(),
      attempts: 0
    }

    this.jobs.set(job.storageId, job)

    this.sendSSEUpdate({
      type: 'google_drive_update',
      storageId: job.storageId,
      agentId: job.agentId,
      status: 'queued',
      message: 'Added to processing queue'
    })

    this.processNext()
  }

  private async processNext(): Promise<void> {
    if (this.isProcessing || this.processing.size >= this.maxConcurrent) {
      return
    }

    const queuedJob = Array.from(this.jobs.values()).find(
      job => job.status === 'queued' && !this.processing.has(job.storageId)
    )

    if (!queuedJob) {
      return
    }

    this.isProcessing = true
    this.processing.add(queuedJob.storageId)
    queuedJob.status = 'processing'

    try {
      await this.executeJob(queuedJob)
      queuedJob.status = 'completed'

      this.sendSSEUpdate({
        type: 'google_drive_update',
        storageId: queuedJob.storageId,
        agentId: queuedJob.agentId,
        status: 'completed',
        message: 'File successfully processed'
      })

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      queuedJob.lastError = errorMessage
      queuedJob.attempts++

      queuedJob.status = 'failed'

      this.sendSSEUpdate({
        type: 'google_drive_update',
        storageId: queuedJob.storageId,
        agentId: queuedJob.agentId,
        status: 'failed',
        message: `Processing failed: ${errorMessage}`,
        error: errorMessage
      })
    } finally {
      this.processing.delete(queuedJob.storageId)
      
      if (queuedJob.status === 'completed' || queuedJob.status === 'failed') {
        this.jobs.delete(queuedJob.storageId)
      }

      this.isProcessing = false

      setTimeout(() => this.processNext(), 1000)
    }
  }

  private async executeJob(job: GoogleDriveJob): Promise<void> {
    const { storageId, fileName, content, mimeType, agentId, vectorStoreId, ragProvider } = job

    this.sendSSEUpdate({
      type: 'google_drive_update',
      storageId,
      agentId,
      status: 'processing',
      message: 'Preparing file for upload...'
    })

    const agent = await this.prisma.agent.findUnique({
      where: { agentId },
      include: { user: { include: { aiProviders: true, ragProviders: true, zki: true } } }
    })

    if (!agent) {
      throw new Error('Agent not found')
    }

    const subscription = await this.prisma.subscription.findUnique({
      where: { id: agent.user.id },
      select: { serviceVariant: true, managedRegion: true }
    })
    const isManaged = subscription?.serviceVariant === 'managed'
    const effectiveRagProvider = isManaged ? 'azure_ai_search' : ragProvider

    if (effectiveRagProvider === 'azure_ai_search' && isManaged && subscription?.managedRegion) {
      await this.executeAzureAISearchUpload(job, subscription.managedRegion)
    } else if (effectiveRagProvider === 'pinecone') {
      if (!agent.user.encryptedDataKey) {
        throw new Error('User configuration not found')
      }
      let dek: Buffer
      if (agent.user.zkiId && agent.user.zki?.masterKey) {
        dek = decryptDataKeyWithLegacy(Buffer.from(agent.user.encryptedDataKey), agent.user.zki.masterKey)
      } else {
        dek = await decryptDataKey(Buffer.from(agent.user.encryptedDataKey))
      }
      await this.executePineconeUpload(job, agent.user, dek)
    } else if (ragProvider === 'gemini_file_search') {
      if (!agent.user.encryptedDataKey) {
        throw new Error('User configuration not found')
      }
      let dek: Buffer
      if (agent.user.zkiId && agent.user.zki?.masterKey) {
        dek = decryptDataKeyWithLegacy(Buffer.from(agent.user.encryptedDataKey), agent.user.zki.masterKey)
      } else {
        dek = await decryptDataKey(Buffer.from(agent.user.encryptedDataKey))
      }
      if (!agent.user.aiProviders?.providers) {
        throw new Error('Gemini API key not configured')
      }
      const providersConfig = JSON.parse(agent.user.aiProviders.providers)
      if (!providersConfig.gemini?.apiKey) {
        throw new Error('Gemini API key not configured')
      }

      const geminiApiKey = decrypt(Buffer.from(providersConfig.gemini.apiKey, "base64"), dek)
      if (geminiApiKey === "Decryption failed") {
        throw new Error("Gemini API key decryption failed")
      }

      await this.executeGeminiUpload(job, geminiApiKey)
    } else {
      if (!agent.user.encryptedDataKey) {
        throw new Error('User configuration not found')
      }
      let dek: Buffer
      if (agent.user.zkiId && agent.user.zki?.masterKey) {
        dek = decryptDataKeyWithLegacy(Buffer.from(agent.user.encryptedDataKey), agent.user.zki.masterKey)
      } else {
        dek = await decryptDataKey(Buffer.from(agent.user.encryptedDataKey))
      }
      if (!agent.user.aiProviders?.providers) {
        throw new Error('OpenAI API key not configured')
      }
      const providersConfig = JSON.parse(agent.user.aiProviders.providers)
      if (!providersConfig.openai?.apiKey) {
        throw new Error('OpenAI API key not configured')
      }

      const openaiApiKey = decrypt(Buffer.from(providersConfig.openai.apiKey, "base64"), dek)
      if (openaiApiKey === "Decryption failed") {
        throw new Error("OpenAI API key decryption failed")
      }

      await this.executeOpenAIUpload(job, openaiApiKey)
    }
  }

  private async executeOpenAIUpload(job: GoogleDriveJob, userApiKey: string): Promise<void> {
    const { storageId, fileName, content, mimeType, agentId, vectorStoreId } = job

    if (!vectorStoreId) {
      throw new Error('Vector Store ID is required for OpenAI upload')
    }

    const openai = new OpenAI({
      apiKey: userApiKey,
      timeout: 300000,
      maxRetries: 3,
    })

    this.sendSSEUpdate({
      type: 'google_drive_update',
      storageId,
      agentId,
      status: 'processing',
      message: 'Uploading file to OpenAI...'
    })

    let fileForUpload: File

    if (typeof content === 'string') {
      const fileBuffer = Buffer.from(content, 'utf-8')
      let processedFileName = fileName
      if (mimeType?.startsWith('application/vnd.google-apps')) {
        processedFileName = fileName + '.txt'
      }
      fileForUpload = new File([fileBuffer], processedFileName, { type: 'text/plain' })
    } else if (content instanceof ArrayBuffer) {
      fileForUpload = new File([content], fileName, { type: mimeType })
    } else if (Buffer.isBuffer(content)) {
      fileForUpload = new File([new Uint8Array(content)], fileName, { type: mimeType })
    } else if (content && typeof content === 'object' && 'arrayBuffer' in content) {
      const arrayBuffer = await (content as Blob).arrayBuffer()
      fileForUpload = new File([arrayBuffer], fileName, { type: mimeType })
    } else if (content && typeof content === 'object') {
      const fileBuffer = Buffer.from(JSON.stringify(content), 'utf-8')
      fileForUpload = new File([fileBuffer], fileName, { type: mimeType })
    } else {
      const fileBuffer = Buffer.from(String(content), 'utf-8')
      fileForUpload = new File([fileBuffer], fileName, { type: mimeType })
    }

    const fileResponse = await openai.files.create({
      file: fileForUpload as any,
      purpose: 'assistants',
    })

    const openaiFileId = fileResponse.id

    this.sendSSEUpdate({
      type: 'google_drive_update',
      storageId,
      agentId,
      status: 'processing',
      message: 'Adding to Vector Store...'
    })

    let vectorStoreFileId = ''
    try {
      if (openai.vectorStores) {
        const vectorResponse = await openai.vectorStores.files.create(vectorStoreId, {
          file_id: openaiFileId,
        })
        vectorStoreFileId = vectorResponse.id
      } else {
        const response = await fetch(`https://api.openai.com/v1/vector_stores/${vectorStoreId}/files`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${userApiKey}`,
            'Content-Type': 'application/json',
            'OpenAI-Beta': 'assistants=v2'
          },
          body: JSON.stringify({
            file_id: openaiFileId
          })
        })

        if (!response.ok) {
          const errorText = await response.text()
          throw new Error(`Vector Store API Error ${response.status}: ${errorText}`)
        }

        const vectorResponse = await response.json()
        vectorStoreFileId = vectorResponse.id
      }
    } catch (vectorError) {
      const errorMessage = `Vector Store operation failed: ${vectorError instanceof Error ? vectorError.message : 'Unknown error'}`

      if (openaiFileId) {
        try {
          await openai.files.delete(openaiFileId)
        } catch (cleanupError) {
          // Failed to cleanup OpenAI file
        }
      }

      await this.prisma.storage.update({
        where: { id: storageId },
        data: {
          status: 'failed',
          openaiFileId: null,
          vectorStoreFileId: null,
          errorMessage: errorMessage,
          processingLog: JSON.stringify({
            startTime: new Date().toISOString(),
            failedTime: new Date().toISOString(),
            error: errorMessage,
            step: 'vector_store_addition',
            openaiFileId: openaiFileId || null
          }),
        },
      })

      throw new Error(errorMessage)
    }

    const ingestionStatus = await this.waitForVectorStoreIngestion(openai, vectorStoreId, vectorStoreFileId, userApiKey, fileForUpload.size)

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
                'Authorization': `Bearer ${userApiKey}`,
                'OpenAI-Beta': 'assistants=v2'
              }
            })
          }
        }
      } catch (cleanupError) {
        // Failed to cleanup vector store file after ingestion failure
      }

      if (openaiFileId) {
        try {
          await openai.files.delete(openaiFileId)
        } catch (cleanupError) {
          // Failed to cleanup OpenAI file after ingestion failure
        }
      }

      await this.prisma.storage.update({
        where: { id: storageId },
        data: {
          status: 'failed',
          openaiFileId: null,
          vectorStoreFileId: null,
          errorMessage: failureMessage,
          processingLog: JSON.stringify({
            startTime: new Date().toISOString(),
            failedTime: new Date().toISOString(),
            error: failureMessage,
            step: 'vector_store_ingestion'
          }),
        }
      })

      this.sendSSEUpdate({
        type: 'google_drive_update',
        storageId,
        agentId,
        status: 'failed',
        message: failureMessage,
        error: failureMessage
      })

      throw new Error(failureMessage)
    }

    const ragStatus = {
      openai_vector_store: {
        fileId: openaiFileId,
        vectorFileId: vectorStoreFileId,
        status: 'completed',
        createdAt: new Date().toISOString(),
      }
    }

    await this.prisma.storage.update({
      where: { id: storageId },
      data: {
        status: 'completed',
        ragProvider: 'openai_vector_store',
        openaiFileId,
        vectorStoreFileId,
        ragStatus: JSON.stringify(ragStatus),
        processingLog: JSON.stringify({
          startTime: new Date().toISOString(),
          completedTime: new Date().toISOString(),
          openaiFileId,
          vectorStoreFileId,
          ragProvider: 'openai_vector_store',
          status: 'completed'
        }),
      },
    })
  }

  private async executeAzureAISearchUpload(job: GoogleDriveJob, managedRegion: string): Promise<void> {
    const { storageId, fileName, content, mimeType, agentId } = job
    let blobPath: string | undefined

    try {
      this.sendSSEUpdate({
        type: 'google_drive_update',
        storageId,
        agentId,
        status: 'processing',
        message: 'Uploading to Azure AI Search...'
      })

      const agent = await this.prisma.agent.findUnique({
        where: { agentId },
        select: { userId: true }
      })
      const userId = agent?.userId || ''

      const store = await getKnowledgeStore({ regionId: managedRegion, docIntelligence: true })

      const preCheck = await this.prisma.storage.findUnique({ where: { id: storageId }, select: { id: true } })
      if (!preCheck) {
        console.warn(`[GoogleDriveQueue] storage ${storageId} gone before blob upload (space deleted?) — aborting`)
        return
      }

      let buffer: Buffer
      if (typeof content === 'string') {
        buffer = Buffer.from(content, 'utf-8')
      } else if (Buffer.isBuffer(content)) {
        buffer = content
      } else if (content instanceof ArrayBuffer) {
        buffer = Buffer.from(content)
      } else if (content && typeof content === 'object' && 'arrayBuffer' in content) {
        const arrayBuffer = await (content as Blob).arrayBuffer()
        buffer = Buffer.from(arrayBuffer)
      } else {
        buffer = Buffer.from(String(content || ''), 'utf-8')
      }

      try {
        const { generateBlobPath, uploadToBlob } = await import('@/lib/managed/blob-storage')
        blobPath = generateBlobPath(userId, agentId, fileName)
        await uploadToBlob(managedRegion, blobPath, buffer, mimeType || 'application/octet-stream')
      } catch (blobError) {
        console.warn(`[GoogleDriveQueue] Blob upload failed (continuing with indexing):`, blobError)
      }

      if (blobPath) { await this.prisma.storage.update({ where: { id: storageId }, data: { blobPath } }).catch(() => {}) }

      const spaceRow = await this.prisma.storage.findUnique({ where: { id: storageId }, select: { ragSpaceId: true } })
      if (!spaceRow) {
        console.warn(`[GoogleDriveQueue] storage ${storageId} no longer exists (space deleted?) — aborting upload`)
        if (blobPath) { try { const { deleteFromBlob } = await import('@/lib/managed/blob-storage'); await deleteFromBlob(managedRegion, blobPath) } catch (e) { console.warn('[GoogleDriveQueue] blob cleanup failed:', describeCaughtError(e)) } }
        return
      }
      const result = await store.ingest({ agentId }, {
        userId,
        storageId,
        fileName,
        file: buffer,
        mimeType: mimeType || 'application/octet-stream',
        ragSpace: spaceRow.ragSpaceId != null ? String(spaceRow.ragSpaceId) : '',
        blobPath,
      })
      const { indexName } = result.providerRef

      const stillExists = await this.prisma.storage.findUnique({ where: { id: storageId }, select: { id: true } })
      if (!stillExists) {
        console.warn(`[GoogleDriveQueue] storage ${storageId} deleted during indexing — cleaning up chunks/blob`)
        try { await store.deleteDoc({ agentId }, String(storageId)) } catch (e) { console.warn('[GoogleDriveQueue] chunk cleanup failed (orphan possible):', describeCaughtError(e)) }
        if (blobPath) { try { const { deleteFromBlob } = await import('@/lib/managed/blob-storage'); await deleteFromBlob(managedRegion, blobPath) } catch (e) { console.warn('[GoogleDriveQueue] blob cleanup failed:', describeCaughtError(e)) } }
        return
      }

      if (result.pageCount && result.pageCount > 0) {
        const agent2 = await this.prisma.agent.findUnique({
          where: { agentId },
          select: { user: { select: { subscription: { select: { id: true } } } } }
        })
        if (agent2?.user?.subscription?.id) {
          await this.prisma.subscription.update({
            where: { id: agent2.user.subscription.id },
            data: { docPagesUsed: { increment: result.pageCount } },
          })
          console.log(`[GoogleDriveQueue] Doc pages used: +${result.pageCount} (storage=${storageId})`)
        }
      }

      const ragStatus = {
        azure_ai_search: {
          indexName,
          fileId: result.providerRef.fileId,
          chunkCount: result.chunkCount || 0,
          contentHash: result.providerRef.contentHash,
          pageCount: result.pageCount || 0,
          status: 'completed',
          region: managedRegion,
          blobPath,
          createdAt: new Date().toISOString(),
        }
      }

      await this.prisma.storage.update({
        where: { id: storageId },
        data: {
          status: 'completed',
          ragProvider: 'azure_ai_search',
          ragStatus: JSON.stringify(ragStatus),
          blobPath: blobPath || null,
          ...(result.textSize !== undefined && { fileSizeBytes: result.textSize }),
        }
      })

      this.sendSSEUpdate({
        type: 'google_drive_update',
        storageId,
        agentId,
        status: 'completed',
        message: 'Uploaded to Azure AI Search'
      })

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Azure AI Search upload failed'
      console.error(`[GoogleDriveQueue] Azure AI Search upload failed for storage ${storageId}:`, error)

      await this.prisma.storage.update({
        where: { id: storageId },
        data: {
          status: 'failed',
          ragProvider: 'azure_ai_search',
          errorMessage,
          blobPath: blobPath || null,
        },
      })

      throw error
    }
  }

  private async executeGeminiUpload(job: GoogleDriveJob, apiKey: string): Promise<void> {
    const { storageId, fileName, content, mimeType, agentId } = job

    const genAI = new GoogleGenAI({ apiKey })

    this.sendSSEUpdate({
      type: 'google_drive_update',
      storageId,
      agentId,
      status: 'processing',
      message: 'Uploading file to Gemini...'
    })

    let blob: Blob
    let uploadFileName = fileName
    let uploadMimeType = mimeType

    if (typeof content === 'string') {
      if (mimeType?.startsWith('application/vnd.google-apps')) {
        uploadFileName = fileName + '.txt'
        uploadMimeType = 'text/plain'
      }
      blob = new Blob([content], { type: uploadMimeType })
    } else if (content instanceof ArrayBuffer) {
      blob = new Blob([content], { type: uploadMimeType })
    } else if (Buffer.isBuffer(content)) {
      blob = new Blob([new Uint8Array(content)], { type: uploadMimeType })
    } else if (content && typeof content === 'object' && 'arrayBuffer' in content) {
      blob = content as Blob
    } else if (content && typeof content === 'object') {
      blob = new Blob([JSON.stringify(content)], { type: 'application/json' })
    } else {
      blob = new Blob([String(content)], { type: 'text/plain' })
    }

    try {
      const uploadResult = await genAI.files.upload({
        file: blob,
        config: {
          displayName: uploadFileName,
          mimeType: uploadMimeType,
        },
      })

      const geminiFileId = uploadResult.name || null

      if (!geminiFileId) {
        throw new Error('Failed to get Gemini file ID')
      }

      this.sendSSEUpdate({
        type: 'google_drive_update',
        storageId,
        agentId,
        status: 'processing',
        message: 'Processing file...'
      })

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

      await this.prisma.storage.update({
        where: { id: storageId },
        data: {
          status: 'completed',
          ragProvider: 'gemini_file_search',
          ragStatus: JSON.stringify(ragStatus),
          processingLog: JSON.stringify({
            startTime: new Date().toISOString(),
            completedTime: new Date().toISOString(),
            geminiFileId,
            ragProvider: 'gemini_file_search',
            status: 'completed'
          }),
        },
      })

    } catch (error) {
      const errorMessage = `Gemini upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`

      await this.prisma.storage.update({
        where: { id: storageId },
        data: {
          status: 'failed',
          errorMessage: errorMessage,
          processingLog: JSON.stringify({
            startTime: new Date().toISOString(),
            failedTime: new Date().toISOString(),
            error: errorMessage,
            step: 'gemini_upload'
          }),
        },
      })

      this.sendSSEUpdate({
        type: 'google_drive_update',
        storageId,
        agentId,
        status: 'failed',
        message: errorMessage,
        error: errorMessage
      })

      throw new Error(errorMessage)
    }
  }

  private async executePineconeUpload(job: GoogleDriveJob, user: any, dek: Buffer): Promise<void> {
    const { storageId, fileName, content, mimeType, agentId } = job

    this.sendSSEUpdate({
      type: 'google_drive_update',
      storageId,
      agentId,
      status: 'processing',
      message: 'Connecting to Pinecone...'
    })

    if (!user.ragProviders?.providers) {
      throw new Error('Pinecone not configured. Please configure Pinecone in Settings.')
    }

    let pineconeConfig: any
    try {
      const ragProvidersConfig = JSON.parse(user.ragProviders.providers)
      pineconeConfig = ragProvidersConfig.pinecone
      if (!pineconeConfig?.apiKey || !pineconeConfig?.indexName) {
        throw new Error('Pinecone not configured. Please configure Pinecone API Key and Index Name in Settings.')
      }
    } catch (error) {
      throw new Error('Failed to parse Pinecone configuration.')
    }

    const embeddingModel = pineconeConfig.embeddingModel || 'llama-text-embed-v2'
    const isPineconeEmbedding = PINECONE_EMBEDDING_MODELS.includes(embeddingModel)

    let openaiApiKey: string | undefined
    if (!isPineconeEmbedding) {
      if (!user.aiProviders?.providers) {
        throw new Error('OpenAI API key required for OpenAI embedding models.')
      }
      const aiProvidersConfig = JSON.parse(user.aiProviders.providers)
      if (!aiProvidersConfig.openai?.apiKey) {
        throw new Error('OpenAI API key required for OpenAI embedding models.')
      }
      openaiApiKey = decrypt(Buffer.from(aiProvidersConfig.openai.apiKey, "base64"), dek)
      if (openaiApiKey === "Decryption failed") {
        throw new Error("OpenAI API key decryption failed")
      }
    }

    try {
      const connectionConfig: PineconeConnectionConfig = {
        indexName: pineconeConfig.indexName,
        namespace: agentId,
        host: pineconeConfig.host,
        embeddingModel: embeddingModel,
        dimension: pineconeConfig.dimension || 1024,
        embeddingApiKey: openaiApiKey,
      }

      const pineconeClient = new PineconeClient(pineconeConfig.apiKey, connectionConfig)

      this.sendSSEUpdate({
        type: 'google_drive_update',
        storageId,
        agentId,
        status: 'processing',
        message: 'Indexing to Pinecone...'
      })

      let fileBuffer: Buffer

      if (typeof content === 'string') {
        fileBuffer = Buffer.from(content, 'utf-8')
      } else if (content instanceof ArrayBuffer) {
        fileBuffer = Buffer.from(content)
      } else if (Buffer.isBuffer(content)) {
        fileBuffer = content
      } else if (content && typeof content === 'object' && 'arrayBuffer' in content) {
        const arrayBuffer = await (content as Blob).arrayBuffer()
        fileBuffer = Buffer.from(arrayBuffer)
      } else if (content && typeof content === 'object') {
        fileBuffer = Buffer.from(JSON.stringify(content), 'utf-8')
      } else {
        fileBuffer = Buffer.from(String(content), 'utf-8')
      }

      const result = await pineconeClient.uploadFile(agentId, fileBuffer, fileName, mimeType)

      const ragStatus = {
        pinecone: {
          indexName: pineconeConfig.indexName,
          namespace: agentId,
          vectorCount: result.chunkCount || 1,
          embeddingModel: embeddingModel,
          status: 'completed',
          createdAt: new Date().toISOString()
        }
      }

      await this.prisma.storage.update({
        where: { id: storageId },
        data: {
          status: 'completed',
          ragProvider: 'pinecone',
          ragStatus: JSON.stringify(ragStatus),
          processingLog: JSON.stringify({
            startTime: new Date().toISOString(),
            completedTime: new Date().toISOString(),
            pineconeIndexName: pineconeConfig.indexName,
            namespace: agentId,
            vectorCount: result.chunkCount || 1,
            ragProvider: 'pinecone',
            status: 'completed'
          }),
        },
      })

    } catch (error) {
      const errorMessage = `Pinecone upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`

      await this.prisma.storage.update({
        where: { id: storageId },
        data: {
          status: 'failed',
          errorMessage: errorMessage,
          processingLog: JSON.stringify({
            startTime: new Date().toISOString(),
            failedTime: new Date().toISOString(),
            error: errorMessage,
            step: 'pinecone_upload'
          }),
        },
      })

      this.sendSSEUpdate({
        type: 'google_drive_update',
        storageId,
        agentId,
        status: 'failed',
        message: errorMessage,
        error: errorMessage
      })

      throw new Error(errorMessage)
    }
  }

  getQueueStatus() {
    const jobs = Array.from(this.jobs.values())
    return {
      total: jobs.length,
      queued: jobs.filter(j => j.status === 'queued').length,
      processing: jobs.filter(j => j.status === 'processing').length,
      completed: jobs.filter(j => j.status === 'completed').length,
      failed: jobs.filter(j => j.status === 'failed').length,
    }
  }

  private async waitForVectorStoreIngestion(openai: OpenAI, vectorStoreId: string, vectorStoreFileId: string, apiKey: string, fileSize?: number) {
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
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
    }

    return { status: 'timeout' as const, error: 'Vector store ingestion timeout' }
  }
}

export const googleDriveQueue = globalForPrisma.googleDriveQueue ?? new GoogleDriveQueue()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.googleDriveQueue = googleDriveQueue
}
