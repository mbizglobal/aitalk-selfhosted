import { PrismaClient } from '@prisma/client'
import fs from 'fs/promises'
import path from 'path'
import { RAGProviderType } from '@/lib/rag-providers/types'
import { ROBOTS_DISALLOWED_PREFIX } from '@/lib/crawlConstants'
import { isCrawlAllowedForUser } from '@/lib/entitlement'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  crawlQueue: CrawlQueue | undefined
}

export const MAX_ACTIVE_CRAWLS_PER_USER = 5

export class CrawlRateLimitError extends Error {
  constructor(public readonly limit: number) {
    super(`Too many concurrent crawls (limit ${limit})`)
    this.name = 'CrawlRateLimitError'
  }
}

interface PineconeConfig {
  apiKey: string
  indexName: string
  host?: string
  embeddingModel: string
  dimension: number
}

interface CrawlJob {
  storageId: number
  agentId: string
  userId?: string
  url: string
  maxDepth: number
  maxPages: number
  format: 'markdown' | 'json'
  vectorStoreId: string | null
  userApiKey: string
  userLanguage?: string
  ragProvider?: RAGProviderType
  pineconeConfig?: PineconeConfig | null
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'retrying' | 'cancelled'
  createdAt: Date
  attempts: number
  currentUrl?: string
  progress?: string
  lastError?: string
  failureType?: 'timeout' | 'network' | 'not_found' | 'permission' | 'server_error' | 'unknown' | 'cancelled' | 'robots_disallowed'
  abortController?: AbortController
}

interface ProcessingLogData {
  status: 'pending' | 'queued' | 'crawling' | 'processing' | 'processing_files' | 'indexing' | 'retrying' | 'completed' | 'failed'
  substatus?: string
  progress?: {
    current: number
    total: number
    currentUrl?: string
  }
  retry?: {
    attempt: number
    maxAttempts: number
    reason?: string
    failureType?: 'timeout' | 'network' | 'not_found' | 'permission' | 'server_error' | 'unknown' | 'cancelled' | 'robots_disallowed'
    nextRetryAt?: string // ISO string
  }
  timestamps: {
    startTime?: string
    lastUpdate: string
    completedTime?: string
    failedTime?: string
  }
  log?: string[]
}

function updateProcessingLog(
  existingLog: string | null, 
  updates: Partial<ProcessingLogData>
): string {
  let logData: ProcessingLogData

  try {
    if (existingLog && existingLog.startsWith('{')) {
      logData = JSON.parse(existingLog)
    } else {
      logData = {
        status: 'processing',
        timestamps: {
          startTime: new Date().toISOString(),
          lastUpdate: new Date().toISOString(),
        },
        log: existingLog ? [existingLog] : []
      }
    }
  } catch (error) {
    logData = {
      status: 'processing',
      timestamps: {
        startTime: new Date().toISOString(),
        lastUpdate: new Date().toISOString(),
      },
      log: existingLog ? [existingLog] : []
    }
  }

  logData = {
    ...logData,
    ...updates,
    timestamps: {
      ...logData.timestamps,
      ...updates.timestamps,
      lastUpdate: new Date().toISOString(),
    }
  }

  return JSON.stringify(logData, null, 0)
}

class CrawlQueue {
  private jobs = new Map<number, CrawlJob>()
  private processing = new Set<number>()
  private maxConcurrent = 2
  private ready: Promise<void>

  constructor(private prisma: PrismaClient) {
    this.ready = this.recoverUnfinishedJobs()
  }

  private async recoverUnfinishedJobs() {
    try {
      const pendingJobs = await this.prisma.storage.findMany({
        where: {
          status: 'processing',
          type: 'website'
        },
        select: {
          id: true,
          agentId: true,
          ragProvider: true,
          processingLog: true,
          sourceUrl: true,
          crawlDepth: true,
          maxPages: true,
          userLanguage: true,
          agent: { select: { userId: true } },
        }
      })

      for (const job of pendingJobs) {
        try {
          await this.recoverOneJob(job)
        } catch (rowErr) {
          console.error(`[CRAWL_QUEUE] Recovery failed for storage ${job.id}:`, rowErr)
          await this.prisma.storage.update({
            where: { id: job.id },
            data: { status: 'failed', errorMessage: 'Server restart - recovery error' },
          }).catch(() => {})
        }
      }
    } catch (error) {
      console.error('[CRAWL_QUEUE] Failed to recover unfinished jobs:', error)
    }
  }

