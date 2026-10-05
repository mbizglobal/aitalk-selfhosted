import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { encryptData, decryptData } from '@/lib/encryption'

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const searchParams = request.nextUrl.searchParams
    const agentId = searchParams.get('agentId')
    const provider = searchParams.get('provider') || 'telegram'

    if (!agentId) {
      return NextResponse.json({ error: 'agentId is required' }, { status: 400 })
    }

    const agent = await prisma.agent.findFirst({
      where: { agentId, userId }
    })

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const connection = await prisma.workflowConnection.findFirst({
      where: {
        agentId,
        userId,
        provider: provider as any
      },
      select: {
        id: true,
        encryptedToken: true,
        serverUrl: true,
        serviceConfig: true
      }
    })

    let botUsername = null
    if (connection?.serviceConfig) {
      try {
        const config = JSON.parse(connection.serviceConfig)
        botUsername = config.botUsername || null
      } catch (e) {
      }
    }

    return NextResponse.json({
      hasBotToken: !!(connection?.encryptedToken),
      webhookSet: !!(connection?.serverUrl),
      botUsername
    })
  } catch (error) {
    console.error('Telegram GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const body = await request.json()
    const { agentId, botToken, provider = 'telegram', workflowId } = body

    if (!agentId || !botToken) {
      return NextResponse.json(
        { error: 'agentId and botToken are required' },
        { status: 400 }
      )
    }

    const agent = await prisma.agent.findFirst({
      where: { agentId, userId }
    })

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const encryptedToken = await encryptData(botToken)

    let botUsername = null
    try {
      const getMeRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`)
      const getMeData = await getMeRes.json()
      if (getMeData.ok && getMeData.result?.username) {
        botUsername = getMeData.result.username
      }
    } catch (e) {
      console.error('Failed to get bot info:', e)
    }

    const existing = await prisma.workflowConnection.findFirst({
      where: {
        agentId,
        userId,
        provider: provider as any
      }
    })

    const label = provider === 'telegram_webhook' ? 'Telegram Webhook' : 'Telegram'

    const serviceConfig = botUsername ? JSON.stringify({ botUsername }) : null

    if (existing) {
      await prisma.workflowConnection.update({
        where: { id: existing.id },
        data: {
          encryptedToken,
          workflowId: workflowId || existing.workflowId,
          serviceConfig: serviceConfig || existing.serviceConfig,
          status: 'active',
          updatedAt: new Date()
        }
      })
    } else {
      await prisma.workflowConnection.create({
        data: {
          userId,
          agentId,
          provider: provider as any,
          label,
          authType: 'api_key',
          encryptedToken,
          workflowId: workflowId || null,
          serviceConfig,
          status: 'active'
        }
      })
    }

    return NextResponse.json({ success: true, botUsername })
  } catch (error) {
    console.error('Telegram POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const searchParams = request.nextUrl.searchParams
    const agentId = searchParams.get('agentId')
    const provider = searchParams.get('provider') || 'telegram'

    if (!agentId) {
      return NextResponse.json({ error: 'agentId is required' }, { status: 400 })
    }

    const agent = await prisma.agent.findFirst({
      where: { agentId, userId }
    })

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    await prisma.workflowConnection.deleteMany({
      where: {
        agentId,
        userId,
        provider: provider as any
      }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Telegram DELETE error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
