
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../../../auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { downloadFromBlob } from '@/lib/managed/blob-storage'
import { describeCaughtError } from '@/lib/log-mask'
import { isSelfHosted } from '@/lib/edition'
import { SELFHOSTED_REGION } from '@/lib/knowledge'

const INT4_MAX = 2147483647

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions as any) as any
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const storageId = /^[1-9]\d*$/.test(id) ? Number(id) : NaN
    if (!Number.isSafeInteger(storageId) || storageId > INT4_MAX) {
      return NextResponse.json({ error: 'Invalid storage ID' }, { status: 400 })
    }

    const storage = await prisma.storage.findUnique({
      where: { id: storageId },
      select: {
        id: true,
        title: true,
        blobPath: true,
        mimeType: true,
        agent: {
          select: { userId: true }
        }
      }
    })

    if (!storage) {
      return NextResponse.json({ error: 'Storage item not found' }, { status: 404 })
    }

    if (storage.agent.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (!storage.blobPath) {
      return NextResponse.json({
        error: 'Original file not available for download. Only Managed plan files are stored.'
      }, { status: 404 })
    }

    let regionId = SELFHOSTED_REGION
    if (!isSelfHosted()) {
      const subscription = await prisma.subscription.findUnique({
        where: { id: session.user.id },
        select: { managedRegion: true, serviceVariant: true }
      })

      if (!subscription?.managedRegion || subscription.serviceVariant !== 'managed') {
        return NextResponse.json({ error: 'Download is only available for Managed plan users' }, { status: 403 })
      }
      regionId = subscription.managedRegion
    }

    const { buffer, contentType } = await downloadFromBlob(regionId, storage.blobPath)

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType || storage.mimeType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(storage.title)}"`,
        'Content-Length': buffer.length.toString(),
      },
    })

  } catch (error) {
    console.error('[Storage Download] Error:', describeCaughtError(error))
    return NextResponse.json({ error: 'Download failed' }, { status: 500 })
  }
}
