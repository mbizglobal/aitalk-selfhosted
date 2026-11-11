
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { describeCaughtError } from '@/lib/log-mask'
import { ensureUserDataKey } from '@/lib/user-data-key'
import { WorkError } from '@/lib/work/errors'
import { resolveWorkOwner } from '@/lib/work/team-access'
import { backupZipStream, readBackupSnapshot, recordBackupDownload } from '@/lib/work/backup'
import { downloadFromBlob } from '@/lib/managed/blob-storage'

export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const userId = await resolveWorkOwner()
    if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    const { projectId } = await params
    const key = await ensureUserDataKey(prisma, userId)
    const snap = await readBackupSnapshot(prisma, { userId, projectId, key })
    await recordBackupDownload(prisma, key, { userId, projectId, files: snap.files.length })
    const body = backupZipStream(snap, key, { download: (region, path) => downloadFromBlob(region, path) })
    return new Response(body, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="work-app-backup.zip"; filename*=UTF-8''${encodeURIComponent(snap.fileName)}`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    if (e instanceof WorkError && e.code === 'NOT_FOUND') return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    if (e instanceof WorkError && e.code === 'INVALID') return NextResponse.json({ error: 'BACKUP_TOO_LARGE' }, { status: 413 })
    console.error('[work-projects] backup', describeCaughtError(e))
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 })
  }
}
