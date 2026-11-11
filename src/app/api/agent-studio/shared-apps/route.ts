
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkOwner } from '@/lib/work/team-access'
import { describeCaughtError } from '@/lib/log-mask'
import { resolveBook, sharedAppLookup } from '@/lib/work/shared-apps'
import { COMPANY_BOOK_KINDS, isSharedAppTemplateKind } from '@/lib/work/app-template-kinds'
import { isBookBoundKind } from '@/lib/work/workflow-template-catalog'
import { createSharedAppForLink } from '@/lib/workflow/service'

export async function GET(req: NextRequest) {
  try {
    const userId = await resolveWorkOwner()
    if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    const appTemplate = req.nextUrl.searchParams.get('appTemplate') ?? ''
    const workflowId = req.nextUrl.searchParams.get('workflowId') ?? ''
    if (!isSharedAppTemplateKind(appTemplate)) return NextResponse.json({ error: 'INVALID' }, { status: 400 })
    const bookBound = isBookBoundKind(appTemplate, COMPANY_BOOK_KINDS)
    const bookAppWorkflowId = bookBound ? req.nextUrl.searchParams.get('bookAppWorkflowId') ?? '' : ''
    const book = bookAppWorkflowId ? await resolveBook(prisma, userId, bookAppWorkflowId) : null
    if (bookAppWorkflowId && !book) return NextResponse.json({ pickable: [], unpickable: [], exists: false, bookBound, bookUnusable: true })
    const lk = await sharedAppLookup(prisma, userId, appTemplate, { ...(workflowId ? { excludeWorkflowId: workflowId } : {}), ...(book ? { sameBookAs: book.projectId } : {}) })
    const ids = (xs: Array<{ appWorkflowId: string }>) => xs.map((x) => x.appWorkflowId)
    return NextResponse.json({
      bookBound,
      ...(lk.byBook ? { byBook: { same: ids(lk.byBook.same), none: ids(lk.byBook.none), mixed: ids(lk.byBook.mixed), other: ids(lk.byBook.other) } } : {}),
      pickable: lk.pickable.map((p) => ({ appWorkflowId: p.appWorkflowId, appName: p.appName, canvasWorkflowId: p.canvasWorkflowId, canvasName: p.canvasName, agentId: p.agentId, agentName: p.agentName, alone: p.alone })),
      unpickable: lk.unpickable.map((u) => ({ why: u.why, canvasName: u.canvasName, appName: u.appName })),
      exists: lk.exists,
    })
  } catch (e) {
    console.error('[shared-apps] list', describeCaughtError(e))
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await resolveWorkOwner()
    if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    const body = (await req.json().catch(() => null)) as { appTemplate?: unknown; workflowId?: unknown; bookAppWorkflowId?: unknown } | null
    const appTemplate = typeof body?.appTemplate === 'string' ? body.appTemplate : ''
    const workflowId = typeof body?.workflowId === 'string' ? body.workflowId : ''
    if (!isSharedAppTemplateKind(appTemplate) || !workflowId) return NextResponse.json({ error: 'INVALID' }, { status: 400 })
    const canvas = await prisma.workflow.findFirst({ where: { workflowId, kind: 'main', agent: { userId } }, select: { agentId: true } })
    if (!canvas) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    const book = typeof body?.bookAppWorkflowId === 'string' && body.bookAppWorkflowId ? body.bookAppWorkflowId : undefined
    const r = await createSharedAppForLink({ userId, agentId: canvas.agentId, appTemplate, forWorkflowId: workflowId, ...(book ? { book } : {}) })
    if (!r.ok) return NextResponse.json({ error: r.code, detail: r.meta?.detail ?? null }, { status: r.status })
    return NextResponse.json({ appWorkflowId: r.appWorkflowId, book: r.book })
  } catch (e) {
    console.error('[shared-apps] create', describeCaughtError(e))
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 })
  }
}
