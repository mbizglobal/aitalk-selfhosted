import { getApiTranslation } from '@/lib/translations'
import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { assertSeatForMembership, TeamSeatLimitError } from '@/lib/teamSeats'

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: ['error', 'warn'],
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as any
    const t = getApiTranslation(request)

    if (!session?.user?.id) {
      return NextResponse.json({ error: t('api_error_login_required') }, { status: 401 })
    }

    const body = await request.json()
    const { token, userEmail, displayName } = body

    if (!token || !userEmail) {
      return NextResponse.json({ error: t('api_error_token_and_email_required') }, { status: 400 })
    }

    const invitation = await prisma.agentMemberInvitation.findFirst({
      where: {
        token,
        status: 'pending'
      },
      include: {
        agent: {
          select: {
            agentId: true,
            title: true
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

    //
    const normalizedInvite = normalizeEmail(invitation.email)
    if (normalizedInvite !== normalizeEmail(userEmail) ||
        normalizedInvite !== normalizeEmail(session.user.email || '')) {
      return NextResponse.json({ error: t('api_error_email_mismatch') }, { status: 403 })
    }

    const existingMember = await prisma.agentMember.findFirst({
      where: {
        agentAgentId: invitation.agentAgentId,
        email: invitation.email
      }
    })

    if (existingMember) {
      return NextResponse.json({ error: t('api_error_already_team_member') }, { status: 409 })
    }

    //
    const user = await prisma.user.findUnique({
      where: { id: session.user.id }
    })

    if (!user) {
      return NextResponse.json({ error: t('api_error_user_not_found') }, { status: 404 })
    }

    const credentialRef = `oauth:google:${user.id}`

    const result = await prisma.$transaction(async (tx) => {
      await assertSeatForMembership(tx, invitation.agentAgentId)

      const member = await tx.agentMember.create({
        data: {
          agentAgentId: invitation.agentAgentId,
          email: invitation.email,
          displayName: displayName?.trim() || user.name || null,
          authMethod: 'oauth',
          credentialRef: credentialRef,
          status: 'active'
        }
      })

      await tx.agentMemberInvitation.delete({
        where: { id: invitation.id }
      })

      return member
    })

    return NextResponse.json({
      success: true,
      agentId: invitation.agent.agentId,
      member: {
        id: result.id,
        email: result.email,
        displayName: result.displayName,
        authMethod: result.authMethod,
        status: result.status,
        joinedAt: result.joinedAt
      }
    }, { status: 201 })

  } catch (error) {
    const t = getApiTranslation(request)

    if (error instanceof TeamSeatLimitError) {
      return NextResponse.json({
        error: t('api_error_team_full'),
        code: 'TEAM_MEMBER_LIMIT_REACHED',
        limit: error.limit
      }, { status: 403 })
    }

    console.error('Accept OAuth invitation error:', error)
    return NextResponse.json({ error: t('api_error_server_error_occurred') }, { status: 500 })
  }
}