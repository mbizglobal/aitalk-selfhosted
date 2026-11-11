import type { PrismaClient } from '@prisma/client'
import { createHash } from 'crypto'
import { decryptBuffer, encryptBuffer } from '@/lib/encryption'
import { WorkError } from './errors'
import { encryptJson, decryptJson } from './sealed'
import { saveProjectFile, workStorageRegion, WORK_FILE_MAX_BYTES, type WorkFileDeps, type WorkFileKind } from './files'
import type { SheetActor } from './sheet-gate'
import { describeCaughtError } from '@/lib/log-mask'

export const WORK_FILE_BIG_MAX_BYTES = 45 * 1024 * 1024
export const FILE_PIECE_BYTES = 8 * 1024 * 1024
export const FILE_UPLOAD_TTL_MS = 24 * 3600_000
const BIG_MIME: ReadonlySet<string> = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'])
const BIG_KINDS: ReadonlySet<string> = new Set(['receipt', 'report', 'other'])

export const fileUploadPrefix = (userId: string, projectId: string, uploadId: string) => `${userId}/project/${projectId}/upload/${uploadId}/`
const piecePath = (userId: string, projectId: string, uploadId: string, n: number) => `${fileUploadPrefix(userId, projectId, uploadId)}${n}.bin`
export const fileMaxBytes = (mime: string) => (BIG_MIME.has(mime.split(';')[0].trim().toLowerCase()) ? WORK_FILE_BIG_MAX_BYTES : WORK_FILE_MAX_BYTES)

export async function startFileUpload(deps: WorkFileDeps, i: { userId: string; projectId: string; name: string; mimeType: string; sizeBytes: number; sha256: string; kind: string; now?: Date }): Promise<{ uploadId: string; pieceBytes: number; pieces: number }> {
  const mime = i.mimeType.split(';')[0].trim().toLowerCase()
  if (!Number.isSafeInteger(i.sizeBytes) || i.sizeBytes <= WORK_FILE_MAX_BYTES || i.sizeBytes > WORK_FILE_BIG_MAX_BYTES) throw new WorkError('INVALID', 'file too large')
  if (!BIG_MIME.has(mime)) throw new WorkError('INVALID', 'file type not accepted')
  if (!BIG_KINDS.has(i.kind)) throw new WorkError('INVALID', 'unknown file kind')
  if (!/^[0-9a-f]{64}$/.test(i.sha256)) throw new WorkError('INVALID', 'sha256')
  const project = await deps.db.workProject.findFirst({ where: { id: i.projectId, userId: i.userId }, select: { id: true } })
  if (!project) throw new WorkError('NOT_FOUND')
  const key = await deps.dataKey(deps.db, i.userId)
  const pieces = Math.ceil(i.sizeBytes / FILE_PIECE_BYTES)
  const u = await deps.db.workFileUpload.create({ data: {
    userId: i.userId, projectId: i.projectId, region: await workStorageRegion(deps.db, i.userId), kind: i.kind, mimeType: mime, sizeBytes: i.sizeBytes,
    sha256: i.sha256, pieces, payload: encryptJson({ originalName: (i.name || 'file').slice(0, 255) }, key), expiresAt: new Date((i.now ?? new Date()).getTime() + FILE_UPLOAD_TTL_MS),
  } })
  return { uploadId: u.id, pieceBytes: FILE_PIECE_BYTES, pieces }
}

async function openUpload(db: PrismaClient, q: { userId: string; projectId: string; uploadId: string; now?: Date }) {
  const u = await db.workFileUpload.findFirst({ where: { id: q.uploadId, userId: q.userId, projectId: q.projectId } })
  if (!u || u.expiresAt.getTime() <= (q.now ?? new Date()).getTime()) throw new WorkError('NOT_FOUND')
  if (u.state !== 'receiving') throw new WorkError('STALE', 'upload is finished')
  return u
}

