
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { describeCaughtError } from '@/lib/log-mask'
import { ensureUserDataKey } from '@/lib/user-data-key'
import { WorkError } from '@/lib/work/errors'
import { resolveWorkOwner } from '@/lib/work/team-access'
import { restoreStatus } from '@/lib/work/backup-restore'

export async function GET(_req: Request, { params }: { params: Promise<{ uploadId: string }> }) {
  try {
    const userId = await resolveWorkOwner()
    if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    const { uploadId } = await params
    if (!/^[A-Za-z0-9_-]{1,25}$/.test(uploadId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    const key = await ensureUserDataKey(prisma, userId)
    return NextResponse.json(await restoreStatus(prisma, { userId, uploadId, key }), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    if (e instanceof WorkError && e.code === 'NOT_FOUND') return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    console.error('[work-backups] upload status', describeCaughtError(e))
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 })
  }
}
