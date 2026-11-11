
import { storedNoticeOf } from './notices'
import crypto from 'crypto'
import { Prisma, PrismaClient } from '@prisma/client'
import { Unzip, UnzipInflate, strFromU8 } from 'fflate'
import { encryptBuffer } from '@/lib/encryption'
import { WorkError } from './errors'
import { encryptJson } from './sealed'
import { BACKUP_FORMAT } from './backup'
import { isAppTemplateKind } from './app-template-kinds'
import { ALLOWED_MIME, looksLike, workFileBlobPath } from './files'
import { fileMaxBytes } from './file-upload'
import { findTemplate, templateSchema } from './sheet-templates'
import type { SheetTemplate } from './sheet-templates'
import { normalizeRow, uniqueKeyHash } from './sheet-columns'
import { isCalendarDate } from './dates'
import { ASSEMBLED_KIND, NUMBER_COLUMN, SPEC_SHEET_PREFIX, STATUS_COLUMN, specNumberFloors, specSheetName, specTableSchema, TIME_RE, validateSpec, type AppSpec } from './assembled'
import { writeWorkEvent } from './projects'
import { assertAssembledSpec, assertMyFormsForms, assertNoMyFormsTx, assertOneMyForms, raiseCountersTx } from './backup-restore-original'
import { MYFORMS_KIND, checkStoredFormInfo, formSheetSchema, prepareFormRow, type FormInfo } from './myforms'
import { DOC_READ_MAX_PAGES, blockLooksDone, isPageRecList } from './doc-read'
import { docReadSetProblem } from './doc-find'

export const IMPORT_MAX_BYTES = 24 * 1024 * 1024
export const IMPORT_MAX_UNZIPPED = 200 * 1024 * 1024
export const IMPORT_MAX_ENTRIES = 5000
const UPLOAD_WINDOW_MS = 10 * 60_000

export interface ImportDeps {
  db: PrismaClient
  dataKey(db: PrismaClient, userId: string): Promise<Buffer>
  templates: readonly SheetTemplate[]
  region(userId: string): Promise<string>
  upload(region: string, blobPath: string, data: Buffer): Promise<void>
  now?: () => Date
}

type Row = Record<string, unknown>
const bad = (why: string): never => { throw new WorkError('INVALID', `backup: ${why}`) }
const str = (v: unknown, why: string): string => (typeof v === 'string' ? v : bad(why))
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const date = (v: unknown, why: string): Date => { const d = new Date(str(v, why)); return Number.isNaN(d.getTime()) ? bad(why) : d }
const newId = () => `c${crypto.randomBytes(15).toString('base64url').replace(/[^a-z0-9]/gi, '').toLowerCase().padEnd(20, '0').slice(0, 24)}`

function reseal(v: unknown, key: Buffer, remap: (x: unknown) => unknown, why: string): Uint8Array<ArrayBuffer> | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'object' && v && '$json' in v) return encryptJson(remap((v as { $json: unknown }).$json), key)
  if (typeof v === 'object' && v && '$text' in v && typeof (v as { $text: unknown }).$text === 'string') {
    const enc = encryptBuffer(Buffer.from((v as { $text: string }).$text, 'utf8'), key)
    const out = new Uint8Array(new ArrayBuffer(enc.length)); out.set(enc); return out
  }
  return bad(`sealed cell ${why}`)
}
const opened = (v: unknown): unknown => (v && typeof v === 'object' && '$json' in v ? (v as { $json: unknown }).$json : null)

export interface ImportResult { projectId: string; name: string; appTemplate: string; node: Record<string, unknown>; sheetIds: Array<[string, string]> }

export function readBackupZip(zip: Uint8Array): { manifest: Row; project: Record<string, Row[]>; node: Row; files: Map<string, Uint8Array> } {
  if (zip.length > IMPORT_MAX_BYTES) throw new WorkError('INVALID', 'backup too large')
  let entries = 0
  let total = 0
  const out: Record<string, Uint8Array> = {}
  const allowed = (n: string) => n === 'manifest.json' || n === 'project.json' || n === 'node.json' || /^files\/[A-Za-z0-9_-]{1,40}\/[^/]+$/.test(n)
  try {
    const uz = new Unzip()
    uz.register(UnzipInflate)
    uz.onfile = (f) => {
      if (++entries > IMPORT_MAX_ENTRIES) throw new WorkError('INVALID', 'backup: too many entries')
      if (!allowed(f.name)) return
      if (out[f.name]) throw new WorkError('INVALID', 'backup: duplicate entry')
      const chunks: Uint8Array[] = []
      f.ondata = (err, dat, final) => {
        if (err) throw err
        total += dat.length
        if (total > IMPORT_MAX_UNZIPPED) throw new WorkError('INVALID', 'backup: too large when unzipped')
        chunks.push(dat)
        if (final) {
          const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
          let o = 0
          for (const c of chunks) { all.set(c, o); o += c.length }
          out[f.name] = all
        }
      }
      f.start()
    }
    const CHUNK = 64 * 1024
    for (let i = 0; i < zip.length; i += CHUNK) uz.push(zip.subarray(i, Math.min(zip.length, i + CHUNK)), i + CHUNK >= zip.length)
    if (zip.length === 0) uz.push(new Uint8Array(0), true)
  } catch (e) {
    if (e instanceof WorkError) throw e
    throw new WorkError('INVALID', 'backup: not a zip file')
  }
  if (!out['manifest.json']) throw new WorkError('INVALID', 'backup: not a work app backup')
  const json = (name: string): unknown => {
    if (!out[name]) bad(`${name} missing`)
    try { return JSON.parse(strFromU8(out[name])) } catch { return bad(`${name} is not JSON`) }
  }
  const manifest = json('manifest.json') as Row
  if (!manifest || manifest.format !== BACKUP_FORMAT) bad('unknown format')
  const project = json('project.json') as Record<string, Row[]>
  if (!project || typeof project !== 'object' || Array.isArray(project)) bad('project.json shape')
  for (const [k, v] of Object.entries(project)) if (!Array.isArray(v) || v.some((r) => !r || typeof r !== 'object' || Array.isArray(r))) bad(`table ${k}`)
  const node = (out['node.json'] ? json('node.json') : {}) as Row
  const files = new Map<string, Uint8Array>()
  for (const [name, bytes] of Object.entries(out)) {
    const m = /^files\/([A-Za-z0-9_-]{1,40})\//.exec(name)
    if (m) { if (files.has(m[1])) bad('two entries for one file'); files.set(m[1], bytes) }
  }
  return { manifest, project, node: node && typeof node === 'object' && !Array.isArray(node) ? node : {}, files }
}

