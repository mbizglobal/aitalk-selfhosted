
import { createHash, createHmac } from 'crypto'
import { Prisma, PrismaClient } from '@prisma/client'
import { Zip, ZipPassThrough } from 'fflate'
import { decryptBuffer, decryptStrict, encryptBuffer } from '@/lib/encryption'
import { WorkError } from './errors'
import { decryptJson, encryptJson } from './sealed'
import { APP_WORKFLOW_KIND } from './app-canvas'
import { writeWorkEvent } from './projects'
import { workflowAppProjectIds } from './workflow-apps'
import { zipEntryName } from './backup'
import { isSelfHosted } from '@/lib/edition'
import { describeCaughtError } from '@/lib/log-mask'

export const BACKUP_FORMAT_V2 = 'aitalk-workapp-backup@2'
export const PART_MAX_BYTES = 50_000_000
export const CHUNK_MAX_BYTES = 20 * 1024 * 1024
export const BACKUP_JOB_TTL_MS = 24 * 3600_000
export const BACKUP_PREPARE_STALE_MS = 5 * 60_000
const TOUCH_EVERY_MS = 30_000
export const BACKUP_JOB_GRACE_MS = 2 * 3600_000

export const entryOverhead = (name: string) => 128 + 2 * Buffer.byteLength(name, 'utf8')
const ZIP_TAIL = 256

const PROJECT_TABLES: ReadonlyArray<{ table: string; where: string }> = [
  { table: 'work_project', where: 'id = $1' },
  { table: 'work_app_spec', where: 'project_id = $1' },
  { table: 'data_sheets', where: 'project_id = $1' },
  { table: 'work_form', where: 'project_id = $1' },
  { table: 'data_sheet_rows', where: 'project_id = $1' },
  { table: 'sheet_row_pair', where: 'project_id = $1' },
  { table: 'work_task', where: 'project_id = $1' },
  { table: 'work_submission', where: 'project_id = $1' },
  { table: 'work_submission_source', where: 'project_id = $1' },
  { table: 'work_submission_file', where: 'project_id = $1' },
  { table: 'work_task_file', where: 'project_id = $1' },
  { table: 'work_note', where: 'project_id = $1' },
  { table: 'work_message', where: 'project_id = $1' },
  { table: 'work_room_read', where: 'project_id = $1' },
  { table: 'work_send', where: 'project_id = $1' },
  { table: 'work_alert_fired', where: 'project_id = $1' },
  { table: 'work_handoff', where: '(to_project_id = $1 OR from_project_id = $1)' },
  { table: 'work_handoff_period', where: 'to_project_id = $1' },
  { table: 'project_reference', where: '(from_project_id = $1 OR to_project_id = $1)' },
  { table: 'work_event', where: 'project_id = $1' },
  { table: 'work_file', where: 'project_id = $1' },
  { table: 'work_file_page_block', where: 'project_id = $1' },
  { table: 'work_doc_find_block', where: 'project_id = $1' },
  { table: 'work_public_link', where: 'project_id = $1' },
]

type Row = Record<string, unknown>

const isMemberPrivate = (table: string, r: Row) => table === 'work_message' && r.room === 'private' && typeof r.owner === 'string' && r.owner.startsWith('member:')

function openCell(v: unknown, key: Buffer, where: string, keepSealed: boolean): unknown {
  if (v instanceof Date) return v.toISOString()
  if (!(v instanceof Uint8Array)) return typeof v === 'bigint' ? v.toString() : v
  if (keepSealed) return { $sealed: Buffer.from(v).toString('base64') }
  let text: string
  try { text = decryptStrict(Buffer.from(v), key) } catch { throw new WorkError('INTEGRITY', `cannot open sealed cell ${where}`) }
  try { return { $json: JSON.parse(text) } } catch { return { $text: text } }
}

export const backupSignKey = (key: Buffer) => createHmac('sha256', key).update('aitalk-workapp-backup-sign@2').digest()
export function signManifest(key: Buffer, manifestBytes: Uint8Array): { alg: string; manifestSha256: string; mac: string } {
  return {
    alg: 'HMAC-SHA256',
    manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
    mac: createHmac('sha256', backupSignKey(key)).update(manifestBytes).digest('hex'),
  }
}

