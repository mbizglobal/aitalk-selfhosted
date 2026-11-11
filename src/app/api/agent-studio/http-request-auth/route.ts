import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { encryptData, decryptData } from '@/lib/encryption'
import { mergeHttpCred, urlHint } from '@/lib/work/http-target'

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
        urlHint: typeof parsed.url === 'string' ? urlHint(parsed.url) : '',
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
    const { agentId, nodeId, credentials, workApp, url } = body

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

    const existing = await prisma.workflowConnection.findFirst({
      where: {
        agentId,
        userId,
        provider: 'http_request',
        label: nodeId,
      }
    })

    let toSave: Record<string, unknown> = credentials
    if (workApp === true) {
      if (typeof credentials !== 'object' || Array.isArray(credentials) || (url !== undefined && url !== null && typeof url !== 'string')) {
        return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
      }
      let old: Record<string, unknown> = {}
      if (existing?.encryptedToken) {
        try { const v = JSON.parse(await decryptData(existing.encryptedToken)); if (v && typeof v === 'object') old = v } catch { }
      }
      const merged = mergeHttpCred(old, credentials, url)
      if ('error' in merged) return NextResponse.json({ error: merged.error }, { status: 400 })
      toSave = merged.cred
    }

    const encryptedToken = await encryptData(JSON.stringify(toSave))

    const dbAuthType = toSave.authType === 'bearer' ? 'bearer' : 'api_key'

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
