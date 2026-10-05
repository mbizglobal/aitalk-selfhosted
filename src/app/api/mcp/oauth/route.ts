
import { isSelfHosted } from '@/lib/edition'
import { getInstallationBrand } from '@/lib/brand'
import { getAppBaseUrl } from '@/lib/app-url'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { encryptData, decryptData } from '@/lib/encryption'

interface ProviderOAuthConfig {
  authUrl: string
  tokenUrl: string
  supportsDCR?: boolean
  registrationUrl?: string
  mcpServerUrl?: string
}

const PROVIDER_DEFAULTS: Record<string, ProviderOAuthConfig> = {
  notion: {
    authUrl: 'https://mcp.notion.com/authorize',
    tokenUrl: 'https://mcp.notion.com/token',
    supportsDCR: true,
    registrationUrl: 'https://mcp.notion.com/register',
    mcpServerUrl: 'https://mcp.notion.com/mcp',
  },
  slack: {
    authUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
  },
  github: {
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
  },
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
  },
}

function generateCodeVerifier(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return Buffer.from(array).toString('base64url')
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Buffer.from(digest).toString('base64url')
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  if (error) {
    const errorDescription = searchParams.get('error_description') || 'Unknown error'
    return NextResponse.redirect(
      new URL(`/app/agent-studio?error=oauth_${error}&message=${encodeURIComponent(errorDescription)}`, request.url)
    )
  }

  if (code && state) {
    return handleOAuthCallback(request, code, state)
  }

  return startOAuthFlow(request)
}

async function startOAuthFlow(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null

    if (!session?.user?.id) {
      return NextResponse.redirect(new URL('/auth/signin?callbackUrl=/app/agent-studio', request.url))
    }

    const searchParams = request.nextUrl.searchParams
    const connectionId = searchParams.get('connectionId')
    const workflowId = searchParams.get('workflowId') || ''

    if (!connectionId) {
      return NextResponse.json({ error: 'connectionId is required' }, { status: 400 })
    }

    const connection = await prisma.workflowConnection.findFirst({
      where: {
        id: connectionId,
        userId: session.user.id,
      },
    })

    if (!connection) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
    }

    const providerDefaults = PROVIDER_DEFAULTS[connection.provider] || {}

    if (providerDefaults.supportsDCR && providerDefaults.registrationUrl) {
      return startDCRFlow(request, connection, providerDefaults, session.user.id, workflowId)
    }

    if (!connection.oauthClientId) {
      return NextResponse.json({ error: 'OAuth not configured for this connection' }, { status: 400 })
    }

    let clientId: string
    try {
      clientId = await decryptData(connection.oauthClientId)
    } catch {
      return NextResponse.json({ error: 'Failed to decrypt OAuth credentials' }, { status: 500 })
    }

    const authUrl = connection.oauthAuthUrl || providerDefaults.authUrl

    if (!authUrl) {
      return NextResponse.json({ error: 'OAuth auth URL not configured' }, { status: 400 })
    }

    const baseUrl = getAppBaseUrl()
    const redirectUri = connection.oauthRedirectUri || `${baseUrl}/api/mcp/oauth`

    const state = Buffer.from(JSON.stringify({
      userId: session.user.id,
      connectionId,
      agentId: connection.agentId,
      timestamp: Date.now(),
    })).toString('base64url')

    const oauthUrl = new URL(authUrl)
    oauthUrl.searchParams.set('client_id', clientId)
    oauthUrl.searchParams.set('redirect_uri', redirectUri)
    oauthUrl.searchParams.set('response_type', 'code')
    oauthUrl.searchParams.set('state', state)

    if (connection.provider === 'notion') {
      oauthUrl.searchParams.set('owner', 'user')
    } else if (connection.provider === 'google') {
      oauthUrl.searchParams.set('access_type', 'offline')
      oauthUrl.searchParams.set('prompt', 'consent')
      if (connection.oauthScope) {
        oauthUrl.searchParams.set('scope', connection.oauthScope)
      }
    } else if (connection.provider === 'slack') {
      if (connection.oauthScope) {
        oauthUrl.searchParams.set('scope', connection.oauthScope)
      }
    } else if (connection.provider === 'github') {
      if (connection.oauthScope) {
        oauthUrl.searchParams.set('scope', connection.oauthScope)
      }
    }

    return NextResponse.redirect(oauthUrl.toString())
  } catch (error) {
    console.error('OAuth start error:', error)
    return NextResponse.json({ error: 'Failed to start OAuth flow' }, { status: 500 })
  }
}

