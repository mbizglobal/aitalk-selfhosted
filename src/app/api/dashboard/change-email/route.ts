import { getAppBaseUrl } from '@/lib/app-url'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { authTokenService } from '@/lib/auth-tokens'
import { emailServiceV2, type EmailLanguage } from '@/lib/email-v2'

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { newEmail, language = 'en' } = await request.json()

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!newEmail || !emailRegex.test(newEmail)) {
      return NextResponse.json(
        { success: false, error: 'INVALID_EMAIL' },
        { status: 400 }
      )
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, email: true, name: true }
    })

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'USER_NOT_FOUND' },
        { status: 404 }
      )
    }

    if (user.email?.toLowerCase() === newEmail.toLowerCase()) {
      return NextResponse.json(
        { success: false, error: 'SAME_EMAIL' },
        { status: 400 }
      )
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: newEmail.toLowerCase() }
    })

    if (existingUser) {
      return NextResponse.json(
        { success: false, error: 'EMAIL_EXISTS' },
        { status: 400 }
      )
    }

    await prisma.emailChangeToken.deleteMany({
      where: { userId: session.user.id }
    })

    const { token, hashedToken, expires } = authTokenService.generateVerificationToken(newEmail)

    await prisma.emailChangeToken.create({
      data: {
        userId: session.user.id,
        oldEmail: user.email || '',
        newEmail: newEmail.toLowerCase(),
        token: hashedToken,
        expires
      }
    })

    const baseUrl = getAppBaseUrl()
    const verificationUrl = `${baseUrl}/auth/verify-email-change?token=${token}&lang=${language}`

    const emailResult = await emailServiceV2.sendEmailChangeVerificationEmail({
      to: newEmail,
      name: user.name || 'User',
      language: language as EmailLanguage,
      oldEmail: user.email || '',
      newEmail: newEmail,
      verificationUrl
    })

    if (!emailResult.success) {
      console.error('[change-email] Email send failed:', emailResult.error)
      return NextResponse.json(
        { success: false, error: 'EMAIL_SEND_FAILED' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Verification email sent'
    })

  } catch (error) {
    console.error('[change-email] Error:', error)
    return NextResponse.json(
      { success: false, error: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
