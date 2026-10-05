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
    const nodeId = searchParams.get('nodeId')

    if (!agentId || !nodeId) {
      return NextResponse.json({ error: 'agentId and nodeId are required' }, { status: 400 })
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
        provider: 'http_request',
        label: nodeId,
      },
      select: {
        id: true,
        encryptedToken: true,
      }
    })

    if (!connection?.encryptedToken) {
      return NextResponse.json({ hasCredentials: false })
    }

    try {
      const decrypted = await decryptData(connection.encryptedToken)
      const parsed = JSON.parse(decrypted)
      return NextResponse.json({
        hasCredentials: true,
        authType: parsed.authType || 'none',
        authHeaderName: parsed.authHeaderName || '',
        connectionId: connection.id,
      })
    } catch {
      return NextResponse.json({ hasCredentials: true, authType: 'unknown' })
    }
  } catch (error) {
    console.error('HTTP Request Auth GET error:', error)
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
    const { agentId, nodeId, credentials } = body

    if (!agentId || !nodeId || !credentials) {
      return NextResponse.json(
        { error: 'agentId, nodeId, and credentials are required' },
        { status: 400 }
      )
    }

    const agent = await prisma.agent.findFirst({
      where: { agentId, userId }
    })

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const encryptedToken = await encryptData(JSON.stringify(credentials))

    const existing = await prisma.workflowConnection.findFirst({
      where: {
        agentId,
        userId,
        provider: 'http_request',
        label: nodeId,
      }
    })

    const dbAuthType = credentials.authType === 'bearer' ? 'bearer' : 'api_key'

    if (existing) {
      await prisma.workflowConnection.update({
        where: { id: existing.id },
        data: {
          encryptedToken,
          authType: dbAuthType,
          status: 'active',
          updatedAt: new Date(),
        }
      })
    } else {
      await prisma.workflowConnection.create({
        data: {
          userId,
          agentId,
          provider: 'http_request',
          label: nodeId,
          authType: dbAuthType,
          encryptedToken,
          status: 'active',
        }
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('HTTP Request Auth POST error:', error)
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
    const nodeId = searchParams.get('nodeId')

    if (!agentId || !nodeId) {
      return NextResponse.json({ error: 'agentId and nodeId are required' }, { status: 400 })
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
        provider: 'http_request',
        label: nodeId,
      }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('HTTP Request Auth DELETE error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
