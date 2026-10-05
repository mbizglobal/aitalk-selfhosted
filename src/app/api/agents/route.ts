import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../auth/[...nextauth]/route'
import { PrismaClient } from '@prisma/client'
import { getApiTranslation } from '@/lib/translations'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: ['error', 'warn'],
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export async function GET(request: NextRequest) {
  try {
    const t = getApiTranslation(request)
    const session = await getServerSession(authOptions as any) as any

    if (!session?.user?.id) {
      return NextResponse.json({ error: t('api_error_unauthorized') }, { status: 401 })
    }

    const agents = await prisma.agent.findMany({
      where: {
        userId: session.user.id
      },
      orderBy: {
        createdAt: 'asc'
      },
      include: {
        _count: {
          select: {
            workflows: true
          }
        }
      }
    })

    const agentsWithCount = agents.map(agent => ({
      ...agent,
      workflowCount: agent._count.workflows
    }))

    return NextResponse.json({
      success: true,
      agents: agentsWithCount
    })

  } catch (error) {
    const t = getApiTranslation(request)
    console.error('Failed to fetch agents:', error)
    return NextResponse.json(
      { error: t('api_error_failed_to_fetch_agents') },
      { status: 500 }
    )
  }
}