import { PrismaClient } from '@prisma/client'
import { OpenAI } from 'openai'
import { GoogleGenAI } from '@google/genai'
import * as cheerio from 'cheerio'
import TurndownService from 'turndown'
import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import puppeteer from 'puppeteer'
import type { Browser } from 'puppeteer'
import { autoRun } from './auto/cleanup'
import { translations as enTranslations } from './translations/dashboard/en'
import { translations as deTranslations } from './translations/dashboard/de'
import { translations as frTranslations } from './translations/dashboard/fr'
import { translations as esTranslations } from './translations/dashboard/es'
import { translations as koTranslations } from './translations/dashboard/ko'
import { RAGProviderType } from '@/lib/rag-providers/types'
import { PineconeClient, PineconeConnectionConfig } from '@/lib/rag-providers/clients/pinecone'
import { getKnowledgeStore } from '@/lib/knowledge'
import { retryCleanup, recordCleanupFailure, readCleanupPendingPrefix } from './cleanupRetry'
import { assertSafeUrl, SSRFError, DnsLookupError } from './ssrfGuard'
import { ROBOTS_DISALLOWED_PREFIX } from './crawlConstants'
import { isValidUrl, isAllowedByRobots, parseRobotsTxt, CRAWLER_USER_AGENT, type RobotsRule } from './crawlPure'

interface PineconeConfig {
  apiKey: string
  indexName: string
  host?: string
  embeddingModel: string
  dimension: number
}

const dashboardTranslations = {
  en: enTranslations.en,
  de: deTranslations.de,
  fr: frTranslations.fr,
  es: esTranslations.es,
  ko: koTranslations.ko
}

autoRun.startCleanup()

function detectLanguageFromUrl(url: string): 'en' | 'de' | 'fr' | 'es' | 'ko' {
  if (url.includes('?lang=de') || url.includes('/de/') || url.includes('lang=de')) {
    return 'de'
  } else if (url.includes('?lang=fr') || url.includes('/fr/') || url.includes('lang=fr')) {
    return 'fr'
  } else if (url.includes('?lang=es') || url.includes('/es/') || url.includes('lang=es')) {
    return 'es'
  } else if (url.includes('?lang=ko') || url.includes('/ko/') || url.includes('lang=ko')) {
    return 'ko'
  }
  return 'en'
}

function getTranslation(key: string, language: 'en' | 'de' | 'fr' | 'es' | 'ko' = 'en', replacements: Record<string, string | number> = {}): string {
  const translations = dashboardTranslations[language]
  let message = translations[key as keyof typeof translations] as string || key
  
  // Replace placeholders like {count}, {url}, etc.
  Object.keys(replacements).forEach(placeholder => {
    message = message.replace(new RegExp(`\\{${placeholder}\\}`, 'g'), String(replacements[placeholder]))
  })
  
  return message
}

const maxExecutionTime = 60 * 60 * 1000
const maxContentSize = 20 * 1024 * 1024   // 20MB

interface CrawlSafety {
  requestCount: number
  errorCount: number
  startTime: number
}

function createSafety(): CrawlSafety {
  return {
    requestCount: 0,
    errorCount: 0,
    startTime: Date.now(),
  }
}

function getAdaptiveDelay(safety: CrawlSafety): number {
  safety.requestCount++
  if (safety.requestCount > 15) return 5000
  if (safety.requestCount > 10) return 3000
  if (safety.requestCount > 5) return 1000
  return 500
}

function getErrorDelay(safety: CrawlSafety): number {
  if (safety.errorCount === 0) return 0
  return Math.min(safety.errorCount * 2000, 10000)
}

function checkExecutionTime(safety: CrawlSafety): void {
  if (Date.now() - safety.startTime > maxExecutionTime) {
    throw new Error('⏰ Execution time exceeded (60 minutes)')
  }
}

async function retryOperation<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error = new Error('Unknown error')

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      if (attempt === maxRetries) {
        throw lastError
      }

      const delay = baseDelay * Math.pow(2, attempt - 1)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }

  throw lastError
}

async function fetchRobotsTxt(baseUrl: string): Promise<RobotsRule | null> {
  try {
    const robotsUrl = new URL('/robots.txt', baseUrl).href

    const response = await fetch(robotsUrl, {
      headers: {
        'User-Agent': CRAWLER_USER_AGENT,
      },
    })

    if (!response.ok) {
      return null
    }

    const robotsText = await response.text()
    return parseRobotsTxt(robotsText)
  } catch (error) {
    console.warn('[ROBOTS] Failed to fetch robots.txt:', error)
    return null
  }
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: ['error', 'warn'],
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
})

turndownService.addRule('cleanImages', {
  filter: 'img',
  replacement: (_content: string, node: any) => {
    const alt = (node.getAttribute('alt') || '').trim()
    return alt ? alt : ''
  }
})

turndownService.addRule('cleanLinks', {
  filter: 'a',
  replacement: (content: string) => {
    return content || ''
  }
})

