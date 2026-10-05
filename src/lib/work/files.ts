
import crypto from 'crypto'
import { Prisma, type PrismaClient, type WorkFile } from '@prisma/client'
import { decryptBuffer, encryptBuffer } from '@/lib/encryption'
import { decryptJson, encryptJson } from './sealed'
import { blobRef } from '@/lib/managed/blob-storage'
import { describeCaughtError } from '@/lib/log-mask'
import { WorkError } from './errors'
import { assertProjectWritable, lockProjectForWrite, lockTaskForWrite, type SheetActor, type WorkSheetDeps } from './sheet-gate'
import { findTemplate } from './sheet-templates'
import { writeWorkEvent } from './projects'
import { isSelfHosted } from '@/lib/edition'
import { LOCAL_REGION } from '@/lib/file-store'

export const WORK_FILE_MAX_BYTES = 20 * 1024 * 1024
export type WorkFileKind = 'receipt' | 'bank_csv' | 'report' | 'page_image' | 'other'
const KINDS: ReadonlySet<string> = new Set(['receipt', 'bank_csv', 'report', 'page_image', 'other'])
const TX_TIMEOUT_MS = 30_000

export interface WorkBlobStore {
  upload(regionId: string, blobPath: string, buf: Buffer, mimeType: string): Promise<unknown>
  download(regionId: string, blobPath: string): Promise<{ buffer: Buffer }>
  delete(regionId: string, blobPath: string): Promise<void>
}

export interface WorkFileDeps extends WorkSheetDeps {
  blob: WorkBlobStore
}

export const ALLOWED_MIME: ReadonlySet<string> = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'text/csv',
  'text/plain',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])

const HEIC_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1'])

