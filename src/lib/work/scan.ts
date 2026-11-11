import { Prisma, type PrismaClient } from '@prisma/client'
import { WorkError } from './errors'
import { listWorkApps } from './app-chat'
import { booksOf } from './shared-apps'

export const SCAN_FORMS = { receipts: 'receipts', claims: 'receipts', statement: 'ledger', chart: 'ledger', myforms: 'myforms' } as const
export type ScanForm = keyof typeof SCAN_FORMS
export const isScanForm = (v: unknown): v is ScanForm => typeof v === 'string' && Object.prototype.hasOwnProperty.call(SCAN_FORMS, v)

const CLIENT_SCAN_ID = /^[A-Za-z0-9_-]{8,64}$/
export const SCAN_MAX_FILES = 50

type Db = PrismaClient

export interface ScanPlace {
  projectId: string
  kind: 'receipts' | 'ledger' | 'myforms'
  agentId: string
  appName: string
  groupId: string
  groupName: string
  groupType: 'canvas' | 'workflow'
  books: string[]
}

export async function listScanPlaces(db: Db, q: { userId: string; agentId?: string; memberId?: number }): Promise<ScanPlace[]> {
  const isPlace = (k: string | null | undefined): k is ScanPlace['kind'] => k === 'receipts' || k === 'ledger' || k === 'myforms'
  const apps = (await listWorkApps(db, q)).filter((a) => isPlace(a.projectKind))
  if (!apps.length) return []
  const projects = await db.workProject.findMany({ where: { userId: q.userId, status: 'active', workflowId: { in: apps.map((a) => a.workflowId) } }, select: { id: true, workflowId: true, kind: true } })
  const byWf = new Map(projects.map((p) => [p.workflowId, p]))
  const books = await booksOf(db, q.userId, projects.map((p) => p.id))
  const out: ScanPlace[] = []
  for (const a of apps) {
    const p = byWf.get(a.workflowId)
    if (!p || !isPlace(p.kind)) continue
    out.push({ projectId: p.id, kind: p.kind, agentId: a.agentId, appName: a.name, groupId: a.groupId, groupName: a.groupName, groupType: a.groupType, books: books.get(p.id) ?? [] })
  }
  return out
}

const CANVAS_NAME_MAX = 255

export function firstScanCanvas(places: readonly ScanPlace[]): string | null {
  return places.find((p) => p.kind === 'receipts' && p.groupType === 'canvas' && p.groupName === p.appName)?.groupId ?? null
}

export async function startPersonalForms(db: Db, i: { userId: string; isOwner: boolean; name: unknown; lang: import('@/lib/translations/work').WorkLang }): Promise<{ projectId: string; formId: string | null }> {
  if (!i.isOwner) throw new WorkError('FORBIDDEN', 'only the account owner sets up my forms')
  const name = typeof i.name === 'string' ? i.name.trim() : ''
  if (!name || name.length > 60) throw new WorkError('INVALID', 'name must be 1 to 60 characters')
  const { defaultBillsForm } = await import('./myforms')
  return firstMyForm(i, defaultBillsForm(i.lang, name))
}

export async function startCompanyForms(db: Db, i: { userId: string; isOwner: boolean; canvasId?: unknown; name?: unknown; lang: import('@/lib/translations/work').WorkLang }): Promise<{ projectId: string; formId: string | null }> {
  if (!i.isOwner) throw new WorkError('FORBIDDEN', 'only the account owner sets up my forms')
  if (i.canvasId !== undefined && i.canvasId !== null) await nameScanCanvas(db, { userId: i.userId, isOwner: true, canvasId: i.canvasId, name: i.name })
  const { defaultOthersForm } = await import('./myforms')
  return firstMyForm(i, defaultOthersForm(i.lang))
}

