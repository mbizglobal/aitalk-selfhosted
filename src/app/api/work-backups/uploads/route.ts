
import { NextResponse } from 'next/server'
import { describeCaughtError } from '@/lib/log-mask'
import { resolveWorkOwner } from '@/lib/work/team-access'
import { PIECE_BYTES, startUpload } from '@/lib/work/backup-upload'
import { uploadDeps } from './_deps'

export async function POST() {
  try {
    const userId = await resolveWorkOwner()
    if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    return NextResponse.json({ uploadId: await startUpload(uploadDeps, { userId }), pieceBytes: PIECE_BYTES })
  } catch (e) {
    console.error('[work-backups] upload start', describeCaughtError(e))
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 })
  }
}
