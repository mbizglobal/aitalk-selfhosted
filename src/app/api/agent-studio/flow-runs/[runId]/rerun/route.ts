
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkOwner } from '@/lib/work/team-access'
import { rerunFlowRun } from '@/lib/work/flow-runs'
import { WorkError, WORK_ERROR_STATUS } from '@/lib/work/errors'
import { describeCaughtError } from '@/lib/log-mask'

export async function POST(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const userId = await resolveWorkOwner()
    if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    const { runId } = await params
    const r = await rerunFlowRun({ db: prisma }, { userId, runId, requestedBy: 'human' })
    return NextResponse.json({ id: r.id })
  } catch (e) {
    if (e instanceof WorkError) return NextResponse.json({ error: e.code, detail: e.detail || undefined }, { status: WORK_ERROR_STATUS[e.code] })
    console.error('[flow-runs] rerun', describeCaughtError(e))
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 })
  }
}
