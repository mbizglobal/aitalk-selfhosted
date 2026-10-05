import { getApiTranslation } from '@/lib/translations'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { migrateDataKey } from '@/lib/encryption'

export async function GET(request: Request) {
  try {
    const t = getApiTranslation(request)
    const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null

    if (!session || !session.user?.id) {
      return NextResponse.json({ error: t('api_error_unauthorized') }, { status: 401 })
    }

    const userId = session.user.id

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        zkiId: true,
        zki: {
          select: {
            id: true,
            memo: true,
            createdAt: true
          }
        }
      }
    })

    if (!user) {
      return NextResponse.json({ error: t('api_error_user_not_found') }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      migrationRequired: user.zkiId !== null,
      zkiInfo: user.zki ? {
        id: user.zki.id,
        memo: user.zki.memo,
        createdAt: user.zki.createdAt
      } : null
    })
  } catch (error) {
    console.error('[MIGRATE_ENCRYPTION_API] Error in GET:', error)
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

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        encryptedDataKey: true,
        zkiId: true,
        zki: {
          select: {
            masterKey: true
          }
        }
      }
    })

    if (!user) {
      return NextResponse.json({ error: t('api_error_user_not_found') }, { status: 404 })
    }

    if (user.zkiId === null) {
      return NextResponse.json({
        success: true,
        message: 'Migration not required',
        migrationRequired: false
      })
    }

    if (!user.encryptedDataKey) {
      return NextResponse.json({
        error: 'No encryption key found for this user',
        code: 'NO_ENCRYPTION_KEY'
      }, { status: 400 })
    }

    if (!user.zki) {
      return NextResponse.json({
        error: 'Legacy key reference not found',
        code: 'ZKI_NOT_FOUND'
      }, { status: 400 })
    }

    try {
      const newEncryptedDataKey = await migrateDataKey(
        Buffer.from(user.encryptedDataKey),
        user.zki.masterKey
      )

      await prisma.user.update({
        where: { id: userId },
        data: {
          encryptedDataKey: newEncryptedDataKey,
          zkiId: null
        }
      })

      return NextResponse.json({
        success: true,
        message: 'Encryption key migration completed successfully',
        migrationRequired: false
      })
    } catch (migrationError) {
      console.error('[MIGRATE_ENCRYPTION_API] Migration failed:', migrationError)
      return NextResponse.json({
        error: 'Migration failed. Please contact support.',
        code: 'MIGRATION_FAILED'
      }, { status: 500 })
    }
  } catch (error) {
    console.error('[MIGRATE_ENCRYPTION_API] Error in POST:', error)
    const t = getApiTranslation(request)
    return NextResponse.json({ error: t('api_error_internal_server_error') }, { status: 500 })
  }
}
