import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import {
  hashEmail,
  generateFingerprint,
  getClientIP,
  isPaidUser,
  checkRecentAnonymizationByEmail,
  checkRecentAnonymizationByDevice,
  collectUserStats
} from '@/lib/anonymization'
import { executeAnonymization } from '@/lib/execute-anonymization'
import { emailService } from '@/lib/email'
import { Language } from '@/lib/translations'
import { describeCaughtError } from '@/lib/log-mask'

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        subscription: true,
        settings: true
      }
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    if (user.isAnonymized) {
      return NextResponse.json({ error: 'User is already anonymized' }, { status: 400 })
    }

    const userEmail = user.email!
    const userLanguage = (user.settings?.locale?.split('-')[0] || 'en') as Language

    const paid = await isPaidUser(userId)

    const ipAddress = getClientIP(req)
    const userAgent = req.headers.get('user-agent')
    const fingerprint = generateFingerprint(userAgent, ipAddress)

    const stats = await collectUserStats(userId)

    if (paid) {
      console.log(`[Anonymization] Paid user ${userId} - immediate processing`)

      const request = await prisma.anonymizationRequest.create({
        data: {
          userId,
          emailHash: hashEmail(userEmail),
          requestedAt: new Date(),
          scheduledAt: new Date(),
          status: 'processing',
          ipAddress,
          userAgent,
          fingerprint,
          accountAge: stats.accountAge,
          totalCpaUsed: stats.totalCpaUsed,
          isPaidUser: true
        }
      })

      try {
        await executeAnonymization(userId, request.id)
      } catch (error) {
        await prisma.anonymizationRequest
          .update({ where: { id: request.id }, data: { status: 'failed' } })
          .catch(updateError =>
            console.error('[Anonymization] Failed to mark request as failed:', describeCaughtError(updateError))
          )
        throw error
      }

      return NextResponse.json({
        status: 'completed',
        message: '계정이 즉시 익명화되었습니다.'
      })
    }

    console.log(`[Anonymization] Free user ${userId} - 30 days waiting period`)

    const hasRecentByEmail = await checkRecentAnonymizationByEmail(userEmail)
    if (hasRecentByEmail) {
      return NextResponse.json(
        {
          error: '이전 익명화 후 30일이 경과해야 새로운 계정을 생성할 수 있습니다.'
        },
        { status: 400 }
      )
    }

    const hasRecentByDevice = await checkRecentAnonymizationByDevice(fingerprint)
    if (hasRecentByDevice) {
      return NextResponse.json(
        {
          error: '보안 정책상 이 기기에서는 30일 후에 익명화를 요청할 수 있습니다.'
        },
        { status: 400 }
      )
    }

    const existingRequest = await prisma.anonymizationRequest.findFirst({
      where: {
        userId,
        status: { in: ['pending', 'scheduled'] }
      }
    })

    if (existingRequest) {
      return NextResponse.json({
        status: 'already_requested',
        message: '이미 익명화 요청이 접수되었습니다.',
        scheduledDate: existingRequest.scheduledAt
      })
    }

    const scheduledAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

    const request = await prisma.anonymizationRequest.create({
      data: {
        userId,
        emailHash: hashEmail(userEmail),
        requestedAt: new Date(),
        scheduledAt,
        status: 'scheduled',
        ipAddress,
        userAgent,
        fingerprint,
        accountAge: stats.accountAge,
        totalCpaUsed: stats.totalCpaUsed,
        isPaidUser: false
      }
    })

    try {
      await emailService.sendAnonymizationScheduledEmail(userEmail, scheduledAt, userLanguage)
    } catch (error) {
      console.error('[Anonymization] Failed to send scheduled email:', error)
    }

    return NextResponse.json({
      status: 'scheduled',
      message: '익명화 요청이 접수되었습니다. 30일 후 자동으로 처리됩니다.',
      scheduledDate: scheduledAt
    })
  } catch (error) {
    console.error('[Anonymization Request] Error:', error)
    return NextResponse.json(
      { error: 'Failed to process anonymization request' },
      { status: 500 }
    )
  }
}
