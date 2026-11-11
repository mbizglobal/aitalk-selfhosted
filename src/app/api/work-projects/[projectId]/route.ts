
import { NextRequest, NextResponse } from 'next/server'
import { describeCaughtError } from '@/lib/log-mask'
import { resolveWorkOwner } from '@/lib/work/team-access'
import { deleteWorkAppCompletely } from '@/lib/workflow/service'

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const userId = await resolveWorkOwner()
    if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    const { projectId } = await params
    const r = await deleteWorkAppCompletely({ userId, projectId, confirmReferences: req.nextUrl.searchParams.get('confirmReferences') === '1' })
    if (!r.ok) return NextResponse.json({ error: r.code, message: r.message, ...(r.meta ?? {}) }, { status: r.status })
    return NextResponse.json(r)
  } catch (e) {
    console.error('[work-projects] delete', describeCaughtError(e))
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 })
  }
}
