import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { getApiTranslation } from '@/lib/translations'
import { invalidateMemberCache } from '@/lib/teamMemberCache'
import { getTeamSeatUsage, assertSeatForInvitation, lockAgentSeats, TeamSeatLimitError } from '@/lib/teamSeats'
import { purgeMemberPersonalData } from '@/lib/team/member-purge'

class MemberGoneError extends Error {}

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
        userId: true
      }
    })

    if (!agent) {
      return NextResponse.json({ error: t('agent_not_found') }, { status: 404 })
    }

    if (agent.userId !== session.user.id) {
      return NextResponse.json({ error: t('api_error_forbidden') }, { status: 403 })
    }

    const members = await prisma.agentMember.findMany({
      where: { agentAgentId: agentId },
      orderBy: { joinedAt: 'desc' },
      select: {
        id: true,
        email: true,
        displayName: true,
        authMethod: true,
        status: true,
        joinedAt: true,
        lastSeenAt: true,
        planSuspendedAt: true
      }
    })

    const seats = await getTeamSeatUsage(prisma, agentId)

    return NextResponse.json({
      members,
      memberLimit: seats.limit,
      memberCount: seats.memberCount,
      totalMemberCount: members.length,
      pendingCount: seats.reservedCount,
      usedSeats: seats.usedSeats
    })

  } catch (error) {
    const t = getApiTranslation(request)
    console.error('List members error:', error)
    return NextResponse.json({ error: t('api_error_internal_server') }, { status: 500 })
  }
}

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
    const { memberId, status } = body

    if (!memberId || !status || !['active', 'suspended'].includes(status)) {
      return NextResponse.json({ error: t('api_error_valid_member_id_and_status_required') }, { status: 400 })
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

    const member = await prisma.agentMember.findFirst({
      where: {
        id: memberId,
        agentAgentId: agentId
      }
    })

    if (!member) {
      return NextResponse.json({ error: t('api_error_member_not_found') }, { status: 404 })
    }

    //
    //
    let updatedMember
    try {
      updatedMember = await prisma.$transaction(async (tx) => {
        await lockAgentSeats(tx, agentId)

        const current = await tx.agentMember.findUnique({
          where: { id: memberId },
          select: { status: true, email: true }
        })

        if (!current) {
          throw new MemberGoneError()
        }

        if (current.status === status) {
          return tx.agentMember.update({
            where: { id: memberId },
            data: {}
          })
        }

        if (status === 'active') {
          //
          await assertSeatForInvitation(tx, agentId, current.email)
        }

        return tx.agentMember.update({
          where: { id: memberId },
          data: { status, planSuspendedAt: null }
        })
      })
    } catch (seatError) {
      if (seatError instanceof MemberGoneError) {
        return NextResponse.json({ error: t('api_error_member_not_found') }, { status: 404 })
      }
      if (seatError instanceof TeamSeatLimitError) {
        return NextResponse.json({
          error: t('api_error_team_member_limit_reached'),
          limit: seatError.usage.limit,
          current: seatError.usage.memberCount
        }, { status: 403 })
      }
      throw seatError
    }

    invalidateMemberCache(agentId, memberId)

    return NextResponse.json({
      member: {
        id: updatedMember.id,
        email: updatedMember.email,
        displayName: updatedMember.displayName,
        status: updatedMember.status,
        joinedAt: updatedMember.joinedAt,
        lastSeenAt: updatedMember.lastSeenAt
      }
    })

  } catch (error) {
    const t = getApiTranslation(request)
    console.error('Update member error:', error)
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
    const memberId = searchParams.get('id')

    if (!memberId) {
      return NextResponse.json({ error: t('api_error_member_id_required') }, { status: 400 })
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

    const member = await prisma.agentMember.findFirst({
      where: {
        id: parseInt(memberId),
        agentAgentId: agentId
      }
    })

    if (!member) {
      return NextResponse.json({ error: t('api_error_member_not_found') }, { status: 404 })
    }

    const purged = await prisma.$transaction(async (tx) => {
      await lockAgentSeats(tx, agentId)
      await tx.agentMember.delete({ where: { id: member.id } })
      return await purgeMemberPersonalData(tx as any, [member.id])
    })
    console.log(
      `[Team] Purged member data: learning=${purged.learningStates} quiz=${purged.quizHistoryRows} result=${purged.results} ` +
      `payloadDetached=${purged.payloadsDetached} pwToken=${purged.passwordResetTokens} emailToken=${purged.emailChangeTokens}`
    )

    invalidateMemberCache(agentId, member.id)

    return NextResponse.json({ success: true })

  } catch (error) {
    const t = getApiTranslation(request)
    console.error('Delete member error:', error)
    return NextResponse.json({ error: t('api_error_internal_server') }, { status: 500 })
  }
}