
import crypto from 'crypto'
import type { PrismaClient } from '@prisma/client'
import { encryptBuffer, decryptBuffer } from '@/lib/encryption'
import { describeCaughtError } from '@/lib/log-mask'
import { blobRef } from '@/lib/managed/blob-storage'
import { decryptJson, encryptJson } from './sealed'
import { WorkError } from './errors'
import { readProjectFile, workStorageRegion, type WorkFileDeps } from './files'
import { readerOf, type WorkMessageBody } from './app-chat'
import type { TurnPart } from './turn-attachments'
import type { WorkTeamAccess } from './team-access'
import type { DocCardFailure } from './doc-card-check'
import { REPORT_CONSENT_V, REPORT_MAX_ATTACH, REPORT_MAX_FILES, REPORT_NOTE_MAX } from './report-limits'

export { REPORT_CONSENT_V, REPORT_MAX_ATTACH, REPORT_MAX_FILES, REPORT_NOTE_MAX }
export const REPORT_MAX_TOTAL_BYTES = 60 * 1024 * 1024
export const REPORT_DAILY_LIMIT = 10
export const REPORT_REPLY_MAX = 5000
const DAY_MS = 24 * 60 * 60 * 1000
const OPEN_KEEP_MS = 90 * DAY_MS
const RESOLVED_KEEP_MS = 30 * DAY_MS
export const REPLY_SEND_TIMEOUT_MS = 2 * 60 * 1000
export const REPLY_RECLAIM_MS = 10 * 60 * 1000

export type ReportSource = 'work_files' | 'work_chat'

export interface ReportFileContext {
  name: string
  mimeType: string
  sizeBytes: number
  uploadedAt?: string
  readCardState?: string | null
  failure?: DocCardFailure | null
  decisionState?: string | null
  pageImages?: number
  from: 'files' | 'attached'
}
export interface ReportBody {
  note: string
  context: { appId: string | null; projectId: string; taskId: string | null; files: ReportFileContext[]; at: string }
  chat?: { user?: string; assistant: string }
}

export async function reporterEmailOf(db: PrismaClient, access: WorkTeamAccess): Promise<string | null> {
  if (access.isOwner) {
    const u = await db.user.findUnique({ where: { id: access.userId }, select: { email: true } })
    return u?.email ?? null
  }
  if (access.actor.memberId === undefined) return null
  const m = await db.agentMember.findFirst({ where: { id: access.actor.memberId, status: 'active' }, select: { email: true } })
  return m?.email ?? null
}

interface CreateInput {
  access: WorkTeamAccess
  projectId: string
  payload: Record<string, unknown>
  parts: TurnPart[]
  lang: string
}

function parsePayload(payload: Record<string, unknown>, parts: TurnPart[]) {
  if (payload.consent !== true || payload.consentV !== REPORT_CONSENT_V) throw new WorkError('INVALID', 'consent required')
  const source = payload.source
  if (source !== 'work_files' && source !== 'work_chat') throw new WorkError('INVALID', 'source')
  const note = typeof payload.note === 'string' ? payload.note.trim() : ''
  if (note.length > REPORT_NOTE_MAX) throw new WorkError('INVALID', `note over ${REPORT_NOTE_MAX}`)
  const raw = payload.fileIds ?? []
  if (!Array.isArray(raw) || raw.some((x) => typeof x !== 'string' || !x || x.length > 25)) throw new WorkError('INVALID', 'fileIds')
  const fileIds = [...new Set(raw as string[])]
  if (fileIds.length > REPORT_MAX_FILES) throw new WorkError('INVALID', `up to ${REPORT_MAX_FILES} files`)
  if (parts.some((p) => p.kind !== 'file')) throw new WorkError('INVALID', 'files only')
  if (parts.length > REPORT_MAX_ATTACH) throw new WorkError('INVALID', `up to ${REPORT_MAX_ATTACH} attached files`)
  const chatMessageId = payload.chatMessageId
  if (chatMessageId !== undefined && (typeof chatMessageId !== 'string' || !chatMessageId || chatMessageId.length > 25)) throw new WorkError('INVALID', 'chatMessageId')
  if (!fileIds.length && !parts.length && !chatMessageId) throw new WorkError('INVALID', 'nothing to report')
  return { source: source as ReportSource, note, fileIds, chatMessageId: chatMessageId as string | undefined }
}