async function firstMyForm(i: { userId: string; lang: import('@/lib/translations/work').WorkLang }, form: { name: string; shape: import('./myforms').FormShape; columns: unknown[]; people: string[] }): Promise<{ projectId: string; formId: string | null }> {
  const { ensureMyFormsApp } = await import('@/lib/workflow/service')
  const app = await ensureMyFormsApp({ userId: i.userId, lang: i.lang })
  const [{ createForm }, { defaultWorkSheetDeps }] = await Promise.all([import('./myforms'), import('./sheet-gate')])
  const deps = await defaultWorkSheetDeps()
  try {
    const f = await createForm({ db: deps.db, dataKey: deps.dataKey }, { userId: i.userId, isOwner: true, saveKey: `first-${i.userId}`, onlyIfEmpty: true, ...form })
    return { projectId: app.projectId, formId: f.id }
  } catch (e) {
    if (e instanceof WorkError && e.code === 'INVALID' && /deleted form/.test(e.detail)) return { projectId: app.projectId, formId: null }
    throw e
  }
}

export async function nameScanCanvas(db: Db, i: { userId: string; isOwner: boolean; canvasId: unknown; name: unknown }): Promise<{ canvasId: string; name: string }> {
  if (!i.isOwner) throw new WorkError('FORBIDDEN', 'only the account owner can name the company')
  const name = typeof i.name === 'string' ? i.name.trim() : ''
  if (!name || name.length > CANVAS_NAME_MAX) throw new WorkError('INVALID', `name must be 1 to ${CANVAS_NAME_MAX} characters`)
  if (typeof i.canvasId !== 'string' || !i.canvasId) throw new WorkError('INVALID', 'canvasId is required')
  const places = await listScanPlaces(db, { userId: i.userId })
  if (!places.some((p) => p.kind === 'receipts' && p.groupType === 'canvas' && p.groupId === i.canvasId)) throw new WorkError('NOT_FOUND')
  const { updateWorkflow } = await import('@/lib/workflow/service')
  const w = await updateWorkflow({ userId: i.userId, workflowId: i.canvasId, patch: { name } })
  if (!w.ok) throw new Error(`canvas not renamed: ${w.code}`)
  return { canvasId: i.canvasId, name }
}

export interface ScanView {
  scanId: string
  form: ScanForm
  projectId: string
  status: string
  files: number
  formId?: string
}

const view = (s: { id: string; form: string; projectId: string; status: string; formId?: string | null; _count?: { files: number } }): ScanView =>
  ({ scanId: s.id, form: s.form as ScanForm, projectId: s.projectId, status: s.status, files: s._count?.files ?? 0, ...(s.formId ? { formId: s.formId } : {}) })

export async function openScan(db: Db, i: { userId: string; actor: string; isOwner: boolean; clientScanId: unknown; form: unknown; projectId: unknown; formId?: unknown; canUse: (workflowId: string) => Promise<boolean> }): Promise<ScanView & { created: boolean }> {
  if (typeof i.clientScanId !== 'string' || !CLIENT_SCAN_ID.test(i.clientScanId)) throw new WorkError('INVALID', 'clientScanId must be 8-64 letters, digits, - or _')
  if (!isScanForm(i.form)) throw new WorkError('INVALID', 'unknown form')
  if (typeof i.projectId !== 'string' || !i.projectId) throw new WorkError('INVALID', 'projectId is required')
  const { clientScanId, form, projectId } = i
  if (i.formId !== undefined && i.formId !== null && (form !== 'myforms' || typeof i.formId !== 'string' || !i.formId)) throw new WorkError('INVALID', 'formId is only for my forms')
  const formId = typeof i.formId === 'string' ? i.formId : null
  const had = await db.workScan.findUnique({ where: { userId_clientScanId: { userId: i.userId, clientScanId } }, include: { _count: { select: { files: true } } } })
  if (had) {
    if (!i.isOwner && had.actor !== i.actor) throw new WorkError('NOT_FOUND')
    await assertScanApp(db, { userId: i.userId, projectId: had.projectId, canUse: i.canUse })
    if (had.form !== form || had.projectId !== projectId || had.formId !== formId) throw new WorkError('INVALID', 'clientScanId was used for another scan')
    return { ...view(had), created: false }
  }
  const project = await db.workProject.findFirst({ where: { id: projectId, userId: i.userId, status: 'active' }, select: { kind: true } })
  if (!project || project.kind !== SCAN_FORMS[form]) throw new WorkError('NOT_FOUND')
  await assertScanApp(db, { userId: i.userId, projectId, canUse: i.canUse })
  if (formId && !(await db.workForm.count({ where: { id: formId, userId: i.userId, projectId, deletedAt: null } }))) throw new WorkError('NOT_FOUND')
  try {
    const s = await db.workScan.create({ data: { userId: i.userId, projectId, clientScanId, form, actor: i.actor, formId }, include: { _count: { select: { files: true } } } })
    return { ...view(s), created: true }
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return openScan(db, i)
    throw e
  }
}

