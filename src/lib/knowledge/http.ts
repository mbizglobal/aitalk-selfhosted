import type { KnowledgeHit, KnowledgeStore } from './index'

export const HTTP_SEARCH_VERSION = 1
export const HTTP_SEARCH_TIMEOUT_MS = 10_000
const MAX_TOP_K = 50
const MAX_CONTENT = 20_000
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024

export interface HttpSearchConfig {
  url: string
  secret: string
  installId: string
  timeoutMs?: number
  fetch?: typeof fetch
}

export class HttpSearchError extends Error {
  constructor(message: string, readonly status?: number, readonly code?: string) { super(message); this.name = 'HttpSearchError' }
}

export const HTTP_SEARCH_NO_INGEST = 'Documents for search are managed in your own search system — add or remove them there. This page cannot add documents in this installation.'

const safeCode = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(v) ? v : undefined

async function readLimited(res: Response, max: number): Promise<string> {
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > max) { await res.body?.cancel().catch(() => {}); throw new HttpSearchError('search response is too large', res.status, 'too_large') }
  if (!res.body) return ''
  const reader = res.body.getReader()
  const parts: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) { await reader.cancel().catch(() => {}); throw new HttpSearchError('search response is too large', res.status, 'too_large') }
    parts.push(value)
  }
  return Buffer.concat(parts).toString('utf-8')
}

function safeSourceUrl(v: unknown): string | undefined {
  if (typeof v !== 'string' || v.length > 2000) return undefined
  try {
    const u = new URL(v)
    return (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password ? u.toString() : undefined
  } catch { return undefined }
}

export function validateHttpSearchUrl(raw: string): URL {
  let u: URL
  try { u = new URL(raw) } catch { throw new HttpSearchError('KNOWLEDGE_HTTP_URL is not a valid URL') }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new HttpSearchError('KNOWLEDGE_HTTP_URL must be http(s)')
  if (u.username || u.password || u.hash) throw new HttpSearchError('KNOWLEDGE_HTTP_URL must not contain credentials or a fragment')
  return u
}

function toHit(r: unknown, i: number): KnowledgeHit {
  const o = r as Record<string, any> | null
  const src = o?.source as Record<string, any> | undefined
  if (!o || typeof o.content !== 'string' || !o.content.trim()) throw new HttpSearchError(`search response: results[${i}].content missing`)
  if (typeof o.score !== 'number' || !Number.isFinite(o.score)) throw new HttpSearchError(`search response: results[${i}].score is not a number`)
  if (!src || typeof src.id !== 'string' || !src.id.trim()) throw new HttpSearchError(`search response: results[${i}].source.id missing`)
  if (src.chunkIndex != null && !(Number.isInteger(src.chunkIndex) && src.chunkIndex >= 0)) throw new HttpSearchError(`search response: results[${i}].source.chunkIndex is not a non-negative integer`)
  const chunkIndex: number | null = src.chunkIndex ?? null
  const url = safeSourceUrl(src.url)
  return {
    id: `ext:${src.id}:${chunkIndex ?? i}`,
    content: o.content.slice(0, MAX_CONTENT),
    score: o.score,
    source: {
      storageId: null,
      title: typeof src.title === 'string' ? src.title.slice(0, 500) : '',
      chunkIndex,
      version: typeof src.version === 'string' && src.version ? src.version.slice(0, 100) : null,
      external: { id: src.id.slice(0, 500), ...(url && { url }) },
    },
  }
}

export function createHttpSearchKnowledgeStore(cfg: HttpSearchConfig): KnowledgeStore<never> {
  const url = validateHttpSearchUrl(cfg.url)
  if (!cfg.secret?.trim()) throw new HttpSearchError('KNOWLEDGE_HTTP_SECRET is empty')
  const doFetch = cfg.fetch ?? fetch

  return {
    provider: 'http_search',

    async ingest() {
      throw new HttpSearchError(HTTP_SEARCH_NO_INGEST, undefined, 'KNOWLEDGE_EXTERNAL')
    },

    async search(scope, query, topK) {
      if (!scope.agentId?.trim()) throw new Error('[Knowledge] agentId is required for data isolation')
      if (!Number.isFinite(topK) || topK < 1) return []
      const k = Math.min(MAX_TOP_K, Math.floor(topK))
      let res: Response
      try {
        res = await doFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${cfg.secret}` },
          body: JSON.stringify({
            version: HTTP_SEARCH_VERSION, query, topK: k,
            scope: { installId: cfg.installId, agentId: scope.agentId, ragSpace: scope.ragSpace ? { id: scope.ragSpace.id, includeDefault: scope.ragSpace.includeNull } : null },
          }),
          signal: AbortSignal.timeout(cfg.timeoutMs ?? HTTP_SEARCH_TIMEOUT_MS),
          redirect: 'error',
        })
      } catch (e) {
        const timedOut = (e as { name?: string } | null)?.name === 'TimeoutError'
        throw new HttpSearchError(timedOut ? 'search server did not answer in time' : 'search server could not be reached', undefined, timedOut ? 'timeout' : 'unreachable')
      }
      let body: any
      try {
        body = JSON.parse(await readLimited(res, MAX_RESPONSE_BYTES))
      } catch (e) {
        if (e instanceof HttpSearchError) throw e
        if ((e as { name?: string } | null)?.name === 'TimeoutError' || (e as { name?: string } | null)?.name === 'AbortError') throw new HttpSearchError('search server did not answer in time', res.status, 'timeout')
        body = undefined
      }
      if (!res.ok) throw new HttpSearchError(`search server answered ${res.status}`, res.status, safeCode(body?.error?.code))
      if (!body || !Array.isArray(body.results)) throw new HttpSearchError('search response: results is not an array', res.status)
      if (body.results.length > MAX_TOP_K * 4) throw new HttpSearchError(`search response: too many results (${body.results.length})`, res.status)
      const hits = (body.results as unknown[]).map(toHit).sort((a, b) => b.score - a.score).slice(0, k)
      console.log(`[Knowledge] sources agent=${scope.agentId} hits=${hits.length} external=${hits.length} versioned=${hits.filter((h: KnowledgeHit) => h.source.version).length}`)
      return hits
    },

    async deleteDoc() {},
    async deleteAgent() {},
    async deleteUser() {},
    async listChunks() { return [] },
  }
}
