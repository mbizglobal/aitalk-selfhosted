import { WorkError } from '@/lib/work/errors'
import { workRoute } from '@/lib/work/http'
import { appTemplateOf } from '@/lib/work/app-templates'
import { startFileUpload } from '@/lib/work/file-upload'

export const POST = workRoute<{ agentId: string; projectId: string }>('file.upload_big.start', async (req, { access, deps }, p) => {
  const proj = await deps.db.workProject.findFirst({ where: { id: p.projectId, userId: access.userId }, select: { kind: true } })
  if (proj && appTemplateOf(proj.kind)?.ui.files === 'kept') throw new WorkError('FORBIDDEN', 'this work app keeps its own documents — files are not uploaded here')
  let raw: unknown
  try { raw = await req.json() } catch { throw new WorkError('INVALID', 'body must be JSON') }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new WorkError('INVALID', 'body must be a JSON object')
  const body = raw as Record<string, unknown>
  return startFileUpload(deps, {
    userId: access.userId, projectId: p.projectId,
    name: typeof body.name === 'string' ? body.name : 'file', mimeType: typeof body.mimeType === 'string' ? body.mimeType : '',
    sizeBytes: Number(body.sizeBytes), sha256: typeof body.sha256 === 'string' ? body.sha256.toLowerCase() : '', kind: typeof body.kind === 'string' ? body.kind : 'other',
  })
})
