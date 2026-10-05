
import { NextRequest, NextResponse } from 'next/server'
import { describeCaughtError } from '@/lib/log-mask'
import { WORK_ERROR_STATUS, WorkError } from '@/lib/work/errors'
import { defaultWorkFileDeps, deleteProjectFile, readProjectFile } from '@/lib/work/files'
import { workRoute } from '@/lib/work/http'
import { resolveWorkTeamAccess, assertTeamProject } from '@/lib/work/team-access'

const INLINE = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])

export const DELETE = workRoute<{ agentId: string; projectId: string; fileId: string }>('file.delete', async (_req, { access, deps }, p) => {
  await assertTeamProject(access, p.projectId)
  const owned = await deps.db.workFile.findFirst({ where: { id: p.fileId, projectId: p.projectId, userId: access.userId, parentFileId: null }, select: { id: true } })
  if (!owned) throw new WorkError('NOT_FOUND')
  await deleteProjectFile(deps, { userId: access.userId, fileId: p.fileId, actor: access.actor })
  return { ok: true }
})

export async function GET(req: NextRequest, { params }: { params: Promise<{ agentId: string; projectId: string; fileId: string }> }) {
  try {
    const p = await params
    const access = await resolveWorkTeamAccess(req, p.agentId)
    if (!access) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    await assertTeamProject(access, p.projectId)
    const deps = await defaultWorkFileDeps()
    const owned = await deps.db.workFile.findFirst({ where: { id: p.fileId, projectId: p.projectId, userId: access.userId }, select: { id: true } })
    if (!owned) throw new WorkError('NOT_FOUND')
    const { file, buffer, originalName } = await readProjectFile(deps, { userId: access.userId, fileId: p.fileId, actor: access.actor })
    const safeName = originalName.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'file'
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': file.mimeType,
        'Content-Length': String(buffer.length),
        'Content-Disposition': `${INLINE.has(file.mimeType) ? 'inline' : 'attachment'}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(originalName.slice(0, 200))}`,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (e) {
    if (e instanceof WorkError) return NextResponse.json({ error: e.code, detail: e.detail || undefined }, { status: WORK_ERROR_STATUS[e.code] })
    console.error('[work-api] file.read', describeCaughtError(e))
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 })
  }
}
