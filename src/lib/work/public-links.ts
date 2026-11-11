import crypto from 'crypto'
export { PUBLIC_LINK_PATH, publicLinkUrl } from './public-link-url'

const TOKEN = /^[A-Za-z0-9_-]{43}$/

export function newPublicToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString('base64url')
  return { token, hash: hashPublicToken(token) }
}

export function hashPublicToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export function isPublicToken(v: unknown): v is string {
  return typeof v === 'string' && TOKEN.test(v)
}

export { addDays, linkExpiresAt, zurichMidnightUtc, zurichToday } from './dates'
