import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { resolveOauthRequester } from '@/lib/oauth-state'
import { linkOauthAccountOwnedBy } from '@/lib/oauth-account-link'
import { describeCaughtError, describeUpstreamError, readUpstreamJson } from '@/lib/log-mask'

const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID || ''
const MICROSOFT_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET || ''
const REDIRECT_URI = process.env.MICROSOFT_REDIRECT_URI || `${process.env.NEXTAUTH_URL}/api/storage/sharepoint/callback`

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')

    if (error) {
      return NextResponse.redirect(new URL('/app/storage?error=authorization_denied&tab=sharepoint', process.env.NEXTAUTH_URL!))
    }

    if (!code || !state) {
      return NextResponse.redirect(new URL('/app/storage?error=invalid_callback&tab=sharepoint', process.env.NEXTAUTH_URL!))
    }

    const session = (await getServerSession(authOptions as any)) as any
    const requester = resolveOauthRequester(state, session?.user?.id)
    if (!requester.ok) {
      const code = requester.reason === 'session_mismatch' ? 'session_mismatch' : 'invalid_state'
      return NextResponse.redirect(new URL(`/app/storage?error=${code}&tab=sharepoint`, process.env.NEXTAUTH_URL!))
    }
    const agentId = requester.agentId

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
      }),
    })

    if (!tokenResponse.ok) {
      console.error('Token exchange failed:', describeUpstreamError(tokenResponse.status, await tokenResponse.text()))
      return NextResponse.redirect(new URL('/app/storage?error=token_exchange_failed&tab=sharepoint', process.env.NEXTAUTH_URL!))
    }

    const tokenData = await readUpstreamJson(tokenResponse)
    const { access_token, refresh_token, expires_in } = tokenData

    const expiresAt = new Date(Date.now() + expires_in * 1000)

    const userInfoResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: {
        'Authorization': `Bearer ${access_token}`
      }
    })

    if (!userInfoResponse.ok) {
      console.error('Failed to fetch user info:', describeUpstreamError(userInfoResponse.status, await userInfoResponse.text()))
      return NextResponse.redirect(new URL('/app/storage?error=user_info_failed&tab=sharepoint', process.env.NEXTAUTH_URL!))
    }

    const userInfo = await readUpstreamJson(userInfoResponse)
    const microsoftUserId = userInfo.id

    const agent = await prisma.agent.findUnique({
      where: { agentId },
      select: { userId: true },
    })
    if (!agent || agent.userId !== requester.userId) {
      return NextResponse.redirect(new URL('/app/storage?error=user_not_found&tab=sharepoint', process.env.NEXTAUTH_URL!))
    }

    const linked = await linkOauthAccountOwnedBy(prisma.account, {
      provider: 'microsoft',
      providerAccountId: microsoftUserId,
      userId: requester.userId,
      tokens: {
        access_token,
        refresh_token,
        expires_at: Math.floor(expiresAt.getTime() / 1000),
        token_type: 'Bearer',
        scope: 'https://graph.microsoft.com/Sites.Read.All https://graph.microsoft.com/Files.Read.All https://graph.microsoft.com/User.Read offline_access',
      },
    })
    if (!linked.ok) {
      const code = linked.reason === 'owned_by_other' ? 'account_already_linked' : 'link_retry'
      return NextResponse.redirect(new URL(`/app/storage?error=${code}&tab=sharepoint`, process.env.NEXTAUTH_URL!))
    }


    return NextResponse.redirect(new URL('/app/storage?tab=sharepoint&success=connected', process.env.NEXTAUTH_URL!))
  } catch (error) {
    console.error('SharePoint OAuth callback error:', describeCaughtError(error))
    return NextResponse.redirect(new URL('/app/storage?error=callback_error&tab=sharepoint', process.env.NEXTAUTH_URL!))
  }
}