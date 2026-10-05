
import crypto from 'crypto'

const STATE_TTL_MS = 10 * 60_000

function stateKey(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET || process.env.ENCRYPTION_SECRET
  if (!secret) {
    throw new Error('NEXTAUTH_SECRET is not set (required for OAuth state signing)')
  }
  return crypto.createHmac('sha256', 'calendar-oauth-state').update(secret).digest()
}

export function signOauthState(payload: Record<string, unknown>): string {
  const body = Buffer.from(
    JSON.stringify({ ...payload, exp: Date.now() + STATE_TTL_MS })
  ).toString('base64url')
  const sig = crypto.createHmac('sha256', stateKey()).update(body).digest('base64url')
  return `${body}.${sig}`
}

export type OauthRequester =
  | {
      ok: true
      agentId: string
      userId: string
      signedPayload: Record<string, unknown>
    }
  | { ok: false; reason: 'invalid_state' | 'session_mismatch' }

export function resolveOauthRequester(
  rawState: string | null | undefined,
  sessionUserId: string | null | undefined
): OauthRequester {
  if (!rawState) return { ok: false, reason: 'invalid_state' }

  const verified = verifyOauthState<{ agentId?: unknown; userId?: unknown }>(rawState)
  const agentId = verified?.agentId
  const userId = verified?.userId
  if (typeof agentId !== 'string' || !agentId || typeof userId !== 'string' || !userId) {
    return { ok: false, reason: 'invalid_state' }
  }

  if (!sessionUserId || sessionUserId !== userId) {
    return { ok: false, reason: 'session_mismatch' }
  }

  return { ok: true, agentId, userId, signedPayload: verified as Record<string, unknown> }
}

export function verifyOauthState<T extends object>(state: string): (T & { exp: number }) | null {
  const dot = state.lastIndexOf('.')
  if (dot <= 0 || dot === state.length - 1) return null
  const body = state.slice(0, dot)
  const sig = state.slice(dot + 1)

  const expected = crypto.createHmac('sha256', stateKey()).update(body).digest()
  const given = Buffer.from(sig, 'base64url')
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null

  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'))
    if (typeof parsed?.exp !== 'number' || parsed.exp < Date.now()) return null
    return parsed as T & { exp: number }
  } catch {
    return null
  }
}