interface CrawlData {
  baseUrl: string
  totalPages: number
  crawledAt: string
  tempFilePath: string
  metadata: {
    title: string
    description?: string
    language?: string
  }
  pages: Array<{
    url: string
    title: string
    depth: number
    crawledAt: string
  }>
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

type ProgressCallback = (progress: string, currentUrl?: string) => void

function createProcessingLog(initialStatus: ProcessingLogData['status'], substatus?: string): ProcessingLogData {
  return {
    status: initialStatus,
    substatus,
    timestamps: {
      startTime: new Date().toISOString(),
      lastUpdate: new Date().toISOString(),
    },
    log: []
  }
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
      logData = createProcessingLog('processing')
      if (existingLog) {
        logData.log = [existingLog]
      }
    }
  } catch (error) {
    logData = createProcessingLog('processing')
    if (existingLog) {
      logData.log = [existingLog]
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

function getProcessingLogData(log: string | null): ProcessingLogData | null {
  if (!log) return null
  
  try {
    if (log.startsWith('{')) {
      return JSON.parse(log)
    }
  } catch (error) {
  }
  
  return null
}

function generateMarkdownContent(crawledPages: any[], baseUrl: string): string {
  const now = new Date().toISOString()
  let markdownContent = `# Website Crawl Results\n\n`
  markdownContent += `**Base URL:** ${baseUrl}\n`
  markdownContent += `**Crawled At:** ${now}\n`
  markdownContent += `**Total Pages:** ${crawledPages.length}\n\n`
  markdownContent += `---\n\n`

  crawledPages.forEach((page, index) => {
    markdownContent += `## Page ${index + 1}: ${page.title || 'Untitled'}\n\n`
    markdownContent += `**URL:** ${page.url}\n`
    markdownContent += `**Depth:** ${page.depth}\n`
    markdownContent += `**Crawled At:** ${page.crawledAt}\n\n`
    
    if (page.sections && page.sections.length > 0) {
      page.sections.forEach((section: any) => {
        if (section.heading) {
          markdownContent += `### ${section.heading}\n\n`
        }
        if (section.content) {
          markdownContent += `${section.content}\n\n`
        }
      })
    }
    
    if (page.images && page.images.length > 0) {
      markdownContent += `### Images\n\n`
      page.images.forEach((img: any) => {
        const altText = (img.alt || '').trim()
        const context = img.context ? ` (from: ${img.context})` : ''
        if (altText) {
          markdownContent += `- ${altText}${context}\n`
        } else if (img.context) {
          markdownContent += `- ${img.context}\n`
        }
      })
      markdownContent += '\n'
    }
    
    if (page.links && page.links.length > 0) {
      markdownContent += `### Links\n\n`
      page.links.forEach((link: any) => {
        if (link && link.href && link.href !== 'undefined') {
          markdownContent += `- [${link.text || link.href}](${link.href})\n`
        }
      })
      markdownContent += '\n'
    }
    
    markdownContent += `---\n\n`
  })

  return markdownContent
}

export async function crawlWebsiteWithTempFile(
  storageId: number,
  baseUrl: string,
  maxDepth: number,
  maxPages: number,
  vectorStoreId: string | null,
  userApiKey: string,
  format: 'markdown' | 'json' = 'markdown',
  onProgress?: ProgressCallback,
  userLanguage?: string,
  ragProvider?: RAGProviderType,
  pineconeConfig?: PineconeConfig | null,
  abortSignal?: AbortSignal
) {
  const throwIfAborted = () => {
    if (abortSignal?.aborted) {
      throw new Error(abortSignal.reason instanceof Error ? abortSignal.reason.message : 'Crawl aborted')
    }
  }

  const abortableSleep = (ms: number) => new Promise<void>((resolve, reject) => {
    if (abortSignal?.aborted) {
      reject(new Error(abortSignal.reason instanceof Error ? abortSignal.reason.message : 'Crawl aborted'))
      return
    }
    const timer = setTimeout(() => {
      abortSignal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new Error(abortSignal!.reason instanceof Error ? abortSignal!.reason.message : 'Crawl aborted'))
    }
    abortSignal?.addEventListener('abort', onAbort, { once: true })
  })
  const safety = createSafety()

  const tempFilePath = generateTempFilePath(storageId, 'markdown')

  const dbLanguage = (userLanguage || 'en') as 'en' | 'de' | 'fr' | 'es' | 'ko'
  const urlLanguage = detectLanguageFromUrl(baseUrl)

  try {
    onProgress?.(getTranslation('crawl_initializing', dbLanguage))
    
    try {
      const initialLog = createProcessingLog('crawling', 'Discovering website structure')
      await prisma.storage.update({
        where: { id: storageId },
        data: {
          status: 'processing',
          processingLog: JSON.stringify(initialLog),
        },
      })
    } catch (error) {
    }

    onProgress?.(getTranslation('crawl_discovering_structure', dbLanguage))

    let crawledCount = 0
    let totalBytes = 0
    const successfullyProcessedUrls: string[] = []

    const robotsRule = await fetchRobotsTxt(baseUrl)
    if (!isAllowedByRobots(baseUrl, robotsRule)) {
      const message = `${ROBOTS_DISALLOWED_PREFIX}${baseUrl}`
      onProgress?.(message)
      throw new Error(message)
    }

    const queue: Array<[string, number]> = [[baseUrl, 0]]
    const visited = new Set<string>()
    const baseUrlObj = new URL(baseUrl)

    const fileHeader = `# Multi-language Website Crawl Results\n\n**Base URL:** ${baseUrl.split('?')[0]}\n**Crawl Date:** ${new Date().toISOString()}\n**Max Depth:** ${maxDepth}\n**Max Pages:** ${maxPages}\n\n---\n\n`
    await fs.writeFile(tempFilePath, fileHeader, 'utf8')

    while (queue.length > 0 && crawledCount < maxPages) {
      throwIfAborted()

      const [currentUrl, currentDepth] = queue.shift()!

      if (visited.has(currentUrl) || currentDepth > maxDepth) {
        continue
      }

      visited.add(currentUrl)

      try {
        onProgress?.(getTranslation('crawl_processing_page', dbLanguage, { current: (crawledCount + 1).toString(), total: maxPages.toString() }), currentUrl)

        checkExecutionTime(safety)

        const adaptiveDelay = getAdaptiveDelay(safety)
        const errorDelay = getErrorDelay(safety)
        const totalDelay = adaptiveDelay + errorDelay

        if (totalDelay > 0) {
          await abortableSleep(totalDelay)
        }

        let detectedLang = 'en'
        if (currentUrl.includes('?lang=de') || currentUrl.includes('/de/')) {
          detectedLang = 'de'
        } else if (currentUrl.includes('?lang=fr') || currentUrl.includes('/fr/')) {
          detectedLang = 'fr'
        }

        const result = await crawlWithPuppeteerAdvanced(currentUrl, detectedLang, safety, abortSignal)

        if (result) {
          const pageMarkdown = generateSinglePageMarkdown(result, crawledCount + 1)
          await fs.appendFile(tempFilePath, pageMarkdown, 'utf8')

          crawledCount++
          totalBytes += pageMarkdown.length
          successfullyProcessedUrls.push(currentUrl)

          safety.requestCount++

          if (currentDepth < maxDepth) {
            for (const link of result.links) {
              try {
                const linkUrl = new URL(link.href)

                if (linkUrl.origin === baseUrlObj.origin &&
                    !visited.has(link.href) &&
                    isValidUrl(link.href) &&
                    isAllowedByRobots(link.href, robotsRule)) {
                  queue.push([link.href, currentDepth + 1])
                }
              } catch (e) {
              }
            }
          }

          if (crawledCount % 3 === 0) {
            try {
              const currentStorage = await prisma.storage.findUnique({
                where: { id: storageId },
                select: { processingLog: true }
              })

              const updatedLog = updateProcessingLog(currentStorage?.processingLog || null, {
                status: 'crawling',
                substatus: `Processing pages (${crawledCount}/${maxPages})`,
                progress: {
                  current: crawledCount,
                  total: maxPages,
                  currentUrl: currentUrl
                }
              })

              await prisma.storage.update({
                where: { id: storageId },
                data: {
                  processingLog: updatedLog,
                  crawlCount: crawledCount,
                },
              })
            } catch (error) {
            }
          }
        }
      } catch (error) {
        safety.errorCount++
        console.error(getTranslation('crawl_failed_url', dbLanguage, { url: currentUrl }), error)
      }

      await abortableSleep(1000)
      }

    if (crawledCount === 0) {
      throw new Error('No pages were successfully crawled')
    }

    throwIfAborted()

    const fileFooter = `\n\n---\n\n**Crawl Summary:**\n- Total Pages: ${crawledCount}\n- Total Size: ${(totalBytes/1024/1024).toFixed(2)} MB\n- Completed: ${new Date().toISOString()}\n`
    await fs.appendFile(tempFilePath, fileFooter, 'utf8')

    onProgress?.(getTranslation('crawl_uploading_to_vector_store', dbLanguage))

    let openaiFileId: string | null = null
    let vectorStoreFileId: string | null = null
    let ragStatus: Record<string, any> | null = null

    if (crawledCount > 0) {
      try {
        const PINECONE_EMBEDDING_MODELS = ['llama-text-embed-v2', 'multilingual-e5-large', 'pinecone-sparse-english-v0']
        const isPineconeWithBuiltinEmbedding = ragProvider === 'pinecone' &&
          pineconeConfig?.embeddingModel &&
          PINECONE_EMBEDDING_MODELS.includes(pineconeConfig.embeddingModel)

        if (!userApiKey && !isPineconeWithBuiltinEmbedding && ragProvider !== 'azure_ai_search') {
          throw new Error('userApiKey is undefined or empty')
        }

        const fileContent = await fs.readFile(tempFilePath, 'utf8')
        const fileName = path.basename(tempFilePath)

        if (fileContent.length > maxContentSize) {
          const truncatedContent = fileContent.substring(0, maxContentSize) + "\n\n...[Content truncated due to 20MB limit]"
          await fs.writeFile(tempFilePath, truncatedContent, 'utf8')
        }

        if (ragProvider === 'azure_ai_search') {
          onProgress?.(getTranslation('crawl_uploading_openai', dbLanguage) || 'Uploading to Azure AI Search...')

          const storageRecord = await prisma.storage.findUnique({
            where: { id: storageId },
            select: { agentId: true, ragSpaceId: true, agent: { select: { userId: true, user: { select: { subscription: { select: { managedRegion: true } } } } } } }
          })

          const region = storageRecord?.agent?.user?.subscription?.managedRegion
          if (!region) throw new Error('Managed region not configured')
          const userId = storageRecord?.agent?.userId || ''
          const agentId = storageRecord?.agentId || ''
          const ragSpace = storageRecord?.ragSpaceId != null ? String(storageRecord.ragSpaceId) : ''

          const store = await getKnowledgeStore({ regionId: region })

          const textBuffer = Buffer.from(fileContent, 'utf-8')
          let blobPath: string | undefined
          try {
            const { generateBlobPath, uploadToBlob } = await import('@/lib/managed/blob-storage')
            blobPath = generateBlobPath(userId, agentId, fileName)
            await uploadToBlob(region, blobPath, textBuffer, 'text/markdown')
          } catch (blobError) {
            console.warn(`[Crawl] Blob upload failed (continuing with indexing):`, blobError)
          }

          let result: Awaited<ReturnType<typeof store.ingest>>
          try {
            result = await store.ingest({ agentId }, {
              userId,
              storageId,
              fileName,
              file: textBuffer,
              mimeType: 'text/markdown',
              ragSpace,
              blobPath,
            }, { signal: abortSignal })

            if (abortSignal?.aborted) throwIfAborted()
          } catch (err) {
            const cleanup = await retryCleanup(
              () => store.deleteDoc({ agentId }, String(storageId)),
              { label: `azure_ai_search storage=${storageId}` }
            )
            if (!cleanup.ok && abortSignal?.aborted) {
              await recordCleanupFailure(prisma, storageId, 'azure_ai_search', cleanup.error)
            }
            throw err
          }

          ragStatus = {
            azure_ai_search: {
              indexName: result.providerRef.indexName,
              fileId: result.providerRef.fileId,
              chunkCount: result.chunkCount || 0,
              contentHash: result.providerRef.contentHash,
              textSize: result.textSize,
              status: 'completed',
              region,
              blobPath,
              createdAt: new Date().toISOString(),
            }
          }

          await prisma.storage.update({
            where: { id: storageId },
            data: {
              ragProvider: 'azure_ai_search',
              ...(blobPath && { blobPath }),
              ...(result.textSize !== undefined && { fileSizeBytes: result.textSize }),
            },
          })

          onProgress?.(getTranslation('crawl_successfully_uploaded', dbLanguage))

        } else if (ragProvider === 'gemini_file_search') {
          const genAI = new GoogleGenAI({ apiKey: userApiKey })

          const mimeType = 'text/plain'
          const blob = new Blob([fileContent], { type: mimeType })

          let geminiFileId: string | null = null
          let fileInfo: Awaited<ReturnType<typeof genAI.files.upload>>
          try {
            const uploadResult = await genAI.files.upload({
              file: blob,
              config: {
                displayName: fileName,
                mimeType: mimeType,
              },
            })

            geminiFileId = uploadResult.name || null
            if (!geminiFileId) {
              throw new Error('Failed to get Gemini file ID')
            }
            fileInfo = uploadResult

            let attempts = 0
            const maxAttempts = 120
            while (fileInfo.state === 'PROCESSING' && attempts < maxAttempts) {
              await abortableSleep(1000)
              fileInfo = await genAI.files.get({ name: geminiFileId })
              attempts++
            }

            if (fileInfo.state === 'FAILED') {
              throw new Error('Gemini file processing failed')
            }
            if (fileInfo.state !== 'ACTIVE') {
              throw new Error(`Gemini file processing timeout (state: ${fileInfo.state})`)
            }

            if (abortSignal?.aborted) throwIfAborted()
          } catch (err) {
            if (geminiFileId) {
              const cleanup = await retryCleanup(
                () => genAI.files.delete({ name: geminiFileId! }),
                { label: `gemini_file_search fileId=${geminiFileId}` }
              )
              if (!cleanup.ok && abortSignal?.aborted) {
                await recordCleanupFailure(prisma, storageId, 'gemini_file_search', cleanup.error)
              }
            }
            throw err
          }

          ragStatus = {
            gemini_file_search: {
              fileId: geminiFileId,
              fileUri: fileInfo.uri,
              status: 'completed',
              mimeType: fileInfo.mimeType,
              sizeBytes: fileInfo.sizeBytes,
              createdAt: new Date().toISOString(),
            }
          }

          onProgress?.(getTranslation('crawl_successfully_uploaded', dbLanguage))

        } else if (ragProvider === 'pinecone' && pineconeConfig) {
          onProgress?.(getTranslation('storage_upload_pinecone_connecting', dbLanguage) || 'Connecting to Pinecone...')

          const storageRecord = await prisma.storage.findUnique({
            where: { id: storageId },
            select: { agentId: true }
          })

          if (!storageRecord?.agentId) {
            throw new Error('Agent ID not found for storage record')
          }

          const namespace = storageRecord.agentId

          const connectionConfig: PineconeConnectionConfig = {
            indexName: pineconeConfig.indexName,
            namespace: namespace,
            host: pineconeConfig.host,
            embeddingModel: pineconeConfig.embeddingModel,
            dimension: pineconeConfig.dimension,
            embeddingApiKey: userApiKey || undefined,
          }

          const pineconeClient = new PineconeClient(pineconeConfig.apiKey, connectionConfig)

          onProgress?.(getTranslation('storage_upload_pinecone_indexing', dbLanguage) || 'Indexing to Pinecone...')

          const textBuffer = Buffer.from(fileContent, 'utf-8')
          const result = await pineconeClient.uploadFile(namespace, textBuffer, fileName, 'text/markdown')

          if (abortSignal?.aborted) {
            const cleanup = await retryCleanup(
              () => pineconeClient.deleteFile(namespace, fileName),
              { label: `pinecone fileName=${fileName}` }
            )
            if (!cleanup.ok) {
              await recordCleanupFailure(prisma, storageId, 'pinecone', cleanup.error)
            }
            throwIfAborted()
          }

          ragStatus = {
            pinecone: {
              indexName: pineconeConfig.indexName,
              namespace: namespace,
              vectorCount: result.chunkCount || 1,
              embeddingModel: pineconeConfig.embeddingModel,
              status: 'completed',
              createdAt: new Date().toISOString()
            }
          }

          onProgress?.(getTranslation('crawl_successfully_uploaded', dbLanguage))

        } else if (vectorStoreId) {
          const openai = new OpenAI({ apiKey: userApiKey })

          const mimeType = 'text/markdown'
          const blob = new Blob([fileContent], { type: mimeType })
          const file = new File([blob], fileName, { type: mimeType })

          const fileResponse = await openai.files.create({
            file: file as any,
            purpose: 'assistants',
          })

          openaiFileId = fileResponse.id

          if (abortSignal?.aborted) {
            const cleanup = await retryCleanup(
              () => openai.files.delete(fileResponse.id),
              { label: `openai_files fileId=${fileResponse.id}` }
            )
            if (!cleanup.ok) {
              await recordCleanupFailure(prisma, storageId, 'openai_files', cleanup.error)
            }
            throwIfAborted()
          }

          try {
            if (openai.vectorStores) {
              await openai.vectorStores.files.create(vectorStoreId, {
                file_id: fileResponse.id
              })
            } else {
              const response = await fetch(`https://api.openai.com/v1/vector_stores/${vectorStoreId}/files`, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${userApiKey}`,
                  'Content-Type': 'application/json',
                  'OpenAI-Beta': 'assistants=v2'
                },
                body: JSON.stringify({ file_id: fileResponse.id })
              })

              if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${await response.text()}`)
              }
            }

            vectorStoreFileId = fileResponse.id

            if (abortSignal?.aborted) {
              const cleanup = await retryCleanup(
                async () => {
                  if (openai.vectorStores) {
                    await openai.vectorStores.files.delete(fileResponse.id, { vector_store_id: vectorStoreId })
                  } else {
                    const detachResp = await fetch(`https://api.openai.com/v1/vector_stores/${vectorStoreId}/files/${fileResponse.id}`, {
                      method: 'DELETE',
                      headers: {
                        'Authorization': `Bearer ${userApiKey}`,
                        'OpenAI-Beta': 'assistants=v2',
                      },
                    })
                    if (!detachResp.ok) {
                      throw new Error(`Vector store file detach failed: HTTP ${detachResp.status} ${await detachResp.text()}`)
                    }
                  }
                  await openai.files.delete(fileResponse.id)
                },
                { label: `openai_vector_stores storage=${storageId}` }
              )
              if (!cleanup.ok) {
                await recordCleanupFailure(prisma, storageId, 'openai_vector_stores', cleanup.error)
              }
              throwIfAborted()
            }

            onProgress?.(getTranslation('crawl_successfully_uploaded', dbLanguage))

          } catch (vectorError) {
            console.error(
              getTranslation('crawl_vector_store_upload_failed', dbLanguage),
              { storageId, vectorStoreId, fileId: fileResponse.id, vectorStoreFileId },
              vectorError,
            )

            if (!abortSignal?.aborted && vectorStoreFileId === null) {
              const cleanup = await retryCleanup(
                () => openai.files.delete(fileResponse.id),
                { label: `openai_files (post-vector-error) fileId=${fileResponse.id}` }
              )
              if (!cleanup.ok) {
                await recordCleanupFailure(prisma, storageId, 'openai_files', cleanup.error)
              }
            }

            throw vectorError
          }
        }

      } catch (error) {
        console.error('Failed to upload to RAG provider:', error)
        throw new Error(getTranslation('crawl_openai_upload_failed', dbLanguage, { error: String(error) }))
      }
    }

    const finalContent = successfullyProcessedUrls.length > 0 ? successfullyProcessedUrls.join('\n') : getTranslation('crawl_db_content_completed', dbLanguage, { count: crawledCount.toString(), url: baseUrl })

    try {
      const finalLog = updateProcessingLog(null, {
        status: 'completed',
        substatus: `Successfully crawled ${crawledCount} pages`,
        progress: {
          current: crawledCount,
          total: maxPages
        },
        timestamps: {
          lastUpdate: new Date().toISOString(),
          completedTime: new Date().toISOString()
        }
      })

      await prisma.storage.update({
        where: { id: storageId },
        data: {
          status: 'completed',
          title: getTranslation('crawl_db_title_completed', dbLanguage, { count: crawledCount.toString(), hostname: new URL(baseUrl).hostname }),
          content: finalContent,
          fileSizeBytes: totalBytes,
          openaiFileId,
          vectorStoreFileId,
          ragStatus: ragStatus ? JSON.stringify(ragStatus) : null,
          crawlCount: crawledCount,
          processingLog: finalLog,
        },
      })
    } catch (error) {
      console.error(`[CRAWL_ERROR] Critical: Failed to update storage ${storageId} to completed status:`, error)

      try {
        await prisma.storage.update({
          where: { id: storageId },
          data: {
            status: 'completed',
            title: getTranslation('crawl_db_title_completed', dbLanguage, { count: crawledCount.toString(), hostname: new URL(baseUrl).hostname }),
            content: finalContent || getTranslation('crawl_db_content_completed', dbLanguage, { count: crawledCount.toString(), url: baseUrl }),
            crawlCount: crawledCount,
            openaiFileId,
            vectorStoreFileId,
            ragStatus: ragStatus ? JSON.stringify(ragStatus) : null,
            processingLog: JSON.stringify({
              status: 'completed',
              substatus: `Crawled ${crawledCount} pages - RAG uploaded successfully`,
              timestamps: {
                lastUpdate: new Date().toISOString(),
                completedTime: new Date().toISOString()
              }
            })
          },
        })
      } catch (retryError) {
        console.error(`[CRAWL_RETRY] Force-update also failed for storage ${storageId}:`, retryError)
        throw error
      }
    }

    onProgress?.(getTranslation('crawl_completed_with_pages', dbLanguage, { count: crawledCount.toString() }))

  } catch (error) {
    console.error('Advanced crawling failed:', error)

    try {
      let failureType: 'timeout' | 'network' | 'server_error' | 'cancelled' | 'robots_disallowed' | 'unknown' = 'unknown'
      const errorMessage = error instanceof Error ? error.message : String(error)

      if (errorMessage.startsWith(ROBOTS_DISALLOWED_PREFIX)) {
        failureType = 'robots_disallowed'
      } else if (abortSignal?.aborted || /\bcancell?ed\b|\baborted?\b/i.test(errorMessage)) {
        failureType = 'cancelled'
      } else if (/\btimeout\b|Execution time exceeded/i.test(errorMessage)) {
        failureType = 'timeout'
      } else if (/\bECONN|\bENETUNREACH|\bENOTFOUND|\bnetwork\b|\bfetch failed\b/i.test(errorMessage)) {
        failureType = 'network'
      } else if (/\bHTTP[\s]?5\d{2}\b|\b5\d{2}\s/i.test(errorMessage)) {
        failureType = 'server_error'
      }

      const failedLog = updateProcessingLog(null, {
        status: 'failed',
        substatus: `Failed: ${errorMessage}`,
        retry: {
          attempt: 0,
          maxAttempts: 3,
          reason: errorMessage,
          failureType
        },
        timestamps: {
          lastUpdate: new Date().toISOString(),
          failedTime: new Date().toISOString()
        }
      })

      const cleanupPrefix = await readCleanupPendingPrefix(prisma, storageId)

      await prisma.storage.update({
        where: { id: storageId },
        data: {
          status: 'failed',
          errorMessage: cleanupPrefix + errorMessage,
          processingLog: failedLog,
        },
      })
    } catch (dbError) {
      // Failed to update error status to DB
    }

    throw error
  } finally {
  }
}

async function crawlWithPuppeteerAdvanced(url: string, language: string = 'en', safety?: CrawlSafety, abortSignal?: AbortSignal): Promise<{
  url: string
  title: string
  crawledAt: string
  language: string
  mainContent: string
  pricing?: { plans: Array<{ name: string; price: string; features: string[] }> }
  metadata: { ogTitle?: string; ogDescription?: string; ogImage?: string }
  links: Array<{ text: string; href: string; category?: string }>
  images: Array<{ src: string; alt: string; context?: string }>
  detectedKeywords: string[]
} | null> {
  const langFlag = { en: '🇺🇸', de: '🇩🇪', fr: '🇫🇷' }[language] || '🌐'
  
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  })

  const onAbort = () => {
    browser.close().catch((err) => {
      console.warn(`[Crawler] browser.close() failed during abort for ${url}:`, err)
    })
  }
  abortSignal?.addEventListener('abort', onAbort, { once: true })

  try {
    if (abortSignal?.aborted) {
      throw new Error('Crawl aborted before page load')
    }

    const page = await browser.newPage()

    const acceptLanguage = {
      'en': 'en-US,en;q=0.9',
      'de': 'de-DE,de;q=0.9,en;q=0.8',
      'fr': 'fr-FR,fr;q=0.9,en;q=0.8'
    }[language] || 'en-US,en;q=0.9'

    await page.setExtraHTTPHeaders({
      'Accept-Language': acceptLanguage
    })

    try {
      await assertSafeUrl(url)
    } catch (err) {
      if (err instanceof SSRFError || err instanceof DnsLookupError) {
        throw new Error(`Crawl blocked: ${err.message}`)
      }
      throw err
    }

    await page.setRequestInterception(true)
    page.on('request', (req) => {
      const reqUrl = req.url()
      if (reqUrl.startsWith('data:') || reqUrl.startsWith('blob:') || reqUrl.startsWith('about:')) {
        req.continue().catch(() => {})
        return
      }
      assertSafeUrl(reqUrl)
        .then(() => req.continue().catch(() => {}))
        .catch((err) => {
          if (err instanceof SSRFError || err instanceof DnsLookupError) {
            req.abort('blockedbyclient').catch(() => {})
          } else {
            req.continue().catch(() => {})
          }
        })
    })

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    })
    
    let html = await page.content()
    
    if (html.length > maxContentSize) {
      html = html.substring(0, maxContentSize) + "...[Content truncated due to 20MB limit]"
    }
    
    const $ = cheerio.load(html)
    sanitizeBase64Resources($, $('body'))
    normalizeAnchorLinks($, $('body'), url)
    
    const title = await page.title()
    
    const metaDescription = $('meta[name="description"]').attr('content') || ''
    const h1Text = await page.$eval('h1', el => el.textContent).catch(() => '')
    const description = h1Text || metaDescription
    
    const metadata = {
      ogTitle: $('meta[property="og:title"]').attr('content'),
      ogDescription: $('meta[property="og:description"]').attr('content'),
      ogImage: $('meta[property="og:image"]').attr('content'),
    }
    
    const bodyText = await page.$eval('body', el => el.textContent).catch(() => '')
    const detectedKeywords = detectLanguageKeywords(bodyText, language)
    
    const pricing = extractPricingInfo($, language)
    
    const links: Array<{ text: string; href: string; category?: string }> = []
    const seenUrls = new Set<string>()
    
    $('a[href]').each((_, element) => {
      const rawHref = $(element).attr('href')
      const href = rawHref?.trim()
      const text = $(element).text().trim()
      
      if (!href) {
        return
      }

      const lowerHref = href.toLowerCase()
      if (lowerHref.startsWith('javascript:') || lowerHref.startsWith('vbscript:')) {
        return
      }

      if (!seenUrls.has(href)) {
        try {
          const absoluteUrl = new URL(href, url).href
          if (!absoluteUrl.toLowerCase().startsWith('http')) {
            return
          }
          seenUrls.add(href)
          
          let category = 'internal'
          if (href.startsWith('http') && !href.includes(new URL(url).hostname)) {
            category = 'external'
          } else if ($(element).closest('nav, header, footer').length > 0) {
            category = 'navigation'
          }
          
          links.push({
            text: text || href,
            href: absoluteUrl,
            category
          })
        } catch (e) {
        }
      }
    })
    
    const images: Array<{ src: string; alt: string; context?: string }> = []
    $('img').each((_, element) => {
      const rawSrc = $(element).attr('src')
      const src = rawSrc?.trim()
      const alt = ($(element).attr('alt') || '').trim()

      if (!src) {
        return
      }

      const lowerSrc = src.toLowerCase()

      if (lowerSrc.startsWith('data:')) {
        return
      }

      try {
        const absoluteSrc = new URL(src, url).href

        const width = $(element).attr('width')
        const height = $(element).attr('height')
        const isSmall = (width && parseInt(width) < 50) || (height && parseInt(height) < 50)
        const isIcon = lowerSrc.includes('icon') || alt.toLowerCase() === 'check'

        if (!isSmall && !isIcon) {
          const parentSection = $(element).closest('section, article, div[class*="section"]')
          const sectionHeading = parentSection.find('h1, h2, h3').first().text().trim()

          images.push({
            src: absoluteSrc,
            alt,
            context: sectionHeading || undefined
          })
        }
      } catch (e) {
      }
    })
    
    $('script, style, nav, footer, .cookie-banner').remove()
    
    let contentElement = $('main, article, .content, [role="main"]').first()
    if (contentElement.length === 0) {
      contentElement = $('body')
    }
    
    sanitizeBase64Resources($, contentElement)
    normalizeAnchorLinks($, contentElement, url)

    contentElement.find('img').each((_, img) => {
      const rawSrc = $(img).attr('src')
      const src = rawSrc?.trim()

      if (!src) {
        if (rawSrc) {
          $(img).attr('src', rawSrc.trim())
        }
        return
      }

      const lowerSrc = src.toLowerCase()

      if (lowerSrc.startsWith('data:')) {
        $(img).remove()
        return
      }

      if (src.startsWith('/')) {
        $(img).attr('src', new URL(src, url).href)
      } else if (rawSrc !== src) {
        $(img).attr('src', src)
      }
    })
    
    const mainContent = cleanMarkdownArtifacts(
      turndownService.turndown(contentElement.html() || '')
    )

    await browser.close().catch((err) => {
      console.warn(`[Crawler] browser.close() failed in success path for ${url}:`, err)
    })

    return {
      url,
      title,
      crawledAt: new Date().toISOString(),
      language,
      mainContent,
      pricing,
      metadata,
      links,
      images,
      detectedKeywords,
    }

  } catch (error) {
    await browser.close().catch((closeErr) => {
      console.warn(`[Crawler] browser.close() failed in catch path for ${url}:`, closeErr)
    })

    if (abortSignal?.aborted) {
      throw error
    }

    if (safety) safety.errorCount++

    const errorMessage = error instanceof Error ? error.message : String(error)
    const langFlag = { en: '🇺🇸', de: '🇩🇪', fr: '🇫🇷' }[language] || '🌐'
    const attemptCount = safety?.errorCount ?? 1
    console.error(`❌ ${langFlag} ${language.toUpperCase()} crawling failed (attempt ${attemptCount}):`, errorMessage)

    return null
  } finally {
    abortSignal?.removeEventListener('abort', onAbort)
  }
}

