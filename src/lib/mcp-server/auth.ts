import { createHash, randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'

const TOKEN_PREFIX = 'aitk_'

export interface McpAuthContext {
  tokenId: string
  userId: string
  scopes: string[]
}

export function hashMcpToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function generateMcpToken(): { token: string; tokenHash: string; tokenPrefix: string } {
  const token = TOKEN_PREFIX + randomBytes(32).toString('base64url')
  return {
    token,
    tokenHash: hashMcpToken(token),
    tokenPrefix: token.slice(0, 12) + '…',
  }
}

export async function authenticateMcpRequest(headers: Headers): Promise<McpAuthContext | null> {
  const authorizationHeader = headers.get('authorization')
  if (!authorizationHeader?.startsWith('Bearer ')) return null
  const token = authorizationHeader.slice(7).trim()
  if (!token.startsWith(TOKEN_PREFIX) || token.length < 20) return null

  const row = await prisma.mcpAccessToken.findUnique({
    where: { tokenHash: hashMcpToken(token) },
    select: { id: true, userId: true, scopes: true, revokedAt: true, expiresAt: true },
  })
  if (!row) return null
  if (row.revokedAt) return null
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null

  const ip = headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip')?.trim() || null
  const country = headers.get('x-azure-geo-country')?.trim().toUpperCase() || null

  const observedAt = new Date()
  prisma.mcpAccessToken
    .updateMany({
      where: {
        id: row.id,
        OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: observedAt } }],
      },
      data: {
        lastUsedAt: observedAt,
        lastUsedIp: ip && ip.length <= 45 ? ip : null,
        lastUsedCountry: country && /^[A-Z]{2}$/.test(country) ? country : null,
      },
    })
    .catch(() => { /* best-effort */ })

  return { tokenId: row.id, userId: row.userId, scopes: row.scopes.split(/\s+/).filter(Boolean) }
}
