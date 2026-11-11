
import { createHash } from 'crypto'
import { Prisma, PrismaClient } from '@prisma/client'
import { Zip, ZipDeflate, ZipPassThrough } from 'fflate'
import { decryptBuffer, decryptStrict } from '@/lib/encryption'
import { WorkError } from './errors'
import { decryptJson } from './sealed'
import { APP_WORKFLOW_KIND } from './app-canvas'
import { nodeDataFromHidden } from './app-admin'
import { writeWorkEvent } from './projects'
import { isSelfHosted } from '@/lib/edition'
import { describeCaughtError } from '@/lib/log-mask'

export const BACKUP_FORMAT = 'aitalk-workapp-backup@1'
export const BACKUP_MAX_FILE_BYTES = 2 * 1024 ** 3

const TABLES: ReadonlyArray<{ table: string; where: string }> = [
  { table: 'work_project', where: 'id = $1' },
  { table: 'data_sheets', where: 'project_id = $1' },
  { table: 'data_sheet_rows', where: 'project_id = $1' },
  { table: 'sheet_row_pair', where: 'project_id = $1' },
  { table: 'work_task', where: 'project_id = $1' },
  { table: 'work_submission', where: 'project_id = $1' },
  { table: 'work_submission_source', where: 'project_id = $1' },
  { table: 'work_submission_file', where: 'project_id = $1' },
  { table: 'work_task_file', where: 'project_id = $1' },
  { table: 'work_note', where: 'project_id = $1' },
  { table: 'work_message', where: "project_id = $1 AND (room = 'team' OR owner = 'human')" },
  { table: 'work_send', where: 'project_id = $1' },
  { table: 'work_handoff', where: '(to_project_id = $1 OR from_project_id = $1)' },
  { table: 'work_handoff_period', where: 'to_project_id = $1' },
  { table: 'project_reference', where: '(from_project_id = $1 OR to_project_id = $1)' },
  { table: 'work_event', where: 'project_id = $1' },
  { table: 'work_file', where: 'project_id = $1' },
]

function openCell(v: unknown, key: Buffer, where: string): unknown {
  if (!(v instanceof Uint8Array)) return typeof v === 'bigint' ? v.toString() : v
  let text: string
  try { text = decryptStrict(Buffer.from(v), key) } catch { throw new WorkError('INTEGRITY', `cannot open sealed cell ${where}`) }
  try { return { $json: JSON.parse(text) } } catch { return { $text: text } }
}

export interface BackupFile { id: string; name: string; blobRegion: string; blobPath: string; sizeBytes: number; sha256: string }
export interface BackupSnapshot {
  manifest: Record<string, unknown>
  project: Record<string, unknown[]>
  node: Record<string, unknown> | null
  files: BackupFile[]
  fileName: string
}

