
import { Prisma, PrismaClient } from '@prisma/client'
import { Unzip, UnzipInflate } from 'fflate'
import { decryptBuffer, encryptBuffer } from '@/lib/encryption'
import { WorkError } from './errors'
import { decryptJson, encryptJson } from './sealed'
import { APP_WORKFLOW_KIND } from './app-canvas'
import { nodeDataFromHidden } from './app-admin'
import { BACKUP_FORMAT_V2 } from './backup-parts'
import { importApps, importedNodeData, readBackupZip, type ImportDeps, type ImportResult } from './backup-import'
import { uploadPrefix, type UploadReport } from './backup-upload'
import { raiseCounters, restoreSetOriginal, type OriginalInput } from './backup-restore-original'
import { describeCaughtError } from '@/lib/log-mask'

export const RESTORE_STALE_MS = 5 * 60_000
const BEAT_MS = 30_000
export const RESTORE_KEEP_MS = 24 * 3600_000

type Row = Record<string, unknown>

type PendingCanvas =
  | { kind: 'set'; name: string; description: string | null; workflowJson: string; apps: Array<{ projectId: string; nodeId: string; name: string }> }
  | { kind: 'each'; apps: Array<{ projectId: string; nodeData: Record<string, unknown> }> }

export interface RestoreResult {
  mode: 'copy' | 'original'
  format: 1 | 2
  apps: Array<{ projectId: string; name: string; appTemplate: string }>
  workflowId: string | null
  canvasError: string | null
  notRestored: string[]
  copyBecause: string[]
  pendingCanvas?: PendingCanvas
}

export interface RestoreDeps extends ImportDeps {
  download(region: string, blobPath: string): Promise<{ buffer: Buffer }>
  restoreCanvas(input: { userId: string; projectId: string; nodeData?: Record<string, unknown>; inTx?(tx: Prisma.TransactionClient): Promise<void> }): Promise<{ ok: true; workflowId: string } | { ok: false; code: string }>
  restoreSetCanvas(input: { userId: string; agentId: string; name: string; description: string | null; workflowJson: string; apps: Array<{ projectId: string; nodeId: string; name: string }>; inTx?(tx: Prisma.TransactionClient): Promise<void> }): Promise<{ ok: true; workflowId: string } | { ok: false; code: string }>
  originalTx: OriginalInput['originalTx']
}

export async function startRestore(db: PrismaClient, input: { userId: string; uploadId: string; key: Buffer; now?: Date }): Promise<number> {
  const now = input.now ?? new Date()
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ state: string; gen: number; expires_at: Date; touched_at: Date; report: Uint8Array | null }>>`
      SELECT state, gen, expires_at, touched_at, report FROM work_backup_upload WHERE id = ${input.uploadId} AND user_id = ${input.userId} FOR UPDATE`
    const u = rows[0]
    const dead = !!u && u.state === 'restoring' && u.touched_at.getTime() <= now.getTime() - RESTORE_STALE_MS
    if (!u || (!dead && u.expires_at.getTime() <= now.getTime())) throw new WorkError('NOT_FOUND')
    const report = u.report ? decryptJson<UploadReport>(Buffer.from(u.report), input.key) : null
    if (!(u.state === 'checked' || ((u.state === 'failed' || dead) && report?.ok))) throw new WorkError('STALE', `upload is ${u.state}`)
    const gen = u.gen + 1
    await tx.workBackupUpload.update({ where: { id: input.uploadId }, data: { state: 'restoring', gen, touchedAt: now, error: null } })
    return gen
  })
}

export async function restoreStatus(db: PrismaClient, input: { userId: string; uploadId: string; key: Buffer; now?: Date }): Promise<{ state: string; error: string | null; report: UploadReport | null; result: RestoreResult | null }> {
  const now = input.now ?? new Date()
  let u = await db.workBackupUpload.findFirst({ where: { id: input.uploadId, userId: input.userId } })
  if (!u || (u.state !== 'restoring' && u.expiresAt.getTime() <= now.getTime())) throw new WorkError('NOT_FOUND')
  if (u.state === 'restoring' && u.touchedAt.getTime() <= now.getTime() - RESTORE_STALE_MS) {
    await db.workBackupUpload.updateMany({ where: { id: u.id, state: 'restoring', gen: u.gen, touchedAt: u.touchedAt }, data: { state: 'failed', error: 'INTERRUPTED', expiresAt: new Date(now.getTime() + RESTORE_KEEP_MS) } })
    u = await db.workBackupUpload.findUniqueOrThrow({ where: { id: u.id } })
  }
  return {
    state: u.state, error: u.error,
    report: u.report ? decryptJson<UploadReport>(u.report, input.key) : null,
    result: u.result ? decryptJson<RestoreResult>(u.result, input.key) : null,
  }
}

