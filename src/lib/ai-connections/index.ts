import { createHash } from 'node:crypto'
import { AzureOpenAI, OpenAI } from 'openai'
import { createChatCompletionsClient } from './chat-completions'
import { createAnthropicClient } from './anthropic'
import { decryptData } from '@/lib/encryption'

export type AiConnectionKind = 'azure' | 'openai_compatible' | 'anthropic'
export const AI_CONNECTION_KINDS: readonly AiConnectionKind[] = ['azure', 'openai_compatible', 'anthropic']

export interface ResolvedAiConnection {
  id: string
  name: string
  kind: AiConnectionKind
  baseUrl: string
  apiKey: string
  headers: Record<string, string>
  apiVersion: string | null
  textModel: string
  imageModel: string | null
  embeddingModel: string | null
  maxOutputTokens: number | null
}

export type AiConnectionInfo = Pick<ResolvedAiConnection, 'id' | 'name' | 'kind' | 'textModel' | 'imageModel' | 'embeddingModel' | 'maxOutputTokens'>

export type ResolveFailure = 'none' | 'no_default' | 'not_found' | 'ambiguous_default' | 'unchecked' | 'invalid'

export const MIN_MAX_OUTPUT_TOKENS = 1024
export type ResolveResult = { ok: true; connection: ResolvedAiConnection } | { ok: false; reason: ResolveFailure }

export interface AiConnectionCheck {
  ok: boolean
  at: string
  tools: boolean
  json: boolean
  context?: boolean
  image: boolean | null
  embedding: boolean | null
  error?: string
}

export interface AiConnectionRow {
  id: string
  name: string
  kind: string
  baseUrl: string
  apiKey: string
  headers: string | null
  apiVersion: string | null
  textModel: string
  imageModel: string | null
  embeddingModel: string | null
  maxOutputTokens: number | null
  isDefault: boolean
  checkResult: unknown
  checkFingerprint: string | null
}

export interface AiConnectionDb {
  aiConnection: {
    findUnique(args: { where: { id: string } }): Promise<AiConnectionRow | null>
    findMany(args: { where: { isDefault: boolean }; take: number }): Promise<AiConnectionRow[]>
    count(): Promise<number>
  }
}

export interface AiConnectionDeps {
  db: AiConnectionDb
  decrypt: (s: string) => Promise<string>
}

export const CHECK_CONTRACT = 'ai-connection/2'

export function connectionFingerprint(c: Pick<ResolvedAiConnection, 'kind' | 'baseUrl' | 'apiKey' | 'headers' | 'apiVersion' | 'textModel' | 'imageModel' | 'embeddingModel' | 'maxOutputTokens'>): string {
  const headers = Object.keys(c.headers).sort().map((k) => [k, c.headers[k]])
  return createHash('sha256')
    .update(JSON.stringify([CHECK_CONTRACT, c.kind, c.baseUrl, c.apiKey, headers, c.apiVersion, c.textModel, c.imageModel, c.embeddingModel, c.maxOutputTokens]))
    .digest('hex')
}

function isKind(v: string): v is AiConnectionKind {
  return (AI_CONNECTION_KINDS as readonly string[]).includes(v)
}

export async function decryptAiConnectionRow(row: AiConnectionRow, decrypt: AiConnectionDeps['decrypt']): Promise<ResolvedAiConnection | null> {
  try {
    return await readRow(row, decrypt)
  } catch {
    return null
  }
}

async function readRow(row: AiConnectionRow, decrypt: AiConnectionDeps['decrypt']): Promise<ResolvedAiConnection | null> {
  if (!isKind(row.kind) || !row.textModel.trim()) return null
  let url: URL
  try { url = new URL(row.baseUrl.trim()) } catch { return null }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (row.maxOutputTokens != null && (!Number.isInteger(row.maxOutputTokens) || row.maxOutputTokens < MIN_MAX_OUTPUT_TOKENS)) return null
  const apiKey = await decrypt(row.apiKey)
  if (!apiKey) return null
  let headers: Record<string, string> = {}
  if (row.headers) {
    const parsed: unknown = JSON.parse(await decrypt(row.headers))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v !== 'string') return null
      headers[k] = v
    }
  }
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    baseUrl: row.baseUrl.trim(),
    apiKey,
    headers,
    apiVersion: row.apiVersion?.trim() || null,
    textModel: row.textModel.trim(),
    imageModel: row.imageModel?.trim() || null,
    embeddingModel: row.embeddingModel?.trim() || null,
    maxOutputTokens: row.maxOutputTokens ?? null,
  }
}

