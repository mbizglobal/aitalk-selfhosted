import { getAppBaseUrl } from '@/lib/app-url'
import { getApiTranslation, Language } from '@/lib/translations'
import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { createHash, randomBytes } from 'crypto'
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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const t = getApiTranslation(request)
    const { agentId } = await params
    const body = await request.json()
    const email = typeof body.email === 'string' ? normalizeEmail(body.email) : null
    const language = (body.language as Language) || 'en'

    if (!email) {
      return NextResponse.json({ error: t('api_error_email_required') }, { status: 400 })
    }

    const agent = await prisma.agent.findUnique({
      where: { agentId },
      select: { agentId: true, title: true, accessMode: true }
    })

    if (!agent || agent.accessMode !== 'team') {
      return NextResponse.json({ success: true, message: t('api_success_password_reset_email_sent') })
    }

    const member = await prisma.agentMember.findUnique({
      where: {
        agentAgentId_email: {
          agentAgentId: agentId,
          email
        }
      }
    })

    if (!member || member.authMethod !== 'password' || member.status !== 'active') {
      return NextResponse.json({ success: true, message: t('api_success_password_reset_email_sent') })
    }

    await prisma.agentMemberPasswordResetToken.deleteMany({
      where: {
        agentAgentId: agentId,
        email
      }
    })

    const rawToken = randomBytes(32).toString('hex')
    const hashedToken = hashToken(rawToken)
    const expires = new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000)

    await prisma.agentMemberPasswordResetToken.create({
      data: {
        agentAgentId: agentId,
        memberId: member.id,
        email,
        token: hashedToken,
        expires
      }
    })

    const baseUrl = getAppBaseUrl()
    const emailService = new EmailService()
    await emailService.sendTeamMemberPasswordResetEmail(
      email,
      rawToken,
      agentId,
      agent.title || agentId,
      baseUrl,
      language
    )

    return NextResponse.json({
      success: true,
      message: t('api_success_password_reset_email_sent')
    })
  } catch (error) {
    console.error('Team member password reset request error:', describeCaughtError(error))
    const t = getApiTranslation(request)
    return NextResponse.json({ error: t('api_error_internal_server_error') }, { status: 500 })
  }
}
