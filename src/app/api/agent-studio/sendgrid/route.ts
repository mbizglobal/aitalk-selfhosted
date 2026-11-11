import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { encryptData } from '@/lib/encryption'

function readFrom(serviceConfig: string | null | undefined): { fromEmail: string; fromName: string } {
  try {
    const c = serviceConfig ? JSON.parse(serviceConfig) : {}
    return { fromEmail: typeof c?.fromEmail === 'string' ? c.fromEmail : '', fromName: typeof c?.fromName === 'string' ? c.fromName : '' }
  } catch {
    return { fromEmail: '', fromName: '' }
  }
}
const FROM_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/

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

    const connection = await prisma.workflowConnection.findFirst({
      where: {
        agentId,
        userId,
        provider: 'sendgrid'
      },
      select: {
        id: true,
        encryptedToken: true,
        serviceConfig: true
      }
    })

    return NextResponse.json({
      hasApiKey: !!(connection?.encryptedToken),
      connectionId: connection?.id ?? null,
      ...readFrom(connection?.serviceConfig)
    })
  } catch (error) {
    console.error('SendGrid GET error:', error)
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
    const { agentId, apiKey } = body
    const hasFrom = typeof body.fromEmail === 'string' || typeof body.fromName === 'string'
    const fromEmail = typeof body.fromEmail === 'string' ? body.fromEmail.trim().slice(0, 254) : undefined
    const fromName = typeof body.fromName === 'string' ? body.fromName.trim().slice(0, 100) : undefined

    if (!agentId || (!apiKey && !hasFrom)) {
      return NextResponse.json(
        { error: 'agentId and apiKey are required' },
        { status: 400 }
      )
    }
    if (fromEmail && !FROM_RE.test(fromEmail)) {
      return NextResponse.json({ error: 'Invalid from address' }, { status: 400 })
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
        provider: 'sendgrid'
      }
    })
    if (!existing && !apiKey) {
      return NextResponse.json({ error: 'agentId and apiKey are required' }, { status: 400 })
    }

    const encryptedToken = apiKey ? await encryptData(apiKey) : undefined
    const prev = readFrom(existing?.serviceConfig)
    const serviceConfig = hasFrom
      ? JSON.stringify({ fromEmail: fromEmail ?? prev.fromEmail, fromName: fromName ?? prev.fromName })
      : undefined

    if (existing) {
      await prisma.workflowConnection.update({
        where: { id: existing.id },
        data: {
          ...(encryptedToken ? { encryptedToken, status: 'active' as const } : {}),
          ...(serviceConfig !== undefined ? { serviceConfig } : {}),
          updatedAt: new Date()
        }
      })
    } else {
      await prisma.workflowConnection.create({
        data: {
          userId,
          agentId,
          provider: 'sendgrid',
          label: 'SendGrid',
          authType: 'api_key',
          encryptedToken,
          ...(serviceConfig !== undefined ? { serviceConfig } : {}),
          status: 'active'
        }
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('SendGrid POST error:', error)
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

    await prisma.workflowConnection.deleteMany({
      where: {
        agentId,
        userId,
        provider: 'sendgrid'
      }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('SendGrid DELETE error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
