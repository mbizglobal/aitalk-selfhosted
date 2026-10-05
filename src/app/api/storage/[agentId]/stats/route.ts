/**
 * Get storage statistics for an agent
 * GET /api/storage/[agentId]/stats
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../../auth/[...nextauth]/route'
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: ['error', 'warn'],
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const session = await getServerSession(authOptions as any) as any
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { agentId } = await params

    // Verify agent ownership
    const agent = await prisma.agent.findFirst({
      where: {
        agentId,
        userId: session.user.id
      }
    })

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    // Get storage items for this agent
    const storageItems = await prisma.storage.findMany({
      where: { agentId },
      select: {
        id: true,
        type: true,
        status: true,
        fileSizeBytes: true,
        ragStatus: true,
        processingLog: true,
      }
    })

    // Helper function to check if item uses Gemini RAG
    const isGeminiRag = (item: any): boolean => {
      // Check ragStatus JSON for gemini_file_search
      if (item.ragStatus) {
        try {
          const ragStatus = JSON.parse(item.ragStatus)
          if (ragStatus.gemini_file_search) {
            return true
          }
        } catch {}
      }
      // Check processingLog for ragProvider
      if (item.processingLog) {
        try {
          const log = JSON.parse(item.processingLog)
          if (log.ragProvider === 'gemini_file_search') {
            return true
          }
        } catch {}
      }
      return false
    }

    // Filter out Gemini RAG items (48-hour auto-delete, not counted in stats)
    const permanentItems = storageItems.filter(item => !isGeminiRag(item))
    const geminiItems = storageItems.filter(item => isGeminiRag(item))

    // Calculate statistics (excluding Gemini RAG)
    const totalItems = permanentItems.length
    const totalSize = permanentItems.reduce((sum: number, item) => sum + (item.fileSizeBytes || 0), 0)

    // Group by type (excluding Gemini RAG)
    const byType: Record<string, { total: number; completed: number; size: number }> = {}

    for (const item of permanentItems) {
      const type = item.type || 'unknown'
      if (!byType[type]) {
        byType[type] = { total: 0, completed: 0, size: 0 }
      }
      byType[type].total++
      if (item.status === 'completed') {
        byType[type].completed++
      }
      byType[type].size += item.fileSizeBytes || 0
    }

    return NextResponse.json({
      totalItems,
      totalSize,
      byType,
      // Gemini stats separately (for reference, temporary storage)
      gemini: {
        totalItems: geminiItems.length,
        totalSize: geminiItems.reduce((sum: number, item) => sum + (item.fileSizeBytes || 0), 0),
      }
    })
  } catch (error) {
    console.error('Failed to get storage stats:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
