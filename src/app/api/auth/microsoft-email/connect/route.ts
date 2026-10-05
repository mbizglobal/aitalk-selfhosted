
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { signOauthState } from '@/lib/oauth-state'
import { parseMicrosoftEmailConnectType } from '@/lib/email/microsoft-oauth'

const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID || ''
const MICROSOFT_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET || ''
const REDIRECT_URI = process.env.MICROSOFT_EMAIL_REDIRECT_URI ||
  `${process.env.NEXTAUTH_URL}/api/auth/callback/microsoft-email`

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as any

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const agentId = searchParams.get('agentId')
    const rawType = searchParams.get('type')
    const type = rawType === null ? 'both' : parseMicrosoftEmailConnectType(rawType)
    if (!type) {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
    }

    if (!agentId) {
      return NextResponse.json({ error: 'Agent ID is required' }, { status: 400 })
    }

    if (!MICROSOFT_CLIENT_ID || !MICROSOFT_CLIENT_SECRET) {
      console.error('[Microsoft Email OAuth] Missing credentials')
      return NextResponse.json({ error: 'Microsoft OAuth not configured' }, { status: 500 })
    }

    const agent = await prisma.agent.findUnique({
      where: { agentId },
      select: { userId: true },
    })

    if (!agent || agent.userId !== session.user.id) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const state = signOauthState({
      agentId,
      userId: session.user.id,
      type, // imap, smtp, or both
      purpose: 'microsoft-email',
    })

    const authUrl = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize')
    authUrl.searchParams.set('client_id', MICROSOFT_CLIENT_ID)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('redirect_uri', REDIRECT_URI)
    authUrl.searchParams.set('response_mode', 'query')
    authUrl.searchParams.set('scope', [
      'https://outlook.office.com/IMAP.AccessAsUser.All',
      'https://outlook.office.com/SMTP.Send',
      'offline_access',
      'openid',
      'email',
      'profile'
    ].join(' '))
    authUrl.searchParams.set('state', state)
    authUrl.searchParams.set('prompt', 'select_account')

    return NextResponse.json({
      success: true,
      authUrl: authUrl.toString()
    })

  } catch (error) {
    console.error('[Microsoft Email OAuth] Authorization error:', error)
    return NextResponse.json(
      { error: 'Failed to start Microsoft email authorization' },
      { status: 500 }
    )
  }
}