function sanitizeBase64Resources($: cheerio.CheerioAPI, scope: cheerio.Cheerio<cheerio.Element>) {
  const base64AttrNames = [
    'src',
    'data-src',
    'data-original',
    'data-lazy',
    'data-lazy-src',
    'data-large_image',
    'data-small_image',
    'data-thumb',
    'srcset',
    'data-srcset',
    'data-lazy-srcset'
  ]

  const dangerousProtocols = ['javascript:', 'vbscript:']

  const processNode = (node: cheerio.Element) => {
    const $node = $(node)
    const attribs = (node as cheerio.Element & { attribs?: Record<string, string> }).attribs ?? {}

    for (const [attrName, attrValue] of Object.entries(attribs)) {
      if (!attrValue) {
        continue
      }

      const trimmedValue = attrValue.trim()
      if (!trimmedValue) {
        continue
      }

      const lowerValue = trimmedValue.toLowerCase()
      if (!lowerValue.includes('data:image')) {
        const matchedProtocol = dangerousProtocols.find(protocol => lowerValue.startsWith(protocol))
        if (!matchedProtocol) {
          continue
        }

        const lowerAttrName = attrName.toLowerCase()

        if (lowerAttrName === 'href' || lowerAttrName === 'formaction' || lowerAttrName === 'action') {
          const textContent = $node.text().trim()
          const lowerText = textContent.toLowerCase()

          if (
            lowerText === lowerValue ||
            lowerText.startsWith('javascript:') ||
            lowerText.startsWith('vbscript:')
          ) {
            $node.remove()
            return
          }

          $node.replaceWith($node.contents())
          return
        }

        $node.removeAttr(attrName)
        continue
      }

      const lowerAttrName = attrName.toLowerCase()

      if (base64AttrNames.includes(lowerAttrName)) {
        $node.remove()
        return
      }

      if (lowerAttrName === 'style') {
        $node.removeAttr(attrName)
        continue
      }

      $node.removeAttr(attrName)
    }
  }

  scope.each((_, element) => {
    processNode(element as cheerio.Element)
    $(element)
      .find('*')
      .each((__, child) => {
        processNode(child as cheerio.Element)
      })
  })
}