export type PlanEntry =
  | { kind: 'chunk'; name: string; idx: number; bytes: number; sha256: string }
  | { kind: 'file'; name: string; fileId: string; bytes: number; sha256: string; region: string; path: string }
export interface BackupPlan { setId: string; fileBase: string; parts: PlanEntry[][] }

export interface BackupJobDeps {
  db: PrismaClient
  region(userId: string): Promise<string>
  upload(region: string, blobPath: string, data: Buffer): Promise<void>
  now?: () => Date
}

export const backupJobPrefix = (userId: string, jobId: string) => `${userId}/backup-job/${jobId}/`
const chunkPath = (userId: string, jobId: string, idx: number) => `${backupJobPrefix(userId, jobId)}${idx}.bin`
const filePath = (userId: string, jobId: string, fileId: string) => `${backupJobPrefix(userId, jobId)}f/${fileId}.bin`

export function splitRows(rows: unknown[], max = CHUNK_MAX_BYTES): string[] {
  const out: string[] = []
  let cur: string[] = []
  let size = 2
  for (const r of rows) {
    const s = JSON.stringify(r)
    const n = Buffer.byteLength(s, 'utf8') + 1
    if (cur.length && size + n > max) { out.push(`[${cur.join(',')}]`); cur = []; size = 2 }
    cur.push(s); size += n
  }
  if (cur.length || !out.length) out.push(`[${cur.join(',')}]`)
  return out
}

export function planParts(entries: PlanEntry[], reserveFirst: number, max = PART_MAX_BYTES): PlanEntry[][] {
  const partHead = (n: number) => (n === 0 ? reserveFirst : entryOverhead('part.json') + 200)
  const parts: PlanEntry[][] = [[]]
  let used = ZIP_TAIL + partHead(0)
  for (const e of entries) {
    const need = e.bytes + entryOverhead(e.name)
    if (ZIP_TAIL + partHead(1) + need > max) throw new WorkError('INVALID', `backup: item too large for one part (${e.kind === 'file' ? e.fileId : e.name})`)
    if (used + need > max) { parts.push([]); used = ZIP_TAIL + partHead(parts.length - 1) }
    parts[parts.length - 1].push(e)
    used += need
  }
  return parts
}

async function resolveScope(tx: Prisma.TransactionClient, userId: string, scope: 'workflow' | 'app', targetId: string): Promise<{ workflowIds: string[]; projectIds: string[]; name: string }> {
  if (scope === 'app') {
    const p = await tx.workProject.findFirst({ where: { id: targetId, userId }, select: { id: true, workflowId: true } })
    if (!p) throw new WorkError('NOT_FOUND')
    const hidden = await tx.workflow.findMany({ where: { appProjectId: p.id, kind: APP_WORKFLOW_KIND, agent: { userId } }, select: { workflowId: true, name: true } })
    const direct = p.workflowId && !hidden.some((h) => h.workflowId === p.workflowId)
      ? await tx.workflow.findFirst({ where: { workflowId: p.workflowId, agent: { userId } }, select: { workflowId: true, name: true } })
      : null
    const all = [...hidden, ...(direct ? [direct] : [])]
    return { workflowIds: all.map((h) => h.workflowId), projectIds: [p.id], name: all[0]?.name ?? '' }
  }
  const canvas = await tx.workflow.findFirst({ where: { workflowId: targetId, agent: { userId } }, select: { workflowId: true, name: true, kind: true } })
  if (!canvas || canvas.kind === APP_WORKFLOW_KIND) throw new WorkError('NOT_FOUND')
  const hidden = await tx.workflow.findMany({ where: { parentWorkflowId: canvas.workflowId, kind: APP_WORKFLOW_KIND, agent: { userId } }, select: { workflowId: true } })
  const projectIds = await workflowAppProjectIds(tx as unknown as PrismaClient, userId, canvas.workflowId)
  if (!projectIds.length && !hidden.length) throw new WorkError('INVALID', 'not a work app workflow')
  return { workflowIds: [canvas.workflowId, ...hidden.map((h) => h.workflowId)], projectIds, name: canvas.name }
}