function failureOf(readCard: Uint8Array | null, state: string | null, key: Buffer): DocCardFailure | null {
  if (state !== 'failed' || !readCard) return null
  try { return decryptJson<DocCardFailure>(readCard, key) } catch { return null }
}

export async function createReport(deps: WorkFileDeps, input: CreateInput): Promise<{ id: string; number: number; reporterEmail: string | null; appId: string | null; fileCount: number; source: ReportSource; failures: string[]; note: string }> {
  const { db } = deps
  const { access, projectId } = input
  const p = parsePayload(input.payload, input.parts)
  const reader = readerOf(access.actor)
  if (!reader) throw new WorkError('FORBIDDEN', 'only a person reports')

  const project = await db.workProject.findFirst({ where: { id: projectId, userId: access.userId }, select: { id: true, kind: true } })
  if (!project) throw new WorkError('NOT_FOUND')
  if (await db.supportReport.count({ where: { userId: access.userId, createdAt: { gte: new Date(Date.now() - DAY_MS) } } }) >= REPORT_DAILY_LIMIT) {
    throw new WorkError('RATE_LIMITED', `up to ${REPORT_DAILY_LIMIT} reports in 24 hours`)
  }
  const key = await deps.dataKey(db, access.userId)

  const files = p.fileIds.length
    ? await db.workFile.findMany({ where: { id: { in: p.fileIds }, projectId, userId: access.userId, parentFileId: null } })
    : []
  if (files.length !== p.fileIds.length) throw new WorkError('NOT_FOUND')
  const total = files.reduce((n, f) => n + f.sizeBytes, 0) + input.parts.reduce((n, x) => n + x.buffer.length, 0)
  if (total > REPORT_MAX_TOTAL_BYTES) throw new WorkError('INVALID', 'report files over 60 MB in total')

  let chat: ReportBody['chat']
  let taskId: string | null = null
  if (p.chatMessageId) {
    const m = await db.workMessage.findFirst({ where: { id: p.chatMessageId, projectId, userId: access.userId, room: 'private', owner: reader, role: 'assistant' } })
    if (!m) throw new WorkError('NOT_FOUND')
    taskId = m.taskId
    const prev = await db.workMessage.findFirst({
      where: { projectId, userId: access.userId, taskId: m.taskId, room: 'private', owner: reader, OR: [{ createdAt: { lt: m.createdAt } }, { createdAt: m.createdAt, id: { lt: m.id } }] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })
    const text = (b: Uint8Array) => decryptJson<WorkMessageBody>(b, key).text
    chat = { assistant: text(m.body), ...(prev?.role === 'user' ? { user: text(prev.body) } : {}) }
  }

  const pageCounts = files.length
    ? await db.workFile.groupBy({ by: ['parentFileId'], where: { parentFileId: { in: files.map((f) => f.id) }, projectId, userId: access.userId, kind: 'page_image' }, _count: true })
    : []
  const pagesOf = new Map(pageCounts.map((r) => [r.parentFileId, r._count]))

  const copies: { fromFileId: string | null; name: string; mimeType: string; buffer: Buffer; ctx: ReportFileContext }[] = []
  for (const f of files) {
    const { buffer, originalName } = await readProjectFile(deps, { userId: access.userId, fileId: f.id, actor: access.actor })
    copies.push({
      fromFileId: f.id, name: originalName, mimeType: f.mimeType, buffer,
      ctx: { name: originalName, mimeType: f.mimeType, sizeBytes: f.sizeBytes, uploadedAt: f.uploadedAt.toISOString(), readCardState: f.readCardState, failure: failureOf(f.readCard, f.readCardState, key), decisionState: f.decisionState, pageImages: pagesOf.get(f.id) ?? 0, from: 'files' },
    })
  }
  for (const x of input.parts) copies.push({ fromFileId: null, name: x.name, mimeType: x.mimeType, buffer: x.buffer, ctx: { name: x.name, mimeType: x.mimeType, sizeBytes: x.buffer.length, from: 'attached' } })

  const body: ReportBody = { note: p.note, context: { appId: project.kind, projectId, taskId, files: copies.map((c) => c.ctx), at: new Date().toISOString() }, ...(chat ? { chat } : {}) }
  const reporterEmail = await reporterEmailOf(db, access)
  const id = `r${crypto.randomBytes(12).toString('hex')}`
  const region = await workStorageRegion(db, access.userId)

  const uploaded: { path: string; c: (typeof copies)[number] }[] = []
  const discard = async () => {
    for (const u of uploaded) {
      try { await deps.blob.delete(region, u.path) } catch (e) { console.error(`[work-report] 보상 삭제 실패 — 고아 blob ${blobRef(u.path)}:`, describeCaughtError(e)) }
    }
  }
  try {
    for (const c of copies) {
      const path = `${access.userId}/support/${id}/${crypto.randomBytes(8).toString('hex')}.bin`
      await deps.blob.upload(region, path, encryptBuffer(c.buffer, key), 'application/octet-stream')
      uploaded.push({ path, c })
    }
    const now = new Date()
    const made = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(4231, hashtext(${access.userId}))`
      const recent = await tx.supportReport.count({ where: { userId: access.userId, createdAt: { gte: new Date(now.getTime() - DAY_MS) } } })
      if (recent >= REPORT_DAILY_LIMIT) throw new WorkError('RATE_LIMITED', `up to ${REPORT_DAILY_LIMIT} reports in 24 hours`)
      const dup = await openReportNumbers(tx, { userId: access.userId, fileIds: p.fileIds })
      if (dup.size) throw new WorkError('DUPLICATE', `already in open report #${Math.max(...dup.values())}`)
      return tx.supportReport.create({
        data: {
          id, userId: access.userId, agentId: access.agentId, projectId, appId: project.kind, source: p.source, reporter: reader, reporterEmail,
          lang: input.lang, consentV: REPORT_CONSENT_V, consentAt: now, body: encryptJson(body, key), purgeAt: new Date(now.getTime() + OPEN_KEEP_MS),
          files: { create: uploaded.map((u) => ({ fromFileId: u.c.fromFileId, meta: encryptJson({ name: u.c.name }, key), mimeType: u.c.mimeType, sizeBytes: u.c.buffer.length, blobRegion: region, blobPath: u.path })) },
        },
        select: { id: true, number: true },
      })
    })
    const failures = [...new Set(copies.map((c) => c.ctx.failure?.failed).filter((x): x is DocCardFailure['failed'] => !!x))]
    return { ...made, reporterEmail, appId: project.kind, fileCount: copies.length, source: p.source, failures, note: p.note }
  } catch (e) {
    await discard()
    throw e
  }
}

