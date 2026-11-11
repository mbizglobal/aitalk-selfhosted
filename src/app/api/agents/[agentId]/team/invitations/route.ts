import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { getApiTranslation } from '@/lib/translations'
import { lockAgentSeats, TeamSeatLimitError } from '@/lib/teamSeats'
import { InviteEmailRefusedError, normalizeInviteEmail, sendInvitationMail, writeInvitation } from '@/lib/team/invitations'
import { parseInviteAccess } from '@/lib/team/member-access-options'

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
      }
    })

    if (!agent) {
      return NextResponse.json({ error: t('agent_not_found') }, { status: 404 })
    }

    if (agent.userId !== session.user.id) {
      return NextResponse.json({ error: t('api_error_forbidden') }, { status: 403 })
    }

    const body = await request.json()
    const email = typeof body.email === 'string' ? normalizeInviteEmail(body.email) : null
    const workflowId = typeof body.workflowId === 'string' && body.workflowId.trim() ? body.workflowId.trim() : undefined
    const expiresInHours = typeof body.expiresInHours === 'number' && body.expiresInHours > 0
      ? Math.min(body.expiresInHours, 24 * 7)
      : 72

    if (!email) {
      return NextResponse.json({ error: t('api_error_valid_email_required') }, { status: 400 })
    }

    const access = body.access === undefined
      ? undefined
      : parseInviteAccess(body.access, new Set((await prisma.workflow.findMany({ where: { agentId: agent.agentId }, select: { workflowId: true } })).map((w) => w.workflowId)))
    if (access === null) {
      return NextResponse.json({ error: 'INVALID' }, { status: 400 })
    }

    let invitation

    try {
      invitation = (await prisma.$transaction((tx) => writeInvitation(tx, {
        agentAgentId: agent.agentId,
        email,
        invitedByUserId: session.user.id,
        workflowId,
        expiresInHours,
        ...(access ? { access: { set: access.workflowIds } } : {}),
      }))).invitation
    } catch (seatError) {
      if (seatError instanceof InviteEmailRefusedError) {
        return NextResponse.json({ error: t('api_error_team_invite_gmail') }, { status: 400 })
      }
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

    const emailSent = await sendInvitationMail(prisma, { agentAgentId: agent.agentId, invitation, workflowId: invitation.workflowId })

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
