import crypto from 'node:crypto'
import { Prisma, type PrismaClient } from '@prisma/client'
import { contentHashOf } from './azure'
import { chunkText } from './chunk'
import { embedderForChoice, KnowledgeEmbeddingUnavailable, pickEmbeddingChoice, type Embedder, type EmbeddingChoice } from './embedding'
import { extractFailure, extractKnowledgeText } from './extract'
import type { KnowledgeChunk, KnowledgeHit, KnowledgeScope, KnowledgeStore } from './index'
import { attachSources } from './sources'
import { asPgvectorMissing, assertPgvectorInstalled } from './pgvector-status'
import type { ReadImagesFn } from '@/lib/workflow/nodes/ai/read-images'

type Gen = { id: number; connectionId: string; embeddingModel: string; dimension: number | null; status: string }

export interface PgvectorDeps {
  db: PrismaClient
  embedderFor?: (choice: EmbeddingChoice) => Promise<Embedder>
  pickChoice?: () => Promise<EmbeddingChoice>
  readImages?: () => Promise<ReadImagesFn | null>
}

function requireAgent(agentId: string): string {
  if (!agentId) throw new Error('[Knowledge] agentId is required for data isolation')
  return agentId
}

export interface PgvectorRef { generationId: number; ingestId: string; chunkCount: number; contentHash: string }

export function pgvectorChunkId(storageId: number, ingestId: string, generationId: number, i: number): string {
  return `${storageId}_${ingestId}_${generationId}_${i}`
}

const vectorLiteral = (v: number[]) => `[${v.join(',')}]`