export async function assertScanApp(db: Db, q: { userId: string; projectId: string; canUse: (workflowId: string) => Promise<boolean> }): Promise<void> {
  const p = await db.workProject.findFirst({ where: { id: q.projectId, userId: q.userId, status: 'active' }, select: { workflowId: true } })
  const wf = p?.workflowId ? await db.workflow.findFirst({ where: { workflowId: p.workflowId, status: 'production', agent: { userId: q.userId } }, select: { workflowId: true } }) : null
  if (!wf || !(await q.canUse(wf.workflowId))) throw new WorkError('NOT_FOUND')
}

export async function scanOf(db: Db, q: { userId: string; scanId: string; actor: string; isOwner: boolean; canUse?: (workflowId: string) => Promise<boolean> }) {
  const s = await db.workScan.findFirst({ where: { id: q.scanId, userId: q.userId, ...(q.isOwner ? {} : { actor: q.actor }) }, include: { _count: { select: { files: true } } } })
  if (!s) throw new WorkError('NOT_FOUND')
  if (q.canUse) await assertScanApp(db, { userId: q.userId, projectId: s.projectId, canUse: q.canUse })
  return s
}

type ScanRowForItem = { id: string; form: string; projectId: string; status: string; deferReason: string | null; summary: unknown; createdAt: Date; completedAt: Date | null; _count: { files: number } }

export function scanItem(s: ScanRowForItem) {
  return {
    scanId: s.id, form: s.form, projectId: s.projectId, status: s.status, files: s._count.files,
    ...(s.deferReason ? { deferReason: s.deferReason } : {}),
    ...scanSummaryView(s.summary),
    createdAt: s.createdAt.toISOString(),
    ...(s.completedAt ? { completedAt: s.completedAt.toISOString() } : {}),
  }
}

export function scanSummaryView(summary: unknown) {
  const sum = summary as { rows?: number; lines?: number; excluded?: number; unreadable?: number; questions?: number; cards?: number } | null
  return sum ? { summary: { rows: sum.rows ?? 0, lines: sum.lines ?? sum.rows ?? 0, excluded: sum.excluded ?? 0, unreadable: sum.unreadable ?? 0, questions: sum.questions ?? 0, cards: sum.cards ?? 0 } } : {}
}

const LIST_MAX = 50
const ACTIVE_STATUSES = ['open', 'ready', 'sorting', 'deferred', 'failed'] as const
const LIST_BATCH = 100
const LIST_BATCHES = 10

const encodeAfter = (s: { createdAt: Date; id: string }) => Buffer.from(JSON.stringify({ at: s.createdAt.toISOString(), id: s.id })).toString('base64url')
function decodeAfter(v: unknown): { at: Date; id: string } | null {
  if (v === undefined || v === null || v === '') return null
  try {
    const j = JSON.parse(Buffer.from(String(v), 'base64url').toString()) as { at?: unknown; id?: unknown }
    const at = typeof j.at === 'string' ? new Date(j.at) : null
    if (at && !Number.isNaN(at.getTime()) && typeof j.id === 'string' && j.id) return { at, id: j.id }
  } catch { }
  throw new WorkError('INVALID', 'after is not a cursor from this list')
}

