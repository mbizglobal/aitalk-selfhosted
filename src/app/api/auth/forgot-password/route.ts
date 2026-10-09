import { NextRequest, NextResponse } from 'next/server'
import { gmailMustUseGoogle } from '@/lib/auth/google-login'
import { describeCaughtError } from '@/lib/log-mask'
import { prisma } from '@/lib/prisma'
import { authTokenService } from '@/lib/auth-tokens'
import { sendPasswordResetEmailBackground } from '@/lib/background-email'
import { translations, Language } from '@/lib/translations'

export async function POST(request: NextRequest) {
  try {
    const { email: rawEmail, language } = await request.json()

    const email = typeof rawEmail === 'string' ? rawEmail.trim() : ''
    if (!email) {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      )
    }

    const user = await prisma.user.findUnique({
      where: { email }
    })

    if (!user) {
      const t = translations[language as Language] || translations['en']
      return NextResponse.json(
        { error: t.auth_error_email_not_registered },
        { status: 404 }
      )
    }

    if (gmailMustUseGoogle(email)) {
      return NextResponse.json(
        { error: 'Gmail users should use Google Sign-In to access their account.' },
        { status: 400 }
      )
    }

    if (!user.password) {
      return NextResponse.json(
        { error: 'This account was created with Google Sign-In. Please use Google Sign-In to access your account.' },
        { status: 400 }
      )
    }

    try {
      await prisma.passwordResetToken.deleteMany({
        where: { email }
      })

      const { token, hashedToken, expires } = authTokenService.generatePasswordResetToken(email)
      
      await prisma.passwordResetToken.create({
        data: {
          email,
          token: hashedToken,
          expires: expires
        }
      })
      
      const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000'
      const lang = language as Language || 'en'
      
      sendPasswordResetEmailBackground(email, token, baseUrl, lang)
      
      return NextResponse.json({
        message: 'If an account with that email exists, we have sent a password reset link.'
      })
      
    } catch (error) {
      console.error('[forgot-password] send failed:', describeCaughtError(error))
      return NextResponse.json(
        { error: 'Failed to process password reset request. Please try again later.' },
        { status: 500 }
      )
    }

  } catch (error) {
    console.error('[forgot-password] failed:', describeCaughtError(error))
    return NextResponse.json(
      { error: 'An error occurred while processing your request.' },
      { status: 500 }
    )
  }
}