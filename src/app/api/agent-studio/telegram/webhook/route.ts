import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { decryptData } from '@/lib/encryption'
import { randomBytes } from 'crypto'

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const body = await request.json()
    const { agentId, workflowId, webhookUrl } = body

    if (!agentId || !workflowId || !webhookUrl) {
      return NextResponse.json(
        { error: 'agentId, workflowId, and webhookUrl are required' },
        { status: 400 }
      )
    }

    const agent = await prisma.agent.findFirst({
      where: { agentId, userId }
    })

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const targetWorkflow = await prisma.workflow.findFirst({
      where: { workflowId, agentId }
    })
    if (!targetWorkflow) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    const connection = await prisma.workflowConnection.findFirst({
      where: {
        agentId,
        userId,
        provider: 'telegram_webhook'
      }
    })

    if (!connection?.encryptedToken) {
      return NextResponse.json({ error: 'Bot Token not found' }, { status: 400 })
    }

    const botToken = await decryptData(connection.encryptedToken)

    const webhookSecret = randomBytes(32).toString('hex')

    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${botToken}/setWebhook`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: webhookUrl,
          allowed_updates: ['message', 'callback_query'],
          secret_token: webhookSecret
        })
      }
    )

    const rollbackWebhook = async () => {
      try {
        const del = await fetch(`https://api.telegram.org/bot${botToken}/deleteWebhook`, { method: 'POST' })
        const delJson = await del.json().catch(() => null)
        if (!del.ok || !delJson?.ok) {
          console.error('[Telegram webhook] rollback deleteWebhook did not confirm ok:', delJson)
        }
      } catch (e) {
        console.error('[Telegram webhook] rollback deleteWebhook threw:', e)
      }
    }

    try {
      const telegramResult = await telegramResponse.json()

      if (!telegramResult.ok) {
        console.error('Telegram setWebhook error:', telegramResult)
        return NextResponse.json(
          { error: telegramResult.description || 'Failed to set webhook' },
          { status: 400 }
        )
      }

      let mergedServiceConfig: Record<string, unknown> = {}
      if (connection.serviceConfig) {
        try {
          const parsed = JSON.parse(connection.serviceConfig)
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) mergedServiceConfig = parsed
        } catch { }
      }
      mergedServiceConfig.webhookSecret = webhookSecret

      await prisma.workflowConnection.update({
        where: { id: connection.id },
        data: {
          serverUrl: webhookUrl,
          workflowId,
          status: 'active',
          serviceConfig: JSON.stringify(mergedServiceConfig),
          updatedAt: new Date()
        }
      })
    } catch (persistErr) {
      console.error('[Telegram webhook] persist failed after setWebhook, rolling back:', persistErr)
      await rollbackWebhook()
      return NextResponse.json({ error: 'Failed to persist webhook secret. Please retry.' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Telegram webhook POST error:', error)
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
        provider: 'telegram_webhook'
      }
    })

    if (connection?.encryptedToken) {
      const botToken = await decryptData(connection.encryptedToken)

      await fetch(
        `https://api.telegram.org/bot${botToken}/deleteWebhook`,
        { method: 'POST' }
      )

      await prisma.workflowConnection.update({
        where: { id: connection.id },
        data: {
          serverUrl: null,
          status: 'inactive',
          updatedAt: new Date()
        }
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Telegram webhook DELETE error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