function normalizeAnchorLinks($: cheerio.CheerioAPI, scope: cheerio.Cheerio<cheerio.Element>, baseUrl: string) {
  const unwrapNode = ($node: cheerio.Cheerio<cheerio.Element>) => {
    const contents = $node.contents()
    if (contents.length > 0) {
      $node.replaceWith(contents)
      return
    }

    const text = $node.text().trim()
    if (text.length > 0) {
      $node.replaceWith(text)
      return
    }

    $node.remove()
  }

  const processAnchor = (anchor: cheerio.Element) => {
    const $anchor = $(anchor)
    const rawHref = $anchor.attr('href')

    if (!rawHref) {
      unwrapNode($anchor)
      return
    }

    const href = rawHref.trim()
    if (!href) {
      unwrapNode($anchor)
      return
    }

    const lowerHref = href.toLowerCase()
    if (
      lowerHref.startsWith('javascript:') ||
      lowerHref.startsWith('vbscript:') ||
      lowerHref.startsWith('#') ||
      lowerHref.startsWith('data:')
    ) {
      unwrapNode($anchor)
      return
    }

    try {
      const absoluteHref = new URL(href, baseUrl).href
      if (!absoluteHref.toLowerCase().startsWith('http')) {
        unwrapNode($anchor)
        return
      }

      $anchor.attr('href', absoluteHref)
    } catch {
      unwrapNode($anchor)
    }
  }

  scope.each((_, element) => {
    const $element = $(element)
    if ($element.is('a')) {
      processAnchor(element as cheerio.Element)
    }

    $element.find('a').each((__, anchor) => {
      processAnchor(anchor as cheerio.Element)
    })
  })
}

