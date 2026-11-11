import type { AiConnectionKind } from './index'

export type ModelProvider = 'openai' | 'azure' | 'gemini' | 'claude' | 'infomaniak'

export interface RawModel {
  id: string
  model: string
  created?: number
  chat?: boolean
  image?: boolean
  embedding?: boolean
}

export interface ModelOption { id: string; model: string }
export interface ModelLists { text: ModelOption[]; image: ModelOption[]; embedding: ModelOption[] }

export const RECENT_COUNT = 5

const TEXT_FLOOR: Record<Exclude<ModelProvider, 'infomaniak'>, number[]> = { openai: [6, 1], azure: [6, 1], claude: [5, 5], gemini: [3, 8] }
const OPENAI_TEXT_EXTRA = new Set(['gpt-6-luna'])

function infomaniakTextAllowed(model: string): boolean {
  const m = model.toLowerCase()
  const k = /^moonshotai\/kimi-k(\d+)(?:\.(\d+))?/.exec(m)
  if (k) return cmpVersion([Number(k[1]), Number(k[2] ?? 0)], [2, 6]) >= 0
  const q = /^qwen\/qwen(\d+)(?:\.(\d+))?-(\d+)b\b/.exec(m)
  if (q) return cmpVersion([Number(q[1]), Number(q[2] ?? 0)], [3, 5]) >= 0 && Number(q[3]) >= 100
  return false
}
const INFOMANIAK_EMBEDDING = /^(qwen\/qwen\d+(\.\d+)?-embedding|bge_multilingual)/

export function modelProviderOf(kind: AiConnectionKind, baseUrl: string): ModelProvider | null {
  if (kind === 'azure') return 'azure'
  let host = ''
  try { host = new URL(baseUrl.trim()).hostname.toLowerCase() } catch { return null }
  if (kind === 'anthropic') return host === 'api.anthropic.com' ? 'claude' : null
  if (host === 'api.openai.com') return 'openai'
  if (host === 'api.infomaniak.com') return 'infomaniak'
  if (host === 'generativelanguage.googleapis.com') return 'gemini'
  return null
}

export function versionOf(provider: ModelProvider, model: string): number[] {
  const m = model.toLowerCase().replace(/^models\//, '').replace(/-\d{4}-\d{2}-\d{2}$/, '').replace(/-\d{8}$/, '')
  if (provider === 'claude') {
    const parts = m.replace(/^claude-/, '').split('-').filter((p) => /^\d{1,2}$/.test(p)).map(Number)
    return parts.slice(0, 2)
  }
  if (provider === 'infomaniak') {
    const f = /^(?:moonshotai\/kimi-k|qwen\/qwen)(\d+)(?:\.(\d+))?/.exec(m)
    return f ? [Number(f[1]), Number(f[2] ?? 0)] : (m.match(/\d+/g) ?? []).map(Number)
  }
  const g = (provider === 'gemini' ? /^gemini-(\d+)(?:\.(\d+))?/ : /^gpt-(\d+)(?:\.(\d+))?/).exec(m)
  if (g && provider !== 'gemini' && g[1] === '35' && g[2] === undefined) return [3, 5]
  if (g) return [Number(g[1]), Number(g[2] ?? 0)]
  return (m.match(/\d+/g) ?? []).map(Number)
}

function cmpVersion(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d) return d
  }
  return 0
}

const OPENAI_NOT_CHAT = /(tts|transcribe|whisper|audio|realtime|live|image|dall-e|sora|moderation|embedding|search|codex|computer-use|canvas|instruct|davinci|curie|babbage|ada|ft:|chat-latest|-pro\b|-pro-)/
const GEMINI_NOT_CHAT = /(tts|image|banana|lyria|robotics|computer-use|antigravity|deep-research|transcribe|live|omni|gemma|aqa|-latest$|embedding|customtools)/

