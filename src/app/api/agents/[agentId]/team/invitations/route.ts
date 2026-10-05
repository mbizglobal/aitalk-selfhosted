import { getAppBaseUrl } from '@/lib/app-url'
import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getServerSession } from 'next-auth'
import { randomBytes } from 'crypto'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { emailService } from '@/lib/email'
import { getApiTranslation } from '@/lib/translations'
import { assertSeatForInvitation, lockAgentSeats, TeamSeatLimitError } from '@/lib/teamSeats'

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

export async function GET(
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

    const agent = await prisma.agent.findUnique({
      where: { agentId },
      select: {
        id: true,
        userId: true,
        agentId: true,
        accessMode: true,
      }
    })

    if (!agent) {
      return NextResponse.json({ error: t('agent_not_found') }, { status: 404 })
    }

    if (agent.userId !== session.user.id) {
      return NextResponse.json({ error: t('api_error_forbidden') }, { status: 403 })
    }

    //
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
    await prisma.agentMemberInvitation.deleteMany({
      where: {
        agentAgentId: agent.agentId,
        createdAt: { lt: threeDaysAgo },
        OR: [
          { status: { not: 'pending' } },
          { expiresAt: null },
          { expiresAt: { lte: new Date() } }
        ]
      }
    })

    const invitations = await prisma.agentMemberInvitation.findMany({
      where: { agentAgentId: agent.agentId },
      orderBy: { createdAt: 'desc' }
    })

    return NextResponse.json({
      invitations: invitations.map(invite => ({
        id: invite.id,
        email: invite.email,
        status: invite.status,
        token: invite.token,
        expiresAt: invite.expiresAt,
        invitedByUserId: invite.invitedByUserId,
        createdAt: invite.createdAt,
        acceptedAt: invite.acceptedAt,
      }))
    })
  } catch (error) {
    const t = getApiTranslation(request)
    console.error('List invitations error:', error)
    return NextResponse.json({ error: t('api_error_internal_server') }, { status: 500 })
  }
}

export async function POST(
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

    const agent = await prisma.agent.findUnique({
      where: { agentId },
      select: {
        id: true,
        userId: true,
        agentId: true,
        title: true,
        accessMode: true,
        user: {
          select: {
            name: true,
            email: true
          }
        }
      }
    })

    if (!agent) {
      return NextResponse.json({ error: t('agent_not_found') }, { status: 404 })
    }

    if (agent.userId !== session.user.id) {
      return NextResponse.json({ error: t('api_error_forbidden') }, { status: 403 })
    }

    const body = await request.json()
    const email = typeof body.email === 'string' ? normalizeEmail(body.email) : null
    const workflowId = typeof body.workflowId === 'string' ? body.workflowId : null
    const expiresInHours = typeof body.expiresInHours === 'number' && body.expiresInHours > 0
      ? Math.min(body.expiresInHours, 24 * 7)
      : 72

    if (!email) {
      return NextResponse.json({ error: t('api_error_valid_email_required') }, { status: 400 })
    }

    const token = randomBytes(24).toString('hex')
    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000)

    let invitation

    try {
      invitation = await prisma.$transaction(async (tx) => {
        await assertSeatForInvitation(tx, agent.agentId, email)

        const existing = await tx.agentMemberInvitation.findFirst({
          where: {
            agentAgentId: agent.agentId,
            email,
            status: 'pending'
          }
        })

        if (existing) {
          return tx.agentMemberInvitation.update({
            where: { id: existing.id },
            data: {
              token,
              expiresAt,
              invitedByUserId: session.user.id,
              workflowId,
              createdAt: new Date(),
              acceptedAt: null,
              status: 'pending'
            }
          })
        }

        return tx.agentMemberInvitation.create({
          data: {
            agentAgentId: agent.agentId,
            email,
            token,
            expiresAt,
            invitedByUserId: session.user.id,
            workflowId,
            status: 'pending'
          }
        })
      })
    } catch (seatError) {
      if (seatError instanceof TeamSeatLimitError) {
        return NextResponse.json({
          error: t('api_error_team_member_limit_reached'),
          limit: seatError.usage.limit,
          current: seatError.usage.memberCount,
          pending: seatError.usage.reservedCount
        }, { status: 403 })
      }
      throw seatError
    }

    if (agent.accessMode !== 'team') {
      await prisma.agent.update({
        where: { agentId: agent.agentId },
        data: { accessMode: 'team' }
      })
    }

    let emailSent = true

    try {
      const baseUrl = getAppBaseUrl()
      const inviterName = agent.user.name || agent.user.email || 'Unknown'

      let workflowTitle = agent.title // fallback to agent title
      if (workflowId) {
        const workflow = await prisma.workflow.findUnique({
          where: { workflowId },
          select: { name: true }
        })
        if (workflow?.name) {
          workflowTitle = workflow.name
        }
      }

      await emailService.sendTeamInvitationEmail(
        invitation.email,
        workflowTitle,
        invitation.token,
        baseUrl,
        inviterName,
        'en'
      )
    } catch (emailError) {
      emailSent = false
      console.error('Failed to send invitation email:', emailError)
    }

    return NextResponse.json({
      emailSent,
      invitation: {
        id: invitation.id,
        email: invitation.email,
        token: invitation.token,
        status: invitation.status,
        expiresAt: invitation.expiresAt,
        invitedByUserId: invitation.invitedByUserId,
        createdAt: invitation.createdAt,
      }
    }, { status: 201 })
  } catch (error) {
    const t = getApiTranslation(request)
    console.error('Create invitation error:', error)
    return NextResponse.json({ error: t('api_error_internal_server') }, { status: 500 })
  }
}

export async function DELETE(
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

    const { searchParams } = new URL(request.url)
    const invitationId = searchParams.get('id')

    if (!invitationId) {
      return NextResponse.json({ error: t('api_error_invitation_id_required') }, { status: 400 })
    }

    const agent = await prisma.agent.findUnique({
      where: { agentId },
      select: { id: true, userId: true }
    })

    if (!agent) {
      return NextResponse.json({ error: t('agent_not_found') }, { status: 404 })
    }

    if (agent.userId !== session.user.id) {
      return NextResponse.json({ error: t('api_error_forbidden') }, { status: 403 })
    }

    const invitation = await prisma.agentMemberInvitation.findFirst({
      where: {
        id: parseInt(invitationId),
        agentAgentId: agentId,
        invitedByUserId: session.user.id
      }
    })

    if (!invitation) {
      return NextResponse.json({ error: t('api_error_invitation_not_found') }, { status: 404 })
    }

    if (invitation.status !== 'pending') {
      return NextResponse.json({ error: t('api_error_can_only_revoke_pending_invitations') }, { status: 400 })
    }

    await prisma.$transaction(async (tx) => {
      await lockAgentSeats(tx, agentId)

      await tx.agentMemberInvitation.updateMany({
        where: {
          agentAgentId: agentId,
          email: invitation.email,
          status: 'pending'
        },
        data: { status: 'revoked' }
      })
    })

    return NextResponse.json({ success: true })

  } catch (error) {
    const t = getApiTranslation(request)
    console.error('Revoke invitation error:', error)
    return NextResponse.json({ error: t('api_error_internal_server') }, { status: 500 })
  }
}