async function writeJob(tx: Prisma.TransactionClient, c: { uploadId: string; gen: number }, data: Prisma.WorkBackupUploadUpdateInput) {
  const rows = await tx.$queryRaw<Array<{ state: string; gen: number; touched_at: Date }>>`SELECT state, gen, touched_at FROM work_backup_upload WHERE id = ${c.uploadId} FOR UPDATE`
  const u = rows[0]
  if (!u || u.state !== 'restoring' || u.gen !== c.gen || u.touched_at.getTime() <= Date.now() - RESTORE_STALE_MS) throw new WorkError('STALE', 'restore is no longer running')
  await tx.workBackupUpload.update({ where: { id: c.uploadId }, data: { ...data, touchedAt: new Date() } })
}

async function eachEntry(deps: RestoreDeps, key: Buffer, region: string, pieces: Array<{ path: string }>, on: (name: string, data: Buffer) => Promise<void>): Promise<void> {
  const done: Array<{ name: string; data: Buffer }> = []
  const uz = new Unzip()
  uz.register(UnzipInflate)
  uz.onfile = (f) => {
    const parts: Uint8Array[] = []
    f.ondata = (err, d, final) => { if (err) throw err; parts.push(d); if (final) done.push({ name: f.name, data: Buffer.concat(parts) }) }
    f.start()
  }
  for (let i = 0; i < pieces.length; i++) {
    const buf = decryptBuffer((await deps.download(region, pieces[i].path)).buffer, key)
    const STEP = 64 * 1024
    for (let o = 0; o < buf.length; o += STEP) {
      uz.push(buf.subarray(o, Math.min(buf.length, o + STEP)), i === pieces.length - 1 && o + STEP >= buf.length)
      while (done.length) { const e = done.shift()!; await on(e.name, e.data) }
    }
  }
}

const parseRows = (b: Buffer, why: string): Row[] => {
  let v: unknown
  try { v = JSON.parse(b.toString('utf8')) } catch { throw new WorkError('INVALID', `backup: ${why} is not JSON`) }
  if (!Array.isArray(v) || v.some((r) => !r || typeof r !== 'object' || Array.isArray(r))) throw new WorkError('INVALID', `backup: ${why} shape`)
  return v as Row[]
}

function remapDeep(v: unknown, map: Map<string, string>): unknown {
  if (typeof v === 'string') return map.get(v) ?? v
  if (Array.isArray(v)) return v.map((x) => remapDeep(x, map))
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, remapDeep(x, map)]))
  return v
}

