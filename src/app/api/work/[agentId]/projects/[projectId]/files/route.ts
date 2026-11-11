
import { WorkError } from '@/lib/work/errors'
import { listProjectFiles, saveProjectFile, WORK_FILE_MAX_BYTES, type WorkFileKind } from '@/lib/work/files'
import { fileRows, fileStatuses } from '@/lib/work/file-decisions'
import { fileDocs } from '@/lib/work/file-docs'
import { workRoute } from '@/lib/work/http'
import { assertTeamProject } from '@/lib/work/team-access'
import { appTemplateOf } from '@/lib/work/app-templates'
import { assertScanOpen, ensurePdfPages, fileScans, linkScanFile, scanActorOf } from '@/lib/work/scan'

const KINDS: readonly WorkFileKind[] = ['receipt', 'bank_csv', 'report', 'page_image', 'other']

export const GET = workRoute<{ agentId: string; projectId: string }>('file.list', async (req, { access, deps }, p) => {
  await assertTeamProject(access, p.projectId)
  const [files, status] = await Promise.all([listProjectFiles(deps, { userId: access.userId, projectId: p.projectId }), fileStatuses(deps, { userId: access.userId, projectId: p.projectId })])
  const scans = await fileScans(deps.db, { userId: access.userId, projectId: p.projectId, actor: scanActorOf(access.actor), isOwner: access.isOwner, fileIds: files.map((f) => f.id) })
  const visible = [...scans].filter(([, v]) => v.scan).map(([id]) => id)
  const rows = visible.length ? await fileRows(deps, { userId: access.userId, projectId: p.projectId, fileIds: visible }) : new Map<string, Array<{ confirmed: boolean | null }>>()
  const attached = files.filter((f) => status.get(f.id)?.status === 'attached').map((f) => f.id)
  const docs = req.nextUrl.searchParams.get('docs') === '1' && attached.length ? await fileDocs(deps, { userId: access.userId, projectId: p.projectId, fileIds: attached }) : null
  return {
    files: files.map((f) => {
      const x = scans.get(f.id)
      const doc = docs?.get(f.id)
      return {
        ...f,
        status: status.get(f.id) ?? { status: 'new' },
        ...(x?.busy ? { scanBusy: true } : {}),
        ...(x?.scan ? { scan: { ...x.scan, toConfirm: (rows.get(f.id) ?? []).filter((r) => r.confirmed !== true).length } } : {}),
        ...(doc ? { doc } : {}),
      }
    }),
  }
})

export const POST = workRoute<{ agentId: string; projectId: string }>('file.upload', async (req, { access, deps }, p) => {
  await assertTeamProject(access, p.projectId)
  const proj = await deps.db.workProject.findFirst({ where: { id: p.projectId, userId: access.userId }, select: { kind: true } })
  if (proj && appTemplateOf(proj.kind)?.ui.files === 'kept') throw new WorkError('FORBIDDEN', 'this work app keeps its own documents — files are not uploaded here')
  const len = Number(req.headers.get('content-length') ?? '0')
  if (len > WORK_FILE_MAX_BYTES + 64 * 1024) throw new WorkError('INVALID', 'file too large')
  let form: FormData
  try { form = await req.formData() } catch { throw new WorkError('INVALID', 'body must be multipart form data') }
  const file = form.get('file')
  if (!(file instanceof File)) throw new WorkError('INVALID', 'file is required')
  const kind = String(form.get('kind') ?? 'other') as WorkFileKind
  if (!KINDS.includes(kind)) throw new WorkError('INVALID', 'unknown file kind')
  const parent = form.get('parentFileId')
  const parentFileId = typeof parent === 'string' && parent ? parent : null
  if ((kind === 'page_image') !== (parentFileId !== null)) throw new WorkError('INVALID', 'a page image needs parentFileId (and only a page image has one)')
  const serverPages = form.get('pages') === 'server'
  const scanField = form.get('scanId')
  const scanId = typeof scanField === 'string' && scanField ? scanField : null
  if (scanId && kind === 'page_image') throw new WorkError('INVALID', 'a scan uploads originals only — the server makes the page images')
  if (scanId) await assertScanOpen(deps.db, { userId: access.userId, scanId, projectId: p.projectId, actor: scanActorOf(access.actor), isOwner: access.isOwner })
  const buffer = Buffer.from(await file.arrayBuffer())
  const { file: saved, created } = await saveProjectFile(deps, {
    userId: access.userId,
    projectId: p.projectId,
    kind,
    originalName: (file.name || 'file').slice(0, 255),
    mimeType: file.type || 'application/octet-stream',
    buffer,
    parentFileId,
    actor: access.actor,
  })
  if (serverPages && !scanId) await ensurePdfPages(deps, { userId: access.userId, projectId: p.projectId, fileId: saved.id, mimeType: saved.mimeType, parentFileId: saved.parentFileId, buffer, originalName: (file.name || 'file').slice(0, 255), actor: access.actor })
  if (scanId) {
    const actor = scanActorOf(access.actor)
    await ensurePdfPages(deps, { userId: access.userId, projectId: p.projectId, fileId: saved.id, mimeType: saved.mimeType, parentFileId: saved.parentFileId, buffer, originalName: (file.name || 'file').slice(0, 255), actor: access.actor })
    const link = await linkScanFile(deps.db, { userId: access.userId, scanId, projectId: p.projectId, fileId: saved.id, actor, isOwner: access.isOwner })
    return { id: saved.id, created, mimeType: saved.mimeType, sizeBytes: saved.sizeBytes, scan: { owner: link.owner } }
  }
  return { id: saved.id, created, mimeType: saved.mimeType, sizeBytes: saved.sizeBytes }
})
