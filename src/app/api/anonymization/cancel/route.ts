import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    const request = await prisma.anonymizationRequest.findFirst({
      where: {
        userId,
        status: { in: ['pending', 'scheduled'] }
      }
    })

    if (!request) {
      return NextResponse.json(
        { error: '취소할 익명화 요청이 없습니다.' },
        { status: 404 }
      )
    }

    await prisma.anonymizationRequest.update({
      where: { id: request.id },
      data: {
        status: 'cancelled',
        processedAt: new Date()
      }
    })

    console.log(`[Anonymization] Request cancelled for user: ${userId}`)

    return NextResponse.json({
      status: 'cancelled',
      message: '익명화 요청이 취소되었습니다.'
    })
  } catch (error) {
    console.error('[Anonymization Cancel] Error:', error)
    return NextResponse.json(
      { error: 'Failed to cancel anonymization request' },
      { status: 500 }
    )
  }
}
