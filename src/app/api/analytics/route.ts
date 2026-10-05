import { getApiTranslation } from '@/lib/translations'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { encryptData } from '@/lib/encryption'

export async function GET(request: Request) {
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
        success: true,
        config: null
      })
    }

    return NextResponse.json({
      success: true,
      config: {
        measurementId: config.measurementId,
        isEnabled: config.isEnabled,
        hasApiSecret: !!config.apiSecret,
        createdAt: config.createdAt,
        updatedAt: config.updatedAt
      }
    })
  } catch (error) {
    console.error('[ANALYTICS_API] Error in GET:', error)
    const t = getApiTranslation(request)
    return NextResponse.json({ error: t('api_error_internal_server_error') }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const t = getApiTranslation(request)
    const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null

    if (!session || !session.user?.id) {
      return NextResponse.json({ error: t('api_error_unauthorized') }, { status: 401 })
    }

    const userId = session.user.id
    const body = await request.json()
    const { measurementId, apiSecret, isEnabled } = body

    if (!measurementId || typeof measurementId !== 'string') {
      return NextResponse.json({ error: 'Measurement ID is required' }, { status: 400 })
    }

    if (!measurementId.startsWith('G-')) {
      return NextResponse.json({ error: 'Invalid Measurement ID format. It should start with G-' }, { status: 400 })
    }

    const existingConfig = await prisma.analyticsConfig.findUnique({
      where: { userId }
    })

    if (!existingConfig && !apiSecret) {
      return NextResponse.json({ error: 'API Secret is required for new configuration' }, { status: 400 })
    }

    let encryptedApiSecret: string | undefined
    if (apiSecret) {
      encryptedApiSecret = await encryptData(apiSecret)
    }

    let config
    if (existingConfig) {
      config = await prisma.analyticsConfig.update({
        where: { userId },
        data: {
          measurementId,
          ...(encryptedApiSecret && { apiSecret: encryptedApiSecret }),
          isEnabled: isEnabled !== undefined ? isEnabled : true,
        }
      })
    } else {
      config = await prisma.analyticsConfig.create({
        data: {
          userId,
          measurementId,
          apiSecret: encryptedApiSecret!,
          isEnabled: isEnabled !== undefined ? isEnabled : true,
        }
      })
    }

    return NextResponse.json({
      success: true,
      message: 'Analytics configuration saved',
      config: {
        measurementId: config.measurementId,
        isEnabled: config.isEnabled,
        hasApiSecret: !!config.apiSecret
      }
    })
  } catch (error) {
    console.error('[ANALYTICS_API] Error in POST:', error)
    const t = getApiTranslation(request)
    return NextResponse.json({ error: t('api_error_internal_server_error') }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const t = getApiTranslation(request)
    const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null

    if (!session || !session.user?.id) {
      return NextResponse.json({ error: t('api_error_unauthorized') }, { status: 401 })
    }

    const userId = session.user.id

    const existingConfig = await prisma.analyticsConfig.findUnique({
      where: { userId }
    })

    if (!existingConfig) {
      return NextResponse.json({ error: 'No analytics configuration found' }, { status: 404 })
    }

    await prisma.analyticsConfig.delete({
      where: { userId }
    })

    return NextResponse.json({
      success: true,
      message: 'Analytics configuration deleted'
    })
  } catch (error) {
    console.error('[ANALYTICS_API] Error in DELETE:', error)
    const t = getApiTranslation(request)
    return NextResponse.json({ error: t('api_error_internal_server_error') }, { status: 500 })
  }
}
