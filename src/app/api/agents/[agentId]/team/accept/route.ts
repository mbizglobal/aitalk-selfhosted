import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { getApiTranslation } from '@/lib/translations'
import { assertSeatForMembership, lockAgentSeats, TeamSeatLimitError } from '@/lib/teamSeats'
import { invalidateMemberCache } from '@/lib/teamMemberCache'

class AlreadyMemberError extends Error {}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: ['error', 'warn'],
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const t = getApiTranslation(request)
    const { agentId } = await params
    const body = await request.json()
    const token = typeof body.token === 'string' ? body.token : null
    const password = typeof body.password === 'string' ? body.password : null
    const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : null

    if (!token) {
      return NextResponse.json({ error: t('api_error_invitation_token_required') }, { status: 400 })
    }

    if (!password || password.length < 8) {
      return NextResponse.json({ error: t('api_error_password_min_length') }, { status: 400 })
    }

    const invitation = await prisma.agentMemberInvitation.findUnique({
      where: { token }
    })

    if (!invitation || invitation.agentAgentId !== agentId) {
      return NextResponse.json({ error: t('api_error_invitation_not_found') }, { status: 404 })
    }

    if (invitation.status !== 'pending') {
      return NextResponse.json({ error: t('api_error_invitation_no_longer_active') }, { status: 400 })
    }

    if (invitation.expiresAt && invitation.expiresAt < new Date()) {
      return NextResponse.json({ error: t('api_error_invitation_expired') }, { status: 400 })
    }

    const hashedPassword = await bcrypt.hash(password, 12)
    const normalizedEmail = normalizeEmail(invitation.email)

    const member = await prisma.$transaction(async (tx) => {
      await lockAgentSeats(tx, invitation.agentAgentId)

      const existingMember = await tx.agentMember.findUnique({
        where: {
          agentAgentId_email: {
            agentAgentId: invitation.agentAgentId,
            email: normalizedEmail,
          }
        },
        select: { id: true, status: true, planSuspendedAt: true }
      })

      //
      //
      if (existingMember) {
        throw new AlreadyMemberError()
      }

      await assertSeatForMembership(tx, invitation.agentAgentId)

      const created = await tx.agentMember.create({
        data: {
          agentAgentId: invitation.agentAgentId,
          email: normalizedEmail,
          authMethod: 'password',
          passwordHash: hashedPassword,
          status: 'active',
          displayName: displayName || null,
          joinedAt: new Date(),
          lastSeenAt: new Date()
        }
      })

      await tx.agentMemberInvitation.delete({
        where: { id: invitation.id }
      })

      return created
    })

    invalidateMemberCache(agentId, member.id)

    return NextResponse.json({
      member: {
        id: member.id,
        email: member.email,
        displayName: member.displayName,
        status: member.status,
        joinedAt: member.joinedAt,
      }
    })
  } catch (error) {
    const t = getApiTranslation(request)

    if (error instanceof AlreadyMemberError) {
      return NextResponse.json({
        error: t('api_error_already_team_member'),
        code: 'ALREADY_MEMBER'
      }, { status: 409 })
    }

    if (error instanceof TeamSeatLimitError) {
      return NextResponse.json({
        error: t('api_error_team_full'),
        code: 'TEAM_MEMBER_LIMIT_REACHED',
        limit: error.limit
      }, { status: 403 })
    }

    console.error('Accept invitation error:', error)
    return NextResponse.json({ error: t('api_error_internal_server') }, { status: 500 })
  }
}
