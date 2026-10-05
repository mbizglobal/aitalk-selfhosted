import { NextRequest, NextResponse } from 'next/server'
import { MCP_CONNECTION_PROVIDERS } from '@/lib/connection-scope'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { encryptData, decryptData, maskApiKey } from '@/lib/encryption'

export async function GET(request: NextRequest) {
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

    const connections = await prisma.workflowConnection.findMany({
      where: {
        agentId,
        userId,
        provider: { in: [...MCP_CONNECTION_PROVIDERS] }
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        provider: true,
        label: true,
        description: true,
        serverUrl: true,
        transport: true,
        authType: true,
        status: true,
        lastUsedAt: true,
        errorMessage: true,
        createdAt: true,
        updatedAt: true,
        encryptedToken: true,
        serviceConfig: true,
      }
    })

    const maskedConnections = await Promise.all(
      connections.map(async (conn) => {
        let maskedToken = null
        if (conn.encryptedToken) {
          try {
            const decrypted = await decryptData(conn.encryptedToken)
            maskedToken = maskApiKey(decrypted)
          } catch {
            maskedToken = '****'
          }
        }
        return {
          ...conn,
          encryptedToken: undefined,
          hasToken: !!conn.encryptedToken,
          maskedToken,
        }
      })
    )

    return NextResponse.json({ connections: maskedConnections })
  } catch (error) {
    console.error('MCP connections GET error:', error)
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
    const {
      agentId,
      provider,
      label,
      description,
      serverUrl,
      transport = 'streamable_http',
      authType = 'none',
      accessToken,
      oauthScope,
      oauthClientId,
      oauthClientSecret,
      chatId,
    } = body

    if (!agentId || !provider || !label || !serverUrl) {
      return NextResponse.json(
        { error: 'agentId, provider, label, serverUrl are required' },
        { status: 400 }
      )
    }

    const agent = await prisma.agent.findFirst({
      where: { agentId, userId }
    })

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const existing = await prisma.workflowConnection.findFirst({
      where: { agentId, provider, label }
    })

    if (existing) {
      return NextResponse.json(
        { error: 'Connection with same provider and label already exists' },
        { status: 409 }
      )
    }

    let encryptedToken = null
    if (accessToken) {
      encryptedToken = await encryptData(accessToken)
    }

    let encryptedClientId = null
    let encryptedClientSecret = null
    if (oauthClientId) {
      encryptedClientId = await encryptData(oauthClientId)
    }
    if (oauthClientSecret) {
      encryptedClientSecret = await encryptData(oauthClientSecret)
    }

    let serviceConfig: string | null = null
    if (chatId) {
      serviceConfig = JSON.stringify({ chatId })
    }

    const connection = await prisma.workflowConnection.create({
      data: {
        userId,
        agentId,
        provider,
        label,
        description,
        serverUrl,
        transport,
        authType,
        encryptedToken,
        oauthScope,
        oauthClientId: encryptedClientId,
        oauthClientSecret: encryptedClientSecret,
        serviceConfig,
        status: 'active',
      }
    })

    return NextResponse.json({
      success: true,
      connection: {
        id: connection.id,
        provider: connection.provider,
        label: connection.label,
        description: connection.description,
        serverUrl: connection.serverUrl,
        transport: connection.transport,
        authType: connection.authType,
        status: connection.status,
        hasToken: !!encryptedToken,
      }
    })
  } catch (error) {
    console.error('MCP connections POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const body = await request.json()
    const {
      id,
      label,
      description,
      serverUrl,
      transport,
      authType,
      accessToken,
      oauthScope,
      status,
      chatId,
    } = body

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    const existing = await prisma.workflowConnection.findFirst({
      where: { id, userId }
    })

    if (!existing) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
    }

    const updateData: any = {}
    if (label !== undefined) updateData.label = label
    if (description !== undefined) updateData.description = description
    if (serverUrl !== undefined) updateData.serverUrl = serverUrl
    if (transport !== undefined) updateData.transport = transport
    if (authType !== undefined) updateData.authType = authType
    if (oauthScope !== undefined) updateData.oauthScope = oauthScope
    if (status !== undefined) updateData.status = status

    if (accessToken !== undefined) {
      if (accessToken === '') {
        updateData.encryptedToken = null
      } else {
        updateData.encryptedToken = await encryptData(accessToken)
      }
    }

    if (chatId !== undefined) {
      let existingConfig: any = {}
      if (existing.serviceConfig) {
        try {
          existingConfig = JSON.parse(existing.serviceConfig)
        } catch {
        }
      }
      existingConfig.chatId = chatId
      updateData.serviceConfig = JSON.stringify(existingConfig)
    }

    const connection = await prisma.workflowConnection.update({
      where: { id },
      data: updateData
    })

    return NextResponse.json({
      success: true,
      connection: {
        id: connection.id,
        provider: connection.provider,
        label: connection.label,
        description: connection.description,
        serverUrl: connection.serverUrl,
        transport: connection.transport,
        authType: connection.authType,
        status: connection.status,
        hasToken: !!connection.encryptedToken,
      }
    })
  } catch (error) {
    console.error('MCP connections PUT error:', error)
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
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    const existing = await prisma.workflowConnection.findFirst({
      where: { id, userId }
    })

    if (!existing) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
    }

    await prisma.workflowConnection.delete({
      where: { id }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('MCP connections DELETE error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