export function importedMessageRoom(m: Row): {} | { room: 'private'; owner: 'human' } | null {
  if (m.room === undefined || m.room === null || m.room === 'team') return {}
  if (m.room === 'private' && m.owner === 'human') return { room: 'private', owner: 'human' }
  return null
}

export function importedNodeData(node: Row, appTemplate: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of ['appWelcomeMessage', 'accessMode', 'label'] as const) if (typeof node[k] === 'string') out[k] = (node[k] as string).slice(0, 2000)
  if (node.ai && typeof node.ai === 'object' && !Array.isArray(node.ai)) {
    const ai: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(node.ai as Row)) {
      if ((k === 'model' || k === 'systemMessage') && typeof v === 'string') ai[k] = v.slice(0, 20000)
      else if ((k === 'imageInput' || k === 'pdfInput' || k === 'includeChatHistory') && typeof v === 'boolean') ai[k] = v
      else if (k === 'maxTokens' && typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 200000) ai[k] = v
    }
    out.ai = ai
  }
  if (appTemplate !== 'free') out.appTemplate = appTemplate
  return out
}

const NOTE_KINDS = new Set(['conclusion', 'todo', 'source'])
const NOTE_STATUS = new Set(['accepted', 'proposed'])
const ROLES = new Set(['user', 'assistant'])
const TASK_STATUS = new Set(['open', 'awaiting', 'submitted'])
const FILE_KINDS = new Set(['receipt', 'bank_csv', 'report', 'page_image', 'invoice', 'other'])
const oneOf = (v: unknown, set: Set<string>, why: string): string => { const x = str(v, why); return set.has(x) ? x : bad(why) }
const capped = (v: unknown, max: number, why: string): string => { const x = str(v, why); return x.length > 0 && x.length <= max ? x : bad(why) }
const cappedOrNull = (v: unknown, max: number): string | null => (typeof v === 'string' ? v.slice(0, max) : null)
const ymd = (v: unknown, why: string): Date | null => {
  if (v === null || v === undefined) return null
  const x = str(v, why)
  return /^\d{4}-\d{2}-\d{2}/.test(x) && !Number.isNaN(new Date(x).getTime()) ? new Date(x) : bad(why)
}

export async function importBackup(deps: ImportDeps, input: { userId: string; agentId: string; zip: Uint8Array }): Promise<ImportResult> {
  const { manifest, project, node, files } = readBackupZip(input.zip)
  const [r] = await importApps(deps, { userId: input.userId, agentId: input.agentId, apps: [{ manifest, project, node }], files: { get: async (id) => files.get(id) ?? null } })
  return r
}

export interface ImportApp { manifest: Row; project: Record<string, Row[]>; node: Row; counters?: Row[] }
export interface FileSource { get(oldId: string): Promise<Uint8Array | null> }
interface PrepareCtx { userId: string; key: Buffer; templates: readonly SheetTemplate[]; ids: Map<string, string>; kindOf: Map<string, string>; ownerOf: Map<string, string>; files: FileSource }

const ID_TABLES = ['data_sheets', 'work_form', 'data_sheet_rows', 'sheet_row_pair', 'work_task', 'work_submission', 'work_task_file', 'work_submission_file', 'work_note', 'work_message', 'work_file'] as const
function registerIds(ctx: PrepareCtx, app: ImportApp): void {
  const T = (name: string): Row[] => app.project[name] ?? []
  const p0 = T('work_project')[0] ?? bad('no project')
  const oldPid = str(p0.id, 'project id')
  if (ctx.ids.has(oldPid)) bad('duplicate project id')
  ctx.ids.set(oldPid, newId()); ctx.kindOf.set(oldPid, 'work_project'); ctx.ownerOf.set(oldPid, oldPid)
  for (const t of ID_TABLES) {
    for (const r of T(t)) {
      const id = capped(r.id, 25, `${t}.id`)
      if (ctx.ids.has(id)) bad(`duplicate id in ${t}`)
      ctx.ids.set(id, newId()); ctx.kindOf.set(id, t); ctx.ownerOf.set(id, oldPid)
    }
  }
}