function cleanMarkdownArtifacts(markdown: string): string {
  if (!markdown) {
    return markdown
  }

  let cleaned = markdown

  cleaned = cleaned.replace(/!\[([^\]]*?)\]\((?:[^)]+)\)/g, (_match, alt) => (alt || '').trim())

  cleaned = cleaned.replace(/\[([^\]]+)\]\((?:https?:\/\/|mailto:|#)[^)]+\)/g, (_match, text) => text.trim())

  cleaned = cleaned.replace(/\[\s*\]\([^)]+\)/g, '')

  cleaned = cleaned.replace(/[ \t]+\n/g, '\n')

  return cleaned
}

function detectLanguageKeywords(text: string, expectedLang: string): string[] {
  const keywords = {
    en: ['Customer Service', 'AI Chatbot', 'Resolving', 'Inquiries', 'Business', 'Free Plan', 'Starter Plan'],
    de: ['Kundendienst', 'KI Chatbot', 'sofort', 'lösen', 'Geschäft', 'Kostenlos', 'PREISE', 'SPRACHE'],
    fr: ['Service Client', 'Chatbot IA', 'instantané', 'résoudre', 'entreprise', 'gratuit', 'PRIX', 'LANGUE']
  }
  
  const langKeywords = keywords[expectedLang as keyof typeof keywords] || keywords.en
  return langKeywords.filter(keyword => text.includes(keyword))
}

