
import { createHash, createHmac, timingSafeEqual } from 'crypto'
import { Prisma, PrismaClient } from '@prisma/client'
import { Unzip, UnzipInflate, strFromU8 } from 'fflate'
import { decryptBuffer, encryptBuffer } from '@/lib/encryption'
import { WorkError } from './errors'
import { decryptJson, encryptJson } from './sealed'
import { BACKUP_FORMAT } from './backup'
import { IMPORT_MAX_BYTES } from './backup-import'
import { BACKUP_FORMAT_V2, CHUNK_MAX_BYTES, PART_MAX_BYTES, backupSignKey } from './backup-parts'
import { describeCaughtError } from '@/lib/log-mask'

export const PIECE_BYTES = 8 * 1024 * 1024
export const UPLOAD_MAX_FILES = 2000
export const PART_MAX_UNZIPPED = 60 * 1024 * 1024
export const PART_MAX_ENTRIES = 20000
export const UPLOAD_TTL_MS = 24 * 3600_000
export const UPLOAD_GRACE_MS = 2 * 3600_000

export const uploadPrefix = (userId: string, uploadId: string) => `${userId}/backup-upload/${uploadId}/`

export interface UploadDeps {
  db: PrismaClient
  region(userId: string): Promise<string>
  upload(region: string, blobPath: string, data: Buffer): Promise<void>
  download(region: string, blobPath: string): Promise<{ buffer: Buffer }>
  deleteBlob?(region: string, blobPath: string): Promise<void>
  now?: () => Date
}

export async function startUpload(deps: UploadDeps, input: { userId: string }): Promise<string> {
  const now = deps.now?.() ?? new Date()
  const region = await deps.region(input.userId)
  const u = await deps.db.workBackupUpload.create({ data: { userId: input.userId, region, expiresAt: new Date(now.getTime() + UPLOAD_TTL_MS) } })
  return u.id
}

type Tx = Prisma.TransactionClient
async function lockUpload(tx: Tx, userId: string, uploadId: string, states: string[], now: Date) {
  const rows = await tx.$queryRaw<Array<{ id: string; state: string; region: string; expires_at: Date }>>`
    SELECT id, state, region, expires_at FROM work_backup_upload WHERE id = ${uploadId} AND user_id = ${userId} FOR UPDATE`
  const u = rows[0]
  if (!u || u.expires_at.getTime() <= now.getTime()) throw new WorkError('NOT_FOUND')
  if (!states.includes(u.state)) throw new WorkError('STALE', `upload is ${u.state}`)
  return u
}

