import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]/route'
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: ['error', 'warn'],
})

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as any

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const agents = await prisma.agent.findMany({
      where: { userId: session.user.id },
      select: {
        agentId: true,
        title: true,
        accessMode: true,
        createdAt: true,
        vectorStoreId: true
      },
      orderBy: { createdAt: 'desc' }
    })

    const cpaLogs = await prisma.cpaUsageLog.findMany({
      where: {
        agentId: { in: agents.map(a => a.agentId) }
      },
      orderBy: { usageDate: 'desc' },
      take: 20
    })

    return NextResponse.json({
      success: true,
      agents,
      userId: session.user.id,
      cpaLogs: cpaLogs.map(log => ({
        no: log.no,
        agentId: log.agentId,
        usageDate: log.usageDate.toISOString().slice(0, 10),
        cpaUsed: log.cpaUsed,
        createdAt: log.createdAt.toISOString(),
        updatedAt: log.updatedAt.toISOString()
      }))
    })
  } catch (error) {
    console.error('[Debug] Failed to load agents:', error)
    return NextResponse.json({ error: 'Failed to load agents' }, { status: 500 })
  }
}