export interface BackupJobInfo { jobId: string; state: string; error: string | null; partCount: number; fileBase: string; expiresAt: Date; parts: Array<{ n: number; bytes: number; files: number }> }

export async function startBackupJob(deps: BackupJobDeps, input: { userId: string; key: Buffer; scope: 'workflow' | 'app'; targetId: string }): Promise<string> {
  const now = deps.now?.() ?? new Date()
  await resolveScope(deps.db as unknown as Prisma.TransactionClient, input.userId, input.scope, input.targetId)
  const region = await deps.region(input.userId)
  const job = await deps.db.workBackupJob.create({ data: { userId: input.userId, scope: input.scope, targetId: input.targetId, state: 'preparing', plan: encryptJson({}, input.key), partCount: 0, region, expiresAt: new Date(now.getTime() + BACKUP_JOB_TTL_MS) } })
  return job.id
}

export async function createBackupJob(deps: BackupJobDeps & PartStreamDeps, input: { userId: string; key: Buffer; scope: 'workflow' | 'app'; targetId: string }): Promise<BackupJobInfo> {
  const jobId = await startBackupJob(deps, input)
  return prepareBackupJob(deps, { userId: input.userId, key: input.key, jobId })
}

export async function prepareBackupJob(deps: BackupJobDeps & PartStreamDeps, input: { userId: string; key: Buffer; jobId: string }): Promise<BackupJobInfo> {
  const { db, userId, key } = { db: deps.db, userId: input.userId, key: input.key }
  const job = await db.workBackupJob.findFirst({ where: { id: input.jobId, userId, state: 'preparing' } })
  if (!job) throw new WorkError('NOT_FOUND')
  const now = job.createdAt
  const region = job.region
  const scope = job.scope === 'app' ? 'app' : 'workflow'
  const setId = job.id
  const beat = setInterval(() => {
    db.workBackupJob.updateMany({ where: { id: job.id, state: 'preparing' }, data: { touchedAt: new Date() } }).catch(() => undefined)
  }, TOUCH_EVERY_MS)
  try {
    const chunks: Array<PlanEntry & { kind: 'chunk' }> = []
    const putChunk = async (name: string, text: string) => {
      const buf = Buffer.from(text, 'utf8')
      if (buf.length > CHUNK_MAX_BYTES) throw new WorkError('INVALID', `backup: one row is larger than ${CHUNK_MAX_BYTES} bytes (${name})`)
      const idx = chunks.length
      await deps.upload(region, chunkPath(userId, job.id, idx), encryptBuffer(buf, key))
      chunks.push({ kind: 'chunk', name, idx, bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') })
    }
    const putRows = async (dir: string, table: string, rows: unknown[]) => {
      const parts = splitRows(rows)
      for (let i = 0; i < parts.length; i++) await putChunk(`data/${dir ? `${dir}/` : ''}${table}-${String(i + 1).padStart(4, '0')}.json`, parts[i])
      return rows.length
    }

    const snap = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
      const s = await resolveScope(tx, userId, scope, job.targetId)
      const counts: Record<string, number> = {}
      const wf = s.workflowIds
      const wfRows = wf.length ? await tx.$queryRawUnsafe<Row[]>(`SELECT w.* FROM workflows w JOIN agents a ON a."agentId" = w."agentId" WHERE w."workflowId" = ANY($1::text[]) AND a."userId" = $2 ORDER BY w.id`, wf, userId) : []
      counts['workflow/workflows'] = await putRows('workflow', 'workflows', wfRows.map((r) => fix(r, key, 'workflows')))
      for (const [table, sql] of [
        ['workflow_version', `SELECT v.* FROM workflow_version v WHERE v.workflow_id = ANY($1::text[]) ORDER BY v.id`],
        ['agent_member_access', `SELECT m.* FROM agent_member_access m WHERE m.workflow_id = ANY($1::text[])`],
        ['workflow_group_items', `SELECT g.* FROM workflow_group_items g WHERE g.workflow_id = ANY($1::text[])`],
        ['workflow_groups', `SELECT DISTINCT wg.* FROM workflow_groups wg JOIN workflow_group_items g ON g.group_id = wg.id WHERE g.workflow_id = ANY($1::text[])`],
      ] as const) {
        const rows = wf.length ? await tx.$queryRawUnsafe<Row[]>(sql, wf) : []
        counts[`workflow/${table}`] = await putRows('workflow', table, rows.map((r) => fix(r, key, table)))
      }
      const counters = await tx.$queryRawUnsafe<Row[]>(`SELECT name, value FROM work_counter WHERE user_id = $1 ORDER BY name`, userId)
      counts['account/work_counter'] = await putRows('account', 'work_counter', counters)

      const files: Array<{ fileId: string; projectId: string; name: string; bytes: number; sha256: string; region: string; path: string }> = []
      for (const pid of s.projectIds) {
        for (const t of PROJECT_TABLES) {
          const where = t.table === 'work_handoff_period'
            ? `(to_project_id = $1 OR id IN (SELECT period_id FROM work_handoff WHERE from_project_id = $1 AND user_id = $2 AND period_id IS NOT NULL))`
            : t.where
          const rows = await tx.$queryRawUnsafe<Row[]>(`SELECT * FROM ${t.table} WHERE ${where} AND user_id = $2`, pid, userId)
          counts[`apps/${pid}/${t.table}`] = await putRows(`apps/${pid}`, t.table, rows.map((r) => {
            const keep = isMemberPrivate(t.table, r)
            return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, openCell(v, key, `${t.table}.${k}`, keep)]))
          }))
        }
        for (const f of await tx.workFile.findMany({ where: { projectId: pid, userId }, orderBy: { uploadedAt: 'asc' } })) {
          let name = f.id
          try { name = decryptJson<{ originalName?: string }>(f.payload, key).originalName || f.id } catch { }
          if (!Number.isSafeInteger(f.sizeBytes) || f.sizeBytes < 0 || !/^[0-9a-f]{64}$/.test(f.sha256) || !f.blobPath || !f.blobRegion) throw new WorkError('INTEGRITY', `file ${f.id} row`)
          files.push({ fileId: f.id, projectId: pid, name: zipEntryName(f.id, name), bytes: f.sizeBytes, sha256: f.sha256, region: f.blobRegion, path: f.blobPath })
        }
      }
      counts.files = await putRows('', 'files', files.map((f) => ({ id: f.fileId, projectId: f.projectId, entry: f.name, bytes: f.bytes, sha256: f.sha256 })))
      return { s, counts, files }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 300_000, maxWait: 10_000 })

    const copied: PlanEntry[] = []
    for (const f of snap.files) {
      const { buffer: sealed } = await deps.download(f.region, f.path)
      const buf = decryptBuffer(sealed, key)
      if (buf.length !== f.bytes || createHash('sha256').update(buf).digest('hex') !== f.sha256) throw new WorkError('INTEGRITY', `file ${f.fileId} changed`)
      const path = filePath(userId, job.id, f.fileId)
      await deps.upload(region, path, sealed)
      copied.push({ kind: 'file', name: f.name, fileId: f.fileId, bytes: f.bytes, sha256: f.sha256, region, path })
    }

    const appName = snap.s.name || 'work-app'
    const safe = appName.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'work-app'
    const fileBase = `${safe}-${now.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')}`
    const manifestOf = (partCount: number) => ({
      format: BACKUP_FORMAT_V2, setId, createdAt: now.toISOString(), edition: isSelfHosted() ? 'selfhosted' : 'cloud',
      accountId: userId, scope, targetId: job.targetId, appName, partCount,
      projectIds: snap.s.projectIds, workflowIds: snap.s.workflowIds,
      chunks: chunks.map((c) => ({ name: c.name, bytes: c.bytes, sha256: c.sha256 })),
      rows: snap.counts, files: snap.files.length, fileBytes: snap.files.reduce((n, f) => n + f.bytes, 0),
      note: 'Contains your work app data unencrypted (member private chats stay sealed). Keep it safe.',
    })
    const headBytes = Buffer.byteLength(JSON.stringify(manifestOf(999999), null, 2), 'utf8')
    const reserve = headBytes + entryOverhead('manifest.json') + 400 + entryOverhead('signature.json')
    const parts = planParts([...chunks, ...copied], reserve)
    const manifestBytes = Buffer.from(JSON.stringify(manifestOf(parts.length), null, 2), 'utf8')
    const signature = Buffer.from(JSON.stringify(signManifest(key, manifestBytes), null, 2), 'utf8')
    const head: PlanEntry[] = []
    for (const [name, buf] of [['manifest.json', manifestBytes], ['signature.json', signature]] as const) {
      const idx = chunks.length + head.length
      await deps.upload(region, chunkPath(userId, job.id, idx), encryptBuffer(buf, key))
      head.push({ kind: 'chunk', name, idx, bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') })
    }
    parts[0] = [...head, ...parts[0]]
    if (partBytes(parts[0], 0) > PART_MAX_BYTES) throw new WorkError('INVALID', 'backup: manifest too large for one part')
    const plan: BackupPlan = { setId, fileBase, parts }
    const readyUntil = new Date(Date.now() + BACKUP_JOB_TTL_MS)
    await db.$transaction(async (tx) => {
      const r = await tx.workBackupJob.updateMany({ where: { id: job.id, state: 'preparing' }, data: { plan: encryptJson(plan, key), partCount: parts.length, state: 'ready', expiresAt: readyUntil } })
      if (r.count !== 1) throw new WorkError('STALE', 'backup job is no longer preparing')
      for (const pid of snap.s.projectIds) await writeWorkEvent(tx, key, { userId, projectId: pid, actor: { type: 'human' }, action: 'backup_download', detail: { files: snap.files.filter((f) => f.projectId === pid).length, parts: parts.length } })
    })
    return jobInfo({ id: job.id, state: 'ready', error: null, partCount: parts.length, expiresAt: readyUntil }, plan)
  } catch (e) {
    const code = e instanceof WorkError ? e.code : e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2028' ? 'TIMEOUT' : 'INTERNAL'
    const why = e instanceof WorkError && e.code === 'INVALID' && e.detail ? `${code}: ${e.detail}`.slice(0, 80) : code
    await db.workBackupJob.updateMany({ where: { id: job.id, state: 'preparing' }, data: { state: 'failed', error: why } }).catch(() => undefined)
    throw e
  } finally {
    clearInterval(beat)
  }
}

