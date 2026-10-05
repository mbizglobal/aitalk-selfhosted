import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { getApiTranslation } from '@/lib/translations'
import { clampRateLimitCount } from '@/lib/rate-limit'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: ['error', 'warn'],
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const t = getApiTranslation(request)
    const { agentId } = await params
    const session = await getServerSession(authOptions as any) as any

    if (!session?.user?.id) {
      return NextResponse.json({ error: t('api_error_unauthorized') }, { status: 401 })
    }

    const body = await request.json()
    const {
      title,
      accessMode,
      chatLimitCount,
      chatLimitUnit,
      chatLimitMessage,
      continuousAnswerLimit,
      continuousAnswerLimitMessage
    } = body

    const agent = await prisma.agent.findUnique({
      where: { agentId },
      select: {
        id: true,
        userId: true,
        agentId: true,
      }
    })

    if (!agent) {
      return NextResponse.json({ error: t('agent_not_found') }, { status: 404 })
    }

    if (agent.userId !== session.user.id) {
      return NextResponse.json({ error: t('api_error_forbidden') }, { status: 403 })
    }

    const updateData: any = {}

    if (title !== undefined) {
      updateData.title = title
    }

    if (accessMode !== undefined && ['public', 'team'].includes(accessMode)) {
      updateData.accessMode = accessMode
    }

    if (chatLimitCount !== undefined) {
      updateData.chatLimitCount = clampRateLimitCount(chatLimitCount)
    }

    if (chatLimitUnit !== undefined) {
      const unitToMinutes: Record<string, number> = {
        minute: 1,
        hour: 60,
        day: 1440,
      }
      updateData.chatLimitDurationMinutes = unitToMinutes[chatLimitUnit] || 1440
    }

    if (chatLimitMessage !== undefined) {
      updateData.chatLimitMessage = chatLimitMessage
    }

    if (continuousAnswerLimit !== undefined) {
      updateData.continuousAnswerLimit = clampRateLimitCount(continuousAnswerLimit)
    }

    if (continuousAnswerLimitMessage !== undefined) {
      updateData.continuousAnswerLimitMessage = continuousAnswerLimitMessage
    }

    const updatedAgent = await prisma.agent.update({
      where: { agentId },
      data: updateData,
      select: {
        agentId: true,
        title: true,
        accessMode: true,
        updatedAt: true,
      }
    })

    return NextResponse.json({
      success: true,
      agent: updatedAgent
    })

  } catch (error) {
    const t = getApiTranslation(request)
    console.error('Update agent settings error:', error)
    return NextResponse.json({ error: t('api_error_internal_server') }, { status: 500 })
  }
}