export async function putFilePiece(deps: WorkFileDeps, i: { userId: string; projectId: string; uploadId: string; n: number; data: Buffer; now?: Date }): Promise<{ n: number }> {
  const u = await openUpload(deps.db, i)
  if (!Number.isSafeInteger(i.n) || i.n < 0 || i.n >= u.pieces) throw new WorkError('INVALID', 'piece number')
  if (i.data.length !== Math.min(FILE_PIECE_BYTES, u.sizeBytes - i.n * FILE_PIECE_BYTES)) throw new WorkError('INVALID', 'piece length')
  const key = await deps.dataKey(deps.db, i.userId)
  await deps.blob.upload(u.region, piecePath(i.userId, u.projectId, u.id, i.n), encryptBuffer(i.data, key), 'application/octet-stream')
  return { n: i.n }
}

let merging = false

export async function finishFileUpload(deps: WorkFileDeps, i: { userId: string; projectId: string; uploadId: string; actor: SheetActor; now?: Date }): Promise<{ id: string; created: boolean; mimeType: string; sizeBytes: number }> {
  if (merging) throw new WorkError('UNAVAILABLE', 'another large file is being saved — try again in a moment')
  merging = true
  try {
    const u = await openUpload(deps.db, i)
    const key = await deps.dataKey(deps.db, i.userId)
    const parts: Buffer[] = []
    for (let n = 0; n < u.pieces; n++) {
      let b: Buffer
      try { b = decryptBuffer((await deps.blob.download(u.region, piecePath(i.userId, u.projectId, u.id, n))).buffer, key) } catch { throw new WorkError('INVALID', `piece ${n} missing`) }
      if (b.length !== Math.min(FILE_PIECE_BYTES, u.sizeBytes - n * FILE_PIECE_BYTES)) throw new WorkError('INVALID', `piece ${n} missing`)
      parts.push(b)
    }
    const buffer = Buffer.concat(parts)
    parts.length = 0
    if (buffer.length !== u.sizeBytes || createHash('sha256').update(buffer).digest('hex') !== u.sha256) throw new WorkError('INVALID', 'the pieces do not match the file — upload it again')
    const { originalName } = decryptJson<{ originalName: string }>(u.payload, key)
    const { file, created } = await saveProjectFile(deps, { userId: i.userId, projectId: i.projectId, kind: u.kind as WorkFileKind, originalName, mimeType: u.mimeType, buffer, actor: i.actor, maxBytes: WORK_FILE_BIG_MAX_BYTES })
    await deps.db.workFileUpload.updateMany({ where: { id: u.id, state: 'receiving' }, data: { state: 'done' } })
    await deletePieces(deps, u.region, i.userId, u.projectId, u.id, u.pieces)
    return { id: file.id, created, mimeType: file.mimeType, sizeBytes: file.sizeBytes }
  } finally {
    merging = false
  }
}

async function deletePieces(deps: Pick<WorkFileDeps, 'blob'>, region: string, userId: string, projectId: string, uploadId: string, pieces: number) {
  for (let n = 0; n < pieces; n++) {
    await deps.blob.delete(region, piecePath(userId, projectId, uploadId, n)).catch((e) => console.warn(`[work] file upload piece delete: ${describeCaughtError(e)}`))
  }
}

export async function purgeExpiredFileUploads(d: { db: PrismaClient; deletePrefix(region: string, prefix: string): Promise<void>; now?: Date; limit?: number }): Promise<number> {
  const now = d.now ?? new Date()
  const rows = await d.db.workFileUpload.findMany({ where: { OR: [{ expiresAt: { lt: now } }, { state: 'done', createdAt: { lt: new Date(now.getTime() - FILE_UPLOAD_TTL_MS) } }] }, select: { id: true, userId: true, projectId: true, region: true }, take: d.limit ?? 200 })
  let n = 0
  for (const r of rows) {
    try {
      await d.deletePrefix(r.region, fileUploadPrefix(r.userId, r.projectId, r.id))
      await d.db.workFileUpload.delete({ where: { id: r.id } })
      n++
    } catch (e) {
      console.warn(`[CLEANUP] file upload ${r.id}: ${describeCaughtError(e)}`)
    }
  }
  return n
}

