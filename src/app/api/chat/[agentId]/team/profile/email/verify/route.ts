import { getApiTranslation } from '@/lib/translations'
import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { createHash } from 'crypto'
import { createAgentMemberToken } from '@/lib/agentMemberAuth'
import { describeCaughtError } from '@/lib/log-mask'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: ['error', 'warn'],
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const t = getApiTranslation(request)
    const { agentId } = await params
    const body = await request.json()
    const rawToken = typeof body.token === 'string' ? body.token : null

    if (!rawToken) {
      return NextResponse.json({ error: t('api_error_token_required') }, { status: 400 })
    }

    const hashedToken = hashToken(rawToken)

    const emailToken = await prisma.agentMemberEmailChangeToken.findUnique({
      where: { token: hashedToken }
    })

    if (!emailToken) {
      return NextResponse.json({ error: t('api_error_invalid_or_expired_token') }, { status: 400 })
    }

    if (emailToken.agentAgentId !== agentId) {
      return NextResponse.json({ error: t('api_error_invalid_or_expired_token') }, { status: 400 })
    }

    if (emailToken.expires < new Date()) {
      await prisma.agentMemberEmailChangeToken.delete({
        where: { id: emailToken.id }
      })
      return NextResponse.json({ error: t('api_error_token_expired') }, { status: 400 })
    }

    const member = await prisma.agentMember.findUnique({
      where: { id: emailToken.memberId }
    })

    if (!member || member.status !== 'active') {
      return NextResponse.json({ error: t('api_error_member_not_found') }, { status: 400 })
    }

    const existingMember = await prisma.agentMember.findUnique({
      where: {
        agentAgentId_email: {
          agentAgentId: agentId,
          email: emailToken.newEmail
        }
      }
    })

    if (existingMember) {
      await prisma.agentMemberEmailChangeToken.delete({
        where: { id: emailToken.id }
      })
      return NextResponse.json({ error: t('api_error_email_already_in_use') }, { status: 400 })
    }

    const updatedMember = await prisma.$transaction(async (tx) => {
      const updated = await tx.agentMember.update({
        where: { id: member.id },
        data: { email: emailToken.newEmail }
      })

      await tx.agentMemberEmailChangeToken.delete({
        where: { id: emailToken.id }
      })

      return updated
    })

    const { token: newToken, expiresAt } = createAgentMemberToken({
      agentId,
      memberId: updatedMember.id,
      email: updatedMember.email
    })

    return NextResponse.json({
      success: true,
      message: t('api_success_email_changed'),
      newToken,
      expiresAt,
      member: {
        id: updatedMember.id,
        email: updatedMember.email,
        displayName: updatedMember.displayName,
        authMethod: updatedMember.authMethod
      }
    })
  } catch (error) {
    console.error('Team member email change verify error:', describeCaughtError(error))
    const t = getApiTranslation(request)
    return NextResponse.json({ error: t('api_error_internal_server_error') }, { status: 500 })
  }
}
