
import { NextRequest, NextResponse } from 'next/server'
import { describeCaughtError } from '@/lib/log-mask'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { encrypt, decrypt } from '@/lib/encryption'
import { ensureUserDataKey, DataKeyError } from '@/lib/user-data-key'

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const agentId = searchParams.get('agentId')

    if (!agentId) {
      return NextResponse.json(
        { success: false, error: 'Agent ID is required' },
        { status: 400 }
      )
    }

    const agent = await prisma.agent.findFirst({
      where: {
        agentId,
        userId: session.user.id,
      },
      select: {
        gitbookAccessToken: true,
        gitbookSpaceId: true,
        gitbookPublishedUrl: true,
      },
    })

    if (!agent) {
      return NextResponse.json(
        { success: false, error: 'Agent not found' },
        { status: 404 }
      )
    }

    const hasAccessToken = !!agent.gitbookAccessToken

    return NextResponse.json({
      success: true,
      settings: {
        hasAccessToken,
        spaceId: agent.gitbookSpaceId || '',
        publishedUrl: agent.gitbookPublishedUrl || '',
      },
    })
  } catch (error) {
    console.error('Get GitBook settings error:', describeCaughtError(error))
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}

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
    const { agentId, accessToken, spaceId, publishedUrl } = body

    if (!agentId) {
      return NextResponse.json(
        { success: false, error: 'Agent ID is required' },
        { status: 400 }
      )
    }

    const agent = await prisma.agent.findFirst({
      where: {
        agentId,
        userId: session.user.id,
      },
    })

    if (!agent) {
      return NextResponse.json(
        { success: false, error: 'Agent not found' },
        { status: 404 }
      )
    }

    let encryptedAccessToken: string | null = null

    if (accessToken) {
      const dataKey = await ensureUserDataKey(prisma, session.user.id)

      encryptedAccessToken = encrypt(accessToken, dataKey).toString('base64')
    }

    const updateData: any = {
      gitbookSpaceId: spaceId || null,
      gitbookPublishedUrl: publishedUrl || null,
    }

    if (accessToken !== undefined) {
      updateData.gitbookAccessToken = accessToken ? encryptedAccessToken : null
    }

    await prisma.agent.update({
      where: { id: agent.id },
      data: updateData,
    })

    return NextResponse.json({
      success: true,
      message: 'GitBook settings saved',
    })
  } catch (error) {
    console.error('Save GitBook settings error:', describeCaughtError(error))
    if (error instanceof DataKeyError && error.code === 'USER_NOT_FOUND') {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      )
    }
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const agentId = searchParams.get('agentId')

    if (!agentId) {
      return NextResponse.json(
        { success: false, error: 'Agent ID is required' },
        { status: 400 }
      )
    }

    const agent = await prisma.agent.findFirst({
      where: {
        agentId,
        userId: session.user.id,
      },
    })

    if (!agent) {
      return NextResponse.json(
        { success: false, error: 'Agent not found' },
        { status: 404 }
      )
    }

    await prisma.agent.update({
      where: { id: agent.id },
      data: {
        gitbookAccessToken: null,
        gitbookSpaceId: null,
        gitbookPublishedUrl: null,
      },
    })

    return NextResponse.json({
      success: true,
      message: 'GitBook settings deleted',
    })
  } catch (error) {
    console.error('Delete GitBook settings error:', describeCaughtError(error))
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
