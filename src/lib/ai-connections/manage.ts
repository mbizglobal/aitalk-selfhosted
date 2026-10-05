import { prisma } from '@/lib/prisma'
import { decryptData, encryptData } from '@/lib/encryption'
import { isSelfHosted } from '@/lib/edition'
import { AI_CONNECTION_KINDS, MIN_MAX_OUTPUT_TOKENS, connectionFingerprint, decryptAiConnectionRow, isChecked, type AiConnectionCheck, type AiConnectionKind } from './index'
import { checkRecord, maskSecrets, runConnectionCheck } from './check'

export interface AiConnectionInput {
  name: string
  kind: AiConnectionKind
  baseUrl: string
  apiKey: string
  headers?: Record<string, string>
  apiVersion?: string | null
  textModel: string
  imageModel?: string | null
  embeddingModel?: string | null
  maxOutputTokens?: number | null
}

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
  if (u.username || u.password || u.search || u.hash) throw new AiConnectionInputError('baseUrl must not contain a user name, password, query string or # part — put keys in the API key field')
  if (!opts.keyOptional && !i.apiKey?.trim()) throw new AiConnectionInputError('apiKey is required')
  if (!i.textModel?.trim()) throw new AiConnectionInputError('textModel is required')
  if (i.maxOutputTokens != null && (!Number.isInteger(i.maxOutputTokens) || i.maxOutputTokens < MIN_MAX_OUTPUT_TOKENS || i.maxOutputTokens > 1_000_000)) throw new AiConnectionInputError(`maxOutputTokens must be an integer from ${MIN_MAX_OUTPUT_TOKENS} to 1000000`)
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
    imageModel: i.imageModel?.trim() || null,
    embeddingModel: i.kind === 'anthropic' ? null : i.embeddingModel?.trim() || null,
    maxOutputTokens: i.maxOutputTokens ?? null,
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
      textModel: r.textModel, imageModel: r.imageModel, embeddingModel: r.embeddingModel, maxOutputTokens: r.maxOutputTokens,
      isDefault: r.isDefault, hasHeaders: !!r.headers, readable: !!c,
      check: r.checkResult ? { ...(r.checkResult as unknown as AiConnectionCheck), ...((r.checkResult as any).error ? { error: maskSecrets(String((r.checkResult as any).error)) } : {}) } : null,
      checkValid: !!c && isChecked(r, c),
    }
  }))
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
