import { decryptBuffer } from '@/lib/encryption'
import { WorkError } from './errors'
import { hashPublicToken, isPublicToken } from './public-links'
import { sha256Hex, type WorkFileDeps } from './files'

const OPEN_STATUSES: ReadonlySet<string> = new Set(['issued', 'sent', 'partly_paid', 'paid'])

const WINDOW_MS = 60_000
const PER_IP = 30
const MAX_KEYS = 20_000
const hits = new Map<string, number[]>()

export function allowPublicDownload(ip: string | null, now: number = Date.now()): boolean {
  const key = ip ?? 'unknown'
  const list = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS)
  if (list.length >= PER_IP) {
    hits.set(key, list)
    return false
  }
  if (!hits.has(key) && hits.size >= MAX_KEYS) {
    for (const [k, v] of hits) if (v.every((t) => now - t >= WINDOW_MS)) hits.delete(k)
    if (hits.size >= MAX_KEYS) return false
  }
  list.push(now)
  hits.set(key, list)
  return true
}

export function __resetPublicDownloadLimiter(): void {
  hits.clear()
}

export interface PublicDownload {
  buffer: Buffer
  fileName: string
}

export async function resolvePublicDownload(deps: WorkFileDeps, token: unknown, now: Date = new Date()): Promise<PublicDownload | null> {
  if (!isPublicToken(token)) return null
  const { db } = deps
  const link = await db.workPublicLink.findUnique({ where: { tokenHash: hashPublicToken(token) } })
  if (!link || link.revokedAt || link.expiresAt <= now) return null
  const file = await db.workFile.findFirst({ where: { id: link.fileId, projectId: link.projectId, userId: link.userId } })
  if (!file || file.kind !== 'invoice' || file.mimeType !== 'application/pdf') return null
  const row = await db.dataSheetRow.findFirst({ where: { id: link.rowId, projectId: link.projectId, userId: link.userId, kind: 'project' }, select: { rowData: true } })
  if (!row) return null
  const data = JSON.parse(row.rowData) as Record<string, unknown>
  if (!OPEN_STATUSES.has(String(data.status)) || data.pdfFileId !== file.id || data.pdfSha256 !== file.sha256) return null

  const key = await deps.dataKey(db, link.userId)
  const { buffer: sealed } = await deps.blob.download(file.blobRegion, file.blobPath)
  const buffer = decryptBuffer(sealed, key)
  if (buffer.length !== file.sizeBytes || sha256Hex(buffer) !== file.sha256) throw new WorkError('INTEGRITY')

  const counted = await db.$transaction(async (tx) => {
    const n = await tx.workPublicLink.updateMany({ where: { id: link.id, revokedAt: null, expiresAt: { gt: now } }, data: { downloads: { increment: 1 }, lastDownloadAt: now } })
    if (n.count === 0) return false
    await tx.workEvent.create({ data: { userId: link.userId, projectId: link.projectId, rowId: link.rowId, fileId: file.id, actor: 'public-link', action: 'public_download', payload: null } })
    return true
  })
  if (!counted) return null
  const number = (typeof data.number === 'string' ? data.number.replace(/[^A-Za-z0-9-]/g, '') : '') || 'invoice'
  const word = data.lang === 'fr' ? 'Facture' : data.lang === 'en' ? 'Invoice' : 'Rechnung'
  return { buffer, fileName: `${word}-${number}.pdf` }
}

export async function deleteExpiredPublicLinks(db: WorkFileDeps['db'], now: Date = new Date()): Promise<number> {
  const r = await db.workPublicLink.deleteMany({ where: { expiresAt: { lte: now } } })
  return r.count
}