export function isChecked(row: AiConnectionRow, c: ResolvedAiConnection): boolean {
  const r = row.checkResult as { ok?: unknown } | null
  return !!r && r.ok === true && row.checkFingerprint === connectionFingerprint(c)
}

export async function resolveAiConnection(deps: AiConnectionDeps, connectionId?: string | null): Promise<ResolveResult> {
  let row: AiConnectionRow | null
  if (connectionId) {
    row = await deps.db.aiConnection.findUnique({ where: { id: connectionId } })
    if (!row) return { ok: false, reason: 'not_found' }
  } else {
    const rows = await deps.db.aiConnection.findMany({ where: { isDefault: true }, take: 2 })
    if (rows.length === 0) return { ok: false, reason: (await deps.db.aiConnection.count()) > 0 ? 'no_default' : 'none' }
    if (rows.length > 1) return { ok: false, reason: 'ambiguous_default' }
    row = rows[0]
  }
  const connection = await decryptAiConnectionRow(row, deps.decrypt)
  if (!connection) return { ok: false, reason: 'invalid' }
  if (!isChecked(row, connection)) return { ok: false, reason: 'unchecked' }
  return { ok: true, connection }
}

export const defaultAiConnectionDeps = async (): Promise<AiConnectionDeps> => {
  const { prisma } = await import('@/lib/prisma')
  return { db: prisma as unknown as AiConnectionDb, decrypt: decryptData }
}

export function resolveFailureMessage(reason: ResolveFailure): string {
  switch (reason) {
    case 'none': return 'No AI connection is set up. An administrator must add one in Settings → AI connections.'
    case 'no_default': return 'No AI connection is marked as default. An administrator must choose a default connection, or choose a connection in this workflow step.'
    case 'not_found': return 'The AI connection chosen for this step no longer exists. Choose another connection in the workflow.'
    case 'ambiguous_default': return 'More than one AI connection is marked as default. An administrator must keep exactly one default.'
    case 'unchecked': return 'The AI connection has not passed its connection check since it was last changed. An administrator must run the check again.'
    case 'invalid': return 'The AI connection is incomplete (address, key or model missing). An administrator must fix it.'
  }
}

export const AZURE_DEFAULT_API_VERSION = '2025-03-01-preview'

export function createAzureClient(c: ResolvedAiConnection): AzureOpenAI {
  return new AzureOpenAI({
    apiKey: c.apiKey,
    endpoint: c.baseUrl,
    apiVersion: c.apiVersion || AZURE_DEFAULT_API_VERSION,
    defaultHeaders: c.headers,
  })
}

function isOpenAiApi(baseUrl: string): boolean {
  try { return new URL(baseUrl).hostname === 'api.openai.com' } catch { return false }
}

export function createConnectionClient(c: ResolvedAiConnection): OpenAI {
  if (c.kind === 'azure') return createAzureClient(c)
  if (c.kind === 'openai_compatible' && isOpenAiApi(c.baseUrl)) return new OpenAI({ apiKey: c.apiKey, baseURL: c.baseUrl, defaultHeaders: c.headers })
  if (c.kind === 'openai_compatible') return createChatCompletionsClient(c) as unknown as OpenAI
  return createAnthropicClient(c) as unknown as OpenAI
}

export function toConnectionInfo(c: ResolvedAiConnection): AiConnectionInfo {
  return { id: c.id, name: c.name, kind: c.kind, textModel: c.textModel, imageModel: c.imageModel, embeddingModel: c.embeddingModel, maxOutputTokens: c.maxOutputTokens }
}
