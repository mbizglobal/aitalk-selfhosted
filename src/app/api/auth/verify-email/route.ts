import { getAppBaseUrl } from '@/lib/app-url'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authTokenService } from '@/lib/auth-tokens'
import { sendWelcomeEmailBackground } from '@/lib/background-email'
import { translations, Language } from '@/lib/translations'
import crypto from 'crypto'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const token = searchParams.get('token')
    const language = (searchParams.get('lang') as Language) || 'en'
    const source = searchParams.get('source')

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'MISSING_TOKEN' },
        { status: 400 }
      )
    }

    const hashedToken = authTokenService.hashToken(token)

    const verificationToken = await prisma.verificationToken.findFirst({
      where: { token: hashedToken }
    })

    if (!verificationToken) {
      return NextResponse.json(
        { success: false, error: 'INVALID_TOKEN' },
        { status: 400 }
      )
    }

    if (verificationToken.expires < new Date()) {
      await prisma.verificationToken.delete({
        where: { token: hashedToken }
      })
      
      return NextResponse.json(
        { success: false, error: 'EXPIRED_TOKEN' },
        { status: 400 }
      )
    }

    const user = await prisma.user.findUnique({
      where: { email: verificationToken.identifier }
    })

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'USER_NOT_FOUND' },
        { status: 404 }
      )
    }

    if (user.emailVerified) {
      await prisma.verificationToken.delete({
        where: { token: hashedToken }
      })
      
      return NextResponse.json(
        { success: false, error: 'ALREADY_VERIFIED' },
        { status: 400 }
      )
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: new Date() }
    })

    await prisma.verificationToken.delete({
      where: { token: hashedToken }
    })

    const sub = await prisma.subscription.findUnique({ where: { id: user.id }, select: { signupSource: true } })
    const isAppUser = source === 'app' && sub?.signupSource === 'app'

    const welcomeBaseUrl = getAppBaseUrl()
    sendWelcomeEmailBackground(user.email!, user.name || 'User', language, isAppUser ? 'app' : undefined, welcomeBaseUrl)

    const t = translations[language]

    if (isAppUser) {
      const raw = crypto.randomBytes(32).toString('base64url')
      const hash = crypto.createHash('sha256').update(raw).digest('hex')
      await prisma.verificationToken.create({
        data: {
          identifier: `app-exchange:${user.id}`,
          token: hash,
          expires: new Date(Date.now() + 5 * 60 * 1000),
        },
      })
      return NextResponse.json({
        success: true,
        message: t.verify_email_success_message || 'Email verified.',
        user: { email: user.email, name: user.name },
        appCode: raw,
      })
    }

    return NextResponse.json({
      success: true,
      message: t.verify_email_success_message || 'Your email has been successfully verified. You can now access all features of AI Talk.',
      user: {
        email: user.email,
        name: user.name
      }
    })

  } catch (error) {

    try {
      const { searchParams } = new URL(request.url)
      const language = (searchParams.get('lang') as Language) || 'en'
      const t = (translations as any)[language] || translations.en
      return NextResponse.json(
        { error: t.verify_email_error_generic || 'An error occurred during verification. Please try again.' },
        { status: 500 }
      )
    } catch (translationError) {
      return NextResponse.json(
        { error: 'An error occurred during verification. Please try again.' },
        { status: 500 }
      )
    }
  }
}