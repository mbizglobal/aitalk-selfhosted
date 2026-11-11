
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { describeCaughtError } from '@/lib/log-mask'
import { ensureUserDataKey } from '@/lib/user-data-key'
import { WorkError } from '@/lib/work/errors'
import { resolveWorkOwner } from '@/lib/work/team-access'
import { backupPartStream, partFileName, readBackupJob } from '@/lib/work/backup-parts'
import { downloadFromBlob } from '@/lib/managed/blob-storage'

export async function GET(_req: Request, { params }: { params: Promise<{ jobId: string; n: string }> }) {
  try {
    const userId = await resolveWorkOwner()
    if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    const { jobId, n: nText } = await params
    const n = /^[1-9][0-9]{0,5}$/.test(nText) ? Number(nText) : 0
    if (!n || !/^[A-Za-z0-9_-]{1,25}$/.test(jobId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    const key = await ensureUserDataKey(prisma, userId)
    const job = await readBackupJob(prisma, { userId, jobId, key })
    if (n > job.partCount) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    const body = backupPartStream({ userId, jobId, key, plan: job.plan, region: job.region, n }, { download: (region, path) => downloadFromBlob(region, path) })
    const name = partFileName(job.plan.fileBase, n, job.partCount)
    return new Response(body, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="work-app-backup-part${n}.zip"; filename*=UTF-8''${encodeURIComponent(name)}`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    if (e instanceof WorkError && e.code === 'NOT_FOUND') return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    console.error('[work-backups] part', describeCaughtError(e))
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 })
  }
}