async function startDCRFlow(
  request: NextRequest,
  connection: any,
  providerConfig: ProviderOAuthConfig,
  userId: string,
  workflowId: string = ''
) {
  try {
    const baseUrl = getAppBaseUrl()
    const redirectUri = `${baseUrl}/api/mcp/oauth`

    let clientId = connection.oauthClientId
      ? await decryptData(connection.oauthClientId).catch(() => null)
      : null

    if (!clientId && providerConfig.registrationUrl) {
      console.log('Starting DCR registration for', connection.provider)

      const registrationResponse = await fetch(providerConfig.registrationUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_name: `${isSelfHosted() ? getInstallationBrand().productName : 'AITalk'} - ${connection.label}`,
          redirect_uris: [redirectUri],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
        }),
      })

      if (!registrationResponse.ok) {
        const errorText = await registrationResponse.text()
        console.error('DCR registration failed:', errorText)
        return NextResponse.json({ error: 'Failed to register OAuth client' }, { status: 500 })
      }

      const registrationData = await registrationResponse.json()
      clientId = registrationData.client_id

      const encryptedClientId = await encryptData(clientId)
      await prisma.workflowConnection.update({
        where: { id: connection.id },
        data: { oauthClientId: encryptedClientId },
      })

      console.log(`[MCP OAuth] DCR registration successful (connection ${connection.id})`)
    }

    if (!clientId) {
      return NextResponse.json({ error: 'Failed to obtain client ID' }, { status: 500 })
    }

    const codeVerifier = generateCodeVerifier()
    const codeChallenge = await generateCodeChallenge(codeVerifier)

    const state = Buffer.from(JSON.stringify({
      userId,
      connectionId: connection.id,
      agentId: connection.agentId,
      workflowId,
      codeVerifier,
      isDCR: true,
      timestamp: Date.now(),
    })).toString('base64url')

    const oauthUrl = new URL(providerConfig.authUrl)
    oauthUrl.searchParams.set('client_id', clientId)
    oauthUrl.searchParams.set('redirect_uri', redirectUri)
    oauthUrl.searchParams.set('response_type', 'code')
    oauthUrl.searchParams.set('state', state)
    oauthUrl.searchParams.set('code_challenge', codeChallenge)
    oauthUrl.searchParams.set('code_challenge_method', 'S256')

    console.log(`[MCP OAuth] Redirecting to authorize endpoint (connection ${connection.id})`)

    return NextResponse.redirect(oauthUrl.toString())
  } catch (error) {
    console.error('DCR flow error:', error)
    return NextResponse.json({ error: 'Failed to start DCR OAuth flow' }, { status: 500 })
  }
}

async function handleOAuthCallback(request: NextRequest, code: string, state: string) {
  try {
    let stateData: {
      userId: string
      connectionId: string
      agentId: string
      timestamp: number
      codeVerifier?: string
      isDCR?: boolean
    }
    try {
      stateData = JSON.parse(Buffer.from(state, 'base64url').toString())
    } catch {
      return NextResponse.redirect(
        new URL('/app/agent-studio?error=invalid_state', request.url)
      )
    }

    if (Date.now() - stateData.timestamp > 10 * 60 * 1000) {
      return NextResponse.redirect(
        new URL('/app/agent-studio?error=state_expired', request.url)
      )
    }

    const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null
    if (!session?.user?.id || session.user.id !== stateData.userId) {
      return NextResponse.redirect(new URL('/auth/signin', request.url))
    }

    const connection = await prisma.workflowConnection.findFirst({
      where: {
        id: stateData.connectionId,
        userId: stateData.userId,
      },
    })

    if (!connection) {
      return NextResponse.redirect(
        new URL('/app/agent-studio?error=connection_not_found', request.url)
      )
    }

    const providerDefaults = PROVIDER_DEFAULTS[connection.provider] || {}

    if (stateData.isDCR && stateData.codeVerifier) {
      return handleDCRCallback(request, code, stateData, connection, providerDefaults)
    }

    if (!connection.oauthClientId || !connection.oauthClientSecret) {
      return NextResponse.redirect(
        new URL('/app/agent-studio?error=oauth_not_configured', request.url)
      )
    }

    let clientId: string, clientSecret: string
    try {
      clientId = await decryptData(connection.oauthClientId)
      clientSecret = await decryptData(connection.oauthClientSecret)
    } catch {
      return NextResponse.redirect(
        new URL('/app/agent-studio?error=decrypt_failed', request.url)
      )
    }

    const tokenUrl = connection.oauthTokenUrl || providerDefaults.tokenUrl

    if (!tokenUrl) {
      return NextResponse.redirect(
        new URL('/app/agent-studio?error=token_url_not_configured', request.url)
      )
    }

    const baseUrl = getAppBaseUrl()
    const redirectUri = connection.oauthRedirectUri || `${baseUrl}/api/mcp/oauth`

    let tokenResponse: Response
    let tokenData: any

    if (connection.provider === 'notion' && !stateData.isDCR) {
      tokenResponse = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
        }),
      })
    } else if (connection.provider === 'github') {
      tokenResponse = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
      })
    } else {
      tokenResponse = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
      })
    }

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text()
      console.error('Token exchange error:', errorText)
      return NextResponse.redirect(
        new URL(`/app/agent-studio?error=token_exchange_failed`, request.url)
      )
    }

    tokenData = await tokenResponse.json()

    const accessToken = tokenData.access_token
    const refreshToken = tokenData.refresh_token

    if (!accessToken) {
      return NextResponse.redirect(
        new URL('/app/agent-studio?error=no_access_token', request.url)
      )
    }

    const encryptedToken = await encryptData(accessToken)
    const encryptedRefreshToken = refreshToken ? await encryptData(refreshToken) : null

    let oauthScope = connection.oauthScope
    if (connection.provider === 'notion' && tokenData.workspace_id) {
      oauthScope = `workspace:${tokenData.workspace_id}`
    }

    await prisma.workflowConnection.update({
      where: { id: stateData.connectionId },
      data: {
        encryptedToken,
        refreshToken: encryptedRefreshToken,
        authType: 'oauth',
        status: 'active',
        oauthScope,
        errorMessage: null,
        tokenExpiresAt: tokenData.expires_in
          ? new Date(Date.now() + tokenData.expires_in * 1000)
          : null,
        updatedAt: new Date(),
      },
    })

    const successMessage = tokenData.workspace_name
      ? `&workspace=${encodeURIComponent(tokenData.workspace_name)}`
      : ''

    const redirectPath = stateData.agentId
      ? `/app/agents/${stateData.agentId}/workflows?success=${connection.provider}_connected${successMessage}`
      : `/app/agent-studio?success=${connection.provider}_connected${successMessage}`

    return NextResponse.redirect(new URL(redirectPath, baseUrl))
  } catch (error) {
    console.error('OAuth callback error:', error)
    const baseUrl = getAppBaseUrl()
    return NextResponse.redirect(
      new URL('/app/agent-studio?error=oauth_callback_failed', baseUrl)
    )
  }
}

