
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { describeCaughtError } from '@/lib/log-mask'
import { ensureUserDataKey } from '@/lib/user-data-key'
import { WorkError } from '@/lib/work/errors'
import { resolveWorkOwner } from '@/lib/work/team-access'
import { prepareBackupJob, startBackupJob } from '@/lib/work/backup-parts'
import { workStorageRegion } from '@/lib/work/files'
import { downloadFromBlob, uploadToBlob } from '@/lib/managed/blob-storage'

export async function POST(req: NextRequest) {
  try {
    const userId = await resolveWorkOwner()
    if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    const body = await req.json().catch(() => null) as { scope?: unknown; id?: unknown } | null
    const scope = body?.scope === 'workflow' || body?.scope === 'app' ? body.scope : null
    const id = typeof body?.id === 'string' && /^[A-Za-z0-9_-]{1,25}$/.test(body.id) ? body.id : null
    if (!scope || !id) return NextResponse.json({ error: 'INVALID' }, { status: 400 })
    const key = await ensureUserDataKey(prisma, userId)
    const deps = {
      db: prisma,
      region: (u: string) => workStorageRegion(prisma, u),
      upload: async (region: string, path: string, data: Buffer) => { await uploadToBlob(region, path, data, 'application/octet-stream') },
      download: (region: string, path: string) => downloadFromBlob(region, path),
    }
    const jobId = await startBackupJob(deps, { userId, key, scope, targetId: id })
    void prepareBackupJob(deps, { userId, key, jobId }).catch((e) => console.error('[work-backups] prepare', describeCaughtError(e)))
    return NextResponse.json({ jobId })
  } catch (e) {
    if (e instanceof WorkError && e.code === 'NOT_FOUND') return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    if (e instanceof WorkError && e.code === 'INVALID') return NextResponse.json({ error: 'INVALID', detail: e.detail?.slice(0, 200) ?? null }, { status: 400 })
    console.error('[work-backups] create', describeCaughtError(e))
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 })
  }
}
