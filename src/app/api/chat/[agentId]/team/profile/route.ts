import { getApiTranslation } from '@/lib/translations'
import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { verifyActiveAgentMemberToken } from '@/lib/teamMemberCache'
import { describeCaughtError } from '@/lib/log-mask'

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

    const authHeader = request.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: t('api_error_unauthorized') }, { status: 401 })
    }

    const token = authHeader.slice(7)
    const payload = await verifyActiveAgentMemberToken(prisma, token, agentId)

    if (!payload) {
      return NextResponse.json({ error: t('api_error_invalid_or_expired_token') }, { status: 401 })
    }

    if (payload.agentId !== agentId) {
      return NextResponse.json({ error: t('api_error_unauthorized') }, { status: 401 })
    }

    const body = await request.json()
    const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : null

    if (!displayName || displayName.length === 0) {
      return NextResponse.json({ error: t('api_error_display_name_required') }, { status: 400 })
    }

    if (displayName.length > 50) {
      return NextResponse.json({ error: t('api_error_display_name_too_long') }, { status: 400 })
    }

    const updatedMember = await prisma.agentMember.update({
      where: { id: payload.memberId },
      data: { displayName }
    })

    return NextResponse.json({
      success: true,
      member: {
        id: updatedMember.id,
        email: updatedMember.email,
        displayName: updatedMember.displayName,
        authMethod: updatedMember.authMethod,
      }
    })
  } catch (error) {
    console.error('Team member profile update error:', describeCaughtError(error))
    const t = getApiTranslation(request)
    return NextResponse.json({ error: t('api_error_internal_server_error') }, { status: 500 })
  }
}
