
import { NextRequest, NextResponse } from 'next/server'
import { describeCaughtError } from '@/lib/log-mask'
import { WORK_ERROR_STATUS, WorkError } from '@/lib/work/errors'
import { defaultWorkFileDeps } from '@/lib/work/files'
import { readReferencedFile } from '@/lib/work/reference-files'
import { resolveWorkTeamAccess, assertTeamProject } from '@/lib/work/team-access'

const INLINE = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])

export async function GET(req: NextRequest, { params }: { params: Promise<{ agentId: string; projectId: string; fileId: string }> }) {
  try {
    const p = await params
    const access = await resolveWorkTeamAccess(req, p.agentId)
    if (!access) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    await assertTeamProject(access, p.projectId)
    const { file, buffer, originalName } = await readReferencedFile(await defaultWorkFileDeps(), { userId: access.userId, projectId: p.projectId, fileId: p.fileId, actor: access.actor })
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
    console.error('[work-api] reference-file.read', describeCaughtError(e))
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 })
  }
}