function extractPricingInfo($: cheerio.CheerioAPI, language: string): { plans: Array<{ name: string; price: string; features: string[] }> } | undefined {
  const plans: Array<{ name: string; price: string; features: string[] }> = []
  
  const planInfo = {
    en: {
      free: { name: 'Free Plan', price: 'FREE' },
      starter: { name: 'Starter Plan', price: '$29.99/month' },
      standard: { name: 'Standard Plan', price: '$59.99/month' },
      growth: { name: 'Growth Plan', price: '$99.99/month' },
      pro: { name: 'Pro Plan', price: '$189.99/month' }
    },
    de: {
      free: { name: 'Kostenloser Plan', price: 'KOSTENLOS' },
      starter: { name: 'Starter Plan', price: '29,99€/Monat' },
      standard: { name: 'Standard Plan', price: '59,99€/Monat' },
      growth: { name: 'Growth Plan', price: '99,99€/Monat' },
      pro: { name: 'Pro Plan', price: '189,99€/Monat' }
    },
    fr: {
      free: { name: 'Plan Gratuit', price: 'GRATUIT' },
      starter: { name: 'Plan Starter', price: '29,99€/mois' },
      standard: { name: 'Plan Standard', price: '59,99€/mois' },
      growth: { name: 'Plan Growth', price: '99,99€/mois' },
      pro: { name: 'Plan Pro', price: '189,99€/mois' }
    }
  }
  
  const langPlans = planInfo[language as keyof typeof planInfo] || planInfo.en
  const bodyText = $('body').text()
  
  const features = {
    free: ['1 AI Agent', '50 Workflow Executions per month', '1 Workflow', 'Max Files: 10,000', 'Max Storage: 100 GB'],
    starter: ['1 AI Agent', '5,000 Workflow Executions', 'Max Files: 10,000', 'Max Storage: 100 GB'],
    standard: ['2 AI Agents', '10,000 Workflow Executions', 'Max Files: 10,000', 'Max Storage: 100 GB'],
    growth: ['3 AI Agents', '20,000 Workflow Executions', 'Max Files: 10,000', 'Max Storage: 100 GB'],
    pro: ['4 AI Agents', '40,000 Workflow Executions', 'Max Files: 10,000', 'Max Storage: 100 GB']
  }
  
  if (bodyText.includes('Free') || bodyText.includes('KOSTENLOS') || bodyText.includes('GRATUIT')) {
    plans.push({ ...langPlans.free, features: features.free })
  }
  
  if (bodyText.includes('29.99') || bodyText.includes('29,99')) {
    plans.push({ ...langPlans.starter, features: features.starter })
  }
  
  if (bodyText.includes('59.99') || bodyText.includes('59,99')) {
    plans.push({ ...langPlans.standard, features: features.standard })
  }
  
  if (bodyText.includes('99.99') || bodyText.includes('99,99')) {
    plans.push({ ...langPlans.growth, features: features.growth })
  }
  
  if (bodyText.includes('189.99') || bodyText.includes('189,99')) {
    plans.push({ ...langPlans.pro, features: features.pro })
  }
  
  return plans.length > 0 ? { plans } : undefined
}