export async function runRestore(deps: RestoreDeps, input: { userId: string; uploadId: string; key: Buffer; gen: number; agentId: string; forceCopy?: boolean }): Promise<RestoreResult> {
  const { db, key } = { db: deps.db, key: input.key }
  const job = { uploadId: input.uploadId, gen: input.gen }
  const beat = setInterval(() => {
    db.workBackupUpload.updateMany({ where: { id: input.uploadId, state: 'restoring', gen: input.gen, touchedAt: { gt: new Date(Date.now() - RESTORE_STALE_MS) } }, data: { touchedAt: new Date() } }).catch(() => undefined)
  }, BEAT_MS)
  try {
    const up = await db.workBackupUpload.findFirst({ where: { id: input.uploadId, userId: input.userId, state: 'restoring', gen: input.gen } })
    if (!up || !up.report) throw new WorkError('STALE', 'restore is no longer running')
    const report = decryptJson<UploadReport>(up.report, key)
    if (!report.ok || !report.format) throw new WorkError('INVALID', 'upload was not checked')

    const prior = up.result ? decryptJson<RestoreResult>(up.result, key) : null
    let result: RestoreResult
    if (prior) result = prior
    else {
      const pieces = await db.workBackupUploadPiece.findMany({ where: { uploadId: up.id }, orderBy: [{ fileIndex: 'asc' }, { offset: 'asc' }] })
      const piecesOf = (file: number) => pieces.filter((p) => p.fileIndex === file)
      const copyBecause: string[] = []
      if (!report.sameAccount) copyBecause.push('OTHER_ACCOUNT')
      else if (!report.signatureValid) copyBecause.push('SIGNATURE')
      else if (input.forceCopy) copyBecause.push('ASKED_COPY')
      if (report.format === 1) result = await restoreV1(deps, { ...input, region: up.region, report, piecesOf, job })
      else {
        const set = await unpackSet(deps, { userId: input.userId, uploadId: up.id, key, region: up.region, report, piecesOf })
        let original: RestoreResult | null = null
        if (!copyBecause.length) {
          const o = await restoreSetOriginal({
            db, userId: input.userId, key, region: up.region, stagingPrefix: uploadPrefix(input.userId, up.id), manifest: set.manifest, table: set.table,
            download: deps.download, upload: deps.upload, originalTx: deps.originalTx,
            onCommit: async (tx, r) => {
              const rr: RestoreResult = { mode: 'original', format: 2, apps: r.projectIds.map((pid) => ({ projectId: pid, name: r.names[pid].name, appTemplate: r.names[pid].kind })), workflowId: r.canvasId, canvasError: null, notRestored: r.notRestored, copyBecause: [], pendingCanvas: r.canvasId ? undefined : { kind: 'each', apps: r.projectIds.map((pid) => ({ projectId: pid, nodeData: {} })) } }
              await writeJob(tx, job, { result: encryptJson(rr, key) })
            },
          })
          if (o.kind === 'done') {
            original = { mode: 'original', format: 2, apps: o.projectIds.map((pid) => ({ projectId: pid, name: o.names[pid].name, appTemplate: o.names[pid].kind })), workflowId: o.canvasId, canvasError: null, notRestored: o.notRestored, copyBecause: [], pendingCanvas: o.canvasId ? undefined : { kind: 'each', apps: o.projectIds.map((pid) => ({ projectId: pid, nodeData: {} })) } }
          } else copyBecause.push(o.reason)
        }
        result = original ?? await restoreSetCopy(deps, { userId: input.userId, uploadId: up.id, key, agentId: input.agentId, region: up.region, report, set, copyBecause, job })
      }
    }

    const final = await makeCanvas(deps, db, { userId: input.userId, agentId: input.agentId, job }, result)
    await db.$transaction((tx) => writeJob(tx, job, { state: 'done', result: encryptJson(final, key), error: null, expiresAt: new Date(Date.now() + RESTORE_KEEP_MS) }))
    return final
  } catch (e) {
    const code = e instanceof WorkError ? e.code : 'INTERNAL'
    const why = e instanceof WorkError && e.detail ? `${code}: ${e.detail}`.slice(0, 120) : code
    await db.workBackupUpload.updateMany({ where: { id: input.uploadId, state: 'restoring', gen: input.gen }, data: { state: 'failed', error: why, expiresAt: new Date(Date.now() + RESTORE_KEEP_MS) } }).catch(() => undefined)
    if (!(e instanceof WorkError)) console.error('[work-backup] 되살리기 실패:', describeCaughtError(e))
    throw e
  } finally {
    clearInterval(beat)
  }
}

