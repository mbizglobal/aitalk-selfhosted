import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authTokenService } from '@/lib/auth-tokens'
import { sendVerificationEmailBackground } from '@/lib/background-email'
import { translations, Language } from '@/lib/translations'

export async function POST(request: NextRequest) {
  try {
    const { email, language = 'en' } = await request.json()
    
    if (!email) {
      return NextResponse.json(
        { success: false, error: 'EMAIL_REQUIRED' },
        { status: 400 }
      )
    }

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const recentAttempts = await prisma.emailResendAttempt.count({
      where: {
        email,
        attemptAt: {
          gte: twentyFourHoursAgo
        }
      }
    })

    if (recentAttempts >= 5) {
      const t = translations[language as Language]
      return NextResponse.json(
        { 
          success: false, 
          error: 'RATE_LIMIT_EXCEEDED',
          message: t.check_email_resend_limit || 'Too many resend attempts. Please try again after 24 hours.'
        },
        { status: 429 }
      )
    }

    const user = await prisma.user.findUnique({
      where: { email }
    })

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'USER_NOT_FOUND' },
        { status: 404 }
      )
    }

    if (user.emailVerified) {
      return NextResponse.json(
        { success: false, error: 'ALREADY_VERIFIED' },
        { status: 400 }
      )
    }

    await prisma.verificationToken.deleteMany({
      where: { identifier: email }
    })

    const { token, hashedToken, expires } = authTokenService.generateVerificationToken(email)
    
    await prisma.verificationToken.create({
      data: {
        identifier: email,
        token: hashedToken,
        expires: expires
      }
    })
    
    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000'
    const lang = language as Language

    const sub = await prisma.subscription.findUnique({
      where: { id: user.id },
      select: { signupSource: true },
    })
    const source = sub?.signupSource === 'app' ? 'app' : undefined

    sendVerificationEmailBackground(email, token, baseUrl, lang, source)
    
    await prisma.emailResendAttempt.create({
      data: {
        email,
        attemptAt: new Date()
      }
    })
    
    const t = translations[lang]
    
    return NextResponse.json({
      success: true,
      message: t.check_email_resend_success || 'Verification email resent successfully!'
    })

  } catch (error) {
    
    try {
      const language = 'en'
      const t = translations[language as Language]
      return NextResponse.json(
        { 
          success: false,
          error: t.check_email_resend_failed || 'Failed to resend email. Please try again.'
        },
        { status: 500 }
      )
    } catch {
      return NextResponse.json(
        { 
          success: false,
          error: 'Failed to resend email. Please try again.'
        },
        { status: 500 }
      )
    }
  }
}