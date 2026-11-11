
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { describeCaughtError } from '@/lib/log-mask'
import { ensureUserDataKey } from '@/lib/user-data-key'
import { WorkError } from '@/lib/work/errors'
import { resolveWorkOwner } from '@/lib/work/team-access'
import { backupJobStatus, partFileName } from '@/lib/work/backup-parts'

export async function GET(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const userId = await resolveWorkOwner()
    if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    const { jobId } = await params
    if (!/^[A-Za-z0-9_-]{1,25}$/.test(jobId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    const key = await ensureUserDataKey(prisma, userId)
    const j = await backupJobStatus(prisma, { userId, jobId, key })
    return NextResponse.json({
      state: j.state, error: j.error, partCount: j.partCount, expiresAt: j.expiresAt.toISOString(),
      parts: j.parts.map((p) => ({ ...p, fileName: partFileName(j.fileBase, p.n, j.partCount) })),
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    if (e instanceof WorkError && e.code === 'NOT_FOUND') return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    console.error('[work-backups] status', describeCaughtError(e))
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 })
  }
}
