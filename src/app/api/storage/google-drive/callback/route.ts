import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { resolveOauthRequester } from '@/lib/oauth-state'
import { linkOauthAccountOwnedBy } from '@/lib/oauth-account-link'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || ''
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || `${process.env.NEXTAUTH_URL}/api/storage/google-drive/callback`

// Helper function for error responses
function getErrorResponse(title: string, message: string) {
  const errorMsg = encodeURIComponent(`${title}: ${message}`)
  return NextResponse.redirect(new URL(`/app/storage?tab=google-drive&error=${errorMsg}`, process.env.NEXTAUTH_URL!))
}

type StorageErrorCode = 'account_already_linked' | 'link_retry' | 'session_mismatch' | 'invalid_state'

function getErrorCodeResponse(code: StorageErrorCode) {
  return NextResponse.redirect(new URL(`/app/storage?tab=google-drive&error=${code}`, process.env.NEXTAUTH_URL!))
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')

    if (error) {
      return getErrorResponse('Authorization Denied', 'You denied access to Google Drive.')
    }

    if (!code || !state) {
      return getErrorResponse('Invalid Callback', 'Missing required parameters.')
    }

    const session = (await getServerSession(authOptions as any)) as any
    const requester = resolveOauthRequester(state, session?.user?.id)
    if (!requester.ok) {
      return getErrorCodeResponse(
        requester.reason === 'session_mismatch' ? 'session_mismatch' : 'invalid_state'
      )
    }
    const agentId = requester.agentId

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    })

    if (!tokenResponse.ok) {
      return getErrorResponse('Token Exchange Failed', 'Failed to exchange authorization code for access token.')
    }

    const tokenData = await tokenResponse.json()
    const { access_token, refresh_token, expires_in, scope } = tokenData
    const normalizedScope = Array.isArray(scope)
      ? scope.join(' ')
      : typeof scope === 'string' && scope.length > 0
        ? scope
        : [
            'https://www.googleapis.com/auth/drive.file',
            'https://www.googleapis.com/auth/userinfo.profile',
          ].join(' ')

    const expiresAt = new Date(Date.now() + expires_in * 1000)

    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        'Authorization': `Bearer ${access_token}`
      }
    })

    if (!userInfoResponse.ok) {
      return getErrorResponse('User Info Failed', 'Failed to fetch Google user information.')
    }

    const userInfo = await userInfoResponse.json()
    const googleUserId = userInfo.id

    const agent = await prisma.agent.findUnique({
      where: { agentId },
      select: { userId: true },
    })
    if (!agent || agent.userId !== requester.userId) {
      return getErrorResponse('User Not Found', 'Could not find user associated with this agent.')
    }

    const linked = await linkOauthAccountOwnedBy(prisma.account, {
      provider: 'google',
      providerAccountId: googleUserId,
      userId: requester.userId,
      tokens: {
        access_token,
        refresh_token,
        expires_at: Math.floor(expiresAt.getTime() / 1000),
        token_type: 'Bearer',
        scope: normalizedScope,
      },
    })
    if (!linked.ok) {
      return getErrorCodeResponse(
        linked.reason === 'owned_by_other' ? 'account_already_linked' : 'link_retry'
      )
    }

    await prisma.agent.update({
      where: { agentId },
      data: {
        googleAccountId: linked.accountId,
        googleDriveDisconnected: false
      }
    })

    return NextResponse.redirect(new URL('/app/storage?tab=google-drive&success=connected', process.env.NEXTAUTH_URL!))
  } catch (error) {
    return getErrorResponse('Authorization Failed', 'An unexpected error occurred during authorization.')
  }
}
