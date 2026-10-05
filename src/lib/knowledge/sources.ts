import crypto from 'node:crypto'
import { azureDocKeyAgentPrefix } from '@/lib/rag-providers/clients/azure-ai-search'
import type { KnowledgeHit } from './index'

type StorageRow = { id: number; title: string; ragStatus: string | null }
export type StorageLookup = (agentId: string, ids: number[]) => Promise<StorageRow[]>

const defaultLookup: StorageLookup = async (agentId, ids) => {
  const { prisma } = await import('@/lib/prisma')
  return prisma.storage.findMany({ where: { agentId, id: { in: ids } }, select: { id: true, title: true, ragStatus: true } })
}

type DocRef = { kind: 'azure_ai_search' | 'pgvector'; docGen: string; contentHash: string | null }

function docRef(ragStatus: string | null | undefined): DocRef | null {
  if (!ragStatus) return null
  try {
    const st = JSON.parse(ragStatus)
    const hash = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{16}$/.test(v) ? v : null
    if (st?.pgvector?.ingestId) return { kind: 'pgvector', docGen: String(st.pgvector.ingestId), contentHash: hash(st.pgvector.contentHash) }
    if (st?.azure_ai_search?.fileId) return { kind: 'azure_ai_search', docGen: String(st.azure_ai_search.fileId), contentHash: hash(st.azure_ai_search.contentHash) }
    return null
  } catch {
    return null
  }
}

export function versionFromRagStatus(ragStatus: string | null | undefined): string | null {
  const ref = docRef(ragStatus)
  if (!ref) return null
  return `${ref.contentHash ?? '-'}:${crypto.createHash('sha256').update(ref.docGen).digest('hex').slice(0, 8)}`
}

export function isCurrentGenerationChunk(agentId: string, chunkId: string, ragStatus: string | null | undefined, storageId?: string | null): boolean {
  const ref = docRef(ragStatus)
  if (!ref) return false
  if (ref.kind === 'pgvector') return !!storageId && chunkId.startsWith(`${storageId}_${ref.docGen}_`)
  return chunkId.startsWith(`${azureDocKeyAgentPrefix(agentId)}_${ref.docGen}_`)
}

export async function attachSources(agentId: string, hits: KnowledgeHit[], lookup: StorageLookup = defaultLookup): Promise<KnowledgeHit[]> {
  if (!hits.length) return hits
  const ids = [...new Set(hits.map((h) => Number(h.source.storageId)).filter((n) => Number.isInteger(n) && n > 0))]
  let rows: StorageRow[] = []
  try {
    rows = ids.length ? await lookup(agentId, ids) : []
  } catch (e) {
    console.warn(`[Knowledge] source lookup failed agent=${agentId} — hits kept without versions:`, e instanceof Error ? e.message : e)
  }
  const byId = new Map(rows.map((r) => [String(r.id), r]))
  let stale = 0
  const out = hits.map((h) => {
    const row = h.source.storageId ? byId.get(h.source.storageId) : undefined
    if (!row) return h
    const current = isCurrentGenerationChunk(agentId, h.id, row.ragStatus, h.source.storageId)
    if (!current && docRef(row.ragStatus)) stale++
    return { ...h, source: { ...h.source, title: h.source.title || row.title, version: current ? versionFromRagStatus(row.ragStatus) : null } }
  })
  const missing = out.filter((h) => !h.source.storageId || !byId.has(h.source.storageId) || !h.source.title).length
  console.log(
    `[Knowledge] sources agent=${agentId} hits=${out.length} used=` +
    out.map((h) => `${h.source.storageId && /^\d+$/.test(h.source.storageId) ? h.source.storageId : '?'}@${h.source.version ?? '?'}`).join(',') +
    (missing ? ` unresolved=${missing}` : '') + (stale ? ` stale=${stale}` : ''),
  )
  return out
}
