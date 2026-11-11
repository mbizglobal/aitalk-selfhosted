
import type { Prisma } from '@prisma/client'
import { encryptJson } from './sealed'

export interface WorkNotice {
  key: string
  params?: Record<string, string | number>
  by?: string
}
const NOTICE_KEY = /^notice_[a-z0-9_]{1,60}$/
const NOTICE_CODE = /^[A-Za-z0-9_.-]{1,40}$/
const NOTICE_BY = /^(human|member:\d{1,9})$/
export function moduleNoticeOf(out: unknown): WorkNotice | null {
  const n = out && typeof out === 'object' ? (out as { notice?: unknown }).notice : undefined
  if (!n || typeof n !== 'object') return null
  const { key, params } = n as { key?: unknown; params?: unknown }
  if (typeof key !== 'string' || !NOTICE_KEY.test(key)) return null
  if (params === undefined) return { key }
  if (!params || typeof params !== 'object' || Array.isArray(params)) return null
  const entries = Object.entries(params as Record<string, unknown>)
  if (entries.length > 8 || entries.some(([k, v]) => !/^[a-z][a-zA-Z0-9]{0,19}$/.test(k) || !((typeof v === 'number' && Number.isSafeInteger(v)) || (typeof v === 'string' && NOTICE_CODE.test(v))))) return null
  return { key, params: Object.fromEntries(entries) as Record<string, string | number> }
}

export function storedNoticeOf(body: unknown): WorkNotice | null {
  if (!body || typeof body !== 'object') return null
  const { text, notice } = body as { text?: unknown; notice?: unknown }
  if (text !== '' || !notice || typeof notice !== 'object') return null
  const { key, params, by } = notice as { key?: unknown; params?: unknown; by?: unknown }
  if (typeof key !== 'string' || !NOTICE_KEY.test(key)) return null
  if (by !== undefined && !(typeof by === 'string' && NOTICE_BY.test(by))) return null
  const who = typeof by === 'string' ? { by } : {}
  if (params === undefined) return { key, ...who }
  if (!params || typeof params !== 'object' || Array.isArray(params)) return null
  const entries = Object.entries(params as Record<string, unknown>)
  if (entries.length > 8 || entries.some(([k, v]) => !/^[a-z][a-zA-Z0-9]{0,19}$/.test(k) || !((typeof v === 'number' && Number.isSafeInteger(v)) || (typeof v === 'string' && v.length <= 200)))) return null
  return { key, params: Object.fromEntries(entries) as Record<string, string | number>, ...who }
}

export async function writeWorkNotice(db: Pick<Prisma.TransactionClient, 'workMessage'>, key: Buffer, n: { userId: string; projectId: string; notice: WorkNotice; alsoPrivate?: string }): Promise<void> {
  await db.workMessage.create({ data: { userId: n.userId, projectId: n.projectId, taskId: null, role: 'notice', actor: 'notice', body: encryptJson({ text: '', notice: n.notice }, key), room: 'team', owner: null } })
  if (n.alsoPrivate && NOTICE_BY.test(n.alsoPrivate)) {
    await db.workMessage.create({ data: { userId: n.userId, projectId: n.projectId, taskId: null, role: 'notice', actor: 'notice', body: encryptJson({ text: '', notice: n.notice }, key), room: 'private', owner: n.alsoPrivate } })
  }
}