async function makeCanvas(deps: RestoreDeps, db: PrismaClient, c: { userId: string; agentId: string; job: { uploadId: string; gen: number } }, r: RestoreResult): Promise<RestoreResult> {
  const p = r.pendingCanvas
  if (!p) return r
  const ids = p.apps.map((a) => a.projectId)
  const existing = await db.workflow.findMany({ where: { kind: APP_WORKFLOW_KIND, appProjectId: { in: ids }, agent: { userId: c.userId } }, select: { parentWorkflowId: true, appProjectId: true } })
  const { pendingCanvas: _, ...rest } = r
  const inTx = (tx: Prisma.TransactionClient) => writeJob(tx, c.job, {})
  if (p.kind === 'set') {
    if (existing.length) {
      const parents = new Set(existing.map((h) => h.parentWorkflowId))
      const all = ids.every((id) => existing.some((h) => h.appProjectId === id))
      if (all && parents.size === 1 && !parents.has(null)) return { ...rest, workflowId: existing[0].parentWorkflowId, canvasError: null }
      return { ...rest, workflowId: null, canvasError: 'CANVAS_CONFLICT' }
    }
    const cv = await deps.restoreSetCanvas({ userId: c.userId, agentId: c.agentId, name: p.name, description: p.description, workflowJson: p.workflowJson, apps: p.apps, inTx })
    return { ...rest, workflowId: cv.ok ? cv.workflowId : null, canvasError: cv.ok ? null : cv.code }
  }
  let workflowId: string | null = null
  let canvasError: string | null = null
  for (const a of p.apps) {
    const had = existing.find((h) => h.appProjectId === a.projectId && h.parentWorkflowId)
    if (had) { workflowId = workflowId ?? had.parentWorkflowId; continue }
    const cv = await deps.restoreCanvas({ userId: c.userId, projectId: a.projectId, nodeData: a.nodeData, inTx })
    if (cv.ok) workflowId = workflowId ?? cv.workflowId
    else canvasError = canvasError ?? cv.code
  }
  return { ...rest, workflowId, canvasError }
}

async function restoreV1(deps: RestoreDeps, c: { userId: string; agentId: string; key: Buffer; region: string; report: UploadReport; piecesOf(file: number): Array<{ path: string }>; job: { uploadId: string; gen: number } }): Promise<RestoreResult> {
  const file = Number(Object.keys(c.report.partOf)[0] ?? (await deps.db.workBackupUploadFile.findFirstOrThrow({ where: { uploadId: c.job.uploadId } })).fileIndex)
  const bufs: Buffer[] = []
  for (const p of c.piecesOf(file)) bufs.push(decryptBuffer((await deps.download(c.region, p.path)).buffer, c.key))
  const { manifest, project, node, files } = readBackupZip(new Uint8Array(Buffer.concat(bufs)))
  const notRestored = ['references', 'sends', 'handoffs', 'history', 'approvals']
  let result: RestoreResult | null = null
  await importApps(deps, {
    userId: c.userId, agentId: c.agentId, apps: [{ manifest, project, node }], files: { get: async (id) => files.get(id) ?? null },
    onCommit: async (tx, rs) => {
      const r = rs[0]
      result = { mode: 'copy', format: 1, apps: [{ projectId: r.projectId, name: r.name, appTemplate: r.appTemplate }], workflowId: null, canvasError: null, notRestored, copyBecause: ['OLD_FORMAT'], pendingCanvas: { kind: 'each', apps: [{ projectId: r.projectId, nodeData: { ...r.node, label: (r.node.label as string) || r.name } }] } }
      await writeJob(tx, c.job, { result: encryptJson(result, c.key) })
    },
  })
  return result!
}

interface UnpackedSet { manifest: Row; table(dir: string, t: string): Row[] }
async function unpackSet(deps: RestoreDeps, c: { userId: string; uploadId: string; key: Buffer; region: string; report: UploadReport; piecesOf(file: number): Array<{ path: string }> }): Promise<UnpackedSet> {
  const { key } = c
  const prefix = uploadPrefix(c.userId, c.uploadId)
  const chunks = new Map<string, Buffer>()
  let manifest: Row | null = null
  const files = Object.entries(c.report.partOf).map(([f, n]) => ({ file: Number(f), n })).sort((a, b) => a.n - b.n)
  for (const { file } of files) {
    await eachEntry(deps, key, c.region, c.piecesOf(file), async (name, data) => {
      if (name === 'manifest.json') { manifest = JSON.parse(data.toString('utf8')) as Row; return }
      if (name.startsWith('data/')) { chunks.set(name, data); return }
      const m = /^files\/([A-Za-z0-9_-]{1,40})\//.exec(name)
      if (m) await deps.upload(c.region, `${prefix}x/${m[1]}.bin`, encryptBuffer(data, key))
    })
  }
  const mf = manifest as Row | null
  if (!mf || mf.format !== BACKUP_FORMAT_V2) throw new WorkError('INVALID', 'backup: manifest missing')
  const table = (dir: string, t: string): Row[] => {
    const out: Row[] = []
    let i = 1
    for (; ; i++) {
      const b = chunks.get(`data/${dir}/${t}-${String(i).padStart(4, '0')}.json`)
      if (!b) break
      out.push(...parseRows(b, `${dir}/${t}`))
    }
    const pre = `data/${dir}/${t}-`
    const total = [...chunks.keys()].filter((k) => k.startsWith(pre) && /^\d{4}\.json$/.test(k.slice(pre.length))).length
    if (total !== i - 1) throw new WorkError('INVALID', `backup: ${dir}/${t} chunks are not numbered in order`)
    return out
  }
  return { manifest: mf, table }
}

