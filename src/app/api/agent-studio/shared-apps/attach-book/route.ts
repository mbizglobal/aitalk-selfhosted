import { NextRequest, NextResponse } from 'next/server'
import { resolveWorkOwner } from '@/lib/work/team-access'
import { describeCaughtError } from '@/lib/log-mask'
import { attachBookToApp } from '@/lib/workflow/service'

export async function POST(req: NextRequest) {
  try {
    const userId = await resolveWorkOwner()
    if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    const body = (await req.json().catch(() => null)) as { appWorkflowId?: unknown; bookAppWorkflowId?: unknown } | null
    const appWorkflowId = typeof body?.appWorkflowId === 'string' ? body.appWorkflowId : ''
    const bookAppWorkflowId = typeof body?.bookAppWorkflowId === 'string' ? body.bookAppWorkflowId : ''
    if (!appWorkflowId || !bookAppWorkflowId) return NextResponse.json({ error: 'INVALID' }, { status: 400 })
    const r = await attachBookToApp({ userId, appWorkflowId, bookAppWorkflowId })
    if (!r.ok) return NextResponse.json({ error: r.code }, { status: r.status })
    return NextResponse.json({ appWorkflowId: r.appWorkflowId, book: r.book })
  } catch (e) {
    console.error('[shared-apps] attach book', describeCaughtError(e))
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 })
  }
}
