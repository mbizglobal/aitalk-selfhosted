import { getApiTranslation } from '@/lib/translations'
import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { createAgentMemberToken } from '@/lib/agentMemberAuth'
import { describeCaughtError } from '@/lib/log-mask'

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
    const email = typeof body.email === 'string' ? normalizeEmail(body.email) : null
    const password = typeof body.password === 'string' ? body.password : null

    if (!email || !password) {
      return NextResponse.json({ error: t('api_error_email_and_password_required') }, { status: 400 })
    }

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
      return NextResponse.json({ error: t('api_error_invalid_credentials') }, { status: 401 })
    }

    if (member.authMethod !== 'password' || !member.passwordHash) {
      return NextResponse.json({ error: t('api_error_must_signin_via_original_method') }, { status: 400 })
    }

    const isValid = await bcrypt.compare(password, member.passwordHash)
    if (!isValid) {
      return NextResponse.json({ error: t('api_error_invalid_credentials') }, { status: 401 })
    }

    const fresh = await prisma.agentMember.findUnique({
      where: { id: member.id },
      select: { status: true }
    })

    if (!fresh || fresh.status !== 'active') {
      return NextResponse.json({ error: t('api_error_invalid_credentials') }, { status: 401 })
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
    console.error('Team member login error:', describeCaughtError(error))
    const t = getApiTranslation(request)
    return NextResponse.json({ error: t('api_error_internal_server_error') }, { status: 500 })
  }
}
