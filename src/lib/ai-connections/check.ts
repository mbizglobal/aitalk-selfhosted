import type { OpenAI } from 'openai'
import { connectionFingerprint, createConnectionClient, type AiConnectionCheck, type ResolvedAiConnection } from './index'

const TIMEOUT_MS = 90_000
const LONG_TIMEOUT_MS = 180_000
const CODE_WORD = 'MARIGOLD-7319'
const RED_PNG = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAF0lEQVR4nGP4z8BAEiJN9aiGUQ1DSgMAkPn/Afnh+ngAAAAASUVORK5CYII='

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

  let tools = false
  try {
    const r: any = await ai.responses.create({
      model: c.textModel,
      input: 'Call the ping tool with value 7.',
      tools: [{ type: 'function', name: 'ping', description: 'Connection check', strict: true, parameters: { type: 'object', properties: { value: { type: 'integer' } }, required: ['value'], additionalProperties: false } }],
      tool_choice: 'required',
      max_output_tokens: 1024,
    } as any, { signal: signal() })
    const call = (r.output || []).find((o: any) => o?.type === 'function_call' && o.name === 'ping')
    tools = !!call && JSON.parse(call.arguments || '{}').value === 7
    if (!tools) errors.push('tools: no valid ping call')
  } catch (e) { errors.push(`tools: ${short(e)}`) }

  let json = false
  try {
    const r: any = await ai.responses.create({
      model: c.textModel,
      input: 'Return ok=true.',
      text: { format: { type: 'json_schema', name: 'check', strict: true, schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false } } },
      max_output_tokens: 1024,
    } as any, { signal: signal() })
    json = JSON.parse(r.output_text || 'null')?.ok === true
    if (!json) errors.push('json: unexpected output')
  } catch (e) { errors.push(`json: ${short(e)}`) }

  let context = false
  try {
    const filler = Array.from({ length: 600 }, (_, i) => `Line ${i + 1}: the ledger entry was reviewed and nothing unusual was found.`).join('\n')
    const r: any = await ai.responses.create({
      model: c.textModel,
      input: `The code word is ${CODE_WORD}. Remember it.\n\n${filler}\n\nWhat is the code word given at the very beginning? Answer with the code word only.`,
      max_output_tokens: 1024,
    } as any, { signal: AbortSignal.timeout(LONG_TIMEOUT_MS) })
    context = typeof r.output_text === 'string' && r.output_text.toUpperCase().includes(CODE_WORD)
    if (!context) errors.push('context: a long input was cut — raise the context length on the AI server (Ollama: OLLAMA_CONTEXT_LENGTH)')
  } catch (e) { errors.push(`context: ${short(e)}`) }

  let image: boolean | null = null
  if (c.imageModel) {
    try {
      const r: any = await ai.responses.create({
        model: c.imageModel,
        input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'What colour is this image? Answer with one English word.' }, { type: 'input_image', image_url: `data:image/png;base64,${RED_PNG}`, detail: 'low' }] }],
        max_output_tokens: 1024,
      } as any, { signal: signal() })
      image = typeof r.output_text === 'string' && /\bred\b/i.test(r.output_text)
      if (!image) errors.push(`image: unexpected answer ${JSON.stringify(String(r.output_text ?? '').slice(0, 60))}`)
    } catch (e) { image = false; errors.push(`image: ${short(e)}`) }
  }

  let embedding: boolean | null = null
  if (c.embeddingModel) {
    try {
      const r = await ai.embeddings.create({ model: c.embeddingModel, input: 'connection check' }, { signal: signal() })
      embedding = Array.isArray(r.data?.[0]?.embedding) && r.data[0].embedding.length > 0
      if (!embedding) errors.push('embedding: empty vector')
    } catch (e) { embedding = false; errors.push(`embedding: ${short(e)}`) }
  }

  const ok = tools && json && context && image !== false && embedding !== false
  return { ok, at: new Date().toISOString(), tools, json, context, image, embedding, ...(errors.length ? { error: errors.join(' | ').slice(0, 1000) } : {}) }
}

export function checkRecord(c: ResolvedAiConnection, result: AiConnectionCheck) {
  return { checkResult: result as unknown as object, checkFingerprint: connectionFingerprint(c) }
}
