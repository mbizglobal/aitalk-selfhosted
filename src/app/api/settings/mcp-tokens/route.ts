import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { generateMcpToken } from '@/lib/mcp-server/auth'
import { getLocationFromIP } from '@/lib/geolocation'

const MAX_TOKENS_PER_USER = 5

export async function GET() {
  try {
    const session = await getServerSession(authOptions as any) as any
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const tokens = await prisma.mcpAccessToken.findMany({
      where: { userId: session.user.id, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, name: true, tokenPrefix: true, scopes: true,
        lastUsedAt: true, lastUsedIp: true, lastUsedCountry: true, createdAt: true,
      },
    })

    //
    const isProduction =
      process.env.NODE_ENV === 'production' || (process.env.NEXTAUTH_URL || '').includes('aitalk.ch')
    if (!isProduction) {
      await Promise.all(
        tokens
          .filter((tk) => tk.lastUsedIp && !tk.lastUsedCountry)
          .map(async (tk) => {
            const observedIp = tk.lastUsedIp!
            const location = await getLocationFromIP(observedIp)
            const code = location.countryCode?.trim().toUpperCase()
            if (!code || !/^[A-Z]{2}$/.test(code)) return
            const written = await prisma.mcpAccessToken
              .updateMany({
                where: { id: tk.id, lastUsedIp: observedIp, lastUsedCountry: null },
                data: { lastUsedCountry: code },
              })
              .catch(() => null)
            if (written && written.count > 0) tk.lastUsedCountry = code
          }),
      )
    }

    return NextResponse.json({ success: true, tokens })
  } catch (error) {
    console.error('[GET /api/settings/mcp-tokens] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as any
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 100) : ''
    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    const scopes = body.scopes === undefined || body.scopes === 'read' ? 'read'
      : body.scopes === 'read write' ? 'read write'
      : null
    if (scopes === null) {
      return NextResponse.json({ error: "scopes must be 'read' or 'read write'" }, { status: 400 })
    }

    const activeCount = await prisma.mcpAccessToken.count({
      where: { userId: session.user.id, revokedAt: null },
    })
    if (activeCount >= MAX_TOKENS_PER_USER) {
      return NextResponse.json({ error: 'token_limit_reached', maxTokens: MAX_TOKENS_PER_USER }, { status: 400 })
    }

    const { token, tokenHash, tokenPrefix } = generateMcpToken()
    const created = await prisma.mcpAccessToken.create({
      data: { userId: session.user.id, name, tokenHash, tokenPrefix, scopes },
      select: { id: true, name: true, tokenPrefix: true, scopes: true, createdAt: true },
    })

    return NextResponse.json({ success: true, token, created }, { status: 201 })
  } catch (error) {
    console.error('[POST /api/settings/mcp-tokens] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as any
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const id = typeof body.id === 'string' ? body.id : ''
    if (!id) {
      return NextResponse.json({ error: 'Token id is required' }, { status: 400 })
    }

    const result = await prisma.mcpAccessToken.updateMany({
      where: { id, userId: session.user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    if (result.count === 0) {
      return NextResponse.json({ error: 'Token not found' }, { status: 404 })
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[DELETE /api/settings/mcp-tokens] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
