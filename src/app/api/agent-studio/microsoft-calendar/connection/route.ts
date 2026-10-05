
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { encryptData, decryptData } from '@/lib/encryption'
import { getSharedMicrosoftApp } from '@/lib/microsoft/shared-oauth'

const PROVIDER = 'microsoft_workspace' as const
const DEFAULT_LABEL = 'Microsoft Calendar'
const DEFAULT_SERVICE_CONFIG = JSON.stringify({
  calendarId: '',
  userPrincipalName: '',
  timezone: 'Europe/Zurich',
  workingHoursStart: '09:00',
  workingHoursEnd: '18:00',
  defaultDurationMin: 30,
  inviteAttendee: false,
})

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { agentId, label, oauthClientId, oauthClientSecret, connectionId } = body || {}
    const oauthMode: 'byo' | 'shared' = body?.oauthMode === 'shared' ? 'shared' : 'byo'

    if (!agentId) {
      return NextResponse.json(
        { success: false, error: 'agentId required' },
        { status: 400 }
      )
    }
    if (oauthMode === 'byo' && (!oauthClientId || !oauthClientSecret)) {
      return NextResponse.json(
        { success: false, error: 'oauthClientId, oauthClientSecret required' },
        { status: 400 }
      )
    }
    if (oauthMode === 'shared') {
      const shared = await getSharedMicrosoftApp(prisma)
      if (!shared) {
        return NextResponse.json(
          { success: false, error: 'Quick connect is not available. Use direct connection.' },
          { status: 503 }
        )
      }
    }

    const agent = await prisma.agent.findFirst({
      where: { agentId, userId: session.user.id },
      select: { agentId: true },
    })
    if (!agent) {
      return NextResponse.json({ success: false, error: 'Agent not found' }, { status: 404 })
    }

    const encryptedClientId = oauthMode === 'byo' ? await encryptData(oauthClientId) : null
    const encryptedClientSecret = oauthMode === 'byo' ? await encryptData(oauthClientSecret) : null
    const effectiveLabel = (label && label.trim()) || DEFAULT_LABEL

    if (connectionId) {
      const existing = await prisma.workflowConnection.findFirst({
        where: { id: connectionId, userId: session.user.id, provider: PROVIDER },
        select: { id: true, agentId: true, status: true, serviceConfig: true },
      })
      if (!existing) {
        return NextResponse.json(
          { success: false, error: 'Connection not found' },
          { status: 404 }
        )
      }
      const labelConflict = await prisma.workflowConnection.findFirst({
        where: {
          agentId: existing.agentId,
          userId: session.user.id,
          provider: PROVIDER,
          label: effectiveLabel,
          NOT: { id: existing.id },
        },
        select: { id: true },
      })
      if (labelConflict) {
        return NextResponse.json(
          { success: false, error: 'A connection with this label already exists. Use a different label.' },
          { status: 409 }
        )
      }
      const updated = await prisma.workflowConnection.update({
        where: { id: existing.id },
        data: {
          label: effectiveLabel,
          oauthMode,
          oauthClientId: encryptedClientId,
          oauthClientSecret: encryptedClientSecret,
          status: 'expired',
          serviceConfig: existing.serviceConfig || DEFAULT_SERVICE_CONFIG,
        },
        select: { id: true },
      })
      return NextResponse.json({ success: true, connectionId: updated.id, mode: 'updated' })
    }

    const existingByLabel = await prisma.workflowConnection.findFirst({
      where: { agentId, userId: session.user.id, provider: PROVIDER, label: effectiveLabel },
      select: { id: true, serviceConfig: true, oauthMode: true },
    })

    if (existingByLabel) {
      if ((existingByLabel.oauthMode || 'byo') !== oauthMode) {
        return NextResponse.json(
          {
            success: false,
            error: 'A connection with this label already exists in a different mode. Use a different label.',
          },
          { status: 409 }
        )
      }
      await prisma.workflowConnection.update({
        where: { id: existingByLabel.id },
        data: {
          oauthMode,
          oauthClientId: encryptedClientId,
          oauthClientSecret: encryptedClientSecret,
          status: 'expired',
          serviceConfig: existingByLabel.serviceConfig || DEFAULT_SERVICE_CONFIG,
        },
      })
      return NextResponse.json({
        success: true,
        connectionId: existingByLabel.id,
        mode: 'updated',
      })
    }

    const created = await prisma.workflowConnection.create({
      data: {
        userId: session.user.id,
        agentId,
        provider: PROVIDER,
        label: effectiveLabel,
        authType: 'oauth',
        oauthMode,
        oauthClientId: encryptedClientId,
        oauthClientSecret: encryptedClientSecret,
        serviceConfig: DEFAULT_SERVICE_CONFIG,
        status: 'expired',
      },
      select: { id: true },
    })
    return NextResponse.json({ success: true, connectionId: created.id, mode: 'created' })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to save connection' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const connectionId = request.nextUrl.searchParams.get('connectionId')
    if (!connectionId) {
      return NextResponse.json(
        { success: false, error: 'connectionId is required' },
        { status: 400 }
      )
    }

    const conn = await prisma.workflowConnection.findFirst({
      where: { id: connectionId, userId: session.user.id, provider: PROVIDER },
      select: { id: true },
    })
    if (!conn) {
      return NextResponse.json(
        { success: false, error: 'Connection not found' },
        { status: 404 }
      )
    }

    await prisma.workflowConnection.delete({ where: { id: conn.id } })
    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to delete connection' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const connectionId = request.nextUrl.searchParams.get('connectionId')
    if (!connectionId) {
      return NextResponse.json(
        { success: false, error: 'connectionId is required' },
        { status: 400 }
      )
    }

    const conn = await prisma.workflowConnection.findFirst({
      where: { id: connectionId, userId: session.user.id, provider: PROVIDER },
      select: {
        id: true,
        label: true,
        status: true,
        oauthMode: true,
        oauthClientId: true,
        oauthClientSecret: true,
      },
    })

    if (!conn) {
      return NextResponse.json(
        { success: false, error: 'Connection not found' },
        { status: 404 }
      )
    }

    const clientId = conn.oauthClientId ? await decryptData(conn.oauthClientId) : ''

    return NextResponse.json({
      success: true,
      connection: {
        id: conn.id,
        label: conn.label,
        status: conn.status,
        oauthMode: conn.oauthMode || 'byo',
        oauthClientId: clientId,
        hasClientSecret: !!conn.oauthClientSecret,
      },
    })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to load connection' },
      { status: 500 }
    )
  }
}
