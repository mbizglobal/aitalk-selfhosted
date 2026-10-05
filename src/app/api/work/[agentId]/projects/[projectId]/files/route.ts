
import { WorkError } from '@/lib/work/errors'
import { listProjectFiles, saveProjectFile, WORK_FILE_MAX_BYTES, type WorkFileKind } from '@/lib/work/files'
import { workRoute } from '@/lib/work/http'
import { assertTeamProject } from '@/lib/work/team-access'

const KINDS: readonly WorkFileKind[] = ['receipt', 'bank_csv', 'report', 'page_image', 'other']

export const GET = workRoute<{ agentId: string; projectId: string }>('file.list', async (_req, { access, deps }, p) => {
  await assertTeamProject(access, p.projectId)
  return { files: await listProjectFiles(deps, { userId: access.userId, projectId: p.projectId }) }
})

export const POST = workRoute<{ agentId: string; projectId: string }>('file.upload', async (req, { access, deps }, p) => {
  await assertTeamProject(access, p.projectId)
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
  return { id: saved.id, created, mimeType: saved.mimeType, sizeBytes: saved.sizeBytes }
})
