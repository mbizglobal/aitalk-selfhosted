import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../auth/[...nextauth]/route'
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: ['error', 'warn'],
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

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
    const type = searchParams.get('type')
    const status = searchParams.get('status') // 'processing', 'completed', 'failed'
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')

    const agent = await prisma.agent.findUnique({
      where: { agentId },
    })

    if (!agent || agent.userId !== session.user.id) {
      return NextResponse.json({ error: 'Agent not found or unauthorized' }, { status: 404 })
    }

    const where: any = { agentId }
    if (type) where.type = type
    if (status) where.status = status

    const ragSpaceIdParam = searchParams.get('ragSpaceId')
    if (ragSpaceIdParam && /^\d+$/.test(ragSpaceIdParam)) {
      const sid = parseInt(ragSpaceIdParam, 10)
      const sp = await prisma.ragSpace.findFirst({ where: { id: sid, agentId }, select: { isDefault: true } })
      if (sp?.isDefault) where.OR = [{ ragSpaceId: sid }, { ragSpaceId: null }]
      else where.ragSpaceId = sid
    }

    const [storageItems, totalCount, totalItemsCount] = await Promise.all([
      prisma.storage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true,
          type: true,
          status: true,
          title: true,
          content: true,
          fileSizeBytes: true,
          mimeType: true,
          sourceUrl: true,
          crawlCount: true,
          crawlDepth: true,
          ragProvider: true,
          ragStatus: true,
          ragSpaceId: true,
          blobPath: true,
          processingLog: true,
          errorMessage: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.storage.count({ where }),
      prisma.storage.count({ where: { agentId } }),
    ])

    const stats = await prisma.storage.groupBy({
      by: ['type', 'status'],
      where: { agentId },
      _count: {
        id: true,
      },
    })

    const totalSize = await prisma.storage.aggregate({
      where: { agentId },
      _sum: {
        fileSizeBytes: true,
      },
    })

    const itemsWithPageCount = storageItems.map((item) => {
      if (item.type === 'gitbook' && item.ragStatus) {
        try {
          const ragStatusJson = typeof item.ragStatus === 'string'
            ? JSON.parse(item.ragStatus)
            : item.ragStatus
          const pageCount = ragStatusJson?.gitbook?.pageCount
          const pages = ragStatusJson?.gitbook?.pages
          return {
            ...item,
            pageCount: pageCount || null,
            pages: pages || null,
          }
        } catch {
          return item
        }
      }
      return item
    })

    return NextResponse.json({
      success: true,
      data: {
        items: itemsWithPageCount,
        pagination: {
          total: totalCount,
          limit,
          offset,
          hasMore: offset + limit < totalCount,
        },
        stats: {
          byType: stats.reduce((acc, item) => {
            if (!acc[item.type]) acc[item.type] = {}
            acc[item.type][item.status] = item._count.id
            return acc
          }, {} as Record<string, Record<string, number>>),
          totalSize: totalSize._sum.fileSizeBytes || 0,
          totalItems: totalItemsCount,
        },
      },
    })

  } catch (error) {
    console.error('Failed to fetch storage items:', error)
    return NextResponse.json(
      { error: 'Failed to fetch storage items' },
      { status: 500 }
    )
  }
}