export async function listScans(db: Db, q: { userId: string; actor: string; isOwner: boolean; canUse: (workflowId: string) => Promise<boolean>; limit: unknown; after: unknown; state?: unknown; projectId?: unknown }) {
  const n = q.limit === undefined || q.limit === null || q.limit === '' ? 20 : Number(q.limit)
  if (!Number.isInteger(n) || n < 1 || n > LIST_MAX) throw new WorkError('INVALID', `limit must be 1 to ${LIST_MAX}`)
  if (q.state !== undefined && q.state !== null && q.state !== 'active') throw new WorkError('INVALID', 'state must be active')
  const onlyProject = typeof q.projectId === 'string' && q.projectId ? q.projectId : null
  let after = decodeAfter(q.after)
  const usable = new Map<string, Promise<boolean>>()
  const canUseProject = (projectId: string) => {
    let p = usable.get(projectId)
    if (!p) usable.set(projectId, (p = assertScanApp(db, { userId: q.userId, projectId, canUse: q.canUse }).then(() => true, (e) => { if (e instanceof WorkError) return false; throw e })))
    return p
  }
  const out: ScanRowForItem[] = []
  let more = true
  for (let b = 0; b < LIST_BATCHES && out.length < n; b++) {
    const rows = await db.workScan.findMany({
      where: { userId: q.userId, ...(q.state === 'active' ? { status: { in: [...ACTIVE_STATUSES] } } : {}), ...(onlyProject ? { projectId: onlyProject } : {}), ...(q.isOwner ? {} : { actor: q.actor }), ...(after ? { OR: [{ createdAt: { lt: after.at } }, { createdAt: after.at, id: { lt: after.id } }] } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: LIST_BATCH,
      include: { _count: { select: { files: true } } },
    })
    let i = 0
    for (; i < rows.length && out.length < n; i++) {
      after = { at: rows[i].createdAt, id: rows[i].id }
      if (await canUseProject(rows[i].projectId)) out.push(rows[i])
    }
    if (rows.length < LIST_BATCH && i === rows.length) { more = false; break }
  }
  return { scans: out.map(scanItem), ...(more && after ? { next: encodeAfter({ createdAt: after.at, id: after.id }) } : {}) }
}

export async function assertScanOpen(db: Db, q: { userId: string; scanId: string; projectId: string; actor: string; isOwner: boolean }): Promise<void> {
  const s = await scanOf(db, { ...q, canUse: async () => true })
  if (s.projectId !== q.projectId) throw new WorkError('INVALID', 'this scan belongs to another work app')
  if (s.status !== 'open') throw new WorkError('INVALID', 'this scan is already complete — start a new scan')
}

export async function linkScanFile(db: Db, i: { userId: string; scanId: string; projectId: string; fileId: string; actor: string; isOwner: boolean }): Promise<{ owner: boolean }> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM work_scan WHERE id = ${i.scanId} AND user_id = ${i.userId} FOR UPDATE`
    const s = await scanOf(tx as unknown as Db, i)
    if (s.projectId !== i.projectId) throw new WorkError('INVALID', 'this scan belongs to another work app')
    if (s.status !== 'open') throw new WorkError('INVALID', 'this scan is already complete — start a new scan')
    const had = await tx.workScanFile.findUnique({ where: { scanId_fileId: { scanId: s.id, fileId: i.fileId } }, select: { owner: true } })
    if (had) return had
    if (s._count.files >= SCAN_MAX_FILES) throw new WorkError('INVALID', `a scan holds at most ${SCAN_MAX_FILES} files`)
    const won = await tx.$executeRaw`INSERT INTO work_scan_file (scan_id, file_id, owner) VALUES (${s.id}, ${i.fileId}, true) ON CONFLICT (file_id) WHERE owner DO NOTHING`
    if (won === 1) return { owner: true }
    await tx.$executeRaw`INSERT INTO work_scan_file (scan_id, file_id, owner) VALUES (${s.id}, ${i.fileId}, false) ON CONFLICT (scan_id, file_id) DO NOTHING`
    return { owner: false }
  })
}

export async function completeScan(db: Db, i: { userId: string; scanId: string; fileIds: unknown; actor: string; isOwner: boolean; canUse?: (workflowId: string) => Promise<boolean> }): Promise<ScanView & { missing?: string[]; alreadyUploaded?: boolean }> {
  if (!Array.isArray(i.fileIds) || i.fileIds.length > SCAN_MAX_FILES || !i.fileIds.every((x) => typeof x === 'string' && x.length > 0 && x.length <= 25)) throw new WorkError('INVALID', `fileIds must be up to ${SCAN_MAX_FILES} file ids`)
  const want = [...new Set(i.fileIds as string[])]
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM work_scan WHERE id = ${i.scanId} AND user_id = ${i.userId} FOR UPDATE`
    const s = await scanOf(tx as unknown as Db, i)
    const links = await tx.workScanFile.findMany({ where: { scanId: s.id }, select: { fileId: true, owner: true } })
    const have = new Set(links.map((l) => l.fileId))
    if (s.status !== 'open') {
      const same = want.length === have.size && want.every((f) => have.has(f))
      if (s.status === 'cancelled' ? want.length === 0 : same) return { ...view(s), ...(s.status === 'done' && !links.some((l) => l.owner) ? { alreadyUploaded: true } : {}) }
      throw new WorkError('INVALID', 'this scan is already complete with other files')
    }
    const missing = want.filter((f) => !have.has(f))
    if (missing.length) return { ...view(s), missing }
    const extra = links.map((l) => l.fileId).filter((f) => !want.includes(f))
    if (extra.length) await tx.workScanFile.deleteMany({ where: { scanId: s.id, fileId: { in: extra } } })
    const owners = links.filter((l) => l.owner && want.includes(l.fileId)).length
    const status = !want.length ? 'cancelled' : owners ? 'ready' : 'done'
    if (!want.length) await tx.workScanFile.deleteMany({ where: { scanId: s.id } })
    const done = await tx.workScan.update({ where: { id: s.id }, data: { status, completedAt: new Date(), changedAt: new Date() }, include: { _count: { select: { files: true } } } })
    if (status === 'ready') await tx.workScan.updateMany({ where: { userId: i.userId, projectId: s.projectId, status: 'deferred', deferReason: 'NO_CREDIT' }, data: { status: 'ready', deferReason: null, changedAt: new Date() } })
    return { ...view(done), ...(status === 'done' ? { alreadyUploaded: true } : {}) }
  })
}

