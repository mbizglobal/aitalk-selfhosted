import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        isAnonymized: true,
        anonymizedAt: true
      }
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    if (user.isAnonymized) {
      return NextResponse.json({
        status: 'completed',
        anonymizedAt: user.anonymizedAt
      })
    }

    const request = await prisma.anonymizationRequest.findFirst({
      where: {
        userId,
        status: { in: ['pending', 'scheduled', 'processing', 'failed'] }
      },
      orderBy: {
        requestedAt: 'desc'
      }
    })

    if (request) {
      return NextResponse.json({
        status: request.status,
        requestedAt: request.requestedAt,
        scheduledAt: request.scheduledAt,
        isPaidUser: request.isPaidUser
      })
    }

    return NextResponse.json({
      status: 'none'
    })
  } catch (error) {
    console.error('[Anonymization Status] Error:', error)
    return NextResponse.json(
      { error: 'Failed to get anonymization status' },
      { status: 500 }
    )
  }
}