export async function openReportNumbers(db: Pick<PrismaClient, 'supportReportFile'>, q: { userId: string; fileIds: string[] }): Promise<Map<string, number>> {
  if (q.fileIds.length === 0) return new Map()
  const rows = await db.supportReportFile.findMany({
    where: { fromFileId: { in: q.fileIds }, report: { userId: q.userId, status: 'open', purgedAt: null } },
    select: { fromFileId: true, report: { select: { number: true } } },
  })
  const out = new Map<string, number>()
  for (const r of rows) if (r.fromFileId && (out.get(r.fromFileId) ?? 0) < r.report.number) out.set(r.fromFileId, r.report.number)
  return out
}

// ─────────────────────────────── console ───────────────────────────────

export interface ReportListItem {
  id: string; number: number; userId: string; userEmail: string | null; appId: string | null; source: string; status: string
  files: number; replyMail: string | null; replyMailAt: Date | null; createdAt: Date; resolvedAt: Date | null; purgedAt: Date | null
}

export async function listReports(db: PrismaClient, q: { status?: string }): Promise<{ items: ReportListItem[]; total: number }> {
  const where = q.status && q.status !== 'all' ? { status: q.status } : {}
  const total = await db.supportReport.count({ where })
  const rows = await db.supportReport.findMany({
    where, orderBy: { createdAt: q.status === 'open' ? 'asc' : 'desc' }, take: 200,
    select: { id: true, number: true, userId: true, appId: true, source: true, status: true, replyMail: true, replyMailAt: true, createdAt: true, resolvedAt: true, purgedAt: true, user: { select: { email: true } }, _count: { select: { files: true } } },
  })
  return { total, items: rows.map((r) => ({ id: r.id, number: r.number, userId: r.userId, userEmail: r.user.email, appId: r.appId, source: r.source, status: r.status, files: r._count.files, replyMail: r.replyMail, replyMailAt: r.replyMailAt, createdAt: r.createdAt, resolvedAt: r.resolvedAt, purgedAt: r.purgedAt })) }
}

