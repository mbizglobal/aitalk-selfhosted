import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]/route'
import { PrismaClient } from '@prisma/client'
import { crawlQueue, MAX_ACTIVE_CRAWLS_PER_USER, CrawlRateLimitError } from '@/lib/crawlQueue'
import { isCrawlAllowedForUser } from '@/lib/entitlement'
import { decryptDataKey, decryptDataKeyWithLegacy, decrypt } from '@/lib/encryption'
import { RAGProviderType } from '@/lib/rag-providers/types'
import { getLanguageFromHeaders, getErrorMessage } from '@/lib/translations/dashboard'
import { assertSafeUrl, SSRFError, DnsLookupError } from '@/lib/ssrfGuard'
import { resolveRagSpaceId, RagSpaceError } from '@/lib/rag-space'

const DOMAIN_REGEX = /^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: ['error', 'warn'],
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

interface CrawlRequest {
  url: string
  maxDepth?: number
  maxPages?: number
  userLanguage?: string
  agentId?: string // Optional agentId in request body
  ragProvider?: RAGProviderType
  ragSpaceId?: number | string | null
}

export async function POST(request: NextRequest) {
  const language = getLanguageFromHeaders(request.headers)
  try {
    const session = await getServerSession(authOptions as any) as any

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body: CrawlRequest = await request.json()
    let { url, maxDepth = 2, maxPages = 10, userLanguage = 'en', ragProvider = 'openai_vector_store' } = body
    
    // Get agentId from request body or query params
    const { searchParams } = new URL(request.url)
    const agentId = searchParams.get('agentId') || body.agentId
    
    if (!agentId) {
      return NextResponse.json({ error: 'Agent ID is required' }, { status: 400 })
    }

    if (!url) {
      return NextResponse.json({ error: 'Invalid URL', errorCode: 'INVALID_DOMAIN' }, { status: 400 })
    }

    let parsedUrl: URL
    try {
      parsedUrl = new URL(url)
    } catch {
      return NextResponse.json({ error: 'Invalid URL', errorCode: 'INVALID_DOMAIN' }, { status: 400 })
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return NextResponse.json({ error: 'Invalid protocol', errorCode: 'INVALID_PROTOCOL' }, { status: 400 })
    }

    if (!DOMAIN_REGEX.test(parsedUrl.hostname)) {
      return NextResponse.json({ error: 'Invalid domain', errorCode: 'INVALID_DOMAIN' }, { status: 400 })
    }

    const agent = await prisma.agent.findUnique({
      where: { agentId },
    })
    if (!agent || agent.userId !== session.user.id) {
      return NextResponse.json({ error: 'Agent not found or unauthorized' }, { status: 404 })
    }

    if (!(await isCrawlAllowedForUser(session.user.id))) {
      return NextResponse.json({
        error: "Website crawling isn't available during the free trial. Please subscribe to enable it.",
        errorCode: 'CRAWL_TRIAL_BLOCKED',
      }, { status: 403 })
    }

    if (crawlQueue.getActiveJobCountForUser(session.user.id) >= MAX_ACTIVE_CRAWLS_PER_USER) {
      return NextResponse.json({
        error: `Too many concurrent crawls (limit ${MAX_ACTIVE_CRAWLS_PER_USER}). Please wait for some to finish.`,
        errorCode: 'CRAWL_RATE_LIMIT',
      }, { status: 429 })
    }

    parsedUrl.hostname = parsedUrl.hostname.toLowerCase()
    if (parsedUrl.pathname === '') parsedUrl.pathname = '/'
    parsedUrl.hash = ''
    const normalizedUrl = parsedUrl.href

    try {
      await assertSafeUrl(normalizedUrl)
    } catch (err) {
      if (err instanceof SSRFError) {
        return NextResponse.json({
          error: 'Target host is not allowed',
          errorCode: 'SSRF_BLOCKED'
        }, { status: 400 })
      }
      if (err instanceof DnsLookupError) {
        return NextResponse.json({
          error: 'DNS lookup failed',
          errorCode: 'DNS_LOOKUP_FAILED'
        }, { status: 400 })
      }
      throw err
    }

    const reachability = await ensureWebsiteReachable(normalizedUrl)
    if (!reachability.ok) {
      if (reachability.reason === 'TIMEOUT') {
        return NextResponse.json({
          error: 'Website is not reachable',
          errorCode: 'URL_TIMEOUT'
        }, { status: 400 })
      }

      return NextResponse.json({
        error: 'Website returned a non-200 status',
        errorCode: 'UNREACHABLE_URL',
        statusCode: reachability.status ?? null
      }, { status: 400 })
    }

    if (maxDepth < 1 || maxDepth > 5) {
      return NextResponse.json({ error: 'Max depth must be between 1-5' }, { status: 400 })
    }

    if (maxPages < 1 || maxPages > 200) {
      return NextResponse.json({ error: 'Max pages must be between 1-200' }, { status: 400 })
    }

    if (ragProvider === 'openai_vector_store' && !agent.vectorStoreId) {
      return NextResponse.json({
        error: 'Vector Store not configured. Please configure OpenAI API key first.'
      }, { status: 400 })
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      include: { aiProviders: true, ragProviders: true, zki: true, subscription: { select: { serviceVariant: true, managedRegion: true, storagePerAgent: true } } }
    })

    const isManaged = user?.subscription?.serviceVariant === 'managed'
    if (isManaged && !user?.subscription?.managedRegion) {
      return NextResponse.json({ error: 'Managed region not configured', code: 'MANAGED_REGION_UNCONFIGURED' }, { status: 400 })
    }
    if (isManaged) {
      ragProvider = 'azure_ai_search' as RAGProviderType
    }

    if (user?.subscription?.storagePerAgent !== null && user?.subscription?.storagePerAgent !== undefined) {
      const currentUsage = await prisma.storage.aggregate({
        where: { agentId, status: 'completed' },
        _sum: { fileSizeBytes: true }
      })
      if ((currentUsage._sum.fileSizeBytes || 0) >= user.subscription.storagePerAgent) {
        return NextResponse.json({
          error: getErrorMessage('api_error_storage_limit_exceeded', language),
          errorCode: 'STORAGE_LIMIT_EXCEEDED'
        }, { status: 400 })
      }
    }

    if (!isManaged && (!user || !user.encryptedDataKey)) {
      return NextResponse.json({
        error: 'User configuration not found. Please configure your settings first.'
      }, { status: 400 })
    }

    const PINECONE_EMBEDDING_MODELS = ['llama-text-embed-v2', 'multilingual-e5-large', 'pinecone-sparse-english-v0']

    let userApiKey: string = ''
    let pineconeConfig: {
      apiKey: string
      indexName: string
      host?: string
      embeddingModel: string
      dimension: number
    } | null = null

    const getDek = async () => {
      if (user.zkiId && user.zki?.masterKey) {
        return decryptDataKeyWithLegacy(Buffer.from(user.encryptedDataKey!), user.zki.masterKey)
      } else {
        return await decryptDataKey(Buffer.from(user.encryptedDataKey!))
      }
    }

    try {
      if (ragProvider === 'azure_ai_search' && isManaged) {
        userApiKey = ''
      } else if (ragProvider === 'pinecone') {
        if (!user.ragProviders?.providers) {
          return NextResponse.json({
            error: 'Pinecone not configured. Please configure Pinecone in Settings.'
          }, { status: 400 })
        }

        const ragProvidersConfig = JSON.parse(user.ragProviders.providers)
        const pinecone = ragProvidersConfig.pinecone
        if (!pinecone?.apiKey || !pinecone?.indexName) {
          return NextResponse.json({
            error: 'Pinecone not configured. Please configure Pinecone API Key and Index Name in Settings.'
          }, { status: 400 })
        }

        const embeddingModel = pinecone.embeddingModel || 'llama-text-embed-v2'
        const isPineconeEmbedding = PINECONE_EMBEDDING_MODELS.includes(embeddingModel)

        pineconeConfig = {
          apiKey: pinecone.apiKey,
          indexName: pinecone.indexName,
          host: pinecone.host,
          embeddingModel,
          dimension: pinecone.dimension || 1024,
        }

        if (!isPineconeEmbedding) {
          if (!user.aiProviders?.providers) {
            return NextResponse.json({
              error: 'OpenAI API key required for OpenAI embedding models.'
            }, { status: 400 })
          }
          const aiProvidersConfig = JSON.parse(user.aiProviders.providers)
          if (!aiProvidersConfig.openai?.apiKey) {
            return NextResponse.json({
              error: 'OpenAI API key required for OpenAI embedding models.'
            }, { status: 400 })
          }
          const dek = await getDek()
          userApiKey = decrypt(Buffer.from(aiProvidersConfig.openai.apiKey, "base64"), dek)
        }
      } else {
        if (!user.aiProviders?.providers) {
          return NextResponse.json({
            error: 'API key not configured. Please configure your API key first.'
          }, { status: 400 })
        }

        const requiredLlmProvider = ragProvider === 'gemini_file_search' ? 'gemini' : 'openai'
        const providersConfig = JSON.parse(user.aiProviders.providers)
        const providerApiKey = providersConfig[requiredLlmProvider]?.apiKey

        if (!providerApiKey) {
          const providerName = requiredLlmProvider === 'gemini' ? 'Gemini' : 'OpenAI'
          return NextResponse.json({
            error: `${providerName} API key not configured. Please configure your API key first.`
          }, { status: 400 })
        }

        const dek = await getDek()
        userApiKey = decrypt(Buffer.from(providerApiKey, "base64"), dek)
      }
    } catch (error) {
      return NextResponse.json({
        error: 'Failed to decrypt API key. Please reconfigure your API key.'
      }, { status: 400 })
    }

    let ragSpaceId: number | null = null
    if (isManaged && user?.subscription?.managedRegion) {
      try {
        ragSpaceId = await resolveRagSpaceId(agentId, body.ragSpaceId)
      } catch (e) {
        if (e instanceof RagSpaceError) return NextResponse.json({ error: e.message, code: e.code }, { status: 400 })
        throw e
      }
    }

    let storage
    let conflictId: number | null = null
    try {
      storage = await prisma.$transaction(async (tx) => {
        const existing = await tx.storage.findFirst({
          where: { agentId, sourceUrl: normalizedUrl, status: 'processing' }
        })
        if (existing) {
          conflictId = existing.id
          throw new Error('CRAWL_CONFLICT')
        }
        return tx.storage.create({
          data: {
            agentId,
            type: 'website',
            status: 'processing',
            title: `Crawling ${normalizedUrl}...`,
            sourceUrl: normalizedUrl,
            crawlDepth: maxDepth,
            maxPages,
            userLanguage,
            ragProvider,
            ragSpaceId,
            processingLog: JSON.stringify({
              status: 'queued',
              ragProvider,
              startTime: new Date().toISOString(),
            }),
          },
        })
      })
    } catch (txError: any) {
      if (conflictId !== null) {
        return NextResponse.json({
          error: 'This URL is already being crawled',
          storageId: conflictId
        }, { status: 409 })
      }

      const isUniqueViolation =
        txError?.code === 'P2002' ||
        txError?.code === '23505' ||
        txError?.meta?.code === '23505' ||
        txError?.cause?.code === '23505'
      if (isUniqueViolation) {
        return NextResponse.json({
          error: 'This URL is already being crawled',
          errorCode: 'CRAWL_CONFLICT'
        }, { status: 409 })
      }

      throw txError
    }

    try {
      await crawlQueue.addJob({
        storageId: storage.id,
        agentId,
        userId: session.user.id,
        url: normalizedUrl,
        maxDepth,
        maxPages,
        format: 'markdown',
        vectorStoreId: ragProvider === 'openai_vector_store' ? agent.vectorStoreId : null,
        userApiKey,
        userLanguage,
        ragProvider,
        pineconeConfig,
      })
    } catch (queueError) {
      if (queueError instanceof CrawlRateLimitError) {
        await prisma.storage.delete({ where: { id: storage.id } }).catch(() => {})
        return NextResponse.json({
          error: `Too many concurrent crawls (limit ${MAX_ACTIVE_CRAWLS_PER_USER}). Please wait for some to finish.`,
          errorCode: 'CRAWL_RATE_LIMIT',
        }, { status: 429 })
      }
      throw queueError
    }


    return NextResponse.json({
      success: true,
      storageId: storage.id,
      message: 'Crawling started in background',
      status: 'queued',
      estimatedTime: `${maxPages * 2}-${maxPages * 5} seconds`
    })

  } catch (error) {
    console.error('Failed to start crawl:', error)
    return NextResponse.json(
      { error: 'Failed to start crawl' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as any

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const agentId = searchParams.get('agentId')

    if (!agentId) {
      return NextResponse.json({ error: 'Agent ID is required' }, { status: 400 })
    }

    const agent = await prisma.agent.findUnique({
      where: { agentId },
    })

    if (!agent || agent.userId !== session.user.id) {
      return NextResponse.json({ error: 'Agent not found or unauthorized' }, { status: 404 })
    }

    const queueStatus = crawlQueue.getQueueStatus()

    const processingJobs = await prisma.storage.findMany({
      where: {
        agentId,
        status: 'processing',
        type: 'website'
      },
      select: {
        id: true,
        sourceUrl: true,
        crawlCount: true,
        processingLog: true,
        createdAt: true
      },
      orderBy: { createdAt: 'desc' }
    })

    const jobDetails = processingJobs.map(job => {
      const queueJob = crawlQueue.getJobStatus(job.id)
      return {
        storageId: job.id,
        url: job.sourceUrl,
        progress: queueJob?.progress || job.processingLog,
        currentUrl: queueJob?.currentUrl,
        crawlCount: job.crawlCount,
        startedAt: job.createdAt
      }
    })

    return NextResponse.json({
      success: true,
      queueStatus,
      activeJobs: jobDetails
    })

  } catch (error) {
    console.error('Failed to get crawl status:', error)
    return NextResponse.json(
      { error: 'Failed to get crawl status' },
      { status: 500 }
    )
  }
}

async function ensureWebsiteReachable(url: string): Promise<{ ok: boolean; status?: number; reason?: 'TIMEOUT' | 'NETWORK' }> {
  const headResult = await fetchWithTimeout(url, 'HEAD')

  if (headResult.ok && headResult.status === 200) {
    return { ok: true }
  }

  if (headResult.timeout) {
    return { ok: false, reason: 'TIMEOUT' }
  }

  if (headResult.error) {
    return { ok: false, reason: 'NETWORK' }
  }

  if ([400, 401, 403, 404, 405, 406, 500].includes(headResult.status ?? 0)) {
    const getResult = await fetchWithTimeout(url, 'GET')

    if (getResult.ok && getResult.status === 200) {
      return { ok: true }
    }

    if (getResult.timeout) {
      return { ok: false, reason: 'TIMEOUT' }
    }

    if (getResult.error) {
      return { ok: false, reason: 'NETWORK' }
    }

    return { ok: false, status: getResult.status }
  }

  return { ok: false, status: headResult.status }
}

async function fetchWithTimeout(
  url: string,
  method: 'HEAD' | 'GET',
  timeoutMs = 10000,
  maxRedirects = 5,
): Promise<{ ok: boolean; status?: number; timeout?: boolean; error?: boolean; ssrfBlocked?: boolean }> {
  let currentUrl = url

  for (let hop = 0; hop <= maxRedirects; hop++) {
    try {
      await assertSafeUrl(currentUrl)
    } catch (err) {
      if (err instanceof SSRFError) return { ok: false, error: true, ssrfBlocked: true }
      if (err instanceof DnsLookupError) return { ok: false, error: true }
      throw err
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(currentUrl, {
        method,
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'AiTalkCrawler/1.0',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
      })

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (!location) return { ok: false, status: response.status }
        try {
          currentUrl = new URL(location, currentUrl).href
        } catch {
          return { ok: false, error: true }
        }
        continue
      }

      return { ok: response.ok, status: response.status }
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        return { ok: false, timeout: true }
      }
      return { ok: false, error: true }
    } finally {
      clearTimeout(timeout)
    }
  }

  return { ok: false, error: true }
}