async function prepareApp(ctx: PrepareCtx, app: ImportApp) {
  const { manifest, project, node } = app
  const { key, userId, ids, kindOf } = ctx
  const T = (name: string): Row[] => project[name] ?? []

  const p0 = T('work_project')[0] ?? bad('no project')
  const kind = str(p0.kind, 'project kind')
  if (kind !== 'free' && !isAppTemplateKind(kind)) throw new WorkError('INVALID', `backup: app template "${kind}" is not installed here`)
  if (manifest.appTemplate !== kind) bad('manifest does not match project')
  assertAssembledSpec(kind, T('work_app_spec'))
  assertMyFormsForms(kind, T('data_sheets'), T('work_form'))
  const settingsRaw = opened(p0.settings)
  if (settingsRaw !== null && (typeof settingsRaw !== 'object' || Array.isArray(settingsRaw))) bad('project settings shape')

  const oldPid = str(p0.id, 'project id')
  const pid = ids.get(oldPid)!
  const ref = (v: unknown, table: string, why: string): string => { const id = str(v, why); return kindOf.get(id) === table && ctx.ownerOf.get(id) === oldPid ? ids.get(id)! : bad(`${why} must point to ${table} in the backup`) }
  const refOrNull = (v: unknown, table: string, why: string): string | null => (v === null || v === undefined ? null : ref(v, table, why))
  const remap = (v: unknown): unknown => {
    if (typeof v === 'string') {
      if (ids.has(v)) return ids.get(v)
      if (v.includes(',')) { const parts = v.split(','); if (parts.some((x) => ids.has(x.trim()))) return parts.map((x) => ids.get(x.trim()) ?? x).join(',') }
      return v
    }
    if (Array.isArray(v)) return v.map(remap)
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, remap(x)]))
    return v
  }
  const settings = (settingsRaw ? remap(settingsRaw) : {}) as Row
  const name = ((typeof settings.name === 'string' && settings.name) || (typeof manifest.appName === 'string' ? manifest.appName : '') || 'Work app').slice(0, 120)
  const sealedNeeded = (v: unknown, why: string, map = remap) => reseal(v, key, map, why) ?? bad(why)

  const fileRows = T('work_file')
  for (const f of fileRows) {
    const oldId = f.id as string
    const bytes = (await ctx.files.get(oldId)) ?? bad(`file ${oldId} missing in zip`)
    const buf = Buffer.from(bytes)
    const mime = str(f.mime_type, 'file mime').split(';')[0].trim().toLowerCase()
    if (buf.length === 0 || buf.length > fileMaxBytes(str(f.mime_type, 'file mime')) || buf.length !== f.size_bytes) bad(`file ${oldId} size`)
    if (typeof f.sha256 !== 'string' || crypto.createHash('sha256').update(buf).digest('hex') !== f.sha256) bad(`file ${oldId} sha256`)
    if (!ALLOWED_MIME.has(mime) || !looksLike(mime, buf)) bad(`file ${oldId} type`)
  }
  if (new Set(fileRows.map((f) => f.sha256)).size !== fileRows.length) bad('same file twice')
  const parentOf = new Map(fileRows.map((f) => [f.id as string, f.parent_file_id ?? null]))
  for (const f of fileRows) {
    const par = f.parent_file_id
    if (par === null || par === undefined) continue
    if (par === f.id || kindOf.get(str(par, 'parent file')) !== 'work_file' || parentOf.get(par as string) !== null) bad('derived file must point to an original file')
  }
  const fileData = fileRows.map((f) => ({
    oldId: f.id as string,
    data: {
      id: ids.get(f.id as string)!, projectId: pid, userId: userId, kind: oneOf(f.kind, FILE_KINDS, 'file kind'), parentFileId: refOrNull(f.parent_file_id, 'work_file', 'parent file'),
      mimeType: str(f.mime_type, 'mime').split(';')[0].trim().toLowerCase(), sizeBytes: f.size_bytes as number, sha256: f.sha256 as string,
      payload: sealedNeeded(f.payload, 'file payload', (x) => x), readText: reseal(f.read_text, key, (x) => x, 'file text'), uploadedAt: date(f.uploaded_at, 'file uploaded_at'),
    },
  })).sort((a, b) => (a.data.parentFileId ? 1 : 0) - (b.data.parentFileId ? 1 : 0))

  const sheetNames = new Set<string>()
  const sheets = T('data_sheets').map((s) => {
    let schema: { columns?: unknown[]; unique?: string[] }
    try { schema = JSON.parse(str(s.schema, 'sheet schema')) } catch { return bad('sheet schema JSON') }
    if (!schema || !Array.isArray(schema.columns)) bad('sheet columns')
    const template = strOrNull(s.template)
    let tpl: SheetTemplate | null = null
    if (template) {
      try { tpl = findTemplate(ctx.templates, template) } catch { throw new WorkError('INVALID', `backup: sheet template "${template}" is not installed here`) }
    }
    const finalSchema = tpl ? (templateSchema(tpl) as { columns?: unknown[]; unique?: string[] }) : schema
    if (!tpl && schema.unique !== undefined) {
      const names = new Set((schema.columns as Array<{ name?: unknown }>).map((c) => c?.name))
      if (!Array.isArray(schema.unique) || schema.unique.some((u) => typeof u !== 'string' || !names.has(u))) bad('sheet unique columns')
    }
    const sname = capped(s.name, 255, 'sheet name')
    if (sheetNames.has(sname)) bad('two sheets with one name')
    sheetNames.add(sname)
    return { oldId: s.id as string, tpl, schema: finalSchema, family: tpl ? tpl.family : null, newId: ids.get(s.id as string)!, name: sname, description: cappedOrNull(s.description, 2000), template: tpl ? template : null }
  })
  const sheetOf = new Map(sheets.map((x) => [x.oldId, x]))
  const rows = T('data_sheet_rows').map((r) => {
    const sh = sheetOf.get(str(r.sheet_id, 'row sheet')) ?? bad('row must point to a sheet in the backup')
    let plain: Row
    try { plain = remap(JSON.parse(str(r.row_data, 'row data'))) as Row } catch (e) { if (e instanceof WorkError) throw e; return bad('row data JSON') }
    if (!plain || typeof plain !== 'object' || Array.isArray(plain)) bad('row data shape')
    const sealedOpen = r.sealed == null ? null : (remap(opened(r.sealed) ?? bad('row sealed')) as Row)
    const full = { ...plain, ...(sealedOpen ?? {}) }
    const why = sh.tpl?.checkRow?.(full)
    if (why) throw new WorkError('INVALID', `backup: row rule — ${why}`)
    const confirmed = typeof r.confirmed === 'boolean' ? r.confirmed : null
    return {
      sh, full, sealedOpen,
      data: {
        id: ids.get(r.id as string)!, sheetId: sh.newId, kind: 'project', projectId: pid, userId: userId,
        rowData: JSON.stringify(plain), sealed: sealedOpen ? encryptJson(sealedOpen, key) : null,
        confirmed, confirmedBy: confirmed === true ? cappedOrNull(r.confirmed_by, 80) : null,
        channelKey: null, createdAt: date(r.created_at, 'row created_at'), updatedAt: date(r.updated_at, 'row updated_at'),
      },
    }
  })
  const asm = kind === ASSEMBLED_KIND ? prepareAssembled({ T, sheets, rows, ref, oldPid, pid, key, counters: app.counters ?? [], newIds: new Set(ids.values()), newIdOf: (x) => ids.get(x), projectNewId: (x) => (kindOf.get(x) === 'work_project' ? ids.get(x) ?? null : null) }) : null
  const myForms = kind === MYFORMS_KIND ? prepareMyForms({ T, sheets, rows, ref, ids, oldPid, pid, key }) : null
  const keyData: Prisma.SheetRowKeyCreateManyInput[] = []
  const seenKey = new Set<string>()
  for (const x of rows) {
    const unique = x.sh.schema.unique
    if (!Array.isArray(unique) || !unique.length) continue
    const fam = x.sh.family ?? `sheet:${x.sh.newId}`
    const hash = uniqueKeyHash(unique, x.full)
    if (seenKey.has(`${fam}|${hash}`)) bad('duplicate row key')
    seenKey.add(`${fam}|${hash}`)
    keyData.push({ projectId: pid, userId: userId, templateFamily: fam, keyHash: hash, rowId: x.data.id })
  }
  const pairData = T('sheet_row_pair').map((r) => {
    const from = ref(r.from_row_id, 'data_sheet_rows', 'pair from')
    const to = ref(r.to_row_id, 'data_sheet_rows', 'pair to')
    if (from === to) bad('pair to itself')
    return { id: ids.get(r.id as string)!, projectId: pid, userId: userId, fromRowId: from, toRowId: to, kind: capped(r.kind, 40, 'pair kind'), confirmed: r.confirmed === true, createdAt: date(r.created_at, 'pair created_at') }
  })
  const subTask = new Map(T('work_submission').map((x) => [x.id as string, x.task_id]))
  const taskData = T('work_task').map((t) => {
    if (t.current_submission_id != null && subTask.get(str(t.current_submission_id, 'current submission')) !== t.id) bad('current submission of another task')
    const ps = ymd(t.period_start, 'task period'); const pe = ymd(t.period_end, 'task period')
    if ((ps === null) !== (pe === null) || (ps && pe && ps > pe)) bad('task period')
    const status = oneOf(t.status, TASK_STATUS, 'task status')
    return {
      current: t.current_submission_id == null ? null : ids.get(t.current_submission_id as string)!,
      data: { id: ids.get(t.id as string)!, projectId: pid, userId: userId, title: capped(t.title, 120, 'task title'), periodStart: ps, periodEnd: pe, status: status === 'awaiting' ? 'open' : status, submittedAt: t.submitted_at == null ? null : date(t.submitted_at, 'submitted_at'), createdAt: date(t.created_at, 'task created_at') },
    }
  })
  const seenSub = new Set<string>()
  const subData = T('work_submission').map((x) => {
    if (!Number.isInteger(x.number) || (x.number as number) < 1 || (x.number as number) > 100000) bad('submission number')
    const sk = `${String(x.task_id)}|${String(x.number)}`
    if (seenSub.has(sk)) bad('two submissions with one number')
    seenSub.add(sk)
    return {
      id: ids.get(x.id as string)!, taskId: ref(x.task_id, 'work_task', 'submission task'), projectId: pid, userId: userId, number: x.number as number,
      submittedAt: date(x.submitted_at, 'submitted_at'), result: sealedNeeded(x.result, 'submission result'),
      refAckDigest: null, approvedBy: cappedOrNull(x.approved_by, 80), preparedBy: cappedOrNull(x.prepared_by, 80),
    }
  })
  const taskFileData = T('work_task_file').map((r) => ({ id: ids.get(r.id as string)!, taskId: ref(r.task_id, 'work_task', 'task file task'), fileId: ref(r.file_id, 'work_file', 'task file file'), projectId: pid, userId: userId, createdAt: date(r.created_at, 'task file created_at') }))
  const subFileData = T('work_submission_file').map((r) => ({ id: ids.get(r.id as string)!, submissionId: ref(r.submission_id, 'work_submission', 'submission file submission'), fileId: ref(r.file_id, 'work_file', 'submission file file'), projectId: pid, userId: userId, attachedAt: date(r.attached_at, 'attached_at') }))
  const noteData = T('work_note').map((n) => ({ id: ids.get(n.id as string)!, projectId: pid, userId: userId, taskId: refOrNull(n.task_id, 'work_task', 'note task'), kind: oneOf(n.kind, NOTE_KINDS, 'note kind'), status: oneOf(n.status, NOTE_STATUS, 'note status'), body: sealedNeeded(n.body, 'note body'), createdAt: date(n.created_at, 'note created_at'), updatedAt: date(n.updated_at, 'note updated_at') }))
  const msgData = T('work_message').flatMap((m): Prisma.WorkMessageCreateManyInput[] => {
    const room = importedMessageRoom(m)
    if (room === null) return []
    if (m.role === 'notice') {
      const n = 'room' in room || m.task_id ? null : storedNoticeOf((m.body as { $json?: unknown } | null)?.$json)
      return n ? [{ id: ids.get(m.id as string)!, projectId: pid, userId: userId, taskId: null, role: 'notice', actor: 'notice', room: 'team', owner: null, body: sealedNeeded({ $json: { text: '', notice: n } }, 'message body'), createdAt: date(m.created_at, 'message created_at') }] : []
    }
    return [{ id: ids.get(m.id as string)!, projectId: pid, userId: userId, taskId: refOrNull(m.task_id, 'work_task', 'message task'), role: oneOf(m.role, ROLES, 'message role'), actor: str(m.actor, 'message actor').slice(0, 40), body: sealedNeeded(m.body, 'message body'), createdAt: date(m.created_at, 'message created_at'), ...room }]
  })
  const originalIds = new Set(fileRows.filter((f) => f.parent_file_id === null || f.parent_file_id === undefined).map((f) => f.id as string))
  const docFile = (v: unknown, why: string) => { const id = str(v, why); if (!originalIds.has(id)) bad(`${why} must point to an original file`); return ref(id, 'work_file', why) }
  const seenBlocks = new Set<string>()
  const pageBlockData = T('work_file_page_block').map((r) => {
    const fileId = docFile(r.file_id, 'page block file')
    const b = r.block_no; const total = r.total_pages
    if (!Number.isInteger(b) || !Number.isInteger(total) || (b as number) < 0 || (total as number) < 1 || (total as number) > DOC_READ_MAX_PAGES || (b as number) * 10 >= (total as number)) bad('page block number')
    const state = r.state === 'done' ? 'done' : r.state === 'partial' ? 'partial' : bad('page block state')
    const pages = opened(r.pages)
    if (!isPageRecList(pages, b as number, total as number) || (state === 'done' && !blockLooksDone(pages, b as number, total as number))) bad('page block pages')
    const k = `${fileId}|${b}`
    if (seenBlocks.has(k)) bad('two page blocks for one file block')
    seenBlocks.add(k)
    return { id: newId(), fileId, projectId: pid, userId, blockNo: b as number, totalPages: total as number, pages: encryptJson(pages, key), state, charged: r.charged === true }
  })
  const seenFinds = new Set<string>()
  const findBlockData = T('work_doc_find_block').map((r) => {
    const fileId = docFile(r.file_id, 'find block file')
    const b = r.block_no
    if (!Number.isInteger(b) || (b as number) < 0 || (b as number) >= DOC_READ_MAX_PAGES / 10) bad('find block number')
    const hash = typeof r.fields_hash === 'string' && /^[0-9a-f]{64}$/.test(r.fields_hash) ? r.fields_hash : bad('find block fields')
    const state = r.state === 'done' ? 'done' : r.state === 'open' ? 'open' : bad('find block state')
    const result = r.result === null || r.result === undefined ? null : opened(r.result)
    if (state === 'done' && result === null) bad('find block result')
    const k = `${fileId}|${hash}|${b}`
    if (seenFinds.has(k)) bad('two find blocks for one file block')
    seenFinds.add(k)
    return { id: newId(), fileId, projectId: pid, userId, fieldsHash: hash, blockNo: b as number, result: result === null ? null : encryptJson(result, key), state, charged: r.charged === true }
  })
  const docProblem = docReadSetProblem(pageBlockData.map((x) => ({ file: x.fileId, blockNo: x.blockNo, totalPages: x.totalPages })), T('work_doc_find_block').map((r) => ({ file: docFile(r.file_id, 'find block file'), blockNo: r.block_no as number, result: r.result === null || r.result === undefined ? null : opened(r.result) })))
  if (docProblem) bad(docProblem)
  const sheetStats = new Map(sheets.map((x) => [x.newId, { rows: 0, bytes: 0 }]))
  for (const x of rows) { const st = sheetStats.get(x.sh.newId)!; st.rows++; st.bytes += Buffer.byteLength(x.data.rowData, 'utf8') + (x.data.sealed?.length ?? 0) }

  return { pid, kind, name, settings, p0, manifest, node, fileRows, fileData, sheets, rows, keyData, pairData, taskData, subData, taskFileData, subFileData, noteData, msgData, sheetStats, asm, myForms, pageBlockData, findBlockData }
}

