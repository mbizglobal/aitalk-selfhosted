import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const searchParams = request.nextUrl.searchParams
    const agentId = searchParams.get('agentId')

    if (!agentId) {
      return NextResponse.json(
        { success: false, error: 'Agent ID is required' },
        { status: 400 }
      )
    }

    const agent = await prisma.agent.findFirst({
      where: {
        agentId: agentId,
        userId: session.user.id
      }
    })

    if (!agent) {
      return NextResponse.json(
        { success: false, error: 'Agent not found or access denied' },
        { status: 404 }
      )
    }

    let googleAccount = null

    if (agent.googleAccountId) {
      googleAccount = await prisma.account.findUnique({
        where: {
          id: agent.googleAccountId
        }
      })
    } else if (!agent.googleDriveDisconnected) {
      googleAccount = await prisma.account.findFirst({
        where: {
          userId: session.user.id,
          provider: 'google'
        }
      })

      if (googleAccount) {
        await prisma.agent.update({
          where: { agentId },
          data: {
            googleAccountId: googleAccount.id
          }
        })
      }
    }

    if (!googleAccount || !googleAccount.access_token) {
      return NextResponse.json(
        { success: false, error: 'Google Drive not connected' },
        { status: 404 }
      )
    }

    const scopes = googleAccount.scope?.split(' ') || []
    const hasDriveFileScope = scopes.includes('https://www.googleapis.com/auth/drive.file')

    if (!hasDriveFileScope) {
      return NextResponse.json(
        {
          success: false,
          error: 'Drive scope missing',
          needsReauth: true,
          currentScopes: googleAccount.scope
        },
        { status: 403 }
      )
    }

    const now = Math.floor(Date.now() / 1000)
    let accessToken = googleAccount.access_token

    if (googleAccount.expires_at && googleAccount.expires_at <= now) {
      if (!googleAccount.refresh_token) {
        return NextResponse.json(
          { success: false, error: 'Refresh token not available' },
          { status: 401 }
        )
      }

      try {
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID!,
            client_secret: process.env.GOOGLE_CLIENT_SECRET!,
            refresh_token: googleAccount.refresh_token,
            grant_type: 'refresh_token'
          })
        })

        const tokenData = await tokenResponse.json()

        if (!tokenResponse.ok) {
          throw new Error(tokenData.error || 'Failed to refresh token')
        }

        accessToken = tokenData.access_token
        const expiresIn = tokenData.expires_in || 3600
        const newExpiresAt = Math.floor(Date.now() / 1000) + expiresIn

        await prisma.account.update({
          where: { id: googleAccount.id },
          data: {
            access_token: accessToken,
            expires_at: newExpiresAt
          }
        })
      } catch (error) {
        return NextResponse.json(
          { success: false, error: 'Failed to refresh access token' },
          { status: 500 }
        )
      }
    }

    return NextResponse.json({
      success: true,
      accessToken: accessToken
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { agentId, accessToken, expiresIn, scope } = body ?? {}

    if (!agentId || typeof accessToken !== 'string' || accessToken.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Invalid payload' },
        { status: 400 }
      )
    }

    const agent = await prisma.agent.findFirst({
      where: {
        agentId,
        userId: session.user.id
      }
    })

    if (!agent) {
      return NextResponse.json(
        { success: false, error: 'Agent not found or access denied' },
        { status: 404 }
      )
    }

    let googleAccount = null

    if (agent.googleAccountId) {
      googleAccount = await prisma.account.findUnique({
        where: { id: agent.googleAccountId }
      })
    } else if (!agent.googleDriveDisconnected) {
      googleAccount = await prisma.account.findFirst({
        where: {
          userId: session.user.id,
          provider: 'google'
        }
      })

      if (googleAccount) {
        await prisma.agent.update({
          where: { agentId },
          data: {
            googleAccountId: googleAccount.id
          }
        })
      }
    }

    if (!googleAccount) {
      return NextResponse.json(
        { success: false, error: 'Google account connection not found' },
        { status: 404 }
      )
    }

    const expiresAt = typeof expiresIn === 'number' && !Number.isNaN(expiresIn)
      ? Math.floor(Date.now() / 1000) + Math.max(0, expiresIn)
      : null

    await prisma.account.update({
      where: { id: googleAccount.id },
      data: {
        access_token: accessToken,
        expires_at: expiresAt ?? googleAccount.expires_at,
        scope: typeof scope === 'string' && scope.length > 0 ? scope : googleAccount.scope
      }
    })

    await prisma.agent.update({
      where: { agentId },
      data: {
        googleAccountId: googleAccount.id,
        googleDriveDisconnected: false
      }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