  private async recoverOneJob(job: {
    id: number
    agentId: string
    ragProvider: string | null
    processingLog: string | null
    sourceUrl: string | null
    crawlDepth: number | null
    maxPages: number | null
    userLanguage: string | null
    agent: { userId: string } | null
  }): Promise<void> {
    const ragProvider = (job.ragProvider as RAGProviderType | null) || 'openai_vector_store'
    const isManaged = ragProvider === 'azure_ai_search'

    if (!job.sourceUrl) {
      const nowIso = new Date().toISOString()
      const failedLog = updateProcessingLog(job.processingLog, {
        status: 'failed',
        substatus: 'Server restart - missing sourceUrl',
        timestamps: { lastUpdate: nowIso, failedTime: nowIso },
      })
      await this.prisma.storage.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          errorMessage: 'Server restart - missing sourceUrl (cannot re-queue)',
          processingLog: failedLog,
        },
      })
      return
    }

    if (isManaged) {
      const ownerUserId = job.agent?.userId

      if (!ownerUserId || !(await isCrawlAllowedForUser(ownerUserId))) {
        const nowIso = new Date().toISOString()
        const failedLog = updateProcessingLog(job.processingLog, {
          status: 'failed',
          substatus: 'Server restart - crawl not permitted for this account',
          timestamps: { lastUpdate: nowIso, failedTime: nowIso },
        })
        await this.prisma.storage.update({
          where: { id: job.id },
          data: {
            status: 'failed',
            errorMessage: 'Server restart - crawl not permitted for this account',
            processingLog: failedLog,
          },
        })
        return
      }

      if (ownerUserId && this.getActiveJobCountForUser(ownerUserId) >= MAX_ACTIVE_CRAWLS_PER_USER) {
        const nowIso = new Date().toISOString()
        const failedLog = updateProcessingLog(job.processingLog, {
          status: 'failed',
          substatus: 'Server restart - concurrent crawl limit reached, please retry',
          timestamps: { lastUpdate: nowIso, failedTime: nowIso },
        })
        await this.prisma.storage.update({
          where: { id: job.id },
          data: {
            status: 'failed',
            errorMessage: 'Server restart - concurrent crawl limit reached, please retry',
            processingLog: failedLog,
          },
        })
        return
      }

      const retryLog = updateProcessingLog(job.processingLog, {
        status: 'retrying',
        substatus: 'Server restart - re-queueing automatically',
        retry: {
          attempt: 1,
          maxAttempts: 3,
          reason: 'Server restart detected (Managed auto-recover)',
          failureType: 'server_error',
          nextRetryAt: new Date(Date.now() + 30000).toISOString(),
        },
      })
      await this.prisma.storage.update({
        where: { id: job.id },
        data: {
          status: 'processing',
          errorMessage: 'Server restart - re-queueing automatically in 30 seconds',
          processingLog: retryLog,
        },
      })

      const recoveredJob: CrawlJob = {
        storageId: job.id,
        agentId: job.agentId,
        userId: ownerUserId,
        url: job.sourceUrl,
        maxDepth: job.crawlDepth ?? 2,
        maxPages: job.maxPages ?? 10,
        format: 'markdown',
        vectorStoreId: null,
        userApiKey: '',
        userLanguage: job.userLanguage ?? 'en',
        ragProvider,
        pineconeConfig: null,
        status: 'retrying',
        createdAt: new Date(),
        attempts: 0,
      }
      this.jobs.set(job.id, recoveredJob)
      setTimeout(() => {
        const j = this.jobs.get(job.id)
        if (j && j.status === 'retrying') {
          j.status = 'queued'
          this.processNext()
        }
      }, 30000)
      return
    }

    const nowIso = new Date().toISOString()
    const failedLog = updateProcessingLog(job.processingLog, {
      status: 'failed',
      substatus: 'Server restart - please retry',
      timestamps: { lastUpdate: nowIso, failedTime: nowIso },
    })
    await this.prisma.storage.update({
      where: { id: job.id },
      data: {
        status: 'failed',
        errorMessage: 'Server restart - please retry',
        processingLog: failedLog,
      },
    })
  }

  async addJob(jobData: Omit<CrawlJob, 'status' | 'createdAt' | 'attempts'>): Promise<void> {
    await this.ready

    if (jobData.userId && this.getActiveJobCountForUser(jobData.userId) >= MAX_ACTIVE_CRAWLS_PER_USER) {
      throw new CrawlRateLimitError(MAX_ACTIVE_CRAWLS_PER_USER)
    }

    const job: CrawlJob = {
      ...jobData,
      status: 'queued',
      createdAt: new Date(),
      attempts: 0
    }

    this.jobs.set(job.storageId, job)

    this.processNext()
  }

  getJobStatus(storageId: number): CrawlJob | null {
    return this.jobs.get(storageId) || null
  }

  getQueueStatus(): { queued: number; processing: number; total: number } {
    const queued = Array.from(this.jobs.values()).filter(job => job.status === 'queued').length
    const processing = this.processing.size
    return { queued, processing, total: this.jobs.size }
  }

  getActiveJobCountForUser(userId: string): number {
    let count = 0
    for (const job of this.jobs.values()) {
      if (job.userId === userId) count++
    }
    return count
  }

  private async processNext() {
    if (this.processing.size >= this.maxConcurrent) {
      return
    }

    const queuedJob = Array.from(this.jobs.values()).find(job => 
      job.status === 'queued' && !this.processing.has(job.storageId)
    )

    if (!queuedJob) {
      return
    }

    this.processing.add(queuedJob.storageId)
    queuedJob.status = 'processing'


    try {
      await this.executeJob(queuedJob)
      queuedJob.status = 'completed'
    } catch (error) {
      console.error(`[CRAWL_QUEUE] Job ${queuedJob.storageId} failed:`, error)
      
      const errorMessage = error instanceof Error ? error.message : String(error)
      queuedJob.lastError = errorMessage
      queuedJob.attempts++

      let shouldRetry = true
      let failureType: CrawlJob['failureType'] = 'unknown'

      if ((queuedJob.status as string) === 'cancelled' || /\bcancell?ed\b|\bcancel\b/i.test(errorMessage)) {
        failureType = 'cancelled'
        shouldRetry = false
      } else if (errorMessage.startsWith(ROBOTS_DISALLOWED_PREFIX)) {
        failureType = 'robots_disallowed'
        shouldRetry = false
      } else if (/\btimeout\b|Execution time exceeded/i.test(errorMessage)) {
        failureType = 'timeout'
      } else if (/\bHTTP[\s]?404\b|\b404\s|not found/i.test(errorMessage)) {
        failureType = 'not_found'
        shouldRetry = false
      } else if (/\bHTTP[\s]?40[13]\b|\b40[13]\s|permission denied|forbidden/i.test(errorMessage)) {
        failureType = 'permission'
        shouldRetry = false
      } else if (/\bECONN|\bENETUNREACH|\bENOTFOUND|\bnetwork\b|\bfetch failed\b/i.test(errorMessage)) {
        failureType = 'network'
      } else if (/\bHTTP[\s]?5\d{2}\b|\b5\d{2}\s/i.test(errorMessage)) {
        failureType = 'server_error'
      }

      queuedJob.failureType = failureType

      if (shouldRetry && queuedJob.attempts < 3) {
        const currentStorage = await this.prisma.storage.findUnique({
          where: { id: queuedJob.storageId },
          select: { processingLog: true, vectorStoreFileId: true }
        })
        
        if (currentStorage?.vectorStoreFileId) {
          queuedJob.status = 'completed'
          
          await this.prisma.storage.update({
            where: { id: queuedJob.storageId },
            data: {
              status: 'completed',
              title: `Completed - already uploaded to vector store`,
              processingLog: updateProcessingLog(currentStorage.processingLog || null, {
                status: 'completed',
                substatus: 'Vector store upload already successful',
                timestamps: {
                  lastUpdate: new Date().toISOString(),
                  completedTime: new Date().toISOString()
                }
              })
            }
          })
          return
        }
        
        queuedJob.status = 'retrying'
        
        try {
          
          const retryLog = updateProcessingLog(currentStorage?.processingLog || null, {
            status: 'retrying',
            substatus: `Retry ${queuedJob.attempts}/3 - ${failureType} error`,
            retry: {
              attempt: queuedJob.attempts,
              maxAttempts: 3,
              reason: errorMessage,
              failureType,
              nextRetryAt: new Date(Date.now() + (queuedJob.attempts * 10000)).toISOString()
            }
          })
          
          await this.prisma.storage.update({
            where: { id: queuedJob.storageId },
            data: {
              status: 'processing',
              errorMessage: `Retrying (${queuedJob.attempts}/3): ${errorMessage}`,
              processingLog: retryLog
            }
          })
        } catch (dbError) {
          console.error(`[CRAWL_QUEUE] Failed to update retry status for ${queuedJob.storageId}:`, dbError)
        }
        
        const retryDelay = queuedJob.attempts * 10000
        setTimeout(() => {
          queuedJob.status = 'queued'
          this.processNext()
        }, retryDelay)
        
      } else {
        queuedJob.status = 'failed'
      }
    } finally {
      this.processing.delete(queuedJob.storageId)

      const shouldDelete = queuedJob.status !== 'retrying'
      if (shouldDelete && this.jobs.has(queuedJob.storageId)) {
        this.jobs.delete(queuedJob.storageId)
      }

      if (queuedJob.status !== 'retrying') {
        setTimeout(() => this.processNext(), 1000)
      }
    }
  }

  private async executeJob(job: CrawlJob): Promise<void> {
    const { storageId, url, maxDepth, maxPages, vectorStoreId, userApiKey, userLanguage, ragProvider, pineconeConfig } = job

    const currentStorage = await this.prisma.storage.findUnique({
      where: { id: storageId },
      select: { vectorStoreFileId: true, ragStatus: true, processingLog: true }
    })

    let isAlreadyCompleted = false
    if (ragProvider === 'gemini_file_search' && currentStorage?.ragStatus) {
      try {
        const ragStatusData = JSON.parse(currentStorage.ragStatus as string)
        isAlreadyCompleted = ragStatusData?.gemini_file_search?.status === 'completed'
      } catch {
        isAlreadyCompleted = false
      }
    } else if (ragProvider === 'pinecone' && currentStorage?.ragStatus) {
      try {
        const ragStatusData = JSON.parse(currentStorage.ragStatus as string)
        isAlreadyCompleted = ragStatusData?.pinecone?.status === 'completed'
      } catch {
        isAlreadyCompleted = false
      }
    } else if (currentStorage?.vectorStoreFileId) {
      isAlreadyCompleted = true
    }

    if (isAlreadyCompleted && currentStorage) {
      await this.prisma.storage.update({
        where: { id: storageId },
        data: {
          status: 'completed',
          processingLog: updateProcessingLog(currentStorage.processingLog || null, {
            status: 'completed',
            substatus: 'RAG upload already completed - skipped duplicate execution',
            timestamps: {
              lastUpdate: new Date().toISOString(),
              completedTime: new Date().toISOString()
            }
          })
        }
      })
      return
    }

    const timeoutMs = (maxPages * 30 + 300) * 1000

    const abortController = new AbortController()
    job.abortController = abortController

    const timeoutHandle = setTimeout(() => {
      abortController.abort(new Error(`Crawl job timeout after ${Math.round(timeoutMs/1000)} seconds (${maxPages} pages limit)`))
    }, timeoutMs)

    const { crawlWebsiteWithTempFile } = await import('./crawlLogic')

    try {
      await crawlWebsiteWithTempFile(
        storageId,
        url,
        maxDepth,
        maxPages,
        vectorStoreId,
        userApiKey,
        'markdown',
        (progress: string, currentUrl?: string) => {
          job.progress = progress
          job.currentUrl = currentUrl
        },
        userLanguage,
        ragProvider,
        pineconeConfig,
        abortController.signal
      )
    } catch (error) {
      console.error(`[CRAWL_QUEUE] Job ${storageId} failed with error:`, error)
      throw error
    } finally {
      clearTimeout(timeoutHandle)
      job.abortController = undefined
    }
  }

  cancelJob(storageId: number): boolean {
    const job = this.jobs.get(storageId)
    if (!job) return false

    job.status = 'cancelled'
    job.failureType = 'cancelled'

    if (job.abortController) {
      job.abortController.abort(new Error('Job cancelled by user'))
    }

    this.jobs.delete(storageId)
    return true
  }
}

const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: ['error', 'warn'],
})

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

export const crawlQueue = globalForPrisma.crawlQueue ?? new CrawlQueue(prisma)

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.crawlQueue = crawlQueue
}
