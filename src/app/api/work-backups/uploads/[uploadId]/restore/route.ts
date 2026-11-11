
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { describeCaughtError } from '@/lib/log-mask'
import { ensureUserDataKey } from '@/lib/user-data-key'
import { WorkError } from '@/lib/work/errors'
import { resolveWorkOwner } from '@/lib/work/team-access'
import { runRestore, startRestore } from '@/lib/work/backup-restore'
import { restoreDeps } from '../../_deps'

export async function POST(req: NextRequest, { params }: { params: Promise<{ uploadId: string }> }) {
  try {
    const userId = await resolveWorkOwner()
    if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    const { uploadId } = await params
    if (!/^[A-Za-z0-9_-]{1,25}$/.test(uploadId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    const body = await req.json().catch(() => ({})) as { agentId?: unknown; mode?: unknown }
    const wanted = typeof body.agentId === 'string' ? body.agentId : ''
    const agent = wanted
      ? await prisma.agent.findFirst({ where: { agentId: wanted, userId }, select: { agentId: true } })
      : (await prisma.agent.findFirst({ where: { defaultOwnerId: userId }, select: { agentId: true } })) ?? await prisma.agent.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' }, select: { agentId: true } })
    if (!agent) return NextResponse.json({ error: 'NO_AGENT' }, { status: 409 })
    const key = await ensureUserDataKey(prisma, userId)
    const gen = await startRestore(prisma, { userId, uploadId, key })
    void runRestore(restoreDeps, { userId, uploadId, key, gen, agentId: agent.agentId, forceCopy: body.mode === 'copy' }).catch((e) => { if (!(e instanceof WorkError)) console.error('[work-backups] restore', describeCaughtError(e)) })
    return NextResponse.json({ state: 'restoring' })
  } catch (e) {
    if (e instanceof WorkError && e.code === 'NOT_FOUND') return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    if (e instanceof WorkError && e.code === 'STALE') return NextResponse.json({ error: 'STALE' }, { status: 409 })
    console.error('[work-backups] restore start', describeCaughtError(e))
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 })
  }
}
