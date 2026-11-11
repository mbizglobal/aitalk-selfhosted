import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { ensureUserDataKey } from '@/lib/user-data-key'
import { approveSpecProposal, cancelSpecProposal } from '@/lib/work/assembled-proposals'
import { WorkError } from '@/lib/work/errors'
import { describeCaughtError } from '@/lib/log-mask'

function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin')
  const host = request.headers.get('host')
  if (!origin || !host) return false
  try { return new URL(origin).host === host } catch { return false }
}

async function ownerOf(request: NextRequest): Promise<string | NextResponse> {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
  return session.user.id
}

const deps = { db: prisma, dataKey: ensureUserDataKey }

export async function POST(request: NextRequest, { params }: { params: Promise<{ proposalId: string }> }) {
  try {
    const userId = await ownerOf(request)
    if (typeof userId !== 'string') return userId
    const { proposalId } = await params
    const r = await approveSpecProposal(deps, { userId, proposalId })
    if (r.ok) return NextResponse.json({ success: true, version: r.version })
    if ('code' in r) return NextResponse.json({ error: r.code, currentVersion: r.currentVersion ?? null }, { status: r.code === 'NOT_FOUND' ? 404 : 409 })
    return NextResponse.json({ error: 'SPEC_INVALID', issues: r.issues }, { status: 409 })
  } catch (e) {
    if (e instanceof WorkError && (e.code === 'READ_ONLY' || e.code === 'APP_CLOSED' || e.code === 'NOT_FOUND' || e.code === 'FORBIDDEN')) {
      return NextResponse.json({ error: e.code }, { status: e.code === 'NOT_FOUND' ? 404 : 409 })
    }
    console.error('[POST /api/work-projects/spec-proposals] failed:', describeCaughtError(e))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ proposalId: string }> }) {
  try {
    const userId = await ownerOf(request)
    if (typeof userId !== 'string') return userId
    const { proposalId } = await params
    return NextResponse.json({ success: true, canceled: await cancelSpecProposal(deps, { userId, proposalId }) })
  } catch (e) {
    console.error('[DELETE /api/work-projects/spec-proposals] failed:', describeCaughtError(e))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
