
import { FORM_FILE_COLUMN, FORM_MORE_FILES_COLUMN } from './myforms'
import crypto from 'crypto'
import { Prisma, type PrismaClient, type WorkFile } from '@prisma/client'
import { decryptBuffer, encryptBuffer } from '@/lib/encryption'
import { decryptJson, encryptJson } from './sealed'
import { blobRef } from '@/lib/managed/blob-storage'
import { describeCaughtError } from '@/lib/log-mask'
import { WorkError } from './errors'
import { actorLabel, assertProjectWritable, lockProjectForWrite, lockTaskForWrite, type SheetActor, type WorkSheetDeps } from './sheet-gate'
import { findTemplate, templateFileColumns, templateId } from './sheet-templates'
import { writeWorkEvent } from './projects'
import { isSelfHosted } from '@/lib/edition'
import { LOCAL_REGION } from '@/lib/file-store'

export const WORK_FILE_MAX_BYTES = 20 * 1024 * 1024
export type WorkFileKind = 'receipt' | 'bank_csv' | 'report' | 'page_image' | 'invoice' | 'other'
const KINDS: ReadonlySet<string> = new Set(['receipt', 'bank_csv', 'report', 'page_image', 'invoice', 'other'])
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
  'application/xml',
  'text/xml',
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
    case 'text/plain':
    case 'application/xml':
    case 'text/xml': return !b.includes(0)
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

export const workStorageRegion = (db: PrismaClient, userId: string) => managedRegion(db, userId)

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
  maxBytes?: number
}

export interface PreparedWorkFile {
  userId: string
  projectId: string
  kind: WorkFileKind
  mimeType: string
  sizeBytes: number
  sha256: string
  region: string
  blobPath: string
  originalName: string
  parentFileId: string | null
}

export async function prepareProjectFile(deps: WorkFileDeps, input: SaveWorkFileInput): Promise<{ existing: WorkFile } | { prepared: PreparedWorkFile }> {
  const { db, blob } = deps
  const { userId, projectId, buffer } = input
  if (!KINDS.has(input.kind)) throw new WorkError('INVALID', 'unknown file kind')
  const mimeType = input.mimeType.split(';')[0].trim().toLowerCase()
  if (buffer.length > (input.maxBytes ?? WORK_FILE_MAX_BYTES)) throw new WorkError('INVALID', 'file too large')
  if (buffer.length === 0 || !ALLOWED_MIME.has(mimeType) || !looksLike(mimeType, buffer)) throw new WorkError('INVALID', 'file type not accepted')

  const project = await db.workProject.findFirst({ where: { id: projectId, userId }, select: { status: true, workflowId: true, workflowLinkedAt: true } })
  if (!project) throw new WorkError('NOT_FOUND')
  assertProjectWritable(project)

  const sha256 = sha256Hex(buffer)
  const existing = await db.workFile.findUnique({ where: { projectId_sha256: { projectId, sha256 } } })
  if (existing) return { existing }

  if (input.parentFileId != null) {
    const parent = await db.workFile.findFirst({ where: { id: input.parentFileId, projectId, userId }, select: { id: true, parentFileId: true } })
    if (!parent) throw new WorkError('NOT_FOUND')
    if (parent.parentFileId !== null) throw new WorkError('INVALID', 'a derived file cannot have derived files')
  }

  const region = await managedRegion(db, userId)
  const key = await deps.dataKey(db, userId)
  const blobPath = workFileBlobPath(userId, projectId, sha256)
  await blob.upload(region, blobPath, encryptBuffer(buffer, key), 'application/octet-stream')
  return {
    prepared: {
      userId, projectId, kind: input.kind, mimeType, sizeBytes: buffer.length, sha256, region, blobPath,
      originalName: input.originalName, parentFileId: input.parentFileId ?? null,
    },
  }
}

export async function insertPreparedFile(tx: Prisma.TransactionClient, key: Buffer, p: PreparedWorkFile, actor: SheetActor): Promise<{ file: WorkFile; created: boolean }> {
  const had = await tx.workFile.findUnique({ where: { projectId_sha256: { projectId: p.projectId, sha256: p.sha256 } } })
  if (had) return { file: had, created: false }
  const file = await tx.workFile.create({
    data: {
      projectId: p.projectId, userId: p.userId, kind: p.kind, parentFileId: p.parentFileId,
      blobRegion: p.region, blobPath: p.blobPath, mimeType: p.mimeType, sizeBytes: p.sizeBytes, sha256: p.sha256,
      payload: encryptJson({ originalName: p.originalName }, key),
    },
  })
  await writeWorkEvent(tx, key, { userId: p.userId, projectId: p.projectId, fileId: file.id, actor, action: 'file_upload' })
  return { file, created: true }
}