function generateSinglePageMarkdown(
  data: {
    url: string
    title: string
    crawledAt: string
    language: string
    mainContent: string
    pricing?: { plans: Array<{ name: string; price: string; features: string[] }> }
    metadata: { ogTitle?: string; ogDescription?: string; ogImage?: string }
    links: Array<{ text: string; href: string; category?: string }>
    images: Array<{ src: string; alt: string; context?: string }>
    detectedKeywords: string[]
  },
  pageNumber: number
): string {
  const langFlag = { en: '🇺🇸', de: '🇩🇪', fr: '🇫🇷' }[data.language] || '🌐'
  
  let markdown = `# ${langFlag} Page ${pageNumber}: ${data.language.toUpperCase()} Version\n\n`
  
  markdown += `## Metadata\n\n`
  markdown += `- **URL:** ${data.url}\n`
  markdown += `- **Title:** ${data.title}\n`
  markdown += `- **Crawled:** ${data.crawledAt}\n`
  markdown += `- **Keywords:** ${data.detectedKeywords.join(', ')}\n\n`
  
  if (data.pricing && data.pricing.plans.length > 0) {
    markdown += `## Pricing Plans\n\n`
    
    data.pricing.plans.forEach(plan => {
      markdown += `### ${plan.name} - ${plan.price}\n\n`
      plan.features.forEach(feature => {
        markdown += `- ${feature}\n`
      })
      markdown += `\n`
    })
  }
  
  markdown += `## Main Content\n\n`
  markdown += data.mainContent
  markdown += `\n\n`
  
  const navLinks = data.links.filter(link => {
    const href = link.href?.trim()
    const text = link.text?.trim() || ''
    if (!href) {
      return false
    }

    const normalizedHref = href.toLowerCase()
    if (!normalizedHref.startsWith('http')) {
      return false
    }

    const normalizedText = text.toLowerCase()

    return (
      link.category === 'navigation' ||
      normalizedText.includes('pricing') ||
      normalizedText.includes('blog') ||
      normalizedText.includes('preise') ||
      normalizedText.includes('prix')
    )
  })
  
  if (navLinks.length > 0) {
    markdown += `## Navigation Links\n\n`
    navLinks.forEach(link => {
      const linkHref = link.href.trim()
      const linkText = (link.text?.trim() || linkHref).trim()
      markdown += `- [${linkText}](${linkHref})\n`
    })
    markdown += `\n`
  }
  
  if (data.images.length > 0) {
    markdown += `## Images\n\n`
    data.images.forEach(img => {
      const context = img.context ? ` (from: ${img.context})` : ''
      const altText = (img.alt || '').trim()
      if (altText) {
        markdown += `- ${altText}${context}\n`
      } else if (img.context) {
        markdown += `- ${img.context}\n`
      }
    })
    markdown += `\n`
  }
  
  markdown += `---\n\n`
  
  return markdown
}