function jobInfo(j: { id: string; state: string; error: string | null; partCount: number; expiresAt: Date }, plan: BackupPlan | null): BackupJobInfo {
  return {
    jobId: j.id, state: j.state, error: j.error, partCount: j.partCount, fileBase: plan?.fileBase ?? '', expiresAt: j.expiresAt,
    parts: plan ? plan.parts.map((p, i) => ({ n: i + 1, bytes: partBytes(p, i), files: p.filter((e) => e.kind === 'file').length })) : [],
  }
}

export async function backupJobStatus(db: PrismaClient, input: { userId: string; jobId: string; key: Buffer; now?: Date }): Promise<BackupJobInfo> {
  const now = input.now ?? new Date()
  let j = await db.workBackupJob.findFirst({ where: { id: input.jobId, userId: input.userId } })
  if (!j || j.expiresAt.getTime() <= now.getTime()) throw new WorkError('NOT_FOUND')
  if (j.state === 'preparing' && j.touchedAt.getTime() <= now.getTime() - BACKUP_PREPARE_STALE_MS) {
    await db.workBackupJob.updateMany({ where: { id: j.id, state: 'preparing', touchedAt: j.touchedAt }, data: { state: 'failed', error: 'INTERRUPTED' } })
    j = await db.workBackupJob.findFirstOrThrow({ where: { id: j.id } })
  }
  return jobInfo(j, j.state === 'ready' ? decryptJson<BackupPlan>(j.plan, input.key) : null)
}