export async function retryScan(db: Db, i: { userId: string; scanId: string; actor: string; isOwner: boolean; canUse?: (workflowId: string) => Promise<boolean> }): Promise<ScanView> {
  const s = await scanOf(db, i)
  if (s.status !== 'failed' && s.status !== 'deferred' && s.status !== 'done') return view(s)
  const now = new Date()
  await db.workScan.updateMany({ where: { id: s.id, status: s.status }, data: { status: 'ready', deferReason: null, retryAt: null, changedAt: now, staleRuns: 0, staleLeft: null } })
  return view(await scanOf(db, i))
}

export async function assertScanCardFiles(deps: import('./files').WorkFileDeps, q: { userId: string; projectId: string; scanId: string; fileIds: readonly string[] }): Promise<void> {
  const s = await deps.db.workScan.findFirst({ where: { id: q.scanId, userId: q.userId, projectId: q.projectId }, select: { status: true } })
  if (!s || s.status === 'cancelled') throw new WorkError('STALE', 'this phone scan was closed — open the scan again')
  const ids = [...new Set(q.fileIds)]
  if (!ids.length) return
  const owned = await deps.db.workScanFile.count({ where: { scanId: q.scanId, fileId: { in: ids }, owner: true } })
  if (owned !== ids.length) throw new WorkError('STALE', 'a file of this card is no longer part of the phone scan')
  const { fileStatuses } = await import('./file-decisions')
  const st = await fileStatuses(deps, { userId: q.userId, projectId: q.projectId })
  const onRow = ids.find((id) => st.get(id)?.status === 'attached')
  if (onRow) throw new WorkError('STALE', `file ${onRow} is already on a row — this card is out of date`)
}

