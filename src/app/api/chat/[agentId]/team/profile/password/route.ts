import { getApiTranslation } from '@/lib/translations'
import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { verifyActiveAgentMemberToken } from '@/lib/teamMemberCache'
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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const t = getApiTranslation(request)
    const { agentId } = await params

    const authHeader = request.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: t('api_error_unauthorized') }, { status: 401 })
    }

    const token = authHeader.slice(7)
    const payload = await verifyActiveAgentMemberToken(prisma, token, agentId)

    if (!payload) {
      return NextResponse.json({ error: t('api_error_invalid_or_expired_token') }, { status: 401 })
    }

    if (payload.agentId !== agentId) {
      return NextResponse.json({ error: t('api_error_unauthorized') }, { status: 401 })
    }

    const body = await request.json()
    const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : null
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : null

    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: t('api_error_passwords_required') }, { status: 400 })
    }

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json({ error: t('api_error_password_too_short') }, { status: 400 })
    }

    const member = await prisma.agentMember.findUnique({
      where: { id: payload.memberId }
    })

    if (!member || member.status !== 'active') {
      return NextResponse.json({ error: t('api_error_member_not_found') }, { status: 404 })
    }

    if (member.authMethod !== 'password' || !member.passwordHash) {
      return NextResponse.json({ error: t('api_error_password_change_not_allowed') }, { status: 400 })
    }

    const isValid = await bcrypt.compare(currentPassword, member.passwordHash)
    if (!isValid) {
      return NextResponse.json({ error: t('api_error_current_password_incorrect') }, { status: 401 })
    }

    const newPasswordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS)
    await prisma.agentMember.update({
      where: { id: member.id },
      data: { passwordHash: newPasswordHash }
    })

    return NextResponse.json({
      success: true,
      message: t('api_success_password_changed')
    })
  } catch (error) {
    console.error('Team member password change error:', describeCaughtError(error))
    const t = getApiTranslation(request)
    return NextResponse.json({ error: t('api_error_internal_server_error') }, { status: 500 })
  }
}
