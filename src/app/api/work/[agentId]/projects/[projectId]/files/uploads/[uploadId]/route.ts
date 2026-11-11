import { WorkError } from '@/lib/work/errors'
import { workRoute } from '@/lib/work/http'
import { FILE_PIECE_BYTES, finishFileUpload, putFilePiece } from '@/lib/work/file-upload'

type P = { agentId: string; projectId: string; uploadId: string }

export const PUT = workRoute<P>('file.upload_big.piece', async (req, { access, deps }, p) => {
  const n = Number(req.nextUrl.searchParams.get('n'))
  const lenHeader = req.headers.get('content-length')
  const len = Number(lenHeader)
  if (!lenHeader || !Number.isSafeInteger(len) || len < 1) throw new WorkError('INVALID', 'piece length required')
  if (len > FILE_PIECE_BYTES) throw new WorkError('INVALID', 'piece too large')
  const data = Buffer.from(await req.arrayBuffer())
  if (data.length > FILE_PIECE_BYTES) throw new WorkError('INVALID', 'piece too large')
  return putFilePiece(deps, { userId: access.userId, projectId: p.projectId, uploadId: p.uploadId, n, data })
})

export const POST = workRoute<P>('file.upload_big.finish', async (_req, { access, deps }, p) => {
  return finishFileUpload(deps, { userId: access.userId, projectId: p.projectId, uploadId: p.uploadId, actor: access.actor })
})