export function scanOpenApp(app: { live: boolean; agentId: string | null; workflowId: string | null; name: string | null }) {
  return app.live && app.agentId && app.workflowId ? { agentId: app.agentId, workflowId: app.workflowId, name: app.name?.trim() ? app.name : 'Untitled Workflow' } : null
}

export async function fileScans(db: Db, q: { userId: string; projectId: string; actor: string; isOwner: boolean; fileIds: readonly string[] }) {
  const links = q.fileIds.length
    ? await db.workScanFile.findMany({
        where: { owner: true, fileId: { in: [...q.fileIds] }, scan: { userId: q.userId, projectId: q.projectId, status: { not: 'cancelled' } } },
        select: { fileId: true, scan: { select: { id: true, status: true, deferReason: true, actor: true } } },
      })
    : []
  const out = new Map<string, { busy: boolean; scan?: { id: string; status: string } }>()
  for (const { fileId, scan: s } of links) {
    const busy = s.status === 'ready' || s.status === 'sorting' || (s.status === 'deferred' && s.deferReason === 'BUSY')
    out.set(fileId, { busy, ...(q.isOwner || s.actor === q.actor ? { scan: { id: s.id, status: s.status } } : {}) })
  }
  return out
}

export const scanActorOf = (a: { memberId?: number }): string => (a.memberId !== undefined ? `member:${a.memberId}` : 'human')

export async function ensurePdfPages(deps: import('./files').WorkFileDeps, i: { userId: string; projectId: string; fileId: string; mimeType: string; parentFileId: string | null; buffer: Buffer; originalName: string; actor: import('./sheet-gate').SheetActor }): Promise<void> {
  if (i.mimeType !== 'application/pdf' || i.parentFileId) return
  const { renderPdfPages, WORK_PDF_PAGE_LIMIT } = await import('./pdf-pages')
  const { saveProjectFile } = await import('./files')
  const { createHash } = await import('node:crypto')
  const kids = await deps.db.workFile.findMany({ where: { parentFileId: i.fileId, kind: 'page_image' }, select: { sha256: true } })
  if (kids.length >= WORK_PDF_PAGE_LIMIT) return
  try {
    const r = await renderPdfPages(i.buffer)
    if (kids.length >= r.images.length) return
    const have = new Set(kids.map((k) => k.sha256))
    for (let k = 0; k < r.images.length; k++) {
      if (have.has(createHash('sha256').update(r.images[k]).digest('hex'))) continue
      await saveProjectFile(deps, { userId: i.userId, projectId: i.projectId, kind: 'page_image', originalName: `${i.originalName} p${k + 1}.jpg`.slice(0, 255), mimeType: 'image/jpeg', buffer: r.images[k], parentFileId: i.fileId, actor: i.actor })
    }
  } catch (e) {
    console.error('[scan] pdf pages not made:', e instanceof Error ? e.message.slice(0, 160) : 'error')
  }
}

export async function myFormsGroup(db: Db, userId: string, places: readonly ScanPlace[]): Promise<{ projectId: string; agentId: string; appName: string; forms: Array<{ formId: string; name: string; shape: string }> } | null> {
  const p = places.find((x) => x.kind === 'myforms')
  if (!p) return null
  const forms = await db.workForm.findMany({ where: { userId, projectId: p.projectId, deletedAt: null }, select: { id: true, name: true, shape: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
  return { projectId: p.projectId, agentId: p.agentId, appName: p.appName, forms: forms.map((f) => ({ formId: f.id, name: f.name, shape: f.shape })) }
}
