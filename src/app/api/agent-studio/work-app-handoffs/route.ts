
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkOwner } from '@/lib/work/team-access'
import { handoffPanel, queueClosedHandoffs } from '@/lib/work/handoff'
import { defaultWorkSheetDeps } from '@/lib/work/sheet-gate'
import { WorkError, WORK_ERROR_STATUS } from '@/lib/work/errors'
import { describeCaughtError } from '@/lib/log-mask'

export async function GET(req: NextRequest) {
  try {
    const userId = await resolveWorkOwner()
    if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    const workflowId = req.nextUrl.searchParams.get('workflowId') ?? ''
    const nodeId = req.nextUrl.searchParams.get('nodeId') ?? ''
    const view = workflowId && nodeId ? await handoffPanel(prisma, { userId, canvasWorkflowId: workflowId, toNodeId: nodeId }) : null
    if (!view) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    return NextResponse.json(view)
  } catch (e) {
    console.error('[work-app-handoffs] view', describeCaughtError(e))
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await resolveWorkOwner()
    if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    const b = (await req.json().catch(() => null)) as Record<string, unknown> | null
    const str = (v: unknown) => (typeof v === 'string' ? v : '')
    const r = await queueClosedHandoffs(await defaultWorkSheetDeps(), {
      userId, canvasWorkflowId: str(b?.workflowId), toNodeId: str(b?.nodeId), periodStart: str(b?.periodStart), periodEnd: str(b?.periodEnd),
      resetManual: b?.resetManual === true, requestedBy: 'human',
    })
    return NextResponse.json(r)
  } catch (e) {
    if (e instanceof WorkError) return NextResponse.json({ error: e.code, detail: e.detail || undefined }, { status: WORK_ERROR_STATUS[e.code] })
    console.error('[work-app-handoffs] queue', describeCaughtError(e))
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 })
  }
}