export async function getReport(deps: Pick<WorkFileDeps, 'db' | 'dataKey'>, id: string) {
  const r = await deps.db.supportReport.findUnique({ where: { id }, include: { files: true, user: { select: { email: true } } } })
  if (!r) throw new WorkError('NOT_FOUND')
  const key = await deps.dataKey(deps.db, r.userId)
  const body = r.body ? decryptJson<ReportBody>(r.body, key) : null
  const reply = r.reply ? decryptJson<{ text: string }>(r.reply, key).text : null
  const accesses = await deps.db.supportReportAccess.findMany({ where: { reportId: id }, orderBy: { createdAt: 'desc' }, take: 100 })
  return {
    id: r.id, number: r.number, userId: r.userId, userEmail: r.user.email, agentId: r.agentId, projectId: r.projectId, appId: r.appId, source: r.source,
    reporter: r.reporter, reporterEmail: r.reporterEmail, lang: r.lang, consentV: r.consentV, consentAt: r.consentAt, status: r.status,
    resolvedAt: r.resolvedAt, resolvedBy: r.resolvedBy, reply, replyMail: r.replyMail, replyMailAt: r.replyMailAt, purgeAt: r.purgeAt, purgedAt: r.purgedAt, createdAt: r.createdAt, body,
    files: r.files.map((f) => ({ id: f.id, name: decryptJson<{ name: string }>(f.meta, key).name, mimeType: f.mimeType, sizeBytes: f.sizeBytes, fromFileId: f.fromFileId })),
    accesses: accesses.map((a) => ({ fileRowId: a.fileRowId, admin: a.admin, at: a.createdAt })),
  }
}

export async function readReportFile(deps: WorkFileDeps, q: { reportId: string; fileId: string; admin: string }) {
  const f = await deps.db.supportReportFile.findFirst({ where: { id: q.fileId, reportId: q.reportId }, include: { report: { select: { userId: true, purgedAt: true } } } })
  if (!f || f.report.purgedAt) throw new WorkError('NOT_FOUND')
  const key = await deps.dataKey(deps.db, f.report.userId)
  const { buffer: sealed } = await deps.blob.download(f.blobRegion, f.blobPath)
  const buffer = decryptBuffer(sealed, key)
  await deps.db.supportReportAccess.create({ data: { reportId: q.reportId, fileRowId: f.id, admin: q.admin.slice(0, 100) } })
  return { buffer, mimeType: f.mimeType, name: decryptJson<{ name: string }>(f.meta, key).name }
}

export interface ReplyClaim { id: string; number: number; to: string; text: string; lang: string; claimedAt: Date }

export async function claimResolve(deps: Pick<WorkFileDeps, 'db' | 'dataKey'>, q: { id: string; text: string; admin: string }): Promise<ReplyClaim> {
  const text = q.text.trim()
  if (!text || text.length > REPORT_REPLY_MAX) throw new WorkError('INVALID', 'reply text')
  const r = await deps.db.supportReport.findUnique({ where: { id: q.id }, select: { userId: true, number: true, reporterEmail: true, lang: true, status: true, purgedAt: true } })
  if (!r) throw new WorkError('NOT_FOUND')
  if (r.status !== 'open' || r.purgedAt) throw new WorkError('STALE', 'already resolved or purged')
  if (!r.reporterEmail) throw new WorkError('INVALID', 'no reply address')
  const key = await deps.dataKey(deps.db, r.userId)
  const now = new Date()
  const won = await deps.db.supportReport.updateMany({
    where: { id: q.id, status: 'open', purgedAt: null },
    data: { status: 'resolved', resolvedAt: now, resolvedBy: q.admin.slice(0, 100), reply: encryptJson({ text }, key), replyMail: 'sending', replyMailAt: now, purgeAt: new Date(now.getTime() + RESOLVED_KEEP_MS) },
  })
  if (won.count === 0) throw new WorkError('STALE', 'already resolved or purged')
  return { id: q.id, number: r.number, to: r.reporterEmail, text, lang: r.lang, claimedAt: now }
}

export async function closeReport(db: PrismaClient, q: { id: string; admin: string }): Promise<void> {
  const now = new Date()
  const won = await db.supportReport.updateMany({
    where: { id: q.id, status: 'open', purgedAt: null },
    data: { status: 'resolved', resolvedAt: now, resolvedBy: q.admin.slice(0, 100), purgeAt: new Date(now.getTime() + RESOLVED_KEEP_MS) },
  })
  if (won.count === 0) {
    if (!(await db.supportReport.findUnique({ where: { id: q.id }, select: { id: true } }))) throw new WorkError('NOT_FOUND')
    throw new WorkError('STALE', 'already resolved or purged')
  }
}

