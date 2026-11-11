
export const CONNECTION_KINDS = ['email', 'telegram', 'http', 'database', 'sms', 'calendar'] as const
export type ConnectionKind = (typeof CONNECTION_KINDS)[number]

export const DB_ENGINES = ['mysql', 'postgres', 'mssql'] as const
export type DbEngine = (typeof DB_ENGINES)[number]
export const DB_ENGINE_LABEL: Record<DbEngine, string> = { mysql: 'MySQL', postgres: 'PostgreSQL', mssql: 'SQL Server' }
export const DB_MAX_ROWS_DEFAULT = 200
export const DB_MAX_ROWS_LIMIT = 1_000
export interface UsesConnection {
  id: string
  kind: ConnectionKind
  engine?: DbEngine
  label: string
  hint?: string
}

export type SendTarget = { setting: string } | { fixed: string | readonly string[] }

export interface UsesSendTo {
  id: string
  via: string
  to: SendTarget
  auto?: boolean
  label: string
}
export interface UsesSendQuery {
  id: string
  query: string
  auto?: false
  label: string
}
export type UsesSend = UsesSendTo | UsesSendQuery

export interface UsesDbQuery {
  id: string
  via: string
  mode: 'read' | 'write'
  label: string
}

export interface UsesInbox {
  family: string
  identify: { column: string; by: 'phone' | 'telegram' }
  readable: readonly string[]
}

export interface WorkAppUses {
  connections?: readonly UsesConnection[]
  sends?: readonly UsesSend[]
  webSearch?: boolean
  knowledge?: boolean
  dbQueries?: readonly UsesDbQuery[]
  inbox?: readonly UsesInbox[]
}

export interface DbQueryImpl {
  sql: string
  params: readonly string[]
  maxRows?: number
}

export const isSendQuery = (s: UsesSend): s is UsesSendQuery => typeof (s as UsesSendQuery).query === 'string'

export interface KnowledgeHit {
  content: string
  score: number
  source: { storageId: string | null; title: string; chunkIndex: number | null }
}

export type SendContent = { subject?: string; text: string; attachFileIds?: readonly string[] } | { json: unknown }

export type SendRequest =
  | { send: string; content?: SendContent; params?: Readonly<Record<string, unknown>> }
  | { via: string; to: string | readonly string[]; content: SendContent; ref?: string; refKey?: string; toChatSlot?: true }
  | { query: string; params: Readonly<Record<string, unknown>> }

export interface SendResult {
  sendId: string
  status: 'sent' | 'card' | 'failed' | 'unknown' | 'refused'
  code?: string
  affectedRows?: number
  connected?: boolean
}

export interface WorkAppV3Handles {
  settings(): Promise<Record<string, unknown>>
  llm: { ask(prompt: string, opts?: { json?: boolean; maxTokens?: number }): Promise<string> }
  knowledge?: { search(q: string, opts?: { topK?: number }): Promise<KnowledgeHit[]> }
  db?: { query(id: string, params: Readonly<Record<string, unknown>>): Promise<{ rows: Record<string, unknown>[]; truncated: boolean }> }
  send?(req: SendRequest): Promise<SendResult>
}
