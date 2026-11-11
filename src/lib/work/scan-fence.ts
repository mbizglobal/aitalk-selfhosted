import { AsyncLocalStorage } from 'node:async_hooks'
import type { Prisma, PrismaClient } from '@prisma/client'
import { WorkError } from './errors'
import type { WorkScope } from './app-scope'

interface Fence {
  scanId: string
  attemptId: string
  userId: string
  projectId: string
  allowed: ReadonlySet<string>
  linked: ReadonlySet<string>
  rowsMine: Set<string>
  unreadableMine: Set<string>
}

const als = new AsyncLocalStorage<Fence>()
const mineByAttempt = new Map<string, { rows: Set<string>; unreadable: Set<string> }>()

type Db = Pick<PrismaClient, '$queryRaw' | 'workFile'> | Prisma.TransactionClient

const SCAN_OUT = 'this file is not in the phone scan being sorted — leave it'

export function scanFenceActive(): boolean {
  return als.getStore() !== undefined
}

export function withScanFence<T>(scope: WorkScope, userId: string, fn: () => Promise<T>): Promise<T> {
  const s = scope.scan
  if (!s) return fn()
  let mine = mineByAttempt.get(s.attemptId)
  if (!mine) mineByAttempt.set(s.attemptId, (mine = { rows: new Set(), unreadable: new Set() }))
  return als.run({ scanId: s.scanId, attemptId: s.attemptId, userId, projectId: scope.projectId, allowed: new Set(s.allowed), linked: new Set([...s.linked, ...s.allowed]), rowsMine: mine.rows, unreadableMine: mine.unreadable }, fn)
}

export function endScanAttempt(attemptId: string): void {
  mineByAttempt.delete(attemptId)
}

function stringsOf(v: unknown, out: Set<string>, depth = 0): void {
  if (depth > 4 || out.size > 500) return
  if (typeof v === 'string') { if (v.length >= 20 && v.length <= 25 && /^[a-z0-9]+$/.test(v)) out.add(v); return }
  if (Array.isArray(v)) { for (const x of v) stringsOf(x, out, depth + 1); return }
  if (v && typeof v === 'object') for (const x of Object.values(v)) stringsOf(x, out, depth + 1)
}

export async function assertScanArgs(db: Pick<PrismaClient, 'workFile'>, args: unknown): Promise<void> {
  const f = als.getStore()
  if (!f) return
  const ids = new Set<string>()
  stringsOf(args, ids)
  const cand = [...ids].filter((x) => !f.linked.has(x))
  if (!cand.length) return
  const files = await db.workFile.findMany({ where: { id: { in: cand }, userId: f.userId }, select: { id: true, parentFileId: true } })
  const bad = files.find((x) => !(x.parentFileId && f.linked.has(x.parentFileId)))
  if (bad) throw new WorkError('FORBIDDEN', `file ${bad.id}: ${SCAN_OUT}`)
}

async function notNew(db: Db, f: Fence, ids: readonly string[]): Promise<string | null> {
  const rows = await db.workFile.findMany({ where: { id: { in: [...ids] }, projectId: f.projectId, userId: f.userId }, select: { id: true, decisionState: true, readCardState: true } })
  for (const id of ids) {
    const r = rows.find((x) => x.id === id)
    if (!r) return id
    if (r.decisionState === 'excluded' || r.decisionState === 'pending') return id
    if (r.readCardState === 'failed' && !f.unreadableMine.has(id)) return id
  }
  for (const id of ids) {
    const hit = await db.$queryRaw<Array<{ one: number }>>`SELECT 1 AS one FROM data_sheet_rows WHERE sheet_id IN (SELECT id FROM data_sheets WHERE project_id = ${f.projectId} AND user_id = ${f.userId}) AND row_data LIKE ${`%${id}%`} AND NOT (id = ANY(${[...f.rowsMine]}::text[])) LIMIT 1`
    if (hit.length) return id
  }
  return null
}

export async function scanAttemptOk(tx: Db): Promise<boolean> {
  const f = als.getStore()
  if (!f) return true
  const now = await tx.$queryRaw<Array<{ attempt_id: string | null; status: string }>>`SELECT attempt_id, status FROM work_scan WHERE id = ${f.scanId} FOR SHARE`
  return now[0]?.attempt_id === f.attemptId && now[0]?.status === 'sorting'
}

export async function assertScanWrite(tx: Db | null, write: readonly string[], refer: readonly string[] = []): Promise<void> {
  const f = als.getStore()
  if (!f) return
  const w = [...new Set(write)]
  for (const id of w) if (!f.allowed.has(id)) throw new WorkError('FORBIDDEN', `file ${id}: ${f.linked.has(id) ? 'this file belongs to another scan or was already uploaded — leave it' : SCAN_OUT}`)
  for (const id of refer) if (!f.linked.has(id)) throw new WorkError('FORBIDDEN', `file ${id}: ${SCAN_OUT}`)
  if (!tx) return
  if (!(await scanAttemptOk(tx))) throw new WorkError('FORBIDDEN', 'this sorting attempt was replaced — stop')
  if (w.length) {
    const done = await notNew(tx, f, w)
    if (done) throw new WorkError('FORBIDDEN', `file ${done} is already sorted (on a row, excluded, waiting for an answer or unreadable) — leave it`)
  }
}

export function noteScanRowInserted(rowId: string): void {
  als.getStore()?.rowsMine.add(rowId)
}

export function noteScanUnreadable(fileId: string): void {
  const f = als.getStore()
  if (f && f.allowed.has(fileId)) f.unreadableMine.add(fileId)
}

export function scanFilesAllowed(write: readonly string[], refer: readonly string[] = []): boolean {
  const f = als.getStore()
  if (!f) return true
  return write.every((id) => f.allowed.has(id)) && refer.every((id) => f.linked.has(id))
}
