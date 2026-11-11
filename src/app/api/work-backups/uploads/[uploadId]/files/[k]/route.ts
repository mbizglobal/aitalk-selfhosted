
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { describeCaughtError } from '@/lib/log-mask'
import { ensureUserDataKey } from '@/lib/user-data-key'
import { WorkError } from '@/lib/work/errors'
import { resolveWorkOwner } from '@/lib/work/team-access'
import { PIECE_BYTES, putPiece } from '@/lib/work/backup-upload'
import { uploadDeps } from '../../../_deps'

const int = (v: string | null) => (v !== null && /^\d{1,12}$/.test(v) ? Number(v) : NaN)

export async function PUT(req: NextRequest, { params }: { params: Promise<{ uploadId: string; k: string }> }) {
  try {
    const userId = await resolveWorkOwner()
    if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    const { uploadId, k } = await params
    if (!/^[A-Za-z0-9_-]{1,25}$/.test(uploadId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    const declared = int(req.headers.get('content-length'))
    if (!(declared >= 1 && declared <= PIECE_BYTES)) return NextResponse.json({ error: 'INVALID', detail: 'piece length' }, { status: 400 })
    const data = Buffer.from(await req.arrayBuffer())
    if (data.length !== declared) return NextResponse.json({ error: 'INVALID', detail: 'piece truncated' }, { status: 400 })
    const key = await ensureUserDataKey(prisma, userId)
    const q = req.nextUrl.searchParams
    const r = await putPiece(uploadDeps, { userId, uploadId, fileIndex: int(k), offset: int(q.get('offset')), total: int(q.get('total')), data, key })
    return NextResponse.json(r)
  } catch (e) {
    if (e instanceof WorkError && e.code === 'NOT_FOUND') return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    if (e instanceof WorkError && e.code === 'INVALID') return NextResponse.json({ error: 'INVALID', detail: e.detail?.slice(0, 200) ?? null }, { status: 400 })
    if (e instanceof WorkError && e.code === 'STALE') return NextResponse.json({ error: 'STALE' }, { status: 409 })
    console.error('[work-backups] upload piece', describeCaughtError(e))
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 })
  }
}
