import { getAppBaseUrl } from '@/lib/app-url'
import { getApiTranslation, Language } from '@/lib/translations'
import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { createHash, randomBytes } from 'crypto'
import { verifyActiveAgentMemberToken } from '@/lib/teamMemberCache'
import { EmailService } from '@/lib/email'
import { describeCaughtError } from '@/lib/log-mask'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: ['error', 'warn'],
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

const TOKEN_EXPIRY_HOURS = 1

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

export async function POST(
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
    const newEmail = typeof body.newEmail === 'string' ? normalizeEmail(body.newEmail) : null
    const language = (body.language as Language) || 'en'

    if (!newEmail || !isValidEmail(newEmail)) {
      return NextResponse.json({ error: t('api_error_invalid_email') }, { status: 400 })
    }

    const member = await prisma.agentMember.findUnique({
      where: { id: payload.memberId }
    })

    if (!member || member.status !== 'active') {
      return NextResponse.json({ error: t('api_error_member_not_found') }, { status: 404 })
    }

    if (member.email.toLowerCase() === newEmail) {
      return NextResponse.json({ error: t('api_error_same_email') }, { status: 400 })
    }

    const existingMember = await prisma.agentMember.findUnique({
      where: {
        agentAgentId_email: {
          agentAgentId: agentId,
          email: newEmail
        }
      }
    })

    if (existingMember) {
      return NextResponse.json({ error: t('api_error_email_already_in_use') }, { status: 400 })
    }

    const agent = await prisma.agent.findUnique({
      where: { agentId },
      select: { title: true }
    })

    await prisma.agentMemberEmailChangeToken.deleteMany({
      where: {
        agentAgentId: agentId,
        memberId: member.id
      }
    })

    const rawToken = randomBytes(32).toString('hex')
    const hashedToken = hashToken(rawToken)
    const expires = new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000)

    await prisma.agentMemberEmailChangeToken.create({
      data: {
        agentAgentId: agentId,
        memberId: member.id,
        oldEmail: member.email,
        newEmail,
        token: hashedToken,
        expires
      }
    })

    const baseUrl = getAppBaseUrl()
    const emailService = new EmailService()
    await emailService.sendTeamMemberEmailChangeEmail(
      newEmail,
      rawToken,
      agentId,
      agent?.title || agentId,
      baseUrl,
      language
    )

    return NextResponse.json({
      success: true,
      message: t('api_success_email_change_sent')
    })
  } catch (error) {
    console.error('Team member email change request error:', describeCaughtError(error))
    const t = getApiTranslation(request)
    return NextResponse.json({ error: t('api_error_internal_server_error') }, { status: 500 })
  }
}
