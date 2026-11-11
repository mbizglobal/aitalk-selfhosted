
import { NextResponse } from 'next/server'
import { describeCaughtError } from '@/lib/log-mask'
import { resolveWorkOwner } from '@/lib/work/team-access'
import { restoreWorkAppCanvas } from '@/lib/workflow/service'

export async function POST(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const userId = await resolveWorkOwner()
    if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    const { projectId } = await params
    const r = await restoreWorkAppCanvas({ userId, projectId })
    if (!r.ok) return NextResponse.json({ error: r.code, message: r.message }, { status: r.status })
    return NextResponse.json(r)
  } catch (e) {
    console.error('[work-projects] restore', describeCaughtError(e))
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 })
  }
}
