
import type { PrismaClient, Prisma } from '@prisma/client'

type Db = PrismaClient | Prisma.TransactionClient

const AUTH_TYPES = ['none', 'bearer', 'apiKey', 'basic', 'hmac'] as const
const SECRET_FIELDS: Record<string, readonly string[]> = {
  none: [],
  bearer: ['bearerToken'],
  apiKey: ['authHeaderName', 'authHeaderValue'],
  basic: ['basicUser', 'basicPassword'],
  hmac: ['hmacApiKey', 'hmacSecret'],
}
export const RESERVED_HEADERS: ReadonlySet<string> = new Set(['content-type', 'idempotency-key', 'host', 'content-length', 'transfer-encoding', 'connection'])
const HEADER_NAME_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,100}$/

export function httpUrlValid(v: string): boolean {
  if (v.length > 2000) return false
  try {
    const u = new URL(v)
    return u.protocol === 'https:' && !!u.hostname && !u.username && !u.password
  } catch {
    return false
  }
}

export function hostOf(url: string): string {
  try { return new URL(url).host } catch { return '' }
}

export function urlHint(url: string): string {
  try {
    const u = new URL(url)
    const rest = `${u.pathname}${u.search}`
    return `${u.host}${rest.length > 1 ? `${rest.slice(0, 8)}${rest.length > 8 ? '…' : ''}` : ''}`
  } catch {
    return ''
  }
}

export type HttpCredError = 'BAD_AUTH_TYPE' | 'BAD_URL' | 'NO_URL' | 'RESERVED_HEADER' | 'BAD_HEADER' | 'EMPTY_SECRET'

export function mergeHttpCred(old: Record<string, unknown>, incoming: Record<string, unknown>, url: string | null | undefined): { cred: Record<string, unknown> } | { error: HttpCredError } {
  const str = (o: Record<string, unknown>, k: string) => (typeof o[k] === 'string' ? (o[k] as string) : '')
  const oldType = typeof old.authType === 'string' ? old.authType : 'none'
  const type = typeof incoming.authType === 'string' ? incoming.authType : oldType
  if (!(AUTH_TYPES as readonly string[]).includes(type)) return { error: 'BAD_AUTH_TYPE' }
  const cred: Record<string, unknown> = { authType: type }
  for (const f of SECRET_FIELDS[type]) {
    const v = str(incoming, f)
    if (v.trim()) cred[f] = f === 'authHeaderName' ? v.trim() : v
    else if (type === oldType && str(old, f)) cred[f] = str(old, f)
  }
  if (type === 'bearer' && !str(cred, 'bearerToken').trim()) return { error: 'EMPTY_SECRET' }
  if (type === 'apiKey') {
    if (!str(cred, 'authHeaderValue').trim()) return { error: 'EMPTY_SECRET' }
    const name = str(cred, 'authHeaderName') || 'Authorization'
    if (!HEADER_NAME_RE.test(name)) return { error: 'BAD_HEADER' }
    if (RESERVED_HEADERS.has(name.toLowerCase())) return { error: 'RESERVED_HEADER' }
    cred.authHeaderName = name
  }
  if (type === 'basic' && !str(cred, 'basicUser').trim()) return { error: 'EMPTY_SECRET' }
  if (url === undefined || (url !== null && url.trim() === '')) {
    if (str(old, 'url')) cred.url = str(old, 'url')
  } else if (url !== null) {
    const u = url.trim()
    if (!httpUrlValid(u)) return { error: 'BAD_URL' }
    cred.url = u
  }
  if (!cred.url) return { error: 'NO_URL' }
  return { cred }
}

export const httpSlotLabel = (startNodeId: string, slot: string) => `${startNodeId}:${slot}`

export interface SlotHttpTarget { connectionId: string; url: string }

export async function slotHttpNow(db: Db, userId: string, workflowId: string, slot: string): Promise<SlotHttpTarget | null> {
  const w = await db.workflow.findFirst({ where: { workflowId, agent: { userId } }, select: { agentId: true, workflowJson: true } })
  if (!w) return null
  const [{ appStartSettings }, { agentScopedWhere }] = await Promise.all([import('./app-chat'), import('@/lib/connection-scope')])
  const st = appStartSettings(w.workflowJson)
  const id = st.connections.http?.[slot]
  if (!id || !st.startNodeId) return null
  const conn = await db.workflowConnection.findFirst({
    where: { id, ...agentScopedWhere({ agentId: w.agentId, userId }, 'Work app send'), provider: 'http_request', status: 'active', label: httpSlotLabel(st.startNodeId, slot) },
    select: { id: true, userId: true, encryptedToken: true },
  })
  if (!conn?.encryptedToken) return null
  const { getConnectionSecret } = await import('@/lib/secret-vault')
  try {
    const cred = JSON.parse(await getConnectionSecret(db as PrismaClient, conn.userId, conn.id, conn.encryptedToken))
    const url = cred && typeof cred === 'object' && typeof cred.url === 'string' ? cred.url : ''
    return url && httpUrlValid(url) ? { connectionId: conn.id, url } : null
  } catch {
    return null
  }
}
