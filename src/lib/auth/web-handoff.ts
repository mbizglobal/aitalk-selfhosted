import { createHash, randomBytes } from 'crypto'

const CODE_TTL_MS = 60_000
export const HANDOFF_SESSION_MS = 8 * 60 * 60 * 1000
const MAX_CODES = 10_000

export type HandoffWho = { type: 'owner'; userId: string } | { type: 'member'; agentId: string; memberId: number }
export interface HandoffEntry { who: HandoffWho; path: string; agentId: string; expiresAt: number }

const codes = new Map<string, HandoffEntry>()

const hashOf = (code: string) => createHash('sha256').update(code).digest('hex')

function prune(now: number) {
  for (const [k, e] of codes) if (e.expiresAt <= now) codes.delete(k)
}

export function workAppPath(raw: unknown): { path: string; agentId: string } | null {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\') || raw.length > 1000) return null
  let u: URL
  try { u = new URL(raw, 'http://handoff.invalid') } catch { return null }
  if (u.origin !== 'http://handoff.invalid' || u.hash) return null
  const m = /^\/chat\/([A-Za-z0-9_-]{1,64})\/app$/.exec(u.pathname)
  return m ? { path: `${u.pathname}${u.search}`, agentId: m[1] } : null
}

export function issueHandoff(who: HandoffWho, target: { path: string; agentId: string }): string | null {
  const now = Date.now()
  if (codes.size >= MAX_CODES) prune(now)
  if (codes.size >= MAX_CODES) return null
  const code = randomBytes(32).toString('base64url')
  codes.set(hashOf(code), { who, path: target.path, agentId: target.agentId, expiresAt: now + CODE_TTL_MS })
  return code
}

const live = (code: unknown): [string, HandoffEntry] | null => {
  if (typeof code !== 'string' || code.length < 40 || code.length > 64) return null
  const k = hashOf(code)
  const e = codes.get(k)
  if (!e) return null
  if (e.expiresAt <= Date.now()) { codes.delete(k); return null }
  return [k, e]
}

export function peekHandoff(code: unknown): HandoffEntry | null {
  return live(code)?.[1] ?? null
}

export function takeHandoff(code: unknown): HandoffEntry | null {
  const hit = live(code)
  if (!hit) return null
  codes.delete(hit[0])
  return hit[1]
}
