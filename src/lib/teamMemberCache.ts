
import { PrismaClient } from '@prisma/client'
import { verifyAgentMemberToken, type AgentMemberTokenPayload } from './agentMemberAuth'

interface MemberCacheEntry {
  isActive: boolean
}

const memberCache = new Map<string, MemberCacheEntry>()

function getCacheKey(agentId: string, memberId: number): string {
  return `${agentId}:${memberId}`
}

export async function verifyTeamMember(
  prisma: PrismaClient,
  authHeader: string | null,
  agentId: string,
  options: { failClosed?: boolean } = {}
): Promise<{
  authorized: boolean
  memberId?: number
  email?: string
  reason?: string
}> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { authorized: false, reason: 'NO_TOKEN' }
  }

  const token = authHeader.slice(7)

  const payload = verifyAgentMemberToken(token)
  if (!payload) {
    return { authorized: false, reason: 'INVALID_TOKEN' }
  }

  if (payload.agentId !== agentId) {
    return { authorized: false, reason: 'AGENT_MISMATCH' }
  }

  const cacheKey = getCacheKey(agentId, payload.memberId)

  const cached = memberCache.get(cacheKey)
  if (cached) {
    if (cached.isActive) {
      return { authorized: true, memberId: payload.memberId, email: payload.email }
    } else {
      return { authorized: false, reason: 'MEMBER_INACTIVE' }
    }
  }

  try {
    const member = await prisma.agentMember.findUnique({
      where: { id: payload.memberId },
      select: { id: true, status: true, agentAgentId: true }
    })

    const isActive = member !== null &&
                     member.status === 'active' &&
                     member.agentAgentId === agentId

    memberCache.set(cacheKey, { isActive })

    if (isActive) {
      return { authorized: true, memberId: payload.memberId, email: payload.email }
    } else {
      return { authorized: false, reason: 'MEMBER_INACTIVE' }
    }
  } catch (error) {
    console.error('[TeamMemberCache] DB query failed:', error)
    //
    //
    if (options.failClosed) {
      return { authorized: false, reason: 'DB_ERROR' }
    }

    return { authorized: true, memberId: payload.memberId, email: payload.email }
  }
}

export async function verifyActiveAgentMemberToken(
  prisma: PrismaClient,
  token: string,
  agentId: string
): Promise<AgentMemberTokenPayload | null> {
  const payload = verifyAgentMemberToken(token)
  if (!payload) return null

  const result = await verifyTeamMember(prisma, `Bearer ${token}`, agentId, { failClosed: true })
  return result.authorized ? payload : null
}

export function invalidateMemberCache(agentId: string, memberId: number): void {
  const cacheKey = getCacheKey(agentId, memberId)
  memberCache.delete(cacheKey)
}

export function invalidateAgentMemberCache(agentId: string): void {
  for (const key of memberCache.keys()) {
    if (key.startsWith(`${agentId}:`)) {
      memberCache.delete(key)
    }
  }
}

export function clearMemberCache(): void {
  memberCache.clear()
}

export function getMemberCacheStats(): { size: number, keys: string[] } {
  return {
    size: memberCache.size,
    keys: Array.from(memberCache.keys())
  }
}
