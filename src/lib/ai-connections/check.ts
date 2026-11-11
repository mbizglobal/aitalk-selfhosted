import type { OpenAI } from 'openai'
import { connectionFingerprint, createConnectionClient, type AiConnectionCheck, type ResolvedAiConnection } from './index'

const TIMEOUT_MS = 90_000
const EMPTY_HINT = 'the model returned an empty answer — for models that think first (such as Qwen) turn on "Thinking off"'

export function maskSecrets(text: string): string {
  return text
    .replace(/\b(?:sk-|xai-|AIza)[\w\-*.]{4,}/g, '[hidden]')
    .replace(/\b(Bearer|Basic)\s+\S+/gi, '$1 [hidden]')
    .replace(/[A-Za-z0-9_\-./+=]{20,}/g, '[hidden]')
}

function short(e: unknown): string {
  const err = e as { status?: unknown; code?: unknown; message?: unknown } | null
  const parts = [err?.status, err?.code].filter((x) => x !== undefined && x !== null).map(String)
  const msg = typeof err?.message === 'string' ? maskSecrets(err.message.split('\n')[0]).slice(0, 200) : 'unknown error'
  return parts.length ? `${parts.join(' ')} — ${msg}` : msg
}

export async function runConnectionCheck(c: ResolvedAiConnection, client?: OpenAI): Promise<AiConnectionCheck> {
  const ai = client ?? createConnectionClient(c)
  const signal = () => AbortSignal.timeout(TIMEOUT_MS)
  const errors: string[] = []

  let text = false
  try {
    const r: any = await ai.responses.create({ model: c.textModel, input: 'Reply with the single word OK.', max_output_tokens: 1024 } as any, { signal: signal() })
    text = typeof r.output_text === 'string' && r.output_text.trim().length > 0
    if (!text) errors.push(`text: ${EMPTY_HINT}`)
  } catch (e) {
    errors.push((e as { code?: unknown } | null)?.code === 'empty_response' ? `text: ${EMPTY_HINT}` : `text: ${short(e)}`)
  }

  let embedding: boolean | null = null
  if (c.embeddingModel) {
    try {
      const r = await ai.embeddings.create({ model: c.embeddingModel, input: 'connection check' }, { signal: signal() })
      embedding = Array.isArray(r.data?.[0]?.embedding) && r.data[0].embedding.length > 0
      if (!embedding) errors.push('embedding: empty vector')
    } catch (e) { embedding = false; errors.push(`embedding: ${short(e)}`) }
  }

  const ok = text && embedding !== false
  return { ok, at: new Date().toISOString(), text, embedding, ...(errors.length ? { error: errors.join(' | ').slice(0, 2000) } : {}) }
}

export function checkRecord(c: ResolvedAiConnection, result: AiConnectionCheck) {
  return { checkResult: result as unknown as object, checkFingerprint: connectionFingerprint(c) }
}
