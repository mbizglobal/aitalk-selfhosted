
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { encryptData, decryptData } from '@/lib/encryption'
import { testVaultConnection } from '@/lib/secret-vault'

export async function GET() {
  try {
    const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    const settings = await prisma.settings.findUnique({
      where: { id: userId },
      select: {
        vaultEnabled: true,
        vaultUrl: true,
      },
    })

    const agents = await prisma.agent.findMany({
      where: { userId },
      select: {
        id: true,
        title: true,
        workflowConnections: {
          select: {
            id: true,
            provider: true,
            label: true,
            authType: true,
          },
        },
      },
    })

    const botChannels = await prisma.botChannel.findMany({
      where: {
        agent: { userId },
        status: 'active',
      },
      select: {
        id: true,
        platform: true,
        agent: { select: { title: true } },
      },
    })

    const connections = agents.flatMap((agent) =>
      agent.workflowConnections.map((conn) => ({
        agentTitle: agent.title,
        connectionId: conn.id,
        provider: conn.provider,
        label: conn.label,
        authType: conn.authType,
        vaultKeyName: conn.authType === 'oauth'
          ? '(OAuth — DB only)'
          : `wf_conn_${conn.id}_token`,
      }))
    )

    const channels = botChannels.map((ch) => ({
      channelId: ch.id,
      platform: ch.platform,
      agentTitle: ch.agent?.title,
      vaultKeyName: ch.platform === 'slack'
        ? `bot_channel_${ch.id}_slack_bot_token, bot_channel_${ch.id}_slack_signing_secret`
        : `bot_channel_${ch.id}_token`,
    }))

    return NextResponse.json({
      vaultEnabled: settings?.vaultEnabled ?? false,
      vaultUrl: settings?.vaultUrl ?? null,
      connections,
      channels,
    })
  } catch (error) {
    console.error('[SecretVault API] GET error:', error)
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
    const { action, url, authToken } = body

    if (action === 'test') {
      if (!url || !authToken) {
        return NextResponse.json({ error: 'URL and Auth Token are required' }, { status: 400 })
      }

      const result = await testVaultConnection(url, authToken)
      return NextResponse.json(result)
    }

    if (!url || !authToken) {
      return NextResponse.json({ error: 'URL and Auth Token are required' }, { status: 400 })
    }

    try {
      new URL(url)
    } catch {
      return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 })
    }

    const testResult = await testVaultConnection(url, authToken)
    if (!testResult.success) {
      return NextResponse.json({
        error: `Connection test failed: ${testResult.error}`,
      }, { status: 400 })
    }

    const encryptedAuthToken = await encryptData(authToken)

    await prisma.settings.upsert({
      where: { id: userId },
      update: {
        vaultEnabled: true,
        vaultUrl: url,
        vaultAuthToken: encryptedAuthToken,
      },
      create: {
        id: userId,
        vaultEnabled: true,
        vaultUrl: url,
        vaultAuthToken: encryptedAuthToken,
      },
    })

    return NextResponse.json({ success: true, message: 'Secret Vault enabled' })
  } catch (error) {
    console.error('[SecretVault API] POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE() {
  try {
    const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    await prisma.settings.update({
      where: { id: userId },
      data: {
        vaultEnabled: false,
      },
    })

    return NextResponse.json({ success: true, message: 'Secret Vault disabled' })
  } catch (error) {
    console.error('[SecretVault API] DELETE error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
