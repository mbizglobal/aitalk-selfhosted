import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { signOauthState } from '@/lib/oauth-state'
import { describeCaughtError } from '@/lib/log-mask'

const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID || ''
const MICROSOFT_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET || ''
const REDIRECT_URI = process.env.MICROSOFT_REDIRECT_URI || `${process.env.NEXTAUTH_URL}/api/storage/sharepoint/callback`

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as any

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const agentId = searchParams.get('agentId')

    if (!agentId) {
      return NextResponse.json({ error: 'Agent ID is required' }, { status: 400 })
    }

    const agent = await prisma.agent.findUnique({
      where: { agentId },
      select: { userId: true },
    })
    if (!agent || agent.userId !== session.user.id) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    if (!MICROSOFT_CLIENT_ID || !MICROSOFT_CLIENT_SECRET) {
      console.error('Missing Microsoft OAuth credentials')
      return NextResponse.json({ error: 'Microsoft OAuth not configured' }, { status: 500 })
    }

    const state = signOauthState({
      agentId,
      userId: session.user.id
    })

    const authUrl = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize')
    authUrl.searchParams.set('client_id', MICROSOFT_CLIENT_ID)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('redirect_uri', REDIRECT_URI)
    authUrl.searchParams.set('response_mode', 'query')
    authUrl.searchParams.set('scope', 'https://graph.microsoft.com/Sites.Read.All https://graph.microsoft.com/Files.Read.All https://graph.microsoft.com/Group.Read.All https://graph.microsoft.com/User.Read offline_access')
    authUrl.searchParams.set('state', state)
    authUrl.searchParams.set('prompt', 'select_account')


    return NextResponse.json({
      success: true,
      authUrl: authUrl.toString()
    })

  } catch (error) {
    console.error('SharePoint authorization error:', describeCaughtError(error))
    return NextResponse.json(
      { error: 'Failed to start SharePoint authorization' },
      { status: 500 }
    )
  }
}