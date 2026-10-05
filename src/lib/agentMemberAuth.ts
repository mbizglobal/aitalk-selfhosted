import { createHmac } from 'crypto'

export interface AgentMemberTokenPayload {
  agentId: string
  memberId: number
  email: string
  exp: number
}

const TOKEN_HEADER = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
const DEFAULT_EXPIRY_SECONDS = 60 * 60 * 24 * 7 // 7 days

function base64UrlEncode(input: string | Buffer) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function base64UrlDecode(input: string) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  return Buffer.from(padded, 'base64').toString()
}

function getSecret(): string {
  const secret = process.env.TEAM_MEMBER_TOKEN_SECRET || process.env.NEXTAUTH_SECRET
  if (!secret) {
    throw new Error('Team member token secret is not configured')
  }
  return secret
}

export function createAgentMemberToken({
  agentId,
  memberId,
  email,
  expiresInSeconds = DEFAULT_EXPIRY_SECONDS,
}: {
  agentId: string
  memberId: number
  email: string
  expiresInSeconds?: number
}): { token: string; expiresAt: number } {
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds
  const payload: AgentMemberTokenPayload = {
    agentId,
    memberId,
    email: email.toLowerCase(),
    exp,
  }

  const payloadSegment = base64UrlEncode(JSON.stringify(payload))
  const data = `${TOKEN_HEADER}.${payloadSegment}`
  const signature = base64UrlEncode(createHmac('sha256', getSecret()).update(data).digest())
  return {
    token: `${data}.${signature}`,
    expiresAt: exp,
  }
}

export function createOAuthMemberToken(member: {
  agentAgentId: string
  id: number
  email: string
}): { token: string; expiresAt: number } {
  return createAgentMemberToken({
    agentId: member.agentAgentId,
    memberId: member.id,
    email: member.email,
    expiresInSeconds: DEFAULT_EXPIRY_SECONDS
  })
}

export function verifyAgentMemberToken(token: string): AgentMemberTokenPayload | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) {
      return null
    }

    const [headerSegment, payloadSegment, signature] = parts
    if (headerSegment !== TOKEN_HEADER) {
      return null
    }

    const data = `${headerSegment}.${payloadSegment}`
    const expectedSignature = base64UrlEncode(createHmac('sha256', getSecret()).update(data).digest())

    if (signature !== expectedSignature) {
      return null
    }

    const decoded = JSON.parse(base64UrlDecode(payloadSegment)) as AgentMemberTokenPayload

    if (!decoded.agentId || !decoded.memberId || !decoded.email || !decoded.exp) {
      return null
    }

    if (decoded.exp < Math.floor(Date.now() / 1000)) {
      return null
    }

    decoded.email = decoded.email.toLowerCase()
    return decoded
  } catch (error) {
    return null
  }
}