export async function putPiece(deps: UploadDeps, input: { userId: string; uploadId: string; fileIndex: number; offset: number; total: number; data: Buffer; key: Buffer }): Promise<{ received: number; total: number }> {
  const { fileIndex, offset, total, data } = input
  if (!Number.isSafeInteger(fileIndex) || fileIndex < 1 || fileIndex > UPLOAD_MAX_FILES) throw new WorkError('INVALID', 'file number')
  if (!Number.isSafeInteger(total) || total < 1 || total > PART_MAX_BYTES) throw new WorkError('INVALID', 'part size')
  if (!Number.isSafeInteger(offset) || offset < 0 || offset % PIECE_BYTES !== 0 || offset >= total) throw new WorkError('INVALID', 'piece offset')
  if (data.length !== Math.min(PIECE_BYTES, total - offset)) throw new WorkError('INVALID', 'piece length')
  const now = deps.now?.() ?? new Date()
  const sha = createHash('sha256').update(data).digest('hex')
  const up = await deps.db.workBackupUpload.findFirst({ where: { id: input.uploadId, userId: input.userId }, select: { region: true, state: true, expiresAt: true } })
  if (!up || up.expiresAt.getTime() <= now.getTime()) throw new WorkError('NOT_FOUND')
  if (up.state !== 'receiving') throw new WorkError('STALE', `upload is ${up.state}`)
  const region = up.region
  const had0 = await deps.db.workBackupUploadPiece.findUnique({ where: { uploadId_fileIndex_offset: { uploadId: input.uploadId, fileIndex, offset } } })
  if (had0) {
    if (had0.sha256 !== sha) throw new WorkError('INVALID', 'different bytes for the same piece')
    const agg = await deps.db.workBackupUploadPiece.aggregate({ where: { uploadId: input.uploadId, fileIndex }, _sum: { bytes: true } })
    return { received: agg._sum.bytes ?? 0, total }
  }
  const path = `${uploadPrefix(input.userId, input.uploadId)}p${fileIndex}/${offset}-${sha.slice(0, 16)}.bin`
  await deps.upload(region, path, encryptBuffer(data, input.key))
  let wrote = false
  try {
    const r = await deps.db.$transaction(async (tx) => {
      await lockUpload(tx, input.userId, input.uploadId, ['receiving'], now)
      const f = await tx.workBackupUploadFile.findUnique({ where: { uploadId_fileIndex: { uploadId: input.uploadId, fileIndex } } })
      if (f && f.totalBytes !== total) throw new WorkError('INVALID', 'part size changed')
      if (!f) {
        if ((await tx.workBackupUploadFile.count({ where: { uploadId: input.uploadId } })) >= UPLOAD_MAX_FILES) throw new WorkError('INVALID', 'too many files')
        await tx.workBackupUploadFile.create({ data: { uploadId: input.uploadId, fileIndex, totalBytes: total } })
      }
      const had = await tx.workBackupUploadPiece.findUnique({ where: { uploadId_fileIndex_offset: { uploadId: input.uploadId, fileIndex, offset } } })
      if (had) {
        if (had.sha256 !== sha) throw new WorkError('INVALID', 'different bytes for the same piece')
      } else {
        await tx.workBackupUploadPiece.create({ data: { uploadId: input.uploadId, fileIndex, offset, bytes: data.length, sha256: sha, path } })
        wrote = true
      }
      const agg = await tx.workBackupUploadPiece.aggregate({ where: { uploadId: input.uploadId, fileIndex }, _sum: { bytes: true } })
      return { received: agg._sum.bytes ?? 0, total }
    })
    return r
  } finally {
    if (!wrote && deps.deleteBlob) {
      let kept: unknown = 'unknown'
      try { kept = await deps.db.workBackupUploadPiece.findFirst({ where: { uploadId: input.uploadId, path }, select: { path: true } }) } catch { }
      if (kept === null) await deps.deleteBlob(region, path).catch((e) => console.error('[work-backup] 조각 지우기 실패:', describeCaughtError(e)))
    }
  }
}

export type UploadProblem =
  | { code: 'FILE_INCOMPLETE'; file: number }
  | { code: 'NOT_A_BACKUP'; file: number }
  | { code: 'BROKEN_ZIP'; file: number }
  | { code: 'TOO_LARGE'; file: number }
  | { code: 'MIXED_FORMATS' }
  | { code: 'UNKNOWN_FORMAT' }
  | { code: 'OLD_FORMAT_TOO_LARGE' }
  | { code: 'NO_FIRST_PART' }
  | { code: 'OTHER_SET'; file: number }
  | { code: 'PART_DUPLICATE'; part: number }
  | { code: 'PART_OUT_OF_RANGE'; file: number; part: number }
  | { code: 'PART_MISSING'; parts: number[] }
  | { code: 'ITEM_MISSING'; count: number }
  | { code: 'ITEM_CHANGED'; count: number }
  | { code: 'ITEM_UNKNOWN'; count: number }
  | { code: 'ITEM_DUPLICATE'; count: number }
  | { code: 'MANIFEST_SHAPE' }
  | { code: 'HEAD_MISPLACED'; file: number }

export interface UploadReport {
  ok: boolean
  format: 1 | 2 | null
  setId: string | null
  partCount: number | null
  partOf: Record<number, number>
  problems: UploadProblem[]
  signatureValid: boolean
  sameAccount: boolean
  appName: string | null
  scope: string | null
  files: number
  fileBytes: number
  checkedAt: string
}

interface Entry { name: string; bytes: number; sha256: string }
interface IndexItem { entry: string; bytes: number; sha256: string }
interface IndexChunk { sha256: string; items: IndexItem[] | null }
interface PartRead { file: number; entries: Entry[]; small: Record<string, Uint8Array>; index: Map<string, IndexChunk>; problem?: UploadProblem }