function prepareMyForms(c: {
  T(name: string): Row[]
  sheets: Array<{ oldId: string; newId: string; name: string; template: string | null; schema: { columns?: unknown[]; unique?: string[] }; tpl: SheetTemplate | null }>
  rows: Array<{ sh: { oldId: string; newId: string }; full: Row; sealedOpen: Row | null; data: { id: string; rowData: string; sealed: ReturnType<typeof encryptJson> | null } }>
  ref(v: unknown, table: string, why: string): string
  ids: Map<string, string>
  oldPid: string
  pid: string
  key: Buffer
}) {
  const bySheet = new Map<string, { info: FormInfo; version: number }>()
  const live = new Set<string>()
  const formData = c.T('work_form').map((f) => {
    if (f.project_id !== c.oldPid) bad('form of another app')
    const sheetNew = c.ref(f.sheet_id, 'data_sheets', 'form sheet')
    const sh = c.sheets.find((x) => x.newId === sheetNew)!
    if (bySheet.has(sh.oldId)) bad('two forms on one sheet')
    if (sh.template !== null || sh.tpl) bad('form sheet has a template')
    const shape = f.shape === 'single' || f.shape === 'items' ? f.shape : bad('form shape')
    const info = checkStoredFormInfo(opened(f.info), shape)
    const name = capped(f.name, 40, 'form name').trim() || bad('form name')
    const deletedAt = f.deleted_at == null ? null : date(f.deleted_at, 'form deleted_at')
    if (!deletedAt) { const k = name.toLowerCase(); if (live.has(k)) bad('two live forms with one name'); live.add(k) }
    const version = f.version
    if (!Number.isSafeInteger(version) || (version as number) < 1 || (version as number) > 2_147_483_647) bad('form version')
    const id = c.ids.get(str(f.id, 'form id'))!
    sh.name = `form_${id}`
    sh.schema = formSheetSchema(info)
    bySheet.set(sh.oldId, { info, version: version as number })
    return { id, projectId: c.pid, sheetId: sheetNew, name, shape, version: version as number, info, saveKey: `restore-${crypto.randomBytes(12).toString('hex')}`, createdAt: date(f.created_at, 'form created_at'), deletedAt }
  })
  for (const x of c.rows) {
    const f = bySheet.get(x.sh.oldId)
    if (!f) continue
    if (x.sealedOpen !== null && (typeof x.sealedOpen !== 'object' || Array.isArray(x.sealedOpen))) bad('row sealed shape')
    const plain = JSON.parse(x.data.rowData) as Row
    if (x.sealedOpen) for (const k of Object.keys(x.sealedOpen)) if (k in plain && JSON.stringify(plain[k]) !== JSON.stringify(x.sealedOpen[k])) bad('row: two values for one column')
    let split: { plain: Row; sealed: Row | null }
    try { split = normalizeRow(formSheetSchema(f.info), prepareFormRow({ info: f.info, version: f.version }, x.full)) } catch (e) { return bad(`form row: ${e instanceof WorkError ? (e.detail ?? e.message) : 'shape'}`) }
    x.data.rowData = JSON.stringify(split.plain)
    x.data.sealed = split.sealed ? encryptJson(split.sealed, c.key) : null
    x.full = { ...split.plain, ...(split.sealed ?? {}) }
  }
  return { formData }
}