async function restoreSetCopy(deps: RestoreDeps, c: { userId: string; uploadId: string; key: Buffer; agentId: string; region: string; report: UploadReport; set: UnpackedSet; copyBecause: string[]; job: { uploadId: string; gen: number } }): Promise<RestoreResult> {
  const { key } = c
  const prefix = uploadPrefix(c.userId, c.uploadId)
  const mf = c.set.manifest
  const table = c.set.table
  const wfRows = table('workflow', 'workflows')
  const projectIds = Array.isArray(mf.projectIds) ? (mf.projectIds as unknown[]).filter((x): x is string => typeof x === 'string') : []
  if (!projectIds.length) throw new WorkError('INVALID', 'backup: no apps in the set')
  const hiddenOf = (pid: string) => wfRows.find((w) => w.kind === APP_WORKFLOW_KIND && w.app_project_id === pid) ?? null
  const canvasRow = mf.scope === 'workflow' ? wfRows.find((w) => w.workflowId === mf.targetId && w.kind !== APP_WORKFLOW_KIND) ?? null : null
  const plain = wfRows.filter((w) => w.kind !== APP_WORKFLOW_KIND)
  const legacy = !wfRows.some((w) => w.kind === APP_WORKFLOW_KIND) && plain.length === 1 ? plain[0] : null

  const apps = projectIds.map((pid) => {
    const project: Record<string, Row[]> = {}
    for (const t of ['work_project', 'work_app_spec', 'data_sheets', 'data_sheet_rows', 'sheet_row_pair', 'work_task', 'work_submission', 'work_submission_source', 'work_submission_file', 'work_task_file', 'work_note', 'work_message', 'work_file', 'work_alert_fired', 'work_form', 'work_file_page_block', 'work_doc_find_block']) project[t] = table(`apps/${pid}`, t)
    const p0 = project.work_project[0]
    if (!p0) throw new WorkError('INVALID', 'backup: app without project row')
    const kind = String(p0.kind)
    const h = hiddenOf(pid) ?? legacy
    const tpl = kind !== 'free' ? kind : null
    const node = nodeDataFromHidden(String(h?.name ?? ''), typeof h?.workflow_json === 'string' ? h.workflow_json : null, tpl)
    return { pid, hidden: hiddenOf(pid), input: { manifest: { format: BACKUP_FORMAT_V2, appTemplate: kind, appName: h?.name ?? mf.appName, createdAt: mf.createdAt, edition: mf.edition }, project, node, counters: table('account', 'work_counter') } }
  })
  const references: Row[] = []
  const seenRef = new Set<string>()
  for (const pid of projectIds) for (const r of table(`apps/${pid}`, 'project_reference')) { const k = String(r.id); if (!seenRef.has(k)) { seenRef.add(k); references.push(r) } }

  const notRestored = new Set<string>()
  for (const pid of projectIds) {
    if (table(`apps/${pid}`, 'work_event').length) notRestored.add('history')
    if (table(`apps/${pid}`, 'work_send').length) notRestored.add('sends')
    if (table(`apps/${pid}`, 'work_handoff').length) notRestored.add('handoffs')
    if (table(`apps/${pid}`, 'work_public_link').length) notRestored.add('public_links')
    if (table(`apps/${pid}`, 'work_message').some((m) => m.room === 'private' && typeof m.owner === 'string' && m.owner.startsWith('member:'))) notRestored.add('member_private_chats')
    if (table(`apps/${pid}`, 'work_task').some((t) => t.status === 'awaiting')) notRestored.add('approvals')
    if (!c.report.sameAccount && table(`apps/${pid}`, 'work_project')[0]?.kind === 'assembled') notRestored.add('people_outside_team')
  }
  if (references.some((r) => !projectIds.includes(String(r.from_project_id)) || !projectIds.includes(String(r.to_project_id)))) notRestored.add('outside_links')

  let graph: { nodes?: Array<{ id?: string; data?: Row }>; edges?: Array<{ source?: string; target?: string }> } | null = null
  if (canvasRow) {
    try { graph = typeof canvasRow.workflow_json === 'string' && canvasRow.workflow_json ? JSON.parse(canvasRow.workflow_json) : null } catch { graph = null }
    if (!graph || typeof graph !== 'object' || Array.isArray(graph)) throw new WorkError('INVALID', 'backup: canvas JSON')
  }
  const withNode = apps.map((a) => ({ pid: a.pid, nodeId: typeof a.hidden?.parent_node_id === 'string' ? a.hidden.parent_node_id : null }))
  const setCanvas = !!graph && withNode.every((x) => x.nodeId)
  const trusted = c.report.sameAccount && c.report.signatureValid
  if (setCanvas && !trusted) notRestored.add('canvas_connections')
  if (setCanvas && trusted && (graph!.nodes ?? []).some((n) => n.data?.nodeType === 'workAppLink')) notRestored.add('outside_links')

  const counters = table('account', 'work_counter')
  let result: RestoreResult | null = null
  await importApps(deps, {
    userId: c.userId, agentId: c.agentId, apps: apps.map((a) => a.input),
    files: { get: async (id) => { try { return decryptBuffer((await deps.download(c.region, `${prefix}x/${id}.bin`)).buffer, key) } catch { return null } } },
    references,
    onPrepared: () => raiseCounters(deps.db, c.userId, counters),
    onCommit: async (tx, rs) => {
      let pendingCanvas: PendingCanvas
      if (setCanvas) {
        const newOf = new Map(apps.map((a, i) => [a.pid, rs[i]]))
        const sheetMap = new Map(rs.flatMap((r) => r.sheetIds.map(([o, n]) => [`sheet:${o}`, `sheet:${n}`] as [string, string])))
        let json: string
        if (trusted) {
          const drop = new Set((graph!.nodes ?? []).filter((n) => n.data?.nodeType === 'workAppLink').map((n) => n.id))
          const nodes = (graph!.nodes ?? []).filter((n) => !drop.has(n.id))
          const edges = (graph!.edges ?? []).filter((e) => !drop.has(e.source) && !drop.has(e.target))
          json = JSON.stringify(remapDeep({ ...graph, nodes, edges }, new Map([...apps.map((a) => [a.pid, newOf.get(a.pid)!.projectId] as [string, string]), ...sheetMap])))
        } else {
          const nodes = (graph!.nodes ?? []).flatMap((n) => {
            if (n.data?.nodeType === 'start') return [{ ...n, data: { label: 'Start / App', nodeType: 'start', triggerType: 'app' } }]
            const x = withNode.find((w) => w.nodeId === n.id)
            const r = x ? newOf.get(x.pid)! : null
            return r ? [{ ...n, data: { ...importedNodeData(r.node, r.appTemplate), label: (r.node.label as string) || r.name, nodeType: 'workApp' } }] : []
          })
          const ids = new Set(nodes.map((n) => n.id))
          json = JSON.stringify({ nodes, edges: remapDeep((graph!.edges ?? []).filter((e) => ids.has(e.source) && ids.has(e.target)), sheetMap) })
        }
        pendingCanvas = { kind: 'set', name: String(canvasRow!.name ?? 'Work app'), description: typeof canvasRow!.description === 'string' ? canvasRow!.description : null, workflowJson: json, apps: withNode.map((x) => ({ projectId: newOf.get(x.pid)!.projectId, nodeId: x.nodeId!, name: newOf.get(x.pid)!.name })) }
      } else {
        pendingCanvas = { kind: 'each', apps: rs.map((r: ImportResult) => ({ projectId: r.projectId, nodeData: { ...r.node, label: (r.node.label as string) || r.name } })) }
      }
      result = { mode: 'copy', format: 2, apps: rs.map((r) => ({ projectId: r.projectId, name: r.name, appTemplate: r.appTemplate })), workflowId: null, canvasError: null, notRestored: [...notRestored], copyBecause: c.copyBecause, pendingCanvas }
      await writeJob(tx, c.job, { result: encryptJson(result, key) })
    },
  })
  return result!
}
