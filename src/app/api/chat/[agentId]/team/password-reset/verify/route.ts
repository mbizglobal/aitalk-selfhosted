import { getApiTranslation } from '@/lib/translations'
import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { createHash } from 'crypto'
import bcrypt from 'bcryptjs'
import { describeCaughtError } from '@/lib/log-mask'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: ['error', 'warn'],
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

const MIN_PASSWORD_LENGTH = 8
const BCRYPT_ROUNDS = 12

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
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : null

    if (!rawToken || !newPassword) {
      return NextResponse.json({ error: t('api_error_token_and_password_required') }, { status: 400 })
    }

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json({ error: t('api_error_password_too_short') }, { status: 400 })
    }

    const hashedToken = hashToken(rawToken)

    const resetToken = await prisma.agentMemberPasswordResetToken.findUnique({
      where: { token: hashedToken }
    })

    if (!resetToken) {
      return NextResponse.json({ error: t('api_error_invalid_or_expired_token') }, { status: 400 })
    }

    if (resetToken.agentAgentId !== agentId) {
      return NextResponse.json({ error: t('api_error_invalid_or_expired_token') }, { status: 400 })
    }

    if (resetToken.expires < new Date()) {
      await prisma.agentMemberPasswordResetToken.delete({
        where: { id: resetToken.id }
      })
      return NextResponse.json({ error: t('api_error_token_expired') }, { status: 400 })
    }

    const member = await prisma.agentMember.findUnique({
      where: { id: resetToken.memberId }
    })

    if (!member || member.status !== 'active') {
      return NextResponse.json({ error: t('api_error_member_not_found') }, { status: 400 })
    }

    const newPasswordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS)

    await prisma.$transaction([
      prisma.agentMember.update({
        where: { id: member.id },
        data: { passwordHash: newPasswordHash }
      }),
      prisma.agentMemberPasswordResetToken.delete({
        where: { id: resetToken.id }
      })
    ])

    return NextResponse.json({
      success: true,
      message: t('api_success_password_reset')
    })
  } catch (error) {
    console.error('Team member password reset verify error:', describeCaughtError(error))
    const t = getApiTranslation(request)
    return NextResponse.json({ error: t('api_error_internal_server_error') }, { status: 500 })
  }
}
