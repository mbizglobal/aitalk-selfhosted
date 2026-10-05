import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../../../auth/[...nextauth]/route'
import { PrismaClient } from '@prisma/client'
import { crawlQueue } from '@/lib/crawlQueue'
import { getLanguageFromHeaders, getTranslations, getErrorMessage } from '@/lib/translations/dashboard'
import { describeCaughtError } from '@/lib/log-mask'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: ['error', 'warn'],
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const language = getLanguageFromHeaders(request.headers)
  const t = getTranslations(language)

  try {
    const session = await getServerSession(authOptions as any) as any

    if (!session?.user?.id) {
      return NextResponse.json({ error: getErrorMessage('api_error_unauthorized', language) }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const agentId = searchParams.get('agentId')
    
    if (!agentId) {
      return NextResponse.json({ error: t.storage_items_agent_required }, { status: 400 })
    }
    
    const { id } = await params
    const storageId = parseInt(id)

    if (isNaN(storageId)) {
      return NextResponse.json({ error: t.storage_items_invalid_id }, { status: 400 })
    }

    const agent = await prisma.agent.findUnique({
      where: { agentId },
    })

    if (!agent || agent.userId !== session.user.id) {
      return NextResponse.json({ error: t.storage_items_agent_not_found }, { status: 404 })
    }

    const storageItem = await prisma.storage.findUnique({
      where: {
        id: storageId,
        agentId,
      },
      select: {
        id: true,
        type: true,
        status: true,
        title: true,
        sourceUrl: true,
        crawlCount: true,
        crawlDepth: true,
        processingLog: true,
        errorMessage: true,
        fileSizeBytes: true,
        createdAt: true,
        updatedAt: true,
      }
    })


    if (!storageItem) {
      return NextResponse.json({ error: t.storage_items_not_found }, { status: 404 })
    }

    let realTimeStatus = null
    if (storageItem.status === 'processing') {
      if (storageItem.type === 'website') {
        const queueJob = crawlQueue.getJobStatus(storageId)
        if (queueJob) {
          realTimeStatus = {
            progress: queueJob.progress || storageItem.processingLog,
            currentUrl: queueJob.currentUrl,
            attempts: queueJob.attempts,
            startedAt: queueJob.createdAt,
          }
        }
      } else if (storageItem.type === 'file') {
        let currentStatus = 'file_processing_uploading'
        let displayMessage = t.storage_upload_processing_uploading
        if (storageItem.processingLog) {
          try {
            const logData = JSON.parse(storageItem.processingLog)
            currentStatus = logData.currentStatus || currentStatus
            displayMessage = logData.displayMessage || displayMessage
          } catch (error) {
            console.error('Failed to parse processing log:', describeCaughtError(error))
          }
        }
        realTimeStatus = {
          progress: displayMessage,
          attempts: 1,
          startedAt: storageItem.createdAt.toISOString(),
        }
      }
    }

    let progressPercentage = 0
    if (storageItem.status === 'completed') {
      progressPercentage = 100
    } else if (storageItem.status === 'processing' && storageItem.crawlCount && storageItem.crawlDepth) {
      const estimatedTotalPages = Math.min(50, Math.pow(10, storageItem.crawlDepth))
      progressPercentage = Math.min(95, (storageItem.crawlCount / estimatedTotalPages) * 100)
    }

    let estimatedCompletion = null
    if (storageItem.status === 'processing' && storageItem.crawlCount) {
      const elapsedMs = Date.now() - storageItem.createdAt.getTime()
      const avgTimePerPage = elapsedMs / Math.max(storageItem.crawlCount, 1)
      const estimatedTotalPages = Math.min(50, storageItem.crawlDepth ? Math.pow(10, storageItem.crawlDepth) : 10)
      const remainingPages = estimatedTotalPages - storageItem.crawlCount
      const estimatedRemainingMs = remainingPages * avgTimePerPage
      estimatedCompletion = new Date(Date.now() + estimatedRemainingMs)
    }

    const responseData = {
      ...storageItem,
      realTimeStatus,
      progressPercentage: Math.round(progressPercentage),
      estimatedCompletion,
      statusMessage: getStatusMessage(storageItem.status, storageItem.crawlCount || 0, realTimeStatus?.currentUrl),
    }


    return NextResponse.json({
      success: true,
      data: responseData,
    })

  } catch (error) {
    console.error('Failed to fetch storage status:', describeCaughtError(error))
    return NextResponse.json(
      { error: 'Failed to fetch storage status' },
      { status: 500 }
    )
  }
}

function getStatusMessage(
  status: string, 
  crawlCount: number, 
  currentUrl?: string
): string {
  switch (status) {
    case 'processing':
      if (crawlCount > 0) {
        const urlDisplay = currentUrl ? ` (${new URL(currentUrl).pathname})` : ''
        return `Crawling in progress... ${crawlCount} pages processed${urlDisplay}`
      }
      return 'Starting crawl...'
    
    case 'completed':
      return `Crawling completed successfully! ${crawlCount} pages processed`
    
    case 'failed':
      return 'Crawling failed. Please try again.'

    case 'deleting':
      return 'Deleting...'

    default:
      return 'Unknown status'
  }
}