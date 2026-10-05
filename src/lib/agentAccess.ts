import type { Agent, AgentMember, PrismaClient } from '@prisma/client'
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'

import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { verifyAgentMemberToken } from '@/lib/agentMemberAuth'

export type AgentAccessFailureReason = 'not_team' | 'missing_token' | 'token_invalid' | 'inactive_member'

export interface AgentAccessResult {
  authorized: boolean
  member: AgentMember | null
  ownerAuthorized: boolean
  reason?: AgentAccessFailureReason
}

interface ResolveAgentAccessOptions {
  updateLastSeen?: boolean
}

export function extractBearerToken(request: NextRequest): string | null {
  const header = request.headers.get('authorization')
  if (!header) return null
  const [scheme, token] = header.split(' ')
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) {
    return null
  }
  return token.trim()
}

export async function resolveAgentAccess<TAgent extends Pick<Agent, 'id' | 'agentId' | 'accessMode'>>(
  prisma: PrismaClient,
  agent: TAgent,
  request: NextRequest,
  options: ResolveAgentAccessOptions = {}
): Promise<AgentAccessResult> {
  if (agent.accessMode !== 'team') {
    return { authorized: true, member: null, ownerAuthorized: false, reason: 'not_team' }
  }

  const token = extractBearerToken(request)

  if (token) {
    const payload = verifyAgentMemberToken(token)
    if (payload && payload.agentId === agent.agentId) {
      const member = await prisma.agentMember.findUnique({
        where: { id: payload.memberId }
      })

      if (member && member.status === 'active' && member.agentAgentId === agent.agentId) {
        if (options.updateLastSeen) {
          await prisma.agentMember.update({
            where: { id: member.id },
            data: { lastSeenAt: new Date() }
          })
        }
        return { authorized: true, member, ownerAuthorized: false }
      }

      return { authorized: false, member: null, ownerAuthorized: false, reason: 'inactive_member' }
    }

    const session = await getServerSession(authOptions)
    if (session?.user?.id === agent.id) {
      return { authorized: true, member: null, ownerAuthorized: true }
    }

    return { authorized: false, member: null, ownerAuthorized: false, reason: 'token_invalid' }
  }

  const session = await getServerSession(authOptions)
  if (session?.user?.id === agent.id) {
    return { authorized: true, member: null, ownerAuthorized: true }
  }

  return { authorized: false, member: null, ownerAuthorized: false, reason: 'missing_token' }
}