export const SET_MAX_ITEMS = 2_000_000
export const SET_MAX_HEAD_BYTES = CHUNK_MAX_BYTES + 16 * 1024 * 1024
const HEAD_NAMES = new Set(['manifest.json', 'signature.json', 'part.json'])
const INDEX_RE = /^data\/files-\d{4}\.json$/
const FILE_ENTRY_RE = /^files\/[A-Za-z0-9_-]{1,40}\/[^/]+$/
const HEX64 = /^[0-9a-f]{64}$/

function parseIndex(b: Buffer): IndexItem[] | null {
  let list: unknown
  try { list = JSON.parse(b.toString('utf8')) } catch { return null }
  if (!Array.isArray(list)) return null
  const out: IndexItem[] = []
  for (const f of list as Array<Record<string, unknown>>) {
    if (!f || typeof f !== 'object' || typeof f.entry !== 'string' || !FILE_ENTRY_RE.test(f.entry) || !Number.isSafeInteger(f.bytes) || (f.bytes as number) < 0 || typeof f.sha256 !== 'string' || !HEX64.test(f.sha256)) return null
    out.push({ entry: f.entry, bytes: f.bytes as number, sha256: f.sha256 })
  }
  return out
}

async function readPart(deps: UploadDeps, key: Buffer, region: string, file: number, pieces: Array<{ path: string }>, budget: { items: number; headBytes: number }): Promise<PartRead> {
  const out: PartRead = { file, entries: [], small: {}, index: new Map() }
  let total = 0
  let count = 0
  let open = 0
  const names = new Set<string>()
  const uz = new Unzip()
  uz.register(UnzipInflate)
  uz.onfile = (f) => {
    if (++count > PART_MAX_ENTRIES || ++budget.items > SET_MAX_ITEMS) throw new WorkError('INVALID', 'TOO_LARGE')
    if (names.has(f.name)) throw new WorkError('INVALID', 'DUPLICATE')
    names.add(f.name)
    const h = createHash('sha256')
    let n = 0
    const head = HEAD_NAMES.has(f.name)
    const isIndex = INDEX_RE.test(f.name)
    const cap = f.name === 'manifest.json' || isIndex ? CHUNK_MAX_BYTES : 4 * 1024
    const keep: Uint8Array[] | null = head || isIndex ? [] : null
    open++
    f.ondata = (err, d, final) => {
      if (err) throw err
      n += d.length
      total += d.length
      if (total > PART_MAX_UNZIPPED) throw new WorkError('INVALID', 'TOO_LARGE')
      if (keep) {
        if (n > cap) throw new WorkError('INVALID', 'TOO_LARGE')
        if (head && (budget.headBytes += d.length) > SET_MAX_HEAD_BYTES) throw new WorkError('INVALID', 'TOO_LARGE')
        keep.push(d)
      }
      h.update(d)
      if (final) {
        open--
        const sha256 = h.digest('hex')
        out.entries.push({ name: f.name, bytes: n, sha256 })
        if (head) out.small[f.name] = Buffer.concat(keep!)
        if (isIndex) {
          const items = parseIndex(Buffer.concat(keep!))
          budget.items += items?.length ?? 0
          if (budget.items > SET_MAX_ITEMS) throw new WorkError('INVALID', 'TOO_LARGE')
          out.index.set(f.name, { sha256, items })
        }
      }
    }
    f.start()
  }
  try {
    for (let i = 0; i < pieces.length; i++) {
      const { buffer } = await deps.download(region, pieces[i].path)
      const buf = decryptBuffer(buffer, key)
      const STEP = 64 * 1024
      for (let o = 0; o < buf.length; o += STEP) uz.push(buf.subarray(o, Math.min(buf.length, o + STEP)), i === pieces.length - 1 && o + STEP >= buf.length)
    }
  } catch (e) {
    if (e instanceof WorkError && e.detail === 'TOO_LARGE') return { ...out, problem: { code: 'TOO_LARGE', file } }
    return { ...out, problem: { code: 'BROKEN_ZIP', file } }
  }
  if (open !== 0 || !out.entries.length) return { ...out, problem: { code: 'BROKEN_ZIP', file } }
  return out
}