export function looksLike(mime: string, b: Buffer): boolean {
  const head = (n: number) => b.subarray(0, n)
  switch (mime) {
    case 'application/pdf': return head(1024).includes('%PDF-')
    case 'image/jpeg': return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
    case 'image/png': return head(8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    case 'image/webp': return head(4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP'
    case 'image/heic': return b.subarray(4, 8).toString('latin1') === 'ftyp' && HEIC_BRANDS.has(b.subarray(8, 12).toString('latin1'))
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      return head(4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) && b.includes('[Content_Types].xml') && b.includes('xl/workbook')
    case 'text/csv':
    case 'text/plain': return !b.includes(0)
    default: return false
  }
}

export function sha256Hex(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

export async function defaultWorkFileDeps(): Promise<WorkFileDeps> {
  const [{ defaultWorkSheetDeps }, blob] = await Promise.all([import('./sheet-gate'), import('@/lib/managed/blob-storage')])
  return { ...(await defaultWorkSheetDeps()), blob: { upload: blob.uploadToBlob, download: blob.downloadFromBlob, delete: blob.deleteFromBlob } }
}

export function workFileBlobPath(userId: string, projectId: string, sha256: string, now = new Date()): string {
  const date = now.toISOString().slice(0, 10)
  const rand = crypto.randomBytes(4).readUInt32BE(0).toString(36).padStart(6, '0').slice(-6)
  return `${userId}/project/${projectId}/file/${date}_${rand}_${sha256.slice(0, 8)}.bin`
}

async function managedRegion(db: PrismaClient, userId: string): Promise<string> {
  if (isSelfHosted()) return LOCAL_REGION
  const sub = await db.subscription.findUnique({ where: { id: userId }, select: { managedRegion: true } }) // Subscription.id = userId
  if (!sub?.managedRegion) throw new WorkError('INVALID', 'the account has no storage region')
  return sub.managedRegion
}

export interface SaveWorkFileInput {
  userId: string
  projectId: string
  kind: WorkFileKind
  originalName: string
  mimeType: string
  buffer: Buffer
  parentFileId?: string | null
  actor: SheetActor
}

export async function saveProjectFile(deps: WorkFileDeps, input: SaveWorkFileInput): Promise<{ file: WorkFile; created: boolean }> {
  const { db, blob } = deps
  const { userId, projectId, buffer } = input
  if (!KINDS.has(input.kind)) throw new WorkError('INVALID', 'unknown file kind')
  const mimeType = input.mimeType.split(';')[0].trim().toLowerCase()
  if (buffer.length > WORK_FILE_MAX_BYTES) throw new WorkError('INVALID', 'file too large')
  if (buffer.length === 0 || !ALLOWED_MIME.has(mimeType) || !looksLike(mimeType, buffer)) throw new WorkError('INVALID', 'file type not accepted')

  const project = await db.workProject.findFirst({ where: { id: projectId, userId }, select: { status: true, workflowId: true, workflowLinkedAt: true } })
  if (!project) throw new WorkError('NOT_FOUND')
  assertProjectWritable(project)

  const sha256 = sha256Hex(buffer)
  const existing = await db.workFile.findUnique({ where: { projectId_sha256: { projectId, sha256 } } })
  if (existing) return { file: existing, created: false }

  if (input.parentFileId != null) {
    const parent = await db.workFile.findFirst({ where: { id: input.parentFileId, projectId, userId }, select: { id: true, parentFileId: true } })
    if (!parent) throw new WorkError('NOT_FOUND')
    if (parent.parentFileId !== null) throw new WorkError('INVALID', 'a derived file cannot have derived files')
  }

  const region = await managedRegion(db, userId)
  const key = await deps.dataKey(db, userId)
  const blobPath = workFileBlobPath(userId, projectId, sha256)
  await blob.upload(region, blobPath, encryptBuffer(buffer, key), 'application/octet-stream')

  try {
    const file = await db.$transaction(async (tx) => {
      assertProjectWritable(await lockProjectForWrite(tx, userId, projectId))
      const f = await tx.workFile.create({
        data: {
          projectId, userId, kind: input.kind, parentFileId: input.parentFileId ?? null,
          blobRegion: region, blobPath, mimeType, sizeBytes: buffer.length, sha256,
          payload: encryptJson({ originalName: input.originalName }, key),
        },
      })
      await writeWorkEvent(tx, key, { userId, projectId, fileId: f.id, actor: input.actor, action: 'file_upload' })
      return f
    }, { timeout: TX_TIMEOUT_MS })
    return { file, created: true }
  } catch (error) {
    try {
      await blob.delete(region, blobPath)
    } catch (cleanupError) {
      console.error(`[work] 보상 삭제 실패 — 고아 blob ${blobRef(blobPath)}:`, describeCaughtError(cleanupError))
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const winner = await db.workFile.findUnique({ where: { projectId_sha256: { projectId, sha256 } } })
      if (winner) return { file: winner, created: false }
    }
    throw error
  }
}

export async function readProjectFile(deps: WorkFileDeps, input: { userId: string; fileId: string; actor: SheetActor }) {
  const { db } = deps
  const file = await db.workFile.findFirst({ where: { id: input.fileId, userId: input.userId } })
  if (!file) throw new WorkError('NOT_FOUND')
  const key = await deps.dataKey(db, input.userId)
  const { buffer: sealed } = await deps.blob.download(file.blobRegion, file.blobPath)
  const buffer = decryptBuffer(sealed, key)
  if (buffer.length !== file.sizeBytes || sha256Hex(buffer) !== file.sha256) throw new WorkError('INTEGRITY')
  const { originalName } = decryptJson<{ originalName: string }>(file.payload, key)
  await db.$transaction((tx) => writeWorkEvent(tx, key, { userId: input.userId, projectId: file.projectId, fileId: file.id, actor: input.actor, action: 'file_read' }))
  return { file, buffer, originalName }
}

async function taskProject(db: PrismaClient, userId: string, taskId: string): Promise<string> {
  const t = await db.workTask.findFirst({ where: { id: taskId, userId }, select: { projectId: true } })
  if (!t) throw new WorkError('NOT_FOUND')
  return t.projectId
}

export async function attachFileToTask(deps: WorkFileDeps, input: { userId: string; taskId: string; fileId: string; actor: SheetActor }) {
  const projectId = await taskProject(deps.db, input.userId, input.taskId)
  const key = await deps.dataKey(deps.db, input.userId)
  await deps.db.$transaction(async (tx) => {
    assertProjectWritable(await lockProjectForWrite(tx, input.userId, projectId))
    const task = await lockTaskForWrite(tx, input.userId, projectId, input.taskId)
    if (task.status !== 'open') throw new WorkError('LOCKED')
    const file = await tx.workFile.findFirst({ where: { id: input.fileId, projectId, userId: input.userId }, select: { id: true } })
    if (!file) throw new WorkError('NOT_FOUND')
    const had = await tx.workTaskFile.findUnique({ where: { taskId_fileId: { taskId: input.taskId, fileId: input.fileId } } })
    if (had) return
    await tx.workTaskFile.create({ data: { taskId: input.taskId, fileId: input.fileId, projectId, userId: input.userId } })
    await writeWorkEvent(tx, key, { userId: input.userId, projectId, taskId: input.taskId, fileId: input.fileId, actor: input.actor, action: 'file_attach' })
  }, { timeout: TX_TIMEOUT_MS })
}

export async function detachFileFromTask(deps: WorkFileDeps, input: { userId: string; taskId: string; fileId: string; actor: SheetActor }) {
  const projectId = await taskProject(deps.db, input.userId, input.taskId)
  const key = await deps.dataKey(deps.db, input.userId)
  await deps.db.$transaction(async (tx) => {
    assertProjectWritable(await lockProjectForWrite(tx, input.userId, projectId))
    const task = await lockTaskForWrite(tx, input.userId, projectId, input.taskId)
    if (task.status !== 'open') throw new WorkError('LOCKED')
    const n = await tx.workTaskFile.deleteMany({ where: { taskId: input.taskId, fileId: input.fileId } })
    if (n.count === 0) throw new WorkError('NOT_FOUND')
    await writeWorkEvent(tx, key, { userId: input.userId, projectId, taskId: input.taskId, fileId: input.fileId, actor: input.actor, action: 'file_detach' })
  }, { timeout: TX_TIMEOUT_MS })
}

export async function attachSubmissionProof(deps: WorkFileDeps, input: { userId: string; taskId: string; fileId: string; actor: SheetActor }) {
  const projectId = await taskProject(deps.db, input.userId, input.taskId)
  const key = await deps.dataKey(deps.db, input.userId)
  await deps.db.$transaction(async (tx) => {
    assertProjectWritable(await lockProjectForWrite(tx, input.userId, projectId))
    const task = await lockTaskForWrite(tx, input.userId, projectId, input.taskId)
    if (task.status !== 'submitted') throw new WorkError('INVALID', 'proof can only be added to a submitted task')
    const row = await tx.workTask.findUniqueOrThrow({ where: { id: input.taskId }, select: { currentSubmissionId: true } })
    if (!row.currentSubmissionId) throw new WorkError('INVALID', 'the task has no submission')
    const file = await tx.workFile.findFirst({ where: { id: input.fileId, projectId, userId: input.userId }, select: { id: true } })
    if (!file) throw new WorkError('NOT_FOUND')
    const had = await tx.workSubmissionFile.findUnique({ where: { submissionId_fileId: { submissionId: row.currentSubmissionId, fileId: input.fileId } } })
    if (had) return
    await tx.workSubmissionFile.create({ data: { submissionId: row.currentSubmissionId, fileId: input.fileId, projectId, userId: input.userId } })
    await writeWorkEvent(tx, key, { userId: input.userId, projectId, taskId: input.taskId, submissionId: row.currentSubmissionId, fileId: input.fileId, actor: input.actor, action: 'file_proof' })
  }, { timeout: TX_TIMEOUT_MS })
}

export async function detachSubmissionProof(deps: WorkFileDeps, input: { userId: string; taskId: string; fileId: string; actor: SheetActor }) {
  const projectId = await taskProject(deps.db, input.userId, input.taskId)
  const key = await deps.dataKey(deps.db, input.userId)
  await deps.db.$transaction(async (tx) => {
    assertProjectWritable(await lockProjectForWrite(tx, input.userId, projectId))
    const task = await lockTaskForWrite(tx, input.userId, projectId, input.taskId)
    if (task.status !== 'submitted') throw new WorkError('INVALID', 'proof can only be changed on a submitted task')
    const row = await tx.workTask.findUniqueOrThrow({ where: { id: input.taskId }, select: { currentSubmissionId: true } })
    if (!row.currentSubmissionId) throw new WorkError('INVALID', 'the task has no submission')
    const gone = await tx.workSubmissionFile.deleteMany({ where: { submissionId: row.currentSubmissionId, fileId: input.fileId, projectId, userId: input.userId } })
    if (gone.count === 0) return
    await writeWorkEvent(tx, key, { userId: input.userId, projectId, taskId: input.taskId, submissionId: row.currentSubmissionId, fileId: input.fileId, actor: input.actor, action: 'file_proof_remove' })
  }, { timeout: TX_TIMEOUT_MS })
}

export interface ProjectFileView {
  id: string
  name: string
  mimeType: string
  kind: string
  sizeBytes: number
  uploadedAt: string
  pages: number
  locked: boolean
}

export async function listProjectFiles(deps: WorkFileDeps, q: { userId: string; projectId: string }): Promise<ProjectFileView[]> {
  const files = await deps.db.workFile.findMany({
    where: { projectId: q.projectId, userId: q.userId, parentFileId: null },
    select: { id: true, mimeType: true, kind: true, sizeBytes: true, uploadedAt: true, payload: true, _count: { select: { derived: true, proofs: true } } },
    orderBy: [{ uploadedAt: 'desc' }, { id: 'desc' }],
  })
  if (files.length === 0) return []
  const ids = files.map((f) => f.id)
  const lockedRows = await deps.db.workFile.findMany({
    where: {
      projectId: q.projectId, userId: q.userId,
      OR: [{ id: { in: ids } }, { parentFileId: { in: ids } }],
      AND: [{ OR: [{ proofs: { some: {} } }, { tasks: { some: { task: { status: { in: ['submitted', 'awaiting'] } } } } }] }],
    },
    select: { id: true, parentFileId: true },
  })
  const locked = new Set(lockedRows.map((r) => r.parentFileId ?? r.id))
  const key = await deps.dataKey(deps.db, q.userId)
  return files.map((f) => ({
    id: f.id,
    name: decryptJson<{ originalName: string }>(f.payload, key).originalName,
    mimeType: f.mimeType,
    kind: f.kind,
    sizeBytes: f.sizeBytes,
    uploadedAt: f.uploadedAt.toISOString(),
    pages: f._count.derived,
    locked: locked.has(f.id),
  }))
}

async function rowsPointingTo(tx: Prisma.TransactionClient, deps: WorkFileDeps, userId: string, projectId: string, fileIds: string[]): Promise<boolean> {
  const sheets = await tx.dataSheet.findMany({ where: { kind: 'project', projectId, userId, template: { not: null } }, select: { id: true, template: true } })
  for (const s of sheets) {
    const col = findTemplate(deps.templates, s.template!).ui?.file
    if (!col) continue
    const hit = await tx.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
      SELECT COUNT(*) AS n FROM data_sheet_rows
      WHERE sheet_id = ${s.id} AND project_id = ${projectId} AND user_id = ${userId} AND kind = 'project'
        AND (row_data::jsonb ->> ${col}) IN (${Prisma.join(fileIds)})`)
    if (Number(hit[0]?.n ?? 0) > 0) return true
  }
  return false
}

export async function deleteProjectFile(deps: WorkFileDeps, input: { userId: string; fileId: string; actor: SheetActor }): Promise<{ blobErrors: number }> {
  if (input.actor.type !== 'human') throw new WorkError('FORBIDDEN', 'only a person can delete files')
  const f = await deps.db.workFile.findFirst({ where: { id: input.fileId, userId: input.userId }, select: { projectId: true } })
  if (!f) throw new WorkError('NOT_FOUND')
  const key = await deps.dataKey(deps.db, input.userId)
  const blobs = await deps.db.$transaction(async (tx) => {
    assertProjectWritable(await lockProjectForWrite(tx, input.userId, f.projectId))
    const files = await tx.workFile.findMany({
      where: { projectId: f.projectId, OR: [{ id: input.fileId }, { parentFileId: input.fileId }] },
      select: { id: true, blobRegion: true, blobPath: true },
    })
    if (!files.some((x) => x.id === input.fileId)) throw new WorkError('NOT_FOUND')
    const ids = files.map((x) => x.id)
    const lockedUse = await tx.workTaskFile.count({ where: { fileId: { in: ids }, task: { status: { in: ['submitted', 'awaiting'] } } } })
    const proofs = await tx.workSubmissionFile.count({ where: { fileId: { in: ids } } })
    if (lockedUse > 0 || proofs > 0) throw new WorkError('LOCKED')
    if (await rowsPointingTo(tx, deps, input.userId, f.projectId, ids)) throw new WorkError('IN_USE')
    await tx.workTaskFile.deleteMany({ where: { fileId: { in: ids } } })
    await tx.workFile.delete({ where: { id: input.fileId } })
    await writeWorkEvent(tx, key, { userId: input.userId, projectId: f.projectId, fileId: input.fileId, actor: input.actor, action: 'file_delete', detail: { derived: ids.length - 1 } })
    return files
  }, { timeout: TX_TIMEOUT_MS })
  let blobErrors = 0
  for (const b of blobs) {
    try {
      await deps.blob.delete(b.blobRegion, b.blobPath)
    } catch (e) {
      blobErrors++
      console.error(`[work] 파일 Blob 삭제 실패 ${blobRef(b.blobPath)}:`, describeCaughtError(e))
    }
  }
  return { blobErrors }
}