function generateTempFilePath(storageId: number, format: 'markdown' | 'json' = 'json'): string {
  const now = new Date()
  const dateStr = now.toISOString().slice(0, 19).replace(/[:T-]/g, '')
  const projectRoot = process.cwd()
  const tmpDir = path.join(projectRoot, 'tmp')
  
  try {
    fsSync.mkdirSync(tmpDir, { recursive: true })
  } catch (error) {
    console.warn('Failed to create tmp directory:', error)
  }
  
  const extension = format === 'markdown' ? 'md' : 'json'
  return path.join(tmpDir, `crawl_${dateStr}_${storageId}.${extension}`)
}

async function fetchAndParseSitemap(sitemapUrl: string): Promise<string[]> {
  try {
    
    const response = await retryOperation(
      () => fetch(sitemapUrl, {
        headers: {
          'User-Agent': 'AITalk-Crawler/1.0 (+https://www.aitalk.ch)',
        },
        signal: AbortSignal.timeout(10000)
      }),
      2,
      1000
    )

    if (!response.ok) {
      return []
    }

    const xmlText = await response.text()
    const urls: string[] = []
    
    const urlMatches = xmlText.match(/<loc>(.*?)<\/loc>/g)
    if (urlMatches) {
      for (const match of urlMatches) {
        const url = match.replace(/<\/?loc>/g, '').trim()
        if (url.startsWith('http')) {
          urls.push(url)
        }
      }
    }

    const sitemapMatches = xmlText.match(/<sitemap>[\s\S]*?<\/sitemap>/g)
    if (sitemapMatches) {
      for (const sitemapMatch of sitemapMatches.slice(0, 3)) {
        const subSitemapUrl = sitemapMatch.match(/<loc>(.*?)<\/loc>/)?.[1]
        if (subSitemapUrl) {
          const subUrls = await fetchAndParseSitemap(subSitemapUrl)
          urls.push(...subUrls)
        }
      }
    }

    return urls.slice(0, 50)
  } catch (error) {
    console.warn(`[SITEMAP] Failed to parse sitemap ${sitemapUrl}:`, error)
    return []
  }
}