async function handleDCRCallback(
  request: NextRequest,
  code: string,
  stateData: {
    userId: string
    connectionId: string
    agentId: string
    workflowId?: string
    codeVerifier?: string
    isDCR?: boolean
    timestamp: number
  },
  connection: any,
  providerConfig: ProviderOAuthConfig
) {
  try {
    const baseUrl = getAppBaseUrl()
    const redirectUri = `${baseUrl}/api/mcp/oauth`

    if (!connection.oauthClientId) {
      return NextResponse.redirect(
        new URL('/app/agent-studio?error=no_client_id', baseUrl)
      )
    }

    let clientId: string
    try {
      clientId = await decryptData(connection.oauthClientId)
    } catch {
      return NextResponse.redirect(
        new URL('/app/agent-studio?error=decrypt_failed', baseUrl)
      )
    }

    console.log('Exchanging code for token with PKCE...')

    const tokenResponse = await fetch(providerConfig.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        code,
        redirect_uri: redirectUri,
        code_verifier: stateData.codeVerifier || '',
      }),
    })

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text()
      console.error('DCR token exchange error:', errorText)
      return NextResponse.redirect(
        new URL('/app/agent-studio?error=token_exchange_failed', baseUrl)
      )
    }

    const tokenData = await tokenResponse.json()
    console.log('Token exchange successful')

    const accessToken = tokenData.access_token
    const refreshToken = tokenData.refresh_token

    if (!accessToken) {
      return NextResponse.redirect(
        new URL('/app/agent-studio?error=no_access_token', baseUrl)
      )
    }

    const encryptedToken = await encryptData(accessToken)
    const encryptedRefreshToken = refreshToken ? await encryptData(refreshToken) : null

    await prisma.workflowConnection.update({
      where: { id: stateData.connectionId },
      data: {
        encryptedToken,
        refreshToken: encryptedRefreshToken,
        authType: 'oauth',
        status: 'active',
        errorMessage: null,
        tokenExpiresAt: tokenData.expires_in
          ? new Date(Date.now() + tokenData.expires_in * 1000)
          : null,
        updatedAt: new Date(),
      },
    })

    let redirectPath: string
    if (stateData.workflowId) {
      redirectPath = `/app/agent-studio?workflowId=${stateData.workflowId}&success=${connection.provider}_connected`
    } else if (stateData.agentId) {
      redirectPath = `/app/agents/${stateData.agentId}/workflows?success=${connection.provider}_connected`
    } else {
      redirectPath = `/app/agent-studio?success=${connection.provider}_connected`
    }

    return NextResponse.redirect(new URL(redirectPath, baseUrl))
  } catch (error) {
    console.error('DCR callback error:', error)
    const baseUrl = getAppBaseUrl()
    return NextResponse.redirect(
      new URL('/app/agent-studio?error=dcr_callback_failed', baseUrl)
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { connectionId } = body

    if (!connectionId) {
      return NextResponse.json({ error: 'connectionId is required' }, { status: 400 })
    }

    const connection = await prisma.workflowConnection.findFirst({
      where: {
        id: connectionId,
        userId: session.user.id,
      },
    })

    if (!connection) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
    }

    await prisma.workflowConnection.update({
      where: { id: connectionId },
      data: {
        encryptedToken: null,
        refreshToken: null,
        tokenExpiresAt: null,
        status: 'revoked',
      },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('OAuth disconnect error:', error)
    return NextResponse.json({ error: 'Failed to disconnect' }, { status: 500 })
  }
}