export async function claimResend(deps: Pick<WorkFileDeps, 'db' | 'dataKey'>, q: { id: string }): Promise<ReplyClaim> {
  const r = await deps.db.supportReport.findUnique({ where: { id: q.id }, select: { userId: true, number: true, reporterEmail: true, lang: true, reply: true, replyMail: true, replyMailAt: true, status: true, purgedAt: true } })
  if (!r) throw new WorkError('NOT_FOUND')
  if (r.status !== 'resolved' || r.purgedAt || !r.reply || !r.reporterEmail || !r.replyMailAt) throw new WorkError('STALE', 'nothing to resend')
  const now = new Date()
  const won = await deps.db.supportReport.updateMany({
    where: {
      id: q.id, status: 'resolved', purgedAt: null, replyMailAt: r.replyMailAt,
      OR: [{ replyMail: { in: ['failed', 'unknown'] } }, { replyMail: 'sending', replyMailAt: { lt: new Date(now.getTime() - REPLY_RECLAIM_MS) } }],
    },
    data: { replyMail: 'sending', replyMailAt: now },
  })
  if (won.count === 0) throw new WorkError('STALE', 'mail is being sent or already sent')
  const key = await deps.dataKey(deps.db, r.userId)
  return { id: q.id, number: r.number, to: r.reporterEmail, text: decryptJson<{ text: string }>(r.reply, key).text, lang: r.lang, claimedAt: now }
}

export async function recordReplyMail(db: PrismaClient, claim: Pick<ReplyClaim, 'id' | 'claimedAt'>, result: 'sent' | 'failed' | 'unknown'): Promise<boolean> {
  const r = await db.supportReport.updateMany({ where: { id: claim.id, replyMail: 'sending', replyMailAt: claim.claimedAt }, data: { replyMail: result } })
  return r.count > 0
}

export async function sendWithTimeout(send: () => Promise<{ success: boolean }>, ms = REPLY_SEND_TIMEOUT_MS): Promise<'sent' | 'failed' | 'unknown'> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<'unknown'>((resolve) => { timer = setTimeout(() => resolve('unknown'), ms) })
  try {
    const sent = send().then(
      (r): 'sent' | 'failed' => (r.success ? 'sent' : 'failed'),
      (e): 'failed' => { console.error('[work-report] reply mail', describeCaughtError(e)); return 'failed' },
    )
    return await Promise.race([sent, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function purgeReports(deps: Pick<WorkFileDeps, 'db' | 'blob'>, now = new Date()): Promise<{ purged: number; filesRemoved: number; blobErrors: number }> {
  const due = await deps.db.supportReport.findMany({ where: { purgedAt: null, purgeAt: { lt: now } }, select: { id: true }, take: 200, orderBy: { purgeAt: 'asc' } })
  const sendingCut = new Date(now.getTime() - REPLY_RECLAIM_MS)
  let purged = 0
  for (const { id } of due) {
    const won = await deps.db.$transaction(async (tx) => {
      const w = await tx.supportReport.updateMany({
        where: { id, purgedAt: null, purgeAt: { lt: now }, OR: [{ replyMail: null }, { replyMail: { not: 'sending' } }, { replyMailAt: { lt: sendingCut } }] },
        data: { purgedAt: now, body: null, reply: null, reporterEmail: null, replyMail: null },
      })
      if (w.count === 0) return false
      await tx.supportReport.updateMany({ where: { id, status: 'open' }, data: { status: 'expired' } })
      return true
    })
    if (won) purged++
  }
  const left = await deps.db.supportReportFile.findMany({ where: { report: { purgedAt: { not: null } } }, select: { id: true, blobRegion: true, blobPath: true }, take: 500 })
  let filesRemoved = 0
  let blobErrors = 0
  for (const f of left) {
    try {
      await deps.blob.delete(f.blobRegion, f.blobPath)
    } catch (e) {
      blobErrors++
      console.error(`[work-report] 정리 blob 실패 ${blobRef(f.blobPath)}:`, describeCaughtError(e))
      continue
    }
    await deps.db.supportReportFile.delete({ where: { id: f.id } }).catch(() => {})
    filesRemoved++
  }
  return { purged, filesRemoved, blobErrors }
}