function prepareAssembled(c: {
  T(name: string): Row[]
  sheets: Array<{ oldId: string; newId: string; name: string; template: string | null; schema: { columns?: unknown[]; unique?: string[] }; tpl: SheetTemplate | null }>
  rows: Array<{ sh: { oldId: string; newId: string }; full: Row; sealedOpen: Row | null; data: { id: string; rowData: string; sealed: ReturnType<typeof encryptJson> | null } }>
  ref(v: unknown, table: string, why: string): string
  oldPid: string
  pid: string
  key: Buffer
  counters: Row[]
  newIds: ReadonlySet<string>
  newIdOf(oldId: string): string | undefined
  projectNewId(oldId: string): string | null
}) {
  const specRow = c.T('work_app_spec')[0]
  const v = validateSpec(opened(specRow.info))
  if (!v.ok) bad(`app spec — ${v.issues[0]?.path ?? ''} ${v.issues[0]?.code ?? ''}`.trim())
  const spec = (v as { ok: true; spec: AppSpec }).spec
  for (const t of spec.tables) for (const d of t.docs ?? []) if (d.letterhead) { const n = c.newIdOf(d.letterhead.file); if (n) d.letterhead.file = n }
  for (const t of spec.tables) for (const col of t.columns) if (col.kind === 'ref' && col.ref?.app) { const n = c.projectNewId(col.ref.app); if (n) col.ref.app = n }
  for (const x of spec.appSends ?? []) { const n = c.projectNewId(x.to.app); if (n) x.to.app = n }
  const version = specRow.version
  if (!Number.isSafeInteger(version) || (version as number) < 1 || (version as number) > 2_147_483_647) bad('app spec version')
  const tableOfSheet = new Map<string, AppSpec['tables'][number]>()
  for (const t of spec.tables) {
    const sh = c.sheets.find((x) => x.name === specSheetName(t.key)) ?? bad(`no sheet for table ${t.key}`)
    if (sh.template !== null || sh.tpl) bad(`sheet of table ${t.key} has a template`)
    sh.schema = specTableSchema(t)
    tableOfSheet.set(sh.oldId, t)
  }
  for (const sh of c.sheets) if (sh.name.startsWith(SPEC_SHEET_PREFIX) && !tableOfSheet.has(sh.oldId)) bad(`sheet ${sh.name.slice(0, 40)} is not in the app spec`)
  const rowTable = new Map<string, string>()
  for (const x of c.rows) {
    const t = tableOfSheet.get(x.sh.oldId)
    if (!t) continue
    const plain = JSON.parse(x.data.rowData) as Row
    const sealedOpen = x.sealedOpen
    if (sealedOpen !== null && (typeof sealedOpen !== 'object' || Array.isArray(sealedOpen))) bad(`row of table ${t.key}: sealed shape`)
    for (const k of [STATUS_COLUMN, NUMBER_COLUMN]) if (sealedOpen && k in sealedOpen) bad(`row of table ${t.key}: ${k} must not be sealed`)
    if (sealedOpen) for (const k of Object.keys(sealedOpen)) if (k in plain && JSON.stringify(plain[k]) !== JSON.stringify(sealedOpen[k])) bad(`row of table ${t.key}: two values for one column`)
    const st = x.full[STATUS_COLUMN]
    if (st !== undefined && st !== null && st !== '' && !(t.status && typeof st === 'string' && t.status.values.includes(st))) bad(`row of table ${t.key}: status`)
    const no = x.full[NUMBER_COLUMN]
    if (no !== undefined && no !== null && no !== '' && typeof no !== 'string') bad(`row of table ${t.key}: number`)
    for (const col of t.columns) if (col.kind === 'ref') { const v = x.full[col.key]; if (v !== undefined && v !== null && v !== '' && (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(v))) bad(`row of table ${t.key}: ${col.key} must be a row id`) }
    for (const col of t.columns) if (col.kind === 'time') { const v = x.full[col.key]; if (v !== undefined && v !== null && v !== '' && (typeof v !== 'string' || !TIME_RE.test(v))) bad(`row of table ${t.key}: ${col.key} must be a time HH:MM`) }
    let split: { plain: Row; sealed: Row | null }
    try { split = normalizeRow(specTableSchema(t), x.full) } catch (e) { return bad(`row of table ${t.key}: ${e instanceof WorkError ? (e.detail ?? e.message) : 'shape'}`) }
    x.data.rowData = JSON.stringify(split.plain)
    x.data.sealed = split.sealed ? encryptJson(split.sealed, c.key) : null
    x.full = { ...split.plain, ...(split.sealed ?? {}) }
    rowTable.set(x.data.id, t.key)
  }
  const crossChecks: Array<{ app: string; table: string; value: string; where: string }> = []
  for (const x of c.rows) {
    const tk = rowTable.get(x.data.id)
    const t = tk ? spec.tables.find((y) => y.key === tk) : undefined
    if (!t) continue
    for (const col of t.columns) {
      if (col.kind !== 'ref' || !col.ref) continue
      const v = x.full[col.key]
      if (typeof v !== 'string' || v === '' || !c.newIds.has(v)) continue
      if (col.ref.app) { crossChecks.push({ app: col.ref.app, table: col.ref.table, value: v, where: `row of table ${t.key}: ${col.key}` }); continue }
      if (rowTable.get(v) !== col.ref.table) bad(`row of table ${t.key}: ${col.key} points to a row of another table`)
    }
  }
  const seen = new Set<string>()
  const alertData = c.T('work_alert_fired').map((a) => {
    const tk = str(a.table_key, 'alert table')
    const t = spec.tables.find((x) => x.key === tk) ?? bad('alert record of a table not in the app spec')
    const ak = str(a.alert_key, 'alert key')
    if (!(t.alerts ?? []).some((x) => x.key === ak)) bad('alert record of an alert not in the app spec')
    const rowId = c.ref(a.row_id, 'data_sheet_rows', 'alert row')
    if (rowTable.get(rowId) !== tk) bad('alert record must point to a row of its table')
    const target = str(a.target_date, 'alert date')
    if (!isCalendarDate(target)) bad('alert date')
    const k = `${rowId}|${tk}|${ak}`
    if (seen.has(k)) bad('two alert records for one row')
    seen.add(k)
    return { id: newId(), projectId: c.pid, rowId, tableKey: tk, alertKey: ak, targetDate: target, late: a.late === true, sendId: null, firedAt: date(a.fired_at, 'alert fired_at') }
  })
  const prefix = `asm:${c.oldPid}:`
  const moved = c.counters.flatMap((r) => {
    const name = typeof r.name === 'string' ? r.name : ''
    const value = r.value
    if (!name.startsWith(prefix) || !/^[0-9a-f]{12}:(\d{4}|all)$/.test(name.slice(prefix.length)) || !Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 2_147_483_647) return []
    return [{ name: `asm:${c.pid}:${name.slice(prefix.length)}`, value: value as number }]
  })
  const floors = specNumberFloors(spec, c.pid, (tk) => c.rows.filter((x) => rowTable.get(x.data.id) === tk).map((x) => x.full))
  return { spec, version: version as number, alertData, counters: [...moved, ...floors], rowTable, crossChecks }
}
type PreparedApp = Awaited<ReturnType<typeof prepareApp>>

