
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { encryptData, decryptData } from '@/lib/encryption'
import { verifyOauthState } from '@/lib/oauth-state'

function getRedirectUri(): string {
  return (
    process.env.GOOGLE_CALENDAR_REDIRECT_URI ||
    `${process.env.NEXTAUTH_URL}/api/agent-studio/google-calendar/callback`
  )
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderClosePage(
  status: 'success' | 'error',
  message: string,
  connectionId?: string
): string {
  const payload = JSON.stringify({
    type: 'google_calendar_oauth',
    status,
    message,
    connectionId: connectionId || null,
  }).replace(/</g, '\\u003c')
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${status === 'success' ? 'Connected' : 'Error'}</title></head>
<body style="font-family:sans-serif;padding:24px">
<h3>${status === 'success' ? 'Google Calendar connected' : 'Connection failed'}</h3>
<p>${escapeHtml(message)}</p>
<script>
  try { window.opener && window.opener.postMessage(${payload}, '*'); } catch (e) {}
  setTimeout(() => window.close(), 1200);
</script>
</body></html>`
}

async function exchangeTokenWith(
  code: string,
  clientId: string,
  clientSecret: string
): Promise<any> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: getRedirectUri(),
    }),
  })
  const data = await res.json()
  if (!res.ok) {
    throw new Error(data.error_description || data.error || 'Token exchange failed')
  }
  return data
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const code = searchParams.get('code')
  const stateRaw = searchParams.get('state')
  const errorParam = searchParams.get('error')

  if (errorParam) {
    return new NextResponse(renderClosePage('error', `Google OAuth: ${errorParam}`), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }
  if (!code || !stateRaw) {
    return new NextResponse(renderClosePage('error', 'Missing code or state'), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }

  const state = verifyOauthState<{
    agentId: string
    userId: string
    label?: string
    connectionId?: string
  }>(stateRaw)
  if (!state) {
    return new NextResponse(renderClosePage('error', 'Invalid state'), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }

  if (!state.agentId || !state.userId || !state.connectionId) {
    return new NextResponse(renderClosePage('error', 'Invalid state payload'), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }

  try {
    const conn = await prisma.workflowConnection.findFirst({
      where: {
        id: state.connectionId,
        userId: state.userId,
        provider: 'google_workspace',
        oauthMode: 'byo',
      },
      select: {
        id: true,
        agentId: true,
        userId: true,
        oauthClientId: true,
        oauthClientSecret: true,
      },
    })
    if (!conn?.oauthClientId || !conn?.oauthClientSecret) {
      throw new Error('OAuth connection not found or missing client credentials')
    }
    const clientId = await decryptData(conn.oauthClientId)
    const clientSecret = await decryptData(conn.oauthClientSecret)

    const tokenData = await exchangeTokenWith(code, clientId, clientSecret)
    const accessToken: string = tokenData.access_token
    const refreshToken: string | undefined = tokenData.refresh_token
    const expiresIn: number = tokenData.expires_in || 3600
    const scope: string | undefined = tokenData.scope
    if (!accessToken) throw new Error('No access_token in response')

    let ownerEmail: string | undefined
    try {
      const uiRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (uiRes.ok) {
        const ui = await uiRes.json()
        ownerEmail = ui.email
      }
    } catch {
      /* ignore */
    }
    if (!ownerEmail) {
      throw new Error('Could not resolve Gmail account email (userinfo failed)')
    }

    const encryptedAccess = await encryptData(accessToken)
    const encryptedRefresh = refreshToken ? await encryptData(refreshToken) : null
    const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000)

    // WorkflowCalendarAccount upsert — connectionId + ownerEmail unique
    await prisma.workflowCalendarAccount.upsert({
      where: {
        connectionId_ownerEmail: {
          connectionId: conn.id,
          ownerEmail,
        },
      },
      create: {
        connectionId: conn.id,
        userId: conn.userId,
        agentId: conn.agentId,
        ownerEmail,
        encryptedToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        tokenExpiresAt,
        oauthScope: scope,
        status: 'active',
      },
      update: {
        encryptedToken: encryptedAccess,
        refreshToken: encryptedRefresh ?? undefined,
        tokenExpiresAt,
        oauthScope: scope ?? undefined,
        status: 'active',
        errorMessage: null,
        lastUsedAt: new Date(),
      },
    })

    await prisma.workflowConnection.update({
      where: { id: conn.id },
      data: {
        description: ownerEmail,
        status: 'active',
        lastUsedAt: new Date(),
      },
    })

    return new NextResponse(
      renderClosePage('success', `Connected as ${ownerEmail}`, conn.id),
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  } catch (error: any) {
    return new NextResponse(
      renderClosePage('error', error?.message || 'Google Calendar connection failed'),
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  }
}
