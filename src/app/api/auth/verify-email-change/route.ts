import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authTokenService } from '@/lib/auth-tokens'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const token = searchParams.get('token')

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'MISSING_TOKEN' },
        { status: 400 }
      )
    }

    const hashedToken = authTokenService.hashToken(token)

    const emailChangeToken = await prisma.emailChangeToken.findUnique({
      where: { token: hashedToken }
    })

    if (!emailChangeToken) {
      return NextResponse.json(
        { success: false, error: 'INVALID_TOKEN' },
        { status: 400 }
      )
    }

    if (authTokenService.isTokenExpired(emailChangeToken.expires)) {
      await prisma.emailChangeToken.delete({
        where: { id: emailChangeToken.id }
      })

      return NextResponse.json(
        { success: false, error: 'EXPIRED_TOKEN' },
        { status: 400 }
      )
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: emailChangeToken.newEmail }
    })

    if (existingUser && existingUser.id !== emailChangeToken.userId) {
      await prisma.emailChangeToken.delete({
        where: { id: emailChangeToken.id }
      })

      return NextResponse.json(
        { success: false, error: 'EMAIL_TAKEN' },
        { status: 400 }
      )
    }

    await prisma.user.update({
      where: { id: emailChangeToken.userId },
      data: { email: emailChangeToken.newEmail }
    })

    await prisma.emailChangeToken.delete({
      where: { id: emailChangeToken.id }
    })

    return NextResponse.json({
      success: true,
      message: 'Email changed successfully',
      newEmail: emailChangeToken.newEmail
    })

  } catch (error) {
    console.error('[verify-email-change] Error:', error)
    return NextResponse.json(
      { success: false, error: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