export async function discardPreparedFile(deps: Pick<WorkFileDeps, 'blob'>, p: PreparedWorkFile): Promise<void> {
  try {
    await deps.blob.delete(p.region, p.blobPath)
  } catch (cleanupError) {
    console.error(`[work] 보상 삭제 실패 — 고아 blob ${blobRef(p.blobPath)}:`, describeCaughtError(cleanupError))
  }
}

export async function saveProjectFile(deps: WorkFileDeps, input: SaveWorkFileInput): Promise<{ file: WorkFile; created: boolean }> {
  const r = await prepareProjectFile(deps, input)
  if ('existing' in r) return { file: r.existing, created: false }
  const p = r.prepared
  try {
    const key = await deps.dataKey(deps.db, input.userId)
    const out = await deps.db.$transaction(async (tx) => {
      assertProjectWritable(await lockProjectForWrite(tx, input.userId, input.projectId))
      return insertPreparedFile(tx, key, p, input.actor)
    }, { timeout: TX_TIMEOUT_MS })
    if (!out.created) await discardPreparedFile(deps, p)
    return out
  } catch (error) {
    await discardPreparedFile(deps, p)
    throw error
  }
}

export async function readProjectFile(deps: WorkFileDeps, input: { userId: string; fileId: string; actor: SheetActor; mergeReadMs?: number }) {
  const { db } = deps
  const file = await db.workFile.findFirst({ where: { id: input.fileId, userId: input.userId } })
  if (!file) throw new WorkError('NOT_FOUND')
  const key = await deps.dataKey(db, input.userId)
  const { buffer: sealed } = await deps.blob.download(file.blobRegion, file.blobPath)
  const buffer = decryptBuffer(sealed, key)
  if (buffer.length !== file.sizeBytes || sha256Hex(buffer) !== file.sha256) throw new WorkError('INTEGRITY')
  const { originalName } = decryptJson<{ originalName: string }>(file.payload, key)
  await db.$transaction(async (tx) => {
    if (input.mergeReadMs) {
      const since = new Date(Date.now() - input.mergeReadMs)
      const recent = await tx.workEvent.findFirst({ where: { userId: input.userId, fileId: file.id, action: 'file_read', actor: actorLabel(input.actor), createdAt: { gte: since } }, select: { id: true } })
      if (recent) return
    }
    await writeWorkEvent(tx, key, { userId: input.userId, projectId: file.projectId, fileId: file.id, actor: input.actor, action: 'file_read' })
  })
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
  lockReason?: 'proof' | 'record'
  reported?: number
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
  const record = new Set<string>()
  const sheets = await deps.db.dataSheet.findMany({ where: { kind: 'project', projectId: q.projectId, userId: q.userId, template: { not: null } }, select: { id: true, template: true } })
  for (const sh of sheets) {
    for (const col of deps.templates.find((t) => templateId(t) === sh.template)?.recordFiles ?? []) {
      const hits = await deps.db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT DISTINCT (row_data::jsonb ->> ${col}) AS id FROM data_sheet_rows
        WHERE sheet_id = ${sh.id} AND project_id = ${q.projectId} AND user_id = ${q.userId} AND kind = 'project'
          AND (row_data::jsonb ->> ${col}) IN (${Prisma.join(ids)})`)
      for (const h of hits) if (h.id) record.add(h.id)
    }
  }
  const key = await deps.dataKey(deps.db, q.userId)
  const { openReportNumbers } = await import('./reports')
  const reported = isSelfHosted() ? new Map<string, number>() : await openReportNumbers(deps.db, { userId: q.userId, fileIds: ids })
  return files.map((f) => ({
    id: f.id,
    name: decryptJson<{ originalName: string }>(f.payload, key).originalName,
    mimeType: f.mimeType,
    kind: f.kind,
    sizeBytes: f.sizeBytes,
    uploadedAt: f.uploadedAt.toISOString(),
    pages: f._count.derived,
    locked: locked.has(f.id) || record.has(f.id),
    ...(locked.has(f.id) ? { lockReason: 'proof' as const } : record.has(f.id) ? { lockReason: 'record' as const } : {}),
    ...(reported.has(f.id) ? { reported: reported.get(f.id) } : {}),
  }))
}

async function rowsPointingTo(tx: Prisma.TransactionClient, deps: WorkFileDeps, userId: string, projectId: string, fileIds: string[]): Promise<boolean> {
  const sheets = await tx.dataSheet.findMany({ where: { kind: 'project', projectId, userId, template: { not: null } }, select: { id: true, template: true } })
  const formSheets = await tx.workForm.findMany({ where: { projectId, userId }, select: { sheetId: true } })
  if (formSheets.length) {
    const hit = await tx.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
      SELECT COUNT(*) AS n FROM data_sheet_rows
      WHERE sheet_id IN (${Prisma.join(formSheets.map((f) => f.sheetId))}) AND project_id = ${projectId} AND user_id = ${userId} AND kind = 'project'
        AND ((row_data::jsonb ->> ${FORM_FILE_COLUMN}) IN (${Prisma.join(fileIds)}) OR string_to_array(row_data::jsonb ->> ${FORM_MORE_FILES_COLUMN}, ',') && ARRAY[${Prisma.join(fileIds)}]::text[])`)
    if (Number(hit[0]?.n ?? 0) > 0) return true
  }
  const asm = await tx.workProject.findFirst({ where: { id: projectId, userId, kind: 'assembled' }, select: { id: true } })
  if (asm) {
    const { readSpec, specSheetName, docFileColumn } = await import('./assembled')
    const spec = (await readSpec(tx, await deps.dataKey(deps.db, userId), { userId, projectId }))?.spec
    if (spec?.tables.some((t) => t.docs?.some((d) => !d.hidden && d.letterhead && fileIds.includes(d.letterhead.file)))) return true
    for (const t of spec?.tables ?? []) {
      const sh = await tx.dataSheet.findFirst({ where: { kind: 'project', projectId, userId, template: null, name: specSheetName(t.key) }, select: { id: true } })
      if (!sh) continue
      const cols = [FORM_FILE_COLUMN, ...(t.docs ?? []).filter((d) => !d.hidden).map((d) => docFileColumn(d.key))]
      const one = Prisma.join(cols.map((c) => Prisma.sql`(row_data::jsonb ->> ${c}) IN (${Prisma.join(fileIds)})`), ' OR ')
      const hit = await tx.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
        SELECT COUNT(*) AS n FROM data_sheet_rows
        WHERE sheet_id = ${sh.id} AND project_id = ${projectId} AND user_id = ${userId} AND kind = 'project'
          AND (${one} OR string_to_array(row_data::jsonb ->> ${FORM_MORE_FILES_COLUMN}, ',') && ARRAY[${Prisma.join(fileIds)}]::text[])`)
      if (Number(hit[0]?.n ?? 0) > 0) return true
    }
  }
  for (const s of sheets) {
    for (const col of templateFileColumns(findTemplate(deps.templates, s.template!))) {
      const hit = await tx.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
        SELECT COUNT(*) AS n FROM data_sheet_rows
        WHERE sheet_id = ${s.id} AND project_id = ${projectId} AND user_id = ${userId} AND kind = 'project'
          AND (row_data::jsonb ->> ${col}) IN (${Prisma.join(fileIds)})`)
      if (Number(hit[0]?.n ?? 0) > 0) return true
    }
    const more = findTemplate(deps.templates, s.template!).ui?.moreFiles
    if (more) {
      const hit = await tx.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
        SELECT COUNT(*) AS n FROM data_sheet_rows
        WHERE sheet_id = ${s.id} AND project_id = ${projectId} AND user_id = ${userId} AND kind = 'project'
          AND string_to_array(row_data::jsonb ->> ${more}, ',') && ARRAY[${Prisma.join(fileIds)}]::text[]`)
      if (Number(hit[0]?.n ?? 0) > 0) return true
    }
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
    return removeFileInTx(tx, deps, key, { userId: input.userId, projectId: f.projectId, fileId: input.fileId, actor: input.actor })
  }, { timeout: TX_TIMEOUT_MS })
  return deleteFileBlobs(deps, blobs)
}

export async function removeFileInTx(tx: Prisma.TransactionClient, deps: WorkFileDeps, key: Buffer, input: { userId: string; projectId: string; fileId: string; actor: SheetActor }) {
  const files = await tx.workFile.findMany({
    where: { projectId: input.projectId, OR: [{ id: input.fileId }, { parentFileId: input.fileId }] },
    select: { id: true, blobRegion: true, blobPath: true },
  })
  if (!files.some((x) => x.id === input.fileId)) throw new WorkError('NOT_FOUND')
  const ids = files.map((x) => x.id)
  const lockedUse = await tx.workTaskFile.count({ where: { fileId: { in: ids }, task: { status: { in: ['submitted', 'awaiting'] } } } })
  const proofs = await tx.workSubmissionFile.count({ where: { fileId: { in: ids } } })
  if (lockedUse > 0 || proofs > 0) throw new WorkError('LOCKED')
  if (await rowsPointingTo(tx, deps, input.userId, input.projectId, ids)) throw new WorkError('IN_USE')
  await tx.workTaskFile.deleteMany({ where: { fileId: { in: ids } } })
  await tx.workFile.delete({ where: { id: input.fileId } })
  await writeWorkEvent(tx, key, { userId: input.userId, projectId: input.projectId, fileId: input.fileId, actor: input.actor, action: 'file_delete', detail: { derived: ids.length - 1 } })
  return files
}

export async function deleteFileBlobs(deps: WorkFileDeps, blobs: ReadonlyArray<{ blobRegion: string; blobPath: string }>): Promise<{ blobErrors: number }> {
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