export async function importApps(deps: ImportDeps, input: { userId: string; agentId: string; apps: ImportApp[]; files: FileSource; references?: Row[]; onPrepared?(): Promise<void>; onCommit?(tx: Prisma.TransactionClient, results: ImportResult[]): Promise<void> }): Promise<ImportResult[]> {
  const { db } = deps
  const now = deps.now?.() ?? new Date()
  const key = await deps.dataKey(db, input.userId)
  if (!input.apps.length) bad('no apps')
  const ctx: PrepareCtx = { userId: input.userId, key, templates: deps.templates, ids: new Map(), kindOf: new Map(), ownerOf: new Map(), files: input.files }
  for (const app of input.apps) registerIds(ctx, app)
  const prepared: PreparedApp[] = []
  for (const app of input.apps) prepared.push(await prepareApp(ctx, app))
  const rowTableOf = new Map(prepared.flatMap((a) => (a.asm ? [[a.pid, a.asm.rowTable] as const] : [])))
  const setPids = new Set(prepared.map((a) => a.pid))
  for (const a of prepared) for (const x of a.asm?.crossChecks ?? []) {
    if (!setPids.has(x.app) || rowTableOf.get(x.app)?.get(x.value) !== x.table) bad(`${x.where} points to something that is not a row of "${x.table}" of that app`)
  }
  const hasMyForms = assertOneMyForms(prepared.map((a) => a.kind))
  if (hasMyForms) await db.$transaction((tx) => assertNoMyFormsTx(tx, input.userId))
  const projectNew = (v: unknown) => (typeof v === 'string' && ctx.kindOf.get(v) === 'work_project' ? ctx.ids.get(v)! : null)
  const refData: Prisma.ProjectReferenceCreateManyInput[] = []
  for (const r of input.references ?? []) {
    const from = projectNew(r.from_project_id)
    const to = projectNew(r.to_project_id)
    if (!from || !to || from === to || !Array.isArray(r.sheets) || !r.sheets.length) continue
    const sheets = (r.sheets as unknown[]).map((x) => {
      const v = str(x, 'reference sheet')
      const m = /^sheet:(.+)$/.exec(v)
      return m ? (ctx.kindOf.get(m[1]) === 'data_sheets' && ctx.ownerOf.get(m[1]) === r.to_project_id ? `sheet:${ctx.ids.get(m[1])}` : bad('reference sheet must point to a sheet in the backup')) : v
    })
    if (refData.some((x) => x.fromProjectId === from && x.toProjectId === to)) continue
    if (r.created_by_workflow_id != null) continue
    refData.push({ id: newId(), userId: input.userId, fromProjectId: from, toProjectId: to, sheets, includeUnconfirmed: r.include_unconfirmed === true, createdByWorkflowId: null })
  }

  if (input.onPrepared) await input.onPrepared()

  const region = await deps.region(input.userId)
  const deadline = new Date(now.getTime() + UPLOAD_WINDOW_MS)
  const purges: string[] = []
  const blobPathOf = new Map<string, string>()
  for (const a of prepared) {
    const purge = await db.workPurge.create({ data: { userId: input.userId, kind: 'upload', state: 'uploading', projectId: a.pid, blobRegions: [region], deadline } })
    purges.push(purge.id)
    for (const f of a.fileData) {
      if (Date.now() >= deadline.getTime()) throw new WorkError('STALE', 'upload took too long')
      const path = workFileBlobPath(input.userId, a.pid, f.data.sha256, now)
      const bytes = (await input.files.get(f.oldId)) ?? bad(`file ${f.oldId} missing`)
      let timer: NodeJS.Timeout | undefined
      try {
        await Promise.race([
          deps.upload(region, path, encryptBuffer(Buffer.from(bytes), key)),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new WorkError('STALE', 'upload took too long')), Math.max(0, deadline.getTime() - Date.now())) }),
        ])
      } finally { if (timer) clearTimeout(timer) }
      blobPathOf.set(f.oldId, path)
    }
  }

  const results: ImportResult[] = prepared.map((a) => ({ projectId: a.pid, name: a.name, appTemplate: a.kind, node: importedNodeData(a.node, a.kind), sheetIds: a.sheets.map((x) => [x.oldId, x.newId] as [string, string]) }))
  try {
    await db.$transaction(async (tx) => {
      const held = await tx.$queryRaw<Array<{ id: string; state: string; deadline: Date | null }>>`SELECT id, state, deadline FROM work_purge WHERE id = ANY(${purges}::text[]) ORDER BY id FOR UPDATE`
      if (held.length !== purges.length || held.some((h) => h.state !== 'uploading' || !h.deadline || h.deadline.getTime() <= Date.now())) throw new WorkError('STALE', 'upload window closed')
      if (hasMyForms) { await tx.$queryRaw`SELECT id FROM "user" WHERE id = ${input.userId} FOR NO KEY UPDATE`; await assertNoMyFormsTx(tx, input.userId) }
      for (const a of prepared) await insertApp(tx, key, { userId: input.userId, agentId: input.agentId, now, region, blobPathOf }, a)
      if (refData.length) await tx.projectReference.createMany({ data: refData })
      if (input.onCommit) await input.onCommit(tx, results)
      await tx.workPurge.deleteMany({ where: { id: { in: purges } } })
    }, { timeout: 120_000 + 30_000 * Math.max(0, prepared.length - 1) })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2028') throw new WorkError('STALE', 'database transaction timed out')
    if (e instanceof Prisma.PrismaClientKnownRequestError) throw new WorkError('INVALID', `backup: rejected by the database (${e.code})`)
    throw e
  }
  return results
}

