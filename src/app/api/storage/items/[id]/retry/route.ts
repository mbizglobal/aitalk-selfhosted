import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../../../auth/[...nextauth]/route'
import { PrismaClient } from '@prisma/client'
import { RAGProviderType } from '@/lib/rag-providers/types'
import { decryptUserApiKey, UserApiKeyError } from '@/lib/decryptUserApiKey'
import { crawlQueue, MAX_ACTIVE_CRAWLS_PER_USER, CrawlRateLimitError } from '@/lib/crawlQueue'
import { isCrawlAllowedForUser } from '@/lib/entitlement'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}
const prisma = globalForPrisma.prisma ?? new PrismaClient({ log: ['error', 'warn'] })
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

// POST /api/storage/items/[id]/retry
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions as any) as any
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const storageId = parseInt(id)
    if (isNaN(storageId)) {
      return NextResponse.json({ error: 'Invalid storage id' }, { status: 400 })
    }

    const storage = await prisma.storage.findUnique({
      where: { id: storageId },
      include: { agent: true },
    })
    if (!storage) {
      return NextResponse.json({ error: 'Storage not found' }, { status: 404 })
    }
    if (storage.agent.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (storage.type !== 'website') {
      return NextResponse.json({ error: 'Retry only supported for website crawl' }, { status: 400 })
    }
    if (storage.status !== 'failed') {
      return NextResponse.json({ error: 'Retry only allowed for failed items' }, { status: 400 })
    }
    if (!storage.sourceUrl) {
      return NextResponse.json({ error: 'Missing sourceUrl — cannot retry' }, { status: 400 })
    }

    if (!(await isCrawlAllowedForUser(session.user.id))) {
      return NextResponse.json({
        error: "Website crawling isn't available during the free trial. Please subscribe to enable it.",
        errorCode: 'CRAWL_TRIAL_BLOCKED',
      }, { status: 403 })
    }

    const ragProvider = (storage.ragProvider as RAGProviderType | null) || 'openai_vector_store'
    const isManaged = ragProvider === 'azure_ai_search'
    if (isManaged) {
      return NextResponse.json({
        error: 'Managed (Azure AI Search) retries are handled automatically. Please delete and re-crawl.',
        errorCode: 'MANAGED_AUTO_RECOVER',
      }, { status: 400 })
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      include: { zki: true, aiProviders: true, ragProviders: true, subscription: true },
    })
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    let userApiKey: string
    let pineconeConfig: any = null
    try {
      const decrypted = await decryptUserApiKey(user, ragProvider, false)
      userApiKey = decrypted.userApiKey
      pineconeConfig = decrypted.pineconeConfig
    } catch (err) {
      if (err instanceof UserApiKeyError) {
        return NextResponse.json({ error: err.message, errorCode: err.code }, { status: 400 })
      }
      throw err
    }

    if (crawlQueue.getActiveJobCountForUser(session.user.id) >= MAX_ACTIVE_CRAWLS_PER_USER) {
      return NextResponse.json({
        error: `Too many concurrent crawls (limit ${MAX_ACTIVE_CRAWLS_PER_USER}). Please wait for some to finish.`,
        errorCode: 'CRAWL_RATE_LIMIT',
      }, { status: 429 })
    }

    let claimed
    try {
      claimed = await prisma.storage.updateMany({
        where: { id: storageId, status: 'failed' },
        data: {
          status: 'processing',
          errorMessage: null,
          processingLog: JSON.stringify({
            status: 'queued',
            ragProvider,
            startTime: new Date().toISOString(),
            retriedFrom: 'failed',
          }),
        },
      })
    } catch (updateErr: any) {
      const isUniqueViolation =
        updateErr?.code === 'P2002' ||
        updateErr?.code === '23505' ||
        updateErr?.meta?.code === '23505' ||
        updateErr?.cause?.code === '23505'
      if (isUniqueViolation) {
        return NextResponse.json({
          error: 'Another crawl for this URL is already in progress',
          errorCode: 'CRAWL_CONFLICT',
        }, { status: 409 })
      }
      throw updateErr
    }
    if (claimed.count !== 1) {
      return NextResponse.json({
        error: 'Retry already in progress or item is no longer failed',
        errorCode: 'CRAWL_CONFLICT',
      }, { status: 409 })
    }

    try {
      await crawlQueue.addJob({
        storageId,
        agentId: storage.agentId,
        userId: session.user.id,
        url: storage.sourceUrl,
        maxDepth: storage.crawlDepth ?? 2,
        maxPages: storage.maxPages ?? 10,
        format: 'markdown',
        vectorStoreId: ragProvider === 'openai_vector_store' ? storage.agent.vectorStoreId : null,
        userApiKey,
        userLanguage: storage.userLanguage ?? 'en',
        ragProvider,
        pineconeConfig,
      })
    } catch (queueErr) {
      console.error('[STORAGE_RETRY] addJob failed, reverting status to failed:', queueErr)
      try {
        await prisma.storage.update({
          where: { id: storageId },
          data: {
            status: 'failed',
            errorMessage: 'Retry failed: queue error',
          },
        })
      } catch (revertErr) {
        console.error('[STORAGE_RETRY] Failed to revert status:', revertErr)
      }
      if (queueErr instanceof CrawlRateLimitError) {
        return NextResponse.json({
          error: `Too many concurrent crawls (limit ${MAX_ACTIVE_CRAWLS_PER_USER}). Please wait for some to finish.`,
          errorCode: 'CRAWL_RATE_LIMIT',
        }, { status: 429 })
      }
      return NextResponse.json({ error: 'Failed to enqueue retry' }, { status: 500 })
    }

    return NextResponse.json({ success: true, storageId })
  } catch (error) {
    console.error('[STORAGE_RETRY] Failed:', error)
    return NextResponse.json({ error: 'Failed to retry crawl' }, { status: 500 })
  }
}