function fix(r: Row, key: Buffer, table: string): Row {
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, openCell(v, key, `${table}.${k}`, false)]))
}

export function partBytes(p: PlanEntry[], i: number): number {
  return ZIP_TAIL + (i === 0 ? 0 : entryOverhead('part.json') + 200) + p.reduce((n, e) => n + e.bytes + entryOverhead(e.name), 0)
}

export const partFileName = (fileBase: string, n: number, of: number) => `${fileBase}-part${String(n).padStart(2, '0')}of${String(of).padStart(2, '0')}.zip`

export async function readBackupJob(db: PrismaClient, input: { userId: string; jobId: string; key: Buffer; now?: Date }): Promise<{ plan: BackupPlan; region: string; partCount: number }> {
  const j = await db.workBackupJob.findFirst({ where: { id: input.jobId, userId: input.userId } })
  if (!j || j.state !== 'ready' || j.partCount < 1 || j.expiresAt.getTime() <= (input.now ?? new Date()).getTime()) throw new WorkError('NOT_FOUND')
  return { plan: decryptJson<BackupPlan>(j.plan, input.key), region: j.region, partCount: j.partCount }
}

export interface PartStreamDeps { download(regionId: string, blobPath: string): Promise<{ buffer: Buffer }> }

export function backupPartStream(input: { userId: string; jobId: string; key: Buffer; plan: BackupPlan; region: string; n: number }, deps: PartStreamDeps): ReadableStream<Uint8Array> {
  const entries = input.plan.parts[input.n - 1]
  if (!entries) throw new WorkError('NOT_FOUND')
  let zip: Zip | null = null
  let next = 0
  let cancelled = false
  const fail = (controller: ReadableStreamDefaultController<Uint8Array>, e: unknown) => {
    console.error('[work-backup] 조각 중단:', describeCaughtError(e))
    cancelled = true
    controller.error(e)
  }
  const add = (name: string, buf: Uint8Array) => {
    const e = new ZipPassThrough(name)
    zip!.add(e)
    e.push(buf, true)
  }
  return new ReadableStream<Uint8Array>({
    start(controller) {
      zip = new Zip((err, chunk, final) => {
        if (cancelled) return
        if (err) { fail(controller, err); return }
        controller.enqueue(chunk)
        if (final) controller.close()
      })
      try {
        if (input.n > 1) add('part.json', new TextEncoder().encode(JSON.stringify({ format: BACKUP_FORMAT_V2, setId: input.plan.setId, part: input.n, of: input.plan.parts.length })))
      } catch (e) { fail(controller, e) }
    },
    async pull(controller) {
      if (cancelled || !zip) return
      try {
        if (next >= entries.length) { zip.end(); return }
        const e = entries[next++]
        const path = e.kind === 'chunk' ? chunkPath(input.userId, input.jobId, e.idx) : e.path
        const { buffer: sealed } = await deps.download(e.kind === 'chunk' ? input.region : e.region, path)
        if (cancelled) return
        const buf = decryptBuffer(sealed, input.key)
        if (buf.length !== e.bytes || createHash('sha256').update(buf).digest('hex') !== e.sha256) throw new WorkError('INTEGRITY', `${e.kind} ${e.kind === 'file' ? e.fileId : e.name} changed`)
        add(e.name, new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength))
      } catch (e) { fail(controller, e) }
    },
    cancel() { cancelled = true },
  })
}

export async function purgeExpiredBackupJobs(d: { db: PrismaClient; deletePrefix(regionId: string, prefix: string): Promise<void>; now?: Date; limit?: number }): Promise<number> {
  const before = new Date((d.now ?? new Date()).getTime() - BACKUP_JOB_GRACE_MS)
  const jobs = await d.db.workBackupJob.findMany({ where: { expiresAt: { lte: before } }, orderBy: { expiresAt: 'asc' }, take: d.limit ?? 20, select: { id: true, userId: true, region: true } })
  let done = 0
  for (const j of jobs) {
    try {
      await d.deletePrefix(j.region, backupJobPrefix(j.userId, j.id))
      await d.db.workBackupJob.delete({ where: { id: j.id } })
      done++
    } catch (e) {
      console.error('[work-backup] 만료 작업 정리 실패:', describeCaughtError(e))
    }
  }
  return done
}
