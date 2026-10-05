
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { connectionId } = body || {}
    if (!connectionId) {
      return NextResponse.json(
        { success: false, error: 'connectionId required' },
        { status: 400 }
      )
    }

    const conn = await prisma.workflowConnection.findFirst({
      where: { id: connectionId, userId: session.user.id, provider: 'microsoft_workspace' },
      select: { id: true },
    })
    if (!conn) {
      return NextResponse.json(
        { success: false, error: 'Connection not found' },
        { status: 404 }
      )
    }

    await prisma.workflowConnection.update({
      where: { id: conn.id },
      data: {
        encryptedToken: null,
        refreshToken: null,
        tokenExpiresAt: null,
        oauthScope: null,
        status: 'expired',
      },
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to disconnect' },
      { status: 500 }
    )
  }
}
