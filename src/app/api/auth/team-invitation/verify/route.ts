import { NextRequest, NextResponse } from 'next/server'
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
    const { searchParams } = new URL(request.url)
    const token = searchParams.get('token')

    if (!token) {
      return NextResponse.json({ error: t('api_error_token_required') }, { status: 400 })
    }

    const invitation = await prisma.agentMemberInvitation.findFirst({
      where: {
        token,
        status: 'pending'
      },
      include: {
        agent: {
          select: {
            title: true,
            agentId: true,
            user: {
              select: {
                name: true,
                email: true,
                settings: true
              }
            }
          }
        }
      }
    })

    if (!invitation) {
      return NextResponse.json({ error: t('api_error_invalid_invitation') }, { status: 404 })
    }

    if (invitation.expiresAt && new Date() > invitation.expiresAt) {
      await prisma.agentMemberInvitation.update({
        where: { id: invitation.id },
        data: { status: 'expired' }
      })
      return NextResponse.json({ error: t('api_error_expired_invitation') }, { status: 410 })
    }

    const userSettings = invitation.agent.user.settings as { locale?: string } | null
    const locale = userSettings?.locale || 'en'

    return NextResponse.json({
      invitation: {
        agentTitle: invitation.agent.title,
        agentId: invitation.agent.agentId,
        inviterName: invitation.agent.user.name || invitation.agent.user.email,
        email: invitation.email,
        expiresAt: invitation.expiresAt,
        status: invitation.status,
        locale
      }
    })
  } catch (error) {
    const t = getApiTranslation(request)
    console.error('Verify invitation error:', error)
    return NextResponse.json({ error: t('api_error_server_error_occurred') }, { status: 500 })
  }
}