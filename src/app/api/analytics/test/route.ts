import { getApiTranslation } from '@/lib/translations'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { decryptData } from '@/lib/encryption'
import { sendGA4Event } from '@/lib/analytics'

export async function POST(request: Request) {
  try {
    const t = getApiTranslation(request)
    const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null

    if (!session || !session.user?.id) {
      return NextResponse.json({ error: t('api_error_unauthorized') }, { status: 401 })
    }

    const userId = session.user.id

    const config = await prisma.analyticsConfig.findUnique({
      where: { userId }
    })

    if (!config) {
      return NextResponse.json({
        success: false,
        error: 'Analytics configuration not found'
      }, { status: 404 })
    }

    const apiSecret = await decryptData(config.apiSecret)

    const result = await sendGA4Event(
      {
        measurementId: config.measurementId,
        apiSecret,
        isEnabled: true
      },
      `test_${Date.now()}`,
      [{
        name: 'aitalk_test_event',
        params: {
          test_timestamp: new Date().toISOString(),
          test_source: 'aitalk_analytics_settings',
        }
      }],
      true
    )

    if (result.success) {
      return NextResponse.json({
        success: true,
        message: 'Test event sent successfully. Check your GA4 Realtime report.'
      })
    } else {
      return NextResponse.json({
        success: false,
        error: result.error || 'Failed to send test event',
        validationMessages: result.validationMessages
      }, { status: 400 })
    }
  } catch (error) {
    console.error('[ANALYTICS_TEST_API] Error:', error)
    const t = getApiTranslation(request)
    return NextResponse.json({ error: t('api_error_internal_server_error') }, { status: 500 })
  }
}