function isChat(provider: ModelProvider, r: RawModel): boolean {
  const m = r.model.toLowerCase().replace(/^models\//, '')
  if (provider === 'infomaniak') return infomaniakTextAllowed(m)
  if (provider === 'claude') return r.chat !== false && /^claude-(opus|sonnet|haiku)-/.test(m)
  if (provider === 'gemini') return r.chat === true && m.startsWith('gemini-') && !GEMINI_NOT_CHAT.test(m)
  if (provider === 'openai' && /-\d{4}-\d{2}-\d{2}$/.test(m)) return false
  return /^(gpt-|o\d)/.test(m) && !OPENAI_NOT_CHAT.test(m)
}

function isEmbedding(provider: ModelProvider, r: RawModel): boolean {
  if (provider === 'claude') return false
  if (provider === 'infomaniak') return INFOMANIAK_EMBEDDING.test(r.model.toLowerCase())
  if (provider === 'gemini') return r.embedding === true
  return /embedding/.test(r.model.toLowerCase())
}

function newestFirst(provider: ModelProvider) {
  return (a: RawModel, b: RawModel) => {
    if (a.created !== undefined && b.created !== undefined && a.created !== b.created) return b.created - a.created
    const v = cmpVersion(versionOf(provider, b.model), versionOf(provider, a.model))
    return v || a.id.localeCompare(b.id)
  }
}

const opt = (r: RawModel): ModelOption => ({ id: r.id, model: r.model })

export function pickModelLists(provider: ModelProvider, raw: RawModel[]): ModelLists {
  const seen = new Set<string>()
  const rows = raw.filter((r) => r.id && !seen.has(r.id) && seen.add(r.id)).sort(newestFirst(provider))
  const chat = rows.filter((r) => isChat(provider, r))
  const text = provider === 'infomaniak' ? chat : chat.filter((r) =>
    cmpVersion(versionOf(provider, r.model), TEXT_FLOOR[provider]) >= 0 || ((provider === 'openai' || provider === 'azure') && OPENAI_TEXT_EXTRA.has(r.model.toLowerCase())))
  const image = chat.filter((r) => (provider === 'claude' ? r.image === true : true)).slice(0, RECENT_COUNT)
  const embedding = rows.filter((r) => isEmbedding(provider, r)).slice(0, RECENT_COUNT)
  return { text: text.map(opt), image: image.map(opt), embedding: embedding.map(opt) }
}

export function modelListRequest(provider: ModelProvider, baseUrl: string, apiKey: string): { url: string; headers: Record<string, string> } {
  const base = baseUrl.trim().replace(/\/+$/, '')
  switch (provider) {
    case 'openai':
    case 'infomaniak': return { url: `${base}/models`, headers: { Authorization: `Bearer ${apiKey}` } }
    case 'claude': return { url: `${base.replace(/\/v1$/, '')}/v1/models?limit=1000`, headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } }
    case 'gemini': return { url: `${new URL(base).origin}/v1beta/models?pageSize=1000`, headers: { 'x-goog-api-key': apiKey } }
    case 'azure': return { url: `${new URL(base).origin}/openai/deployments?api-version=2022-12-01`, headers: { 'api-key': apiKey } }
  }
}

export function parseModelList(provider: ModelProvider, body: unknown): RawModel[] {
  const b = (body ?? {}) as Record<string, unknown>
  const arr = (k: string) => (Array.isArray(b[k]) ? (b[k] as Record<string, unknown>[]) : [])
  const s = (v: unknown) => (typeof v === 'string' ? v : '')
  switch (provider) {
    case 'openai':
    case 'infomaniak':
      return arr('data').map((m) => ({ id: s(m.id), model: s(m.id), created: typeof m.created === 'number' ? m.created * 1000 : undefined }))
    case 'claude':
      return arr('data').map((m) => {
        const caps = (m.capabilities ?? {}) as Record<string, unknown>
        const t = Date.parse(s(m.created_at))
        const v = caps.image_input as unknown
        const image = v === true || (!!v && typeof v === 'object' && (v as { supported?: unknown }).supported === true)
        return { id: s(m.id), model: s(m.id), created: Number.isNaN(t) ? undefined : t, image }
      })
    case 'gemini':
      return arr('models').map((m) => {
        const methods = Array.isArray(m.supportedGenerationMethods) ? (m.supportedGenerationMethods as unknown[]).map(String) : []
        const name = s(m.name).replace(/^models\//, '')
        return { id: name, model: name, chat: methods.includes('generateContent'), embedding: methods.includes('embedContent') }
      })
    case 'azure':
      return arr('data').filter((d) => !d.status || d.status === 'succeeded').map((d) => ({
        id: s(d.id), model: s(d.model) || s(d.id), created: typeof d.created_at === 'number' ? d.created_at * 1000 : undefined,
      }))
  }
}

const mask = (t: string) => t.replace(/[A-Za-z0-9_\-./+=]{20,}/g, '[hidden]').slice(0, 200)

export class ModelListError extends Error {}

export async function fetchModelLists(provider: ModelProvider, baseUrl: string, apiKey: string, fetcher: typeof fetch = fetch): Promise<ModelLists> {
  let req: { url: string; headers: Record<string, string> }
  try { req = modelListRequest(provider, baseUrl, apiKey) } catch { throw new ModelListError('The address is not a valid URL.') }
  let res: Response
  try {
    res = await fetcher(req.url, { headers: req.headers, signal: AbortSignal.timeout(20_000), redirect: 'error' })
  } catch {
    throw new ModelListError('Could not reach the AI service — check the address.')
  }
  if (res.status === 401 || res.status === 403) throw new ModelListError('The AI service did not accept the API key.')
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new ModelListError(`The AI service did not return a model list (${res.status}${text ? ` — ${mask(text)}` : ''}).`)
  }
  const body = await res.json().catch(() => null)
  const lists = pickModelLists(provider, parseModelList(provider, body))
  if (!lists.text.length) throw new ModelListError('The AI service returned no text models that can be chosen here — type the model name instead.')
  return lists
}
