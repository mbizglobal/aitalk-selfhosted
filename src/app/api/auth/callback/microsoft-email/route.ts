
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { encryptData } from '@/lib/encryption'
import { resolveOauthRequester } from '@/lib/oauth-state'
import { parseMicrosoftEmailConnectType } from '@/lib/email/microsoft-oauth'
import { describeCaughtError, describeUpstreamError, maskEmail, maskId, readUpstreamJson } from '@/lib/log-mask'

const OAUTH_ERROR_ALLOWLIST = new Set([
  'invalid_request',
  'unauthorized_client',
  'access_denied',
  'unsupported_response_type',
  'invalid_scope',
  'server_error',
  'temporarily_unavailable',
  'consent_required',
  'login_required',
  'interaction_required',
])

const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID || ''
const MICROSOFT_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET || ''
const REDIRECT_URI = process.env.MICROSOFT_EMAIL_REDIRECT_URI ||
  `${process.env.NEXTAUTH_URL}/api/auth/callback/microsoft-email`

export async function GET(request: NextRequest) {
  const isDev = process.env.NODE_ENV === 'development'

  try {
    const searchParams = request.nextUrl.searchParams
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')
    const errorDescription = searchParams.get('error_description')

    if (error) {
      console.error(`[Microsoft Email OAuth] User denied: ${OAUTH_ERROR_ALLOWLIST.has(error!) ? error : 'other'}`)
      return redirectToAgentStudio('authorization_denied')
    }

    if (!code || !state) {
      return redirectToAgentStudio('invalid_callback')
    }

    const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null
    const requester = resolveOauthRequester(state, session?.user?.id)
    if (!requester.ok) {
      return redirectToAgentStudio(
        requester.reason === 'session_mismatch' ? 'session_mismatch' : 'invalid_state'
      )
    }
    const agentId = requester.agentId
    const userId = requester.userId

    if (requester.signedPayload.purpose !== 'microsoft-email') {
      return redirectToAgentStudio('invalid_state')
    }

    const type = parseMicrosoftEmailConnectType(requester.signedPayload.type)
    if (!type) {
      return redirectToAgentStudio('invalid_state')
    }

    if (isDev) {
      console.log(`[Microsoft Email OAuth] Processing callback for agent ${maskId(agentId)}, type: ${type}`)
    }

    const tokenResponse = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: MICROSOFT_CLIENT_ID,
        client_secret: MICROSOFT_CLIENT_SECRET,
        code,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
        scope: [
          'https://outlook.office.com/IMAP.AccessAsUser.All',
          'https://outlook.office.com/SMTP.Send',
          'offline_access',
          'openid',
          'email',
          'profile'
        ].join(' ')
      }),
    })

    if (!tokenResponse.ok) {
      //
      console.error(
        '[Microsoft Email OAuth] Token exchange failed:',
        describeUpstreamError(tokenResponse.status, await tokenResponse.text()),
      )
      return redirectToAgentStudio('token_exchange_failed', agentId)
    }

    const tokenData = await readUpstreamJson(tokenResponse)
    const { access_token, refresh_token, expires_in, id_token } = tokenData

    const expiresAt = new Date(Date.now() + expires_in * 1000)

    let email = ''
    let displayName = ''

    if (id_token) {
      try {
        const payload = JSON.parse(Buffer.from(id_token.split('.')[1], 'base64').toString())
        email = payload.email || payload.preferred_username || payload.upn || ''
        displayName = payload.name || email
        if (isDev) {
          console.log(`[Microsoft Email OAuth] Decoded id_token: email=${maskEmail(email)} (user ${maskId(userId)})`)
        }
      } catch {
        console.error('[Microsoft Email OAuth] Failed to decode id_token (malformed payload)')
      }
    }

    if (!email) {
      console.error('[Microsoft Email OAuth] Could not get email from id_token')
      return redirectToAgentStudio('user_info_failed', agentId)
    }

    if (isDev) {
      console.log(`[Microsoft Email OAuth] Got mailbox ${maskEmail(email)} (user ${maskId(userId)})`)
    }

    const agent = await prisma.agent.findUnique({
      where: { agentId },
      select: { userId: true },
    })

    if (!agent || agent.userId !== userId) {
      return redirectToAgentStudio('agent_not_found', agentId)
    }

    const encryptedAccessToken = await encryptData(access_token)
    const encryptedRefreshToken = refresh_token ? await encryptData(refresh_token) : null

    if (type === 'imap' || type === 'both') {
      const imapConfig = JSON.stringify({
        host: 'outlook.office365.com',
        port: 993,
        user: email,
        email: email,
        displayName: displayName,
        provider: 'outlook'
      })

      await prisma.workflowConnection.upsert({
        where: {
          agentId_provider_label: {
            agentId,
            provider: 'imap',
            label: `Microsoft - ${email}`
          }
        },
        update: {
          userId,
          authType: 'oauth',
          encryptedToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
          tokenExpiresAt: expiresAt,
          serviceConfig: imapConfig,
          oauthScope: 'https://outlook.office.com/IMAP.AccessAsUser.All offline_access',
          status: 'active',
          errorMessage: null,
          updatedAt: new Date()
        },
        create: {
          userId,
          agentId,
          provider: 'imap',
          label: `Microsoft - ${email}`,
          description: `Microsoft Outlook IMAP (OAuth2)`,
          authType: 'oauth',
          encryptedToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
          tokenExpiresAt: expiresAt,
          serviceConfig: imapConfig,
          oauthScope: 'https://outlook.office.com/IMAP.AccessAsUser.All offline_access',
          transport: 'rest_api',
          status: 'active'
        }
      })

      if (isDev) {
        console.log(`[Microsoft Email OAuth] IMAP connection saved for user ${maskId(userId)}`)
      }
    }

    if (type === 'smtp' || type === 'both') {
      const smtpConfig = JSON.stringify({
        host: 'smtp.office365.com',
        port: 587,
        secure: false,
        user: email,
        email: email,
        displayName: displayName,
        provider: 'outlook'
      })

      await prisma.workflowConnection.upsert({
        where: {
          agentId_provider_label: {
            agentId,
            provider: 'smtp',
            label: `Microsoft - ${email}`
          }
        },
        update: {
          userId,
          authType: 'oauth',
          encryptedToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
          tokenExpiresAt: expiresAt,
          serviceConfig: smtpConfig,
          oauthScope: 'https://outlook.office.com/SMTP.Send offline_access',
          status: 'active',
          errorMessage: null,
          updatedAt: new Date()
        },
        create: {
          userId,
          agentId,
          provider: 'smtp',
          label: `Microsoft - ${email}`,
          description: `Microsoft Outlook SMTP (OAuth2)`,
          authType: 'oauth',
          encryptedToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
          tokenExpiresAt: expiresAt,
          serviceConfig: smtpConfig,
          oauthScope: 'https://outlook.office.com/SMTP.Send offline_access',
          transport: 'rest_api',
          status: 'active'
        }
      })

      if (isDev) {
        console.log(`[Microsoft Email OAuth] SMTP connection saved for user ${maskId(userId)}`)
      }
    }

    return redirectToAgentStudio('success', agentId, email)

  } catch (error) {
    console.error('[Microsoft Email OAuth] Callback error:', describeCaughtError(error))
    return redirectToAgentStudio('callback_error')
  }
}

function redirectToAgentStudio(
  status: string,
  agentId?: string,
  email?: string
): NextResponse {
  const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000'
  const url = new URL('/app/agent-studio', baseUrl)

  if (agentId) {
    url.searchParams.set('agentId', agentId)
  }

  if (status === 'success') {
    url.searchParams.set('oauth', 'microsoft-email')
    url.searchParams.set('connected', 'true')
    if (email) {
      url.searchParams.set('email', email)
    }
  } else {
    url.searchParams.set('oauth', 'microsoft-email')
    url.searchParams.set('error', status)
  }

  return NextResponse.redirect(url)
}