async function insertApp(tx: Prisma.TransactionClient, key: Buffer, c: { userId: string; agentId: string; now: Date; region: string; blobPathOf: Map<string, string> }, a: PreparedApp) {
  const { pid, p0 } = a
  await tx.workProject.create({
    data: {
      id: pid, userId: c.userId, kind: a.kind, status: 'active', agentId: c.agentId,
      modules: Array.isArray(p0.modules) ? (p0.modules as unknown[]).filter((m): m is string => typeof m === 'string').slice(0, 50) : [],
      settings: encryptJson({ ...a.settings, name: a.name }, key),
      capabilityOff: p0.capability_off && typeof p0.capability_off === 'object' && !Array.isArray(p0.capability_off) ? (p0.capability_off as Prisma.InputJsonValue) : Prisma.JsonNull,
      workflowId: null, workflowLinkedAt: c.now,
    },
  })
  for (const f of a.fileData) await tx.workFile.create({ data: { ...f.data, blobRegion: c.region, blobPath: c.blobPathOf.get(f.oldId)! } })
  if (a.pageBlockData.length) await tx.workFilePageBlock.createMany({ data: a.pageBlockData })
  if (a.findBlockData.length) await tx.workDocFindBlock.createMany({ data: a.findBlockData })
  for (const x of a.sheets) {
    const st = a.sheetStats.get(x.newId)!
    await tx.dataSheet.create({ data: { id: x.newId, userId: c.userId, projectId: pid, kind: 'project', template: x.template, templateFamily: x.family, name: x.name, description: x.description, schema: JSON.stringify(x.schema), sizeBytes: BigInt(st.bytes), rowCount: st.rows } })
  }
  if (a.asm) await tx.workAppSpec.create({ data: { id: newId(), userId: c.userId, projectId: pid, info: encryptJson(a.asm.spec, key), version: a.asm.version } })
  if (a.myForms?.formData.length) await tx.workForm.createMany({ data: a.myForms.formData.map((f) => ({ ...f, userId: c.userId, info: encryptJson(f.info, key) })) })
  if (a.rows.length) await tx.dataSheetRow.createMany({ data: a.rows.map((x) => x.data) })
  if (a.asm?.alertData.length) await tx.workAlertFired.createMany({ data: a.asm.alertData.map((x) => ({ ...x, userId: c.userId })) })
  if (a.asm?.counters.length) await raiseCountersTx(tx, c.userId, a.asm.counters)
  if (a.keyData.length) await tx.sheetRowKey.createMany({ data: a.keyData })
  if (a.pairData.length) await tx.sheetRowPair.createMany({ data: a.pairData })
  if (a.taskData.length) await tx.workTask.createMany({ data: a.taskData.map((t) => t.data) })
  if (a.subData.length) await tx.workSubmission.createMany({ data: a.subData })
  for (const t of a.taskData) if (t.current) await tx.workTask.update({ where: { id: t.data.id }, data: { currentSubmissionId: t.current } })
  if (a.taskFileData.length) await tx.workTaskFile.createMany({ data: a.taskFileData })
  if (a.subFileData.length) await tx.workSubmissionFile.createMany({ data: a.subFileData })
  if (a.noteData.length) await tx.workNote.createMany({ data: a.noteData })
  if (a.msgData.length) await tx.workMessage.createMany({ data: a.msgData })
  await writeWorkEvent(tx, key, { userId: c.userId, projectId: pid, actor: { type: 'human' }, action: 'backup_import', detail: { format: typeof a.manifest.format === 'string' ? a.manifest.format : BACKUP_FORMAT, createdAt: a.manifest.createdAt ?? null, edition: a.manifest.edition ?? null, files: a.fileRows.length } })
}