export function createPgvectorKnowledgeStore(deps: PgvectorDeps): KnowledgeStore<PgvectorRef> {
  const db = deps.db
  const embedderFor = deps.embedderFor ?? ((c: EmbeddingChoice) => embedderForChoice(c))
  const pickChoice = deps.pickChoice ?? (() => pickEmbeddingChoice(db as any))

  async function activeGen(): Promise<Gen | null> {
    const rows = await db.knowledgeGeneration.findMany({ where: { status: 'active' }, orderBy: { id: 'desc' }, take: 2 })
    if (rows.length > 1) console.error(`[Knowledge:pgvector] ${rows.length} active generations — using newest id=${rows[0].id}`)
    return rows[0] ?? null
  }

  async function writeGens(): Promise<Gen[]> {
    let active = await activeGen()
    if (!active) {
      const choice = await pickChoice()
      active = await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('knowledge_generation_init'))`
        const again = await tx.knowledgeGeneration.findFirst({ where: { status: 'active' }, orderBy: { id: 'desc' } })
        if (again) return again
        return tx.knowledgeGeneration.create({ data: { connectionId: choice.connectionId, embeddingModel: choice.embeddingModel, status: 'active', activatedAt: new Date() } })
      })
    }
    const building = await db.knowledgeGeneration.findMany({ where: { status: 'building' }, orderBy: { id: 'asc' } })
    return [active, ...building]
  }

  async function embedFor(gen: Gen, texts: string[], signal?: AbortSignal): Promise<number[][]> {
    const embedder = await embedderFor({ connectionId: gen.connectionId, embeddingModel: gen.embeddingModel })
    const vectors = await embedder.embed(texts, signal)
    const dim = vectors[0]?.length ?? 0
    if (gen.dimension == null) {
      await db.knowledgeGeneration.updateMany({ where: { id: gen.id, dimension: null }, data: { dimension: dim } })
      const fresh = await db.knowledgeGeneration.findUnique({ where: { id: gen.id }, select: { dimension: true } })
      gen.dimension = fresh?.dimension ?? dim
    }
    if (gen.dimension !== dim) throw new Error(`[Knowledge:pgvector] embedding dimension changed (${gen.dimension} → ${dim}) for generation ${gen.id} — rebuild document search`)
    return vectors
  }

  async function readImagesFn(): Promise<ReadImagesFn | null> {
    return deps.readImages ? deps.readImages() : null
  }

  const store: KnowledgeStore<PgvectorRef> = {
    provider: 'pgvector',

    async ingest(scope, doc, opts) {
      const agentId = requireAgent(scope.agentId)
      const storageId = Number(doc.storageId)
      if (!Number.isInteger(storageId) || storageId <= 0) throw new Error('[Knowledge:pgvector] storageId must be a positive integer')
      const buffer = Buffer.isBuffer(doc.file) ? doc.file : Buffer.from(await (doc.file as Blob).arrayBuffer())
      const { text, pageCount } = await extractKnowledgeText(buffer, doc.fileName, doc.mimeType, await readImagesFn())
      const chunks = chunkText(text)
      if (!chunks.length) throw extractFailure('empty_text')

      const ingestId = crypto.randomUUID().replace(/-/g, '')
      const vectorsByGen = new Map<number, number[][]>()
      let written: number[] | null = null
      let activeId = 0
      for (let attempt = 0; attempt < 4 && !written; attempt++) {
        for (const g of await writeGens()) {
          if (!vectorsByGen.has(g.id)) vectorsByGen.set(g.id, await embedFor(g, chunks, opts?.signal))
        }
        opts?.signal?.throwIfAborted()
        written = await db.$transaction(async (tx) => {
          const row = await tx.$queryRaw<Array<{ id: number }>>`SELECT id FROM storage WHERE id = ${storageId} AND "agentId" = ${agentId} FOR UPDATE`
          if (!row.length) throw new Error(`[Knowledge:pgvector] storage ${storageId} is gone`)
          const live = await tx.$queryRaw<Array<{ id: number; status: string }>>`
            SELECT id, status FROM knowledge_generations WHERE status IN ('active', 'building') ORDER BY id FOR SHARE`
          if (!live.some((g) => g.status === 'active') || live.some((g) => !vectorsByGen.has(g.id))) return null
          activeId = live.find((g) => g.status === 'active')!.id
          await tx.knowledgeChunk.deleteMany({ where: { storageId } })
          for (const g of live) {
            const vectors = vectorsByGen.get(g.id)!
            const model = (await tx.knowledgeGeneration.findUniqueOrThrow({ where: { id: g.id }, select: { embeddingModel: true } })).embeddingModel
            await tx.knowledgeChunk.createMany({
              data: chunks.map((content, i) => ({
                id: pgvectorChunkId(storageId, ingestId, g.id, i),
                generationId: g.id, userId: doc.userId, agentId, storageId, ingestId,
                ragSpace: doc.ragSpace ?? '', title: doc.fileName.slice(0, 500), chunkIndex: i, content,
                embedding: vectors[i], embeddingModel: model, dimension: vectors[i].length,
              })),
            })
          }
          return live.map((g) => g.id)
        }, { timeout: 60_000 })
      }
      if (!written) throw new Error('[Knowledge:pgvector] document search generations kept changing — try again')
      const gens = written

      const ref: PgvectorRef = { generationId: activeId, ingestId, chunkCount: chunks.length, contentHash: contentHashOf(buffer) }
      console.log(`[Knowledge:pgvector] ingested storage=${storageId} agent=${agentId} chunks=${chunks.length} generations=${gens.join(',')}`)
      return { chunkCount: chunks.length, pageCount, textSize: Buffer.byteLength(text, 'utf-8'), providerRef: ref }
    },

    async search(scope, query, topK) {
      const agentId = requireAgent(scope.agentId)
      if (!Number.isFinite(topK) || topK < 1) return []
      const k = Math.min(50, Math.floor(topK))
      const gen = await activeGen()
      if (!gen) return []
      const [q] = await embedFor(gen, [query])
      const space = scope.ragSpace
      const spaceSql = !space ? Prisma.empty
        : space.includeNull ? Prisma.sql`AND rag_space IN (${space.id}, '')` : Prisma.sql`AND rag_space = ${space.id}`
      await assertPgvectorInstalled(db)
      const qv = vectorLiteral(q)
      const rows = await db.$queryRaw<Array<{ id: string; storage_id: number; title: string; chunk_index: number; content: string; score: number }>>`
        SELECT id, storage_id, title, chunk_index, content,
               (1 - ((embedding::vector) <=> ${qv}::vector))::float8 AS score
          FROM knowledge_chunks
         WHERE generation_id = ${gen.id} AND agent_id = ${agentId} ${spaceSql}
         ORDER BY (embedding::vector) <=> ${qv}::vector
         LIMIT ${k}`.catch((e) => { throw asPgvectorMissing(e) })
      const hits: KnowledgeHit[] = rows.map((r) => ({
        id: r.id,
        content: r.content,
        score: Number(r.score),
        source: { storageId: String(r.storage_id), title: r.title, chunkIndex: r.chunk_index, version: null },
      }))
      return attachSources(agentId, hits)
    },

    async deleteDoc(scope, storageId) {
      const agentId = requireAgent(scope.agentId)
      const id = Number(storageId)
      if (!Number.isInteger(id)) throw new Error('[Knowledge:pgvector] storageId must be an integer')
      await db.knowledgeChunk.deleteMany({ where: { agentId, storageId: id } })
    },

    async deleteAgent(agentId) {
      await db.knowledgeChunk.deleteMany({ where: { agentId: requireAgent(agentId) } })
    },

    async deleteUser(userId) {
      if (!userId) throw new Error('[Knowledge] userId is required')
      await db.knowledgeChunk.deleteMany({ where: { userId } })
    },

    async listChunks(scope, opts) {
      const agentId = requireAgent(scope.agentId)
      const gen = await activeGen()
      if (!gen) return []
      if (opts?.storageId !== undefined && !Number.isInteger(opts.storageId)) throw new Error('[Knowledge:pgvector] storageId must be an integer')
      const space = scope.ragSpace
      const rows = await db.knowledgeChunk.findMany({
        where: {
          generationId: gen.id, agentId,
          ...(opts?.storageId !== undefined && { storageId: opts.storageId }),
          ...(space && { ragSpace: space.includeNull ? { in: [space.id, ''] } : space.id }),
        },
        select: { storageId: true, title: true, chunkIndex: true, content: true },
        orderBy: [{ storageId: 'asc' }, { chunkIndex: 'asc' }],
        take: opts?.maxChunks ?? 3000,
      })
      return rows.map((r): KnowledgeChunk => ({ storageId: String(r.storageId), title: r.title, chunkIndex: r.chunkIndex, content: r.content }))
    },
  }
  return store
}

export type RebuildDeps = PgvectorDeps

export interface RebuildResult {
  status: 'unchanged' | 'switched' | 'failed'
  fromGeneration: number | null
  toGeneration: number | null
  documents: number
  error?: string
}

type Group = { storage_id: number; ingest_id: string }

async function missingGroups(db: Pick<PrismaClient, '$queryRaw'>, activeId: number, buildingId: number): Promise<Group[]> {
  return db.$queryRaw<Group[]>`
    SELECT storage_id, ingest_id FROM knowledge_chunks WHERE generation_id = ${activeId} GROUP BY storage_id, ingest_id
    EXCEPT
    SELECT storage_id, ingest_id FROM knowledge_chunks WHERE generation_id = ${buildingId} GROUP BY storage_id, ingest_id`
}

export async function rebuildKnowledge(deps: RebuildDeps, opts?: { signal?: AbortSignal; maxPasses?: number }): Promise<RebuildResult> {
  const db = deps.db
  const pick = deps.pickChoice ?? (() => pickEmbeddingChoice(db as any))
  const embedderFor = deps.embedderFor ?? ((c: EmbeddingChoice) => embedderForChoice(c))
  const choice = await pick()
  const active = await db.knowledgeGeneration.findFirst({ where: { status: 'active' }, orderBy: { id: 'desc' } })
  if (!active || (active.connectionId === choice.connectionId && active.embeddingModel === choice.embeddingModel)) {
    return { status: 'unchanged', fromGeneration: active?.id ?? null, toGeneration: active?.id ?? null, documents: 0 }
  }
  await db.knowledgeGeneration.deleteMany({ where: { status: { in: ['building', 'failed'] } } })
  const gen = await db.knowledgeGeneration.create({ data: { connectionId: choice.connectionId, embeddingModel: choice.embeddingModel, status: 'building' } })
  let documents = 0
  try {
    const embedder = await embedderFor(choice)
    let dimension: number | null = null
    for (let pass = 0; pass < (opts?.maxPasses ?? 5); pass++) {
      const missing = await missingGroups(db, active.id, gen.id)
      if (!missing.length) {
        const switched = await db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM knowledge_generations WHERE id IN (${active.id}, ${gen.id}) FOR UPDATE`
          const st = await tx.knowledgeGeneration.findMany({ where: { id: { in: [active.id, gen.id] } }, select: { id: true, status: true } })
          if (st.find((g) => g.id === gen.id)?.status !== 'building') throw new Error('generation was cancelled during rebuild')
          if (st.find((g) => g.id === active.id)?.status !== 'active') throw new Error('the active generation changed during rebuild')
          if ((await missingGroups(tx, active.id, gen.id)).length) return false
          await tx.$executeRaw`
            DELETE FROM knowledge_chunks b WHERE b.generation_id = ${gen.id}
               AND NOT EXISTS (SELECT 1 FROM knowledge_chunks a WHERE a.generation_id = ${active.id} AND a.storage_id = b.storage_id AND a.ingest_id = b.ingest_id)`
          await tx.knowledgeGeneration.update({ where: { id: gen.id }, data: { status: 'active', activatedAt: new Date(), ...(dimension != null && { dimension }) } })
          await tx.knowledgeGeneration.delete({ where: { id: active.id } })
          return true
        }, { timeout: 120_000 })
        if (switched) {
          console.log(`[Knowledge:pgvector] rebuild switched ${active.id} → ${gen.id} documents=${documents}`)
          return { status: 'switched', fromGeneration: active.id, toGeneration: gen.id, documents }
        }
        continue
      }
      for (const m of missing) {
        opts?.signal?.throwIfAborted()
        const rows = await db.knowledgeChunk.findMany({
          where: { generationId: active.id, storageId: m.storage_id, ingestId: m.ingest_id },
          select: { userId: true, agentId: true, ragSpace: true, title: true, chunkIndex: true, content: true },
          orderBy: { chunkIndex: 'asc' },
        })
        if (!rows.length) continue
        const vectors = await embedder.embed(rows.map((r) => r.content), opts?.signal)
        dimension ??= vectors[0].length
        if (vectors[0].length !== dimension) throw new Error(`embedding dimension changed mid-rebuild (${dimension} → ${vectors[0].length})`)
        await db.$transaction(async (tx) => {
          const row = await tx.$queryRaw<Array<{ id: number }>>`SELECT id FROM storage WHERE id = ${m.storage_id} FOR UPDATE`
          if (!row.length) return
          const still = await tx.knowledgeChunk.count({ where: { generationId: active.id, storageId: m.storage_id, ingestId: m.ingest_id } })
          if (still !== rows.length) return
          await tx.knowledgeChunk.deleteMany({ where: { generationId: gen.id, storageId: m.storage_id } })
          await tx.knowledgeChunk.createMany({
            data: rows.map((r, i) => ({
              id: pgvectorChunkId(m.storage_id, m.ingest_id, gen.id, r.chunkIndex),
              generationId: gen.id, userId: r.userId, agentId: r.agentId, storageId: m.storage_id, ingestId: m.ingest_id,
              ragSpace: r.ragSpace, title: r.title, chunkIndex: r.chunkIndex, content: r.content,
              embedding: vectors[i], embeddingModel: choice.embeddingModel, dimension: vectors[i].length,
            })),
          })
          documents++
        }, { timeout: 60_000 })
      }
    }
    throw new Error('documents kept changing during rebuild — try again')
  } catch (e) {
    await db.knowledgeGeneration.deleteMany({ where: { id: gen.id, status: 'building' } }).catch(() => {})
    const error = e instanceof KnowledgeEmbeddingUnavailable ? e.message : (e instanceof Error ? e.message : String(e))
    console.error(`[Knowledge:pgvector] rebuild failed — staying on generation ${active.id}: ${error}`)
    return { status: 'failed', fromGeneration: active.id, toGeneration: null, documents, error }
  }
}