export async function readBackupSnapshot(db: PrismaClient, input: { userId: string; projectId: string; key: Buffer; now?: Date }): Promise<BackupSnapshot> {
  const at = input.now ?? new Date()
  return db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
    const p = await tx.workProject.findFirst({ where: { id: input.projectId, userId: input.userId }, select: { id: true, kind: true, settings: true, workflowId: true } })
    if (!p) throw new WorkError('NOT_FOUND')
    const project: Record<string, unknown[]> = {}
    for (const t of TABLES) {
      const rows = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT * FROM ${t.table} WHERE ${t.where} AND user_id = $2`, input.projectId, input.userId)
      project[t.table] = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, openCell(v, input.key, `${t.table}.${k}`)])))
    }
    const files: BackupFile[] = []
    for (const f of await tx.workFile.findMany({ where: { projectId: p.id, userId: input.userId }, orderBy: { uploadedAt: 'asc' } })) {
      let name = f.id
      try { name = decryptJson<{ originalName?: string }>(f.payload, input.key).originalName || f.id } catch { }
      files.push({ id: f.id, name, blobRegion: f.blobRegion, blobPath: f.blobPath, sizeBytes: f.sizeBytes, sha256: f.sha256 })
    }
    const hidden = (p.workflowId ? await tx.workflow.findFirst({ where: { workflowId: p.workflowId, agent: { userId: input.userId } }, select: { name: true, workflowJson: true, kind: true } }) : null)
      ?? await tx.workflow.findFirst({ where: { appProjectId: p.id, kind: APP_WORKFLOW_KIND, agent: { userId: input.userId } }, select: { name: true, workflowJson: true, kind: true } })
    const node = hidden ? nodeDataFromHidden(hidden.name, hidden.workflowJson, null) : null
    let appName = hidden?.name ?? ''
    try { appName = appName || (p.settings ? decryptJson<{ name?: string }>(p.settings, input.key).name ?? '' : '') } catch { }
    if (files.some((f) => !Number.isSafeInteger(f.sizeBytes) || f.sizeBytes < 0)) throw new WorkError('INTEGRITY', 'file size')
    const total = files.reduce((n, f) => n + f.sizeBytes, 0)
    if (total > BACKUP_MAX_FILE_BYTES) throw new WorkError('INVALID', 'backup too large')
    const manifest = {
      format: BACKUP_FORMAT,
      createdAt: at.toISOString(),
      edition: isSelfHosted() ? 'selfhosted' : 'cloud',
      appTemplate: p.kind,
      appName: appName || 'Work app',
      tables: Object.fromEntries(Object.entries(project).map(([k, v]) => [k, v.length])),
      files: files.length,
      fileBytes: total,
      note: 'Contains your work app data unencrypted. Keep it safe.',
    }
    const safe = (appName || 'work-app').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'work-app'
    return { manifest, project, node, files, fileName: `${safe}-${at.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-')}.zip` }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 60_000 })
}

export function zipEntryName(fileId: string, original: string): string {
  const base = original.split(/[\\/]/).pop() ?? ''
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, '').replace(/^\.+/, '').trim().slice(0, 150)
  return `files/${fileId}/${clean || 'file'}`
}

export interface BackupStreamDeps {
  download(regionId: string, blobPath: string): Promise<{ buffer: Buffer }>
}

export function backupZipStream(snap: BackupSnapshot, key: Buffer, deps: BackupStreamDeps): ReadableStream<Uint8Array> {
  let zip: Zip | null = null
  let next = 0
  let cancelled = false
  const fail = (controller: ReadableStreamDefaultController<Uint8Array>, e: unknown) => {
    console.error('[work-backup] ZIP 중단:', describeCaughtError(e))
    cancelled = true
    controller.error(e)
  }
  return new ReadableStream<Uint8Array>({
    start(controller) {
      zip = new Zip((err, chunk, final) => {
        if (cancelled) return
        if (err) { fail(controller, err); return }
        controller.enqueue(chunk)
        if (final) controller.close()
      })
      const addJson = (name: string, value: unknown) => {
        const e = new ZipDeflate(name, { level: 6 })
        zip!.add(e)
        e.push(new TextEncoder().encode(JSON.stringify(value, null, 2)), true)
      }
      try {
        addJson('manifest.json', snap.manifest)
        addJson('project.json', snap.project)
        addJson('node.json', snap.node ?? {})
      } catch (e) { fail(controller, e) }
    },
    async pull(controller) {
      if (cancelled || !zip) return
      try {
        if (next >= snap.files.length) { zip.end(); return }
        const f = snap.files[next++]
        const { buffer: sealed } = await deps.download(f.blobRegion, f.blobPath)
        if (cancelled) return
        const buf = decryptBuffer(sealed, key)
        if (buf.length !== f.sizeBytes || createHash('sha256').update(buf).digest('hex') !== f.sha256) throw new WorkError('INTEGRITY', `file ${f.id} changed`)
        const e = new ZipPassThrough(zipEntryName(f.id, f.name))
        zip.add(e)
        e.push(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), true)
      } catch (e) { fail(controller, e) }
    },
    cancel() { cancelled = true },
  })
}

export async function recordBackupDownload(db: PrismaClient, key: Buffer, input: { userId: string; projectId: string; files: number }): Promise<void> {
  await db.$transaction((tx) => writeWorkEvent(tx, key, { userId: input.userId, projectId: input.projectId, actor: { type: 'human' }, action: 'backup_download', detail: { files: input.files } }))
}
