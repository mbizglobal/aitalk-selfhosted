import { prisma } from '@/lib/prisma'
import { decryptData, encryptData } from '@/lib/encryption'
import { isSelfHosted } from '@/lib/edition'
import { AI_CONNECTION_KINDS, MIN_MAX_OUTPUT_TOKENS, connectionFingerprint, decryptAiConnectionRow, isChecked, normalizeTextModels, passedTextModels, type AiConnectionCheck, type AiConnectionKind } from './index'
import { fetchModelLists, modelProviderOf, ModelListError, type ModelLists } from './models'
import { checkRecord, maskSecrets, runConnectionCheck } from './check'

export interface AiConnectionInput {
  name: string
  kind: AiConnectionKind
  baseUrl: string
  apiKey: string
  headers?: Record<string, string>
  apiVersion?: string | null
  textModel: string
  textModels?: string[] | null
  imageModel?: string | null
  embeddingModel?: string | null
  maxOutputTokens?: number | null
  thinkingOff?: boolean
}

export const MAX_TEXT_MODELS = 10

function assertSelfHosted() {
  if (!isSelfHosted()) throw new Error('AI connections are available only in the self-hosted edition')
}

export class AiConnectionInputError extends Error {}
export class AiConnectionNotFoundError extends Error {}

function validate(i: AiConnectionInput, opts: { keyOptional?: boolean } = {}) {
  if (!i.name?.trim()) throw new AiConnectionInputError('name is required')
  if (!AI_CONNECTION_KINDS.includes(i.kind)) throw new AiConnectionInputError(`kind must be one of ${AI_CONNECTION_KINDS.join(', ')}`)
  let u: URL
  try { u = new URL(i.baseUrl) } catch { throw new AiConnectionInputError('baseUrl must be a URL') }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new AiConnectionInputError('baseUrl must be http(s)')
  if (/<[^>]*>|%3C|%3E/i.test(i.baseUrl)) throw new AiConnectionInputError('baseUrl still contains a placeholder such as <product_id> — put in your own value')
  if (u.username || u.password || u.search || u.hash) throw new AiConnectionInputError('baseUrl must not contain a user name, password, query string or # part — put keys in the API key field')
  if (!opts.keyOptional && !i.apiKey?.trim()) throw new AiConnectionInputError('apiKey is required')
  if (!i.textModel?.trim()) throw new AiConnectionInputError('textModel is required')
  if (i.textModels != null && (!Array.isArray(i.textModels) || i.textModels.some((m) => typeof m !== 'string' || m.length > 200))) throw new AiConnectionInputError('textModels must be a list of model names')
  if (normalizeTextModels(i.textModel, i.textModels).length > MAX_TEXT_MODELS) throw new AiConnectionInputError(`Choose at most ${MAX_TEXT_MODELS} text models`)
  if (i.maxOutputTokens != null && (!Number.isInteger(i.maxOutputTokens) || i.maxOutputTokens < MIN_MAX_OUTPUT_TOKENS || i.maxOutputTokens > 1_000_000)) throw new AiConnectionInputError(`maxOutputTokens must be an integer from ${MIN_MAX_OUTPUT_TOKENS} to 1000000`)
  if (i.thinkingOff !== undefined && typeof i.thinkingOff !== 'boolean') throw new AiConnectionInputError('thinkingOff must be true or false')
  for (const [k, v] of Object.entries(i.headers ?? {})) if (!k.trim() || typeof v !== 'string') throw new AiConnectionInputError('headers must be name → string')
}

async function toRow(i: AiConnectionInput) {
  return {
    name: i.name.trim(),
    kind: i.kind,
    baseUrl: i.baseUrl.trim(),
    apiKey: await encryptData(i.apiKey.trim()),
    headers: i.headers && Object.keys(i.headers).length ? await encryptData(JSON.stringify(i.headers)) : null,
    apiVersion: i.apiVersion?.trim() || null,
    textModel: i.textModel.trim(),
    textModels: normalizeTextModels(i.textModel, i.textModels),
    imageModel: i.imageModel?.trim() || null,
    embeddingModel: i.kind === 'anthropic' ? null : i.embeddingModel?.trim() || null,
    maxOutputTokens: i.maxOutputTokens ?? null,
    ...(i.thinkingOff !== undefined ? { thinkingOff: i.kind === 'openai_compatible' && i.thinkingOff } : {}),
  }
}

export async function createAiConnection(i: AiConnectionInput): Promise<string> {
  assertSelfHosted()
  validate(i)
  const data = await toRow(i)
  return prisma.$transaction(async (tx) => {
    const hasDefault = (await tx.aiConnection.count({ where: { isDefault: true } })) > 0
    const row = await tx.aiConnection.create({ data: { ...data, isDefault: !hasDefault } })
    return row.id
  }, { isolationLevel: 'Serializable' })
}

export async function updateAiConnection(id: string, i: AiConnectionInput): Promise<void> {
  assertSelfHosted()
  validate(i, { keyOptional: true })
  const current = await prisma.aiConnection.findUnique({ where: { id }, select: { baseUrl: true, kind: true } })
  if (!current) throw new AiConnectionNotFoundError('AI connection not found')
  const moved = current.baseUrl !== i.baseUrl.trim() || current.kind !== i.kind
  const keep = !i.apiKey?.trim()
  if (moved && keep) throw new AiConnectionInputError('Enter the API key again when you change the address or the type — the saved key is not sent to a new address.')
  const data = await toRow({ ...i, apiKey: keep ? 'x' : i.apiKey })
  const { apiKey, headers, ...rest } = data
  const headerUpdate = i.headers !== undefined ? { headers } : moved ? { headers: null } : {}
  const r = await prisma.aiConnection.updateMany({ where: { id, baseUrl: current.baseUrl, kind: current.kind }, data: { ...rest, ...(keep ? {} : { apiKey }), ...headerUpdate } })
  if (r.count === 0) throw new AiConnectionInputError('The AI connection was changed at the same time by someone else — reload and try again.')
}

