
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { decryptData } from '@/lib/encryption'
import { getSharedMicrosoftApp } from '@/lib/microsoft/shared-oauth'
import { signOauthState } from '@/lib/oauth-state'

const SCOPES = ['Calendars.ReadWrite', 'offline_access', 'User.Read']

function getRedirectUri(): string {
  return (
    process.env.MICROSOFT_CALENDAR_REDIRECT_URI ||
    `${process.env.NEXTAUTH_URL}/api/agent-studio/microsoft-calendar/callback`
  )
}

function buildAuthorizeUrl(clientId: string, state: string): string {
  const authUrl = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', getRedirectUri())
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', SCOPES.join(' '))
  authUrl.searchParams.set('response_mode', 'query')
  authUrl.searchParams.set('prompt', 'consent')
  authUrl.searchParams.set('state', state)
  return authUrl.toString()
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { connectionId } = body || {}

    if (!connectionId) {
      return NextResponse.json(
        { success: false, error: 'connectionId required (save credentials first)' },
        { status: 400 }
      )
    }

    const conn = await prisma.workflowConnection.findFirst({
      where: {
        id: connectionId,
        userId: session.user.id,
        provider: 'microsoft_workspace',
      },
      select: {
        id: true,
        agentId: true,
        label: true,
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

    let clientIdPlain: string
    if (conn.oauthMode === 'shared') {
      const shared = await getSharedMicrosoftApp(prisma)
      if (!shared) {
        return NextResponse.json(
          { success: false, error: 'Quick connect is not available. Use direct connection.' },
          { status: 503 }
        )
      }
      clientIdPlain = shared.clientId
    } else {
      if (!conn.oauthClientId || !conn.oauthClientSecret) {
        return NextResponse.json(
          {
            success: false,
            error: 'Connection credentials missing. Save Client ID/Secret first.',
          },
          { status: 404 }
        )
      }
      clientIdPlain = await decryptData(conn.oauthClientId)
    }

    const state = signOauthState({
      agentId: conn.agentId,
      userId: session.user.id,
      label: conn.label,
      connectionId: conn.id,
    })

    return NextResponse.json({
      success: true,
      authUrl: buildAuthorizeUrl(clientIdPlain, state),
      connectionId: conn.id,
    })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to start OAuth' },
      { status: 500 }
    )
  }
}
