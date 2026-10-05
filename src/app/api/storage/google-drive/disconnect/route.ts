import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { agentId } = body

    if (!agentId) {
      return NextResponse.json(
        { success: false, error: 'Agent ID is required' },
        { status: 400 }
      )
    }

    const agent = await prisma.agent.findUnique({
      where: { agentId },
      include: { user: true }
    })

    if (!agent || agent.userId !== session.user.id) {
      return NextResponse.json(
        { success: false, error: 'Agent not found or access denied' },
        { status: 404 }
      )
    }

    /*
    await prisma.googleDriveIntegration.delete({
      where: { agentId }
    })
    */

    await prisma.agent.update({
      where: { agentId },
      data: {
        googleAccountId: null,
        googleDriveDisconnected: true
      }
    })

    return NextResponse.json({
      success: true,
      message: 'Google Drive disconnected successfully',
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to disconnect Google Drive' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const searchParams = request.nextUrl.searchParams
    const agentId = searchParams.get('agentId')

    if (!agentId) {
      return NextResponse.json(
        { success: false, error: 'Agent ID is required' },
        { status: 400 }
      )
    }

    const agent = await prisma.agent.findUnique({
      where: { agentId },
      include: { user: true }
    })

    if (!agent || agent.userId !== session.user.id) {
      return NextResponse.json(
        { success: false, error: 'Agent not found or access denied' },
        { status: 404 }
      )
    }

    const isConnected = !!agent.googleAccountId

    let googleAccount = null
    if (agent.googleAccountId) {
      googleAccount = await prisma.account.findUnique({
        where: {
          id: agent.googleAccountId
        }
      })
    }

    const googleDriveItems = await prisma.storage.count({
      where: {
        agentId,
        type: 'google_drive',
      },
    })

    return NextResponse.json({
      success: true,
      data: {
        connected: isConnected,
        syncEnabled: isConnected && googleAccount !== null,
        lastSyncAt: null,
        itemCount: googleDriveItems,
        accountInfo: googleAccount ? {
          hasAccessToken: !!googleAccount.access_token,
          hasRefreshToken: !!googleAccount.refresh_token,
          scope: googleAccount.scope
        } : null
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to check connection status' },
      { status: 500 }
    )
  }
}