export async function listAiConnections() {
  assertSelfHosted()
  const rows = await prisma.aiConnection.findMany({ orderBy: { createdAt: 'asc' } })
  return Promise.all(rows.map(async (r) => {
    const c = await decryptAiConnectionRow(r, decryptData)
    return {
      id: r.id, name: r.name, kind: r.kind, baseUrl: r.baseUrl, apiVersion: r.apiVersion,
      textModel: r.textModel, textModels: normalizeTextModels(r.textModel, r.textModels), imageModel: r.imageModel, embeddingModel: r.embeddingModel, maxOutputTokens: r.maxOutputTokens,
      thinkingOff: r.thinkingOff, isDefault: r.isDefault, hasHeaders: !!r.headers, readable: !!c,
      check: r.checkResult ? { ...(r.checkResult as unknown as AiConnectionCheck), ...((r.checkResult as any).error ? { error: maskSecrets(String((r.checkResult as any).error)) } : {}) } : null,
      checkValid: !!c && isChecked(r, c),
      passedModels: c && isChecked(r, c) ? passedTextModels(c, r.checkResult as unknown as AiConnectionCheck) : [],
    }
  }))
}

export async function listAiConnectionChoices() {
  assertSelfHosted()
  const rows = await prisma.aiConnection.findMany({ orderBy: { createdAt: 'asc' } })
  const out: Array<{ id: string; name: string; isDefault: boolean; defaultModel: string; models: string[] }> = []
  for (const r of rows) {
    const c = await decryptAiConnectionRow(r, decryptData)
    if (!c || !isChecked(r, c)) continue
    out.push({ id: r.id, name: r.name, isDefault: r.isDefault, defaultModel: c.textModel, models: passedTextModels(c, r.checkResult as unknown as AiConnectionCheck) })
  }
  return out
}

export async function listProviderModels(i: { id?: string | null; kind: AiConnectionKind; baseUrl: string; apiKey: string }): Promise<ModelLists> {
  assertSelfHosted()
  if (!AI_CONNECTION_KINDS.includes(i.kind)) throw new AiConnectionInputError('kind is not valid')
  const provider = modelProviderOf(i.kind, i.baseUrl)
  if (!provider) throw new AiConnectionInputError('Model lists are available for OpenAI, Azure OpenAI, Gemini and Claude only — type the model name.')
  let key = i.apiKey?.trim()
  if (!key && i.id) {
    const row = await prisma.aiConnection.findUnique({ where: { id: i.id } })
    if (!row) throw new AiConnectionNotFoundError('AI connection not found')
    if (row.baseUrl !== i.baseUrl.trim() || row.kind !== i.kind) throw new AiConnectionInputError('Enter the API key again when you change the address or the type — the saved key is not sent to a new address.')
    key = await decryptData(row.apiKey)
  }
  if (!key) throw new AiConnectionInputError('apiKey is required')
  try {
    return await fetchModelLists(provider, i.baseUrl, key)
  } catch (e) {
    if (e instanceof ModelListError) throw new AiConnectionInputError(e.message)
    throw e
  }
}

export async function setDefaultAiConnection(id: string): Promise<void> {
  assertSelfHosted()
  await prisma.$transaction(async (tx) => {
    const row = await tx.aiConnection.findUnique({ where: { id }, select: { id: true } })
    if (!row) throw new AiConnectionNotFoundError('AI connection not found')
    await tx.aiConnection.updateMany({ where: { isDefault: true, NOT: { id } }, data: { isDefault: false } })
    await tx.aiConnection.update({ where: { id }, data: { isDefault: true } })
  }, { isolationLevel: 'Serializable' })
}

export async function deleteAiConnection(id: string): Promise<void> {
  assertSelfHosted()
  await prisma.$transaction(async (tx) => {
    await tx.aiConnection.delete({ where: { id } })
    if ((await tx.aiConnection.count({ where: { isDefault: true } })) > 0) return
    const rest = await tx.aiConnection.findMany({ select: { id: true }, take: 2 })
    if (rest.length === 1) await tx.aiConnection.update({ where: { id: rest[0].id }, data: { isDefault: true } })
  }, { isolationLevel: 'Serializable' })
}

export async function checkAiConnection(id: string): Promise<AiConnectionCheck> {
  assertSelfHosted()
  const row = await prisma.aiConnection.findUnique({ where: { id } })
  if (!row) throw new AiConnectionNotFoundError('AI connection not found')
  const c = await decryptAiConnectionRow(row, decryptData)
  if (!c) throw new AiConnectionInputError('The AI connection is incomplete (address, key or model missing).')
  const result = await runConnectionCheck(c)
  const now = await prisma.aiConnection.findUnique({ where: { id } })
  const nowConn = now ? await decryptAiConnectionRow(now, decryptData) : null
  if (now && nowConn && connectionFingerprint(nowConn) === connectionFingerprint(c)) {
    await prisma.aiConnection.updateMany({ where: { id, updatedAt: now.updatedAt }, data: checkRecord(c, result) })
  }
  return result
}
