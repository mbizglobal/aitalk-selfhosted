import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import { getServerSession } from 'next-auth'
import { getToken } from 'next-auth/jwt'
import { allowLoginAttempt, clientIpOf, maskEmail } from '@/lib/auth/app-rate-limit'
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
import { translations as koTranslations } from '@/lib/translations/dashboard/ko'
import { translations as enTranslations } from '@/lib/translations/dashboard/en'
import { translations as deTranslations } from '@/lib/translations/dashboard/de'
import { translations as frTranslations } from '@/lib/translations/dashboard/fr'
import { translations as esTranslations } from '@/lib/translations/dashboard/es'
import { describeCaughtError } from '@/lib/log-mask'

const REAUTH_MAX_AGE_MS = 5 * 60 * 1000
const CLOCK_LEEWAY_MS = 60 * 1000

export async function POST(req: NextRequest) {
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

    const userLanguage = (user.settings?.locale?.split('-')[0] || 'en') as Language

    let t: any
    switch (userLanguage) {
      case 'ko': t = koTranslations.ko; break
      case 'de': t = deTranslations.de; break
      case 'fr': t = frTranslations.fr; break
      case 'es': t = esTranslations.es; break
      default: t = enTranslations.en; break
    }

    if (user.isAnonymized) {
      return NextResponse.json({
        success: false,
        error: t.api_anonymize_already_anonymized
      }, { status: 400 })
    }

    if (user.password) {
      let password: unknown
      try {
        password = (await req.json())?.password
      } catch {
        password = undefined
      }
      if (typeof password !== 'string' || !password) {
        return NextResponse.json({ success: false, error: 'PASSWORD_REQUIRED' }, { status: 400 })
      }
      const rl = allowLoginAttempt(user.email ?? userId, clientIpOf(req.headers), 'delete')
      if (!rl.ok) {
        console.warn('[Anonymization] rate-limited', { scope: rl.scope, email: maskEmail(user.email ?? '') })
        return NextResponse.json({ success: false, error: 'RATE_LIMITED' }, { status: 429 })
      }
      if (!(await bcrypt.compare(password, user.password))) {
        console.warn('[Anonymization] wrong password', { email: maskEmail(user.email ?? '') })
        return NextResponse.json({ success: false, error: 'INVALID_PASSWORD' }, { status: 401 })
      }
    } else {
      const jwt = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
      const authAt = typeof jwt?.authAt === 'number' ? jwt.authAt : 0
      const age = Date.now() - authAt
      if (age > REAUTH_MAX_AGE_MS || age < -CLOCK_LEEWAY_MS) {
        return NextResponse.json({ success: false, error: 'REAUTH_REQUIRED' }, { status: 401 })
      }
    }

    const plan = user.settings?.plan?.toLowerCase() ?? 'free'
    const subscription = user.subscription
    if (subscription && plan !== 'free') {
      const membershipActive = subscription.end_date ? new Date(subscription.end_date) > new Date() : false
      const hasPaidCredits = (subscription.paid_cpa ?? 0) > 0 || (subscription.paid_total ?? 0) > 0
      if (membershipActive && hasPaidCredits) {
        return NextResponse.json({
          success: false,
          error: t.api_anonymize_active_subscription || 'Cannot anonymize while subscription is active. Please cancel your subscription first.'
        }, { status: 403 })
      }
    }

    const userEmail = user.email!

    const paid = await isPaidUser(userId)

    const ipAddress = getClientIP(req)
    const userAgent = req.headers.get('user-agent')
    const fingerprint = generateFingerprint(userAgent, ipAddress)

    const stats = await collectUserStats(userId)

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
        isPaidUser: paid
      }
    })

    let result
    try {
      result = await executeAnonymization(userId, request.id)
    } catch (error) {
      await prisma.anonymizationRequest
        .update({ where: { id: request.id }, data: { status: 'failed' } })
        .catch(updateError =>
          console.error('[Anonymization] Failed to mark request as failed:', describeCaughtError(updateError))
        )
      throw error
    }

    return NextResponse.json({
      success: true,
      message: result.hasApiKey ? t.api_anonymize_completed : t.api_anonymize_completed_no_api_key,
      status: 'completed',
      hasApiKey: result.hasApiKey
    })
  } catch (error) {
    console.error('[Anonymization] Error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to process anonymization request'
    }, { status: 500 })
  }
}
