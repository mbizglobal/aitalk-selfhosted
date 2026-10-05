
import { NextRequest, NextResponse } from 'next/server'
import { describeCaughtError } from '@/lib/log-mask'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { GitBookClient } from '@/lib/integrations/gitbook'
import {
  decrypt,
  decryptDataKey,
  decryptDataKeyWithLegacy,
} from '@/lib/encryption'

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
    const { accessToken, spaceId, agentId } = body

    if (!spaceId) {
      return NextResponse.json(
        { success: false, error: 'Space ID is required' },
        { status: 400 }
      )
    }

    let tokenToUse = accessToken

    if (!tokenToUse && agentId) {
      const agent = await prisma.agent.findFirst({
        where: {
          agentId,
          userId: session.user.id,
        },
        select: {
          gitbookAccessToken: true,
        },
      })

      if (!agent?.gitbookAccessToken) {
        return NextResponse.json(
          { success: false, error: 'No saved GitBook access token found' },
          { status: 400 }
        )
      }

      const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: {
          encryptedDataKey: true,
          zkiId: true,
          zki: { select: { masterKey: true } },
        },
      })

      if (!user?.encryptedDataKey) {
        return NextResponse.json(
          { success: false, error: 'Encryption key not found' },
          { status: 500 }
        )
      }

      let dataKey: Buffer
      if (user.zkiId && user.zki?.masterKey) {
        dataKey = decryptDataKeyWithLegacy(
          Buffer.from(user.encryptedDataKey),
          user.zki.masterKey
        )
      } else {
        dataKey = await decryptDataKey(Buffer.from(user.encryptedDataKey))
      }

      tokenToUse = decrypt(
        Buffer.from(agent.gitbookAccessToken, 'base64'),
        dataKey
      )
    }

    if (!tokenToUse) {
      return NextResponse.json(
        { success: false, error: 'Access Token is required' },
        { status: 400 }
      )
    }

    const client = new GitBookClient({ accessToken: tokenToUse })

    try {
      const space = await client.getSpace(spaceId)

      return NextResponse.json({
        success: true,
        space: {
          id: space.id,
          title: space.title,
          visibility: space.visibility,
        },
      })
    } catch (apiError: any) {
      console.error('GitBook API error:', describeCaughtError(apiError))

      if (apiError.statusCode === 401) {
        return NextResponse.json(
          { success: false, error: 'Invalid access token' },
          { status: 401 }
        )
      }

      if (apiError.statusCode === 404) {
        return NextResponse.json(
          { success: false, error: 'Space not found or access denied' },
          { status: 404 }
        )
      }

      return NextResponse.json(
        { success: false, error: 'Failed to connect to GitBook' },
        { status: 500 }
      )
    }
  } catch (error) {
    console.error('Test connection error:', describeCaughtError(error))
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
