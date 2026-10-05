import { getApiTranslation } from '@/lib/translations'
import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { createAgentMemberToken } from '@/lib/agentMemberAuth'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { describeCaughtError } from '@/lib/log-mask'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: ['error', 'warn'],
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const t = getApiTranslation(request)
    const { agentId } = await params

    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: t('api_error_unauthorized') }, { status: 401 })
    }

    const email = session.user.email.toLowerCase()

    const agent = await prisma.agent.findUnique({
      where: { agentId },
      select: {
        agentId: true,
        title: true,
        accessMode: true
      }
    })

    if (!agent) {
      return NextResponse.json({ error: t('api_error_agent_not_found') }, { status: 404 })
    }

    if (agent.accessMode !== 'team') {
      return NextResponse.json({ error: t('api_error_team_login_not_enabled') }, { status: 400 })
    }

    const member = await prisma.agentMember.findUnique({
      where: {
        agentAgentId_email: {
          agentAgentId: agent.agentId,
          email
        }
      }
    })

    if (!member || member.status !== 'active') {
      return NextResponse.json({ error: t('api_error_member_not_found') }, { status: 401 })
    }

    if (member.authMethod !== 'oauth') {
      return NextResponse.json({
        error: t('api_error_must_signin_via_original_method'),
        usePassword: true
      }, { status: 400 })
    }

    const { token, expiresAt } = createAgentMemberToken({
      agentId: member.agentAgentId,
      memberId: member.id,
      email: member.email
    })

    await prisma.agentMember.update({
      where: { id: member.id },
      data: { lastSeenAt: new Date() }
    })

    return NextResponse.json({
      token,
      expiresAt,
      member: {
        id: member.id,
        email: member.email,
        displayName: member.displayName,
        authMethod: member.authMethod,
      }
    })
  } catch (error) {
    console.error('Team member OAuth login error:', describeCaughtError(error))
    const t = getApiTranslation(request)
    return NextResponse.json({ error: t('api_error_internal_server_error') }, { status: 500 })
  }
}