const json = (b: Uint8Array | undefined): unknown => { if (!b) return null; try { return JSON.parse(strFromU8(b)) } catch { return null } }

export async function checkUpload(deps: UploadDeps, input: { userId: string; uploadId: string; key: Buffer }): Promise<UploadReport> {
  const now = deps.now?.() ?? new Date()
  const { db, key } = { db: deps.db, key: input.key }
  const up = await db.workBackupUpload.findFirst({ where: { id: input.uploadId, userId: input.userId } })
  if (!up || up.expiresAt.getTime() <= now.getTime()) throw new WorkError('NOT_FOUND')
  if (up.state !== 'receiving') throw new WorkError('STALE', `upload is ${up.state}`)
  const { files, pieces } = await db.$transaction(async (tx) => ({
    files: await tx.workBackupUploadFile.findMany({ where: { uploadId: up.id }, orderBy: { fileIndex: 'asc' } }),
    pieces: await tx.workBackupUploadPiece.findMany({ where: { uploadId: up.id }, orderBy: [{ fileIndex: 'asc' }, { offset: 'asc' }] }),
  }), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
  const problems: UploadProblem[] = []
  const report: UploadReport = { ok: false, format: null, setId: null, partCount: null, partOf: {}, problems, signatureValid: false, sameAccount: false, appName: null, scope: null, files: 0, fileBytes: 0, checkedAt: now.toISOString() }

  const complete: typeof files = []
  for (const f of files) {
    const ps = pieces.filter((p) => p.fileIndex === f.fileIndex)
    const need = Math.ceil(f.totalBytes / PIECE_BYTES)
    const sum = ps.reduce((n, p) => n + p.bytes, 0)
    if (ps.length !== need || sum !== f.totalBytes || ps.some((p, i) => p.offset !== i * PIECE_BYTES)) problems.push({ code: 'FILE_INCOMPLETE', file: f.fileIndex })
    else complete.push(f)
  }
  if (!files.length) problems.push({ code: 'UNKNOWN_FORMAT' })

  const reads: PartRead[] = []
  const budget = { items: 0, headBytes: 0 }
  for (const f of complete) {
    const r = await readPart(deps, key, up.region, f.fileIndex, pieces.filter((p) => p.fileIndex === f.fileIndex), budget)
    if (r.problem) problems.push(r.problem)
    else reads.push(r)
  }

  const kindOf = (r: PartRead): 1 | 2 | null => {
    const m = json(r.small['manifest.json']) as { format?: unknown } | null
    if (m?.format === BACKUP_FORMAT) return 1
    if (m?.format === BACKUP_FORMAT_V2) return 2
    const p = json(r.small['part.json']) as { format?: unknown } | null
    if (p?.format === BACKUP_FORMAT_V2) return 2
    return null
  }
  const kinds = reads.map(kindOf)
  for (let i = 0; i < reads.length; i++) if (kinds[i] === null) problems.push({ code: 'NOT_A_BACKUP', file: reads[i].file })
  const v1 = reads.filter((_, i) => kinds[i] === 1)
  const v2 = reads.filter((_, i) => kinds[i] === 2)
  if (v1.length && (v2.length || files.length > 1)) problems.push({ code: 'MIXED_FORMATS' })
  else if (v1.length === 1 && !problems.length) {
    const size = files[0].totalBytes
    if (size > IMPORT_MAX_BYTES) problems.push({ code: 'OLD_FORMAT_TOO_LARGE' })
    else report.format = 1
  }

  if (v2.length && !v1.length) {
    report.format = 2
    for (const r of v2) {
      const isFirst = !!r.small['manifest.json']
      if (isFirst ? (!r.small['signature.json'] || r.small['part.json']) : (!r.small['part.json'] || r.small['signature.json'])) problems.push({ code: 'HEAD_MISPLACED', file: r.file })
    }
    const firsts = v2.filter((r) => r.small['manifest.json'])
    if (firsts.length !== 1) problems.push(firsts.length ? { code: 'PART_DUPLICATE', part: 1 } : { code: 'NO_FIRST_PART' })
    const first = firsts[0]
    const m = first ? json(first.small['manifest.json']) as { setId?: unknown; partCount?: unknown; accountId?: unknown; appName?: unknown; scope?: unknown; chunks?: unknown; files?: unknown; fileBytes?: unknown } | null : null
    const chunkList = m && Array.isArray(m.chunks) ? (m.chunks as Array<Record<string, unknown>>) : null
    const chunkNames = new Set<string>()
    const chunksOk = !!chunkList && chunkList.every((c) => {
      const ok = !!c && typeof c === 'object' && typeof c.name === 'string' && /^data\/[A-Za-z0-9_/-]+-\d{4}\.json$/.test(c.name) && !chunkNames.has(c.name)
        && Number.isSafeInteger(c.bytes) && (c.bytes as number) >= 0 && typeof c.sha256 === 'string' && HEX64.test(c.sha256)
      if (ok) chunkNames.add(c.name as string)
      return ok
    }) && [...chunkNames].some((n) => INDEX_RE.test(n))
    const shapeOk = !!m && typeof m.setId === 'string' && Number.isSafeInteger(m.partCount) && (m.partCount as number) >= 1 && (m.partCount as number) <= UPLOAD_MAX_FILES && chunksOk
    if (first && !shapeOk) problems.push({ code: 'MANIFEST_SHAPE' })
    if (first && shapeOk) {
      const setId = m!.setId as string
      const partCount = m!.partCount as number
      report.setId = setId; report.partCount = partCount
      report.appName = typeof m!.appName === 'string' ? m!.appName : null
      report.scope = typeof m!.scope === 'string' ? m!.scope : null
      report.files = Number.isSafeInteger(m!.files) ? m!.files as number : 0
      report.fileBytes = Number.isSafeInteger(m!.fileBytes) ? m!.fileBytes as number : 0
      report.partOf[first.file] = 1
      const seen = new Set<number>([1])
      for (const r of v2) {
        if (r === first) continue
        const p = json(r.small['part.json']) as { setId?: unknown; part?: unknown; of?: unknown } | null
        if (!p || p.setId !== setId || p.of !== partCount) { problems.push({ code: 'OTHER_SET', file: r.file }); continue }
        const n = p.part
        if (!Number.isSafeInteger(n) || (n as number) < 2 || (n as number) > partCount) { problems.push({ code: 'PART_OUT_OF_RANGE', file: r.file, part: Number(n) || 0 }); continue }
        if (seen.has(n as number)) { problems.push({ code: 'PART_DUPLICATE', part: n as number }); continue }
        seen.add(n as number)
        report.partOf[r.file] = n as number
      }
      const missing: number[] = []
      for (let n = 1; n <= partCount; n++) if (!seen.has(n)) missing.push(n)
      if (missing.length) problems.push({ code: 'PART_MISSING', parts: missing })

      const sig = json(first.small['signature.json']) as { mac?: unknown } | null
      if (typeof sig?.mac === 'string' && /^[0-9a-f]{64}$/.test(sig.mac)) {
        const mac = createHmac('sha256', backupSignKey(key)).update(first.small['manifest.json']).digest()
        report.signatureValid = timingSafeEqual(mac, Buffer.from(sig.mac, 'hex'))
      }
      report.sameAccount = m!.accountId === input.userId

      if (!missing.length && !problems.some((p) => p.code === 'OTHER_SET' || p.code === 'PART_DUPLICATE' || p.code === 'PART_OUT_OF_RANGE')) {
        const inSet = v2.filter((r) => report.partOf[r.file] !== undefined)
        const got = new Map<string, Entry>()
        let dup = 0
        for (const r of inSet) for (const e of r.entries) {
          if (HEAD_NAMES.has(e.name)) continue
          if (got.has(e.name)) dup++
          got.set(e.name, e)
        }
        const want = new Map<string, { bytes: number; sha256: string }>()
        for (const c of m!.chunks as Array<{ name: string; bytes: number; sha256: string }>) want.set(c.name, { bytes: c.bytes, sha256: c.sha256 })
        let indexBad = false
        for (const name of chunkNames) {
          if (!INDEX_RE.test(name)) continue
          const ix = inSet.map((r) => r.index.get(name)).find(Boolean)
          if (!ix || ix.sha256 !== want.get(name)!.sha256) continue
          if (!ix.items) { indexBad = true; continue }
          for (const f of ix.items) {
            if (want.has(f.entry)) { indexBad = true; continue }
            want.set(f.entry, { bytes: f.bytes, sha256: f.sha256 })
          }
        }
        if (indexBad) problems.push({ code: 'MANIFEST_SHAPE' })
        let miss = 0, changed = 0, unknown = 0
        for (const [name, w] of want) { const e = got.get(name); if (!e) miss++; else if (e.bytes !== w.bytes || e.sha256 !== w.sha256) changed++ }
        for (const name of got.keys()) if (!want.has(name)) unknown++
        if (miss) problems.push({ code: 'ITEM_MISSING', count: miss })
        if (changed) problems.push({ code: 'ITEM_CHANGED', count: changed })
        if (unknown) problems.push({ code: 'ITEM_UNKNOWN', count: unknown })
        if (dup) problems.push({ code: 'ITEM_DUPLICATE', count: dup })
      }
    }
  }
  if (!report.format && !problems.length) problems.push({ code: 'UNKNOWN_FORMAT' })

  report.ok = problems.length === 0 && report.format !== null
  await db.$transaction(async (tx) => {
    await lockUpload(tx, input.userId, up.id, ['receiving'], deps.now?.() ?? new Date())
    const after = await tx.workBackupUploadPiece.count({ where: { uploadId: up.id } })
    const afterFiles = await tx.workBackupUploadFile.count({ where: { uploadId: up.id } })
    if (after !== pieces.length || afterFiles !== files.length) throw new WorkError('STALE', 'pieces arrived during the check')
    await tx.workBackupUpload.update({ where: { id: up.id }, data: { report: encryptJson(report, key), state: report.ok ? 'checked' : 'receiving' } })
  })
  return report
}

export async function readUploadReport(db: PrismaClient, input: { userId: string; uploadId: string; key: Buffer; now?: Date }): Promise<{ state: string; report: UploadReport | null }> {
  const u = await db.workBackupUpload.findFirst({ where: { id: input.uploadId, userId: input.userId } })
  if (!u || u.expiresAt.getTime() <= (input.now ?? new Date()).getTime()) throw new WorkError('NOT_FOUND')
  return { state: u.state, report: u.report ? decryptJson<UploadReport>(u.report, input.key) : null }
}

export async function purgeExpiredUploads(d: { db: PrismaClient; deletePrefix(regionId: string, prefix: string): Promise<void>; now?: Date; limit?: number }): Promise<number> {
  const before = new Date((d.now ?? new Date()).getTime() - UPLOAD_GRACE_MS)
  const ups = await d.db.workBackupUpload.findMany({ where: { expiresAt: { lte: before }, state: { in: ['receiving', 'checked', 'done', 'failed', 'purging'] } }, orderBy: { expiresAt: 'asc' }, take: d.limit ?? 20, select: { id: true } })
  let done = 0
  for (const { id } of ups) {
    try {
      const u = await d.db.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ user_id: string; region: string; state: string; expires_at: Date }>>`SELECT user_id, region, state, expires_at FROM work_backup_upload WHERE id = ${id} FOR UPDATE`
        const r = rows[0]
        if (!r || r.expires_at.getTime() > before.getTime() || !['receiving', 'checked', 'done', 'failed', 'purging'].includes(r.state)) return null
        await tx.workBackupUpload.update({ where: { id }, data: { state: 'purging' } })
        return r
      })
      if (!u) continue
      await d.deletePrefix(u.region, uploadPrefix(u.user_id, id))
      await d.db.workBackupUpload.delete({ where: { id } })
      done++
    } catch (e) {
      console.error('[work-backup] 만료 올리기 정리 실패:', describeCaughtError(e))
    }
  }
  return done
}
