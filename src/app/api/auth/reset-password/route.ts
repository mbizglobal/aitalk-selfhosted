import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { authTokenService } from '@/lib/auth-tokens'

export async function POST(request: NextRequest) {
  try {
    const { token, password } = await request.json()

    if (!token || !password) {
      return NextResponse.json(
        { error: 'Token and password are required' },
        { status: 400 }
      )
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters long' },
        { status: 400 }
      )
    }

    const hashedToken = authTokenService.hashToken(token)

    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { token: hashedToken }
    })

    if (!resetToken) {
      return NextResponse.json(
        { error: 'Invalid or expired reset token' },
        { status: 400 }
      )
    }

    if (authTokenService.isTokenExpired(resetToken.expires)) {
      await prisma.passwordResetToken.delete({
        where: { token: hashedToken }
      })
      
      return NextResponse.json(
        { error: 'Reset token has expired. Please request a new password reset.' },
        { status: 400 }
      )
    }

    const user = await prisma.user.findUnique({
      where: { email: resetToken.email }
    })

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      )
    }

    try {
      const hashedPassword = await bcrypt.hash(password, 12)

      await prisma.user.update({
        where: { email: resetToken.email },
        data: { 
          password: hashedPassword,
          emailVerified: user.emailVerified || new Date(),
        }
      })

      await prisma.passwordResetToken.delete({
        where: { token: hashedToken }
      })

      return NextResponse.json({
        message: 'Password has been successfully reset. You can now log in with your new password.'
      })

    } catch (updateError) {
      return NextResponse.json(
        { error: 'Failed to update password. Please try again.' },
        { status: 500 }
      )
    }

  } catch (error) {
    return NextResponse.json(
      { error: 'An error occurred while processing your request.' },
      { status: 500 }
    )
  }
}