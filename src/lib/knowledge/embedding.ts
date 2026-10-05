import {
  createConnectionClient, defaultAiConnectionDeps, resolveAiConnection, resolveFailureMessage,
  type AiConnectionDeps, type ResolvedAiConnection,
} from '@/lib/ai-connections'

export class KnowledgeEmbeddingUnavailable extends Error {
  code = 'KNOWLEDGE_EMBEDDING_UNAVAILABLE'
  constructor(message: string) { super(message); this.name = 'KnowledgeEmbeddingUnavailable' }
}

export interface EmbeddingChoice { connectionId: string; embeddingModel: string }

export interface Embedder {
  model: string
  embed(texts: string[], signal?: AbortSignal): Promise<number[][]>
}

export interface EmbeddingChoiceDb {
  aiConnection: {
    findMany(args: { where: { embeddingModel: { not: null } }; select: { id: true; isDefault: true; embeddingModel: true } }): Promise<Array<{ id: string; isDefault: boolean; embeddingModel: string | null }>>
  }
}

export async function pickEmbeddingChoice(db: EmbeddingChoiceDb): Promise<EmbeddingChoice> {
  const rows = (await db.aiConnection.findMany({ where: { embeddingModel: { not: null } }, select: { id: true, isDefault: true, embeddingModel: true } }))
    .filter((r) => r.embeddingModel && r.embeddingModel.trim())
  const def = rows.find((r) => r.isDefault)
  const pick = def ?? (rows.length === 1 ? rows[0] : null)
  if (!pick) {
    throw new KnowledgeEmbeddingUnavailable(rows.length === 0
      ? 'No AI connection has an embedding model, so documents cannot be added to search. An administrator can set one in Settings → AI connections.'
      : 'The default AI connection has no embedding model and several other connections do — set the embedding model on the default connection.')
  }
  return { connectionId: pick.id, embeddingModel: pick.embeddingModel!.trim() }
}

const BATCH = 16

export function assertEmbeddings(vectors: unknown, expected: number): number[][] {
  if (!Array.isArray(vectors) || vectors.length !== expected) throw new Error(`embedding: expected ${expected} vectors, got ${Array.isArray(vectors) ? vectors.length : typeof vectors}`)
  const dim = Array.isArray(vectors[0]) ? vectors[0].length : 0
  if (!dim) throw new Error('embedding: empty vector')
  for (const v of vectors) {
    if (!Array.isArray(v) || v.length !== dim || !v.every((x) => typeof x === 'number' && Number.isFinite(x))) throw new Error('embedding: malformed vector')
  }
  return vectors as number[][]
}

export function embedderFromConnection(c: ResolvedAiConnection, model: string, client = createConnectionClient(c)): Embedder {
  if (c.kind === 'anthropic') throw new KnowledgeEmbeddingUnavailable('Anthropic connections have no embeddings API — use another connection for document search')
  return {
    model,
    async embed(texts, signal) {
      const out: number[][] = []
      for (let i = 0; i < texts.length; i += BATCH) {
        const batch = texts.slice(i, i + BATCH)
        const r: any = await client.embeddings.create({ model, input: batch }, signal ? { signal } : undefined)
        const data = Array.isArray(r?.data) ? [...r.data].sort((a: any, b: any) => (a?.index ?? 0) - (b?.index ?? 0)) : null
        out.push(...assertEmbeddings(data?.map((d: any) => d?.embedding), batch.length))
      }
      return out
    },
  }
}

export async function embedderForChoice(choice: EmbeddingChoice, deps?: AiConnectionDeps): Promise<Embedder> {
  const r = await resolveAiConnection(deps ?? await defaultAiConnectionDeps(), choice.connectionId)
  if (!r.ok) {
    throw new KnowledgeEmbeddingUnavailable(r.reason === 'not_found'
      ? 'The AI connection used for document search no longer exists. An administrator must rebuild document search with another connection.'
      : resolveFailureMessage(r.reason))
  }
  return embedderFromConnection(r.connection, choice.embeddingModel)
}
