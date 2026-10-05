import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { describeCaughtError } from '@/lib/log-mask'

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as any

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const agentId = searchParams.get('agentId')

    if (!agentId) {
      return NextResponse.json({ error: 'Agent ID is required' }, { status: 400 })
    }

    const agent = await prisma.agent.findUnique({
      where: { agentId },
      include: { user: true }
    })

    if (!agent || agent.userId !== session.user.id) {
      return NextResponse.json({ error: 'Agent not found or unauthorized' }, { status: 404 })
    }

    const microsoftAccount = await prisma.account.findFirst({
      where: {
        userId: agent.userId,
        provider: 'microsoft'
      }
    })

    const connected = !!(microsoftAccount && microsoftAccount.access_token)

    return NextResponse.json({
      success: true,
      data: {
        connected,
        hasAccount: !!microsoftAccount,
        hasAccessToken: !!microsoftAccount?.access_token,
      }
    })

  } catch (error) {
    console.error('Failed to check SharePoint connection:', describeCaughtError(error))
    return NextResponse.json(
      { error: 'Failed to check SharePoint connection' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as any

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const agentId = searchParams.get('agentId')

    if (!agentId) {
      return NextResponse.json({ error: 'Agent ID is required' }, { status: 400 })
    }

    const agent = await prisma.agent.findUnique({
      where: { agentId },
      include: { user: true }
    })

    if (!agent || agent.userId !== session.user.id) {
      return NextResponse.json({ error: 'Agent not found or unauthorized' }, { status: 404 })
    }

    const deletedAccount = await prisma.account.deleteMany({
      where: {
        userId: agent.userId,
        provider: 'microsoft'
      }
    })

    return NextResponse.json({
      success: true,
      message: 'SharePoint disconnected successfully',
      deletedAccounts: deletedAccount.count
    })

  } catch (error) {
    console.error('Failed to disconnect SharePoint:', describeCaughtError(error))
    return NextResponse.json(
      { error: 'Failed to disconnect SharePoint' },
      { status: 500 }
    )
  }
}