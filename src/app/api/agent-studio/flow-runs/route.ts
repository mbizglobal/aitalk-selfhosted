
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { ensureUserDataKey } from '@/lib/user-data-key'
import { resolveWorkOwner } from '@/lib/work/team-access'
import { listFlowRuns } from '@/lib/work/flow-runs'
import { describeCaughtError } from '@/lib/log-mask'

export async function GET(req: NextRequest) {
  try {
    const userId = await resolveWorkOwner()
    if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    const workflowId = req.nextUrl.searchParams.get('workflowId') ?? ''
    const w = workflowId ? await prisma.workflow.findFirst({ where: { workflowId, agent: { userId } }, select: { workflowId: true } }) : null
    if (!w) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    const runs = await listFlowRuns({ db: prisma, dataKey: ensureUserDataKey }, { userId, workflowId })
    return NextResponse.json({ runs })
  } catch (e) {
    console.error('[flow-runs] list', describeCaughtError(e))
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 })
  }
}
