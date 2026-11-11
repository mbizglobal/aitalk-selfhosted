import { createHash, randomUUID } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { WorkError } from './errors'
import { appStartSettings } from './app-chat'
import { checkAiSql, countFromRows, countSqlProblem, type AiSqlCheck } from './ai-sql-check'
import { CompanyDbError, execCompanyDbSql, readCompanyDb, resolveDbConnection, writeOutcome, type CompanyDbDeps, type DbConnConfig } from './company-db'
import { createSend, type AiSqlCard, type Sender, type SendPayload } from './sends'
import { usesOfKind, type V3Registry } from './v3-handles'
import { writeWorkEvent } from './projects'
import { decryptJson } from './sealed'
import { DB_ENGINE_LABEL, type DbEngine } from './uses'
import type { WorkFileDeps } from './files'
import type { SheetActor } from './sheet-gate'

export const AI_SQL_CARD_BURST = 10

export type AiSqlMode = 'read' | 'rows' | 'schema'

export interface AiSqlSlot { slot: string; engine: DbEngine | null; label: string; mode?: AiSqlMode; about?: string }

const ASSEMBLED = 'assembled'

export function aiSqlSlotsOf(workflowJson: unknown, kind: string, registry?: V3Registry): AiSqlSlot[] {
  const on = appStartSettings(workflowJson).dbAiSql
  const conns = usesOfKind(kind, registry)?.uses.connections ?? []
  return conns.filter((c) => c.kind === 'database' && on[c.id]).map((c) => ({ slot: c.id, engine: c.engine ?? null, label: c.label }))
}

export async function aiSqlSlotsWithEngines(db: PrismaClient, q: { userId: string; workflowId: string }, slots: AiSqlSlot[]): Promise<AiSqlSlot[]> {
  return Promise.all(slots.map(async (s) => {
    if (s.engine) return s
    const r = await resolveDbConnection(db, { userId: q.userId, workflowId: q.workflowId, slot: s.slot }, { secret: false })
    return { ...s, engine: r.ok ? r.config.engine : null }
  }))
}

async function specCompanyDb(db: PrismaClient, key: Buffer, q: { userId: string; projectId: string; kind: string }): Promise<{ mode: AiSqlMode; label: string; about?: string } | null | undefined> {
  if (q.kind !== ASSEMBLED) return undefined
  const { readSpec } = await import('./assembled')
  const spec = await readSpec(db as never, key, { userId: q.userId, projectId: q.projectId })
  const c = spec?.spec.companyDb
  return c ? { mode: c.mode, label: c.label, ...(c.about ? { about: c.about } : {}) } : null
}

export async function aiSqlToolSlots(db: PrismaClient, key: Buffer, q: { userId: string; workflowId: string; projectId: string; kind: string; workflowJson: unknown; registry?: V3Registry }): Promise<AiSqlSlot[]> {
  const slots = aiSqlSlotsOf(q.workflowJson, q.kind, q.registry)
  if (!slots.length) return []
  const block = await specCompanyDb(db, key, q)
  if (block === null) return []
  const withMode = slots.map((s) => (block ? { ...s, mode: block.mode, ...(block.about ? { about: block.about } : {}) } : { ...s, mode: 'schema' as const }))
  return aiSqlSlotsWithEngines(db, { userId: q.userId, workflowId: q.workflowId }, withMode)
}

export async function aiSqlAccess(db: PrismaClient, key: Buffer, q: { userId: string; workflowId: string; projectId: string; kind: string; slot: string; registry?: V3Registry }): Promise<{ slot: AiSqlSlot; mode: AiSqlMode }> {
  const w = await db.workflow.findFirst({ where: { workflowId: q.workflowId, agent: { userId: q.userId } }, select: { workflowJson: true } })
  const s = w ? aiSqlSlotsOf(w.workflowJson, q.kind, q.registry).find((x) => x.slot === q.slot) : undefined
  if (!s) throw new WorkError('FORBIDDEN', 'AI_SQL_OFF')
  const block = await specCompanyDb(db, key, q)
  if (block === null) throw new WorkError('FORBIDDEN', 'AI_SQL_OFF')
  return { slot: s, mode: block ? block.mode : 'schema' }
}

export function aiSqlModeProblem(mode: AiSqlMode, r: Pick<AiSqlCheck, 'kind' | 'countTarget'>): 'AI_SQL_READ_ONLY' | 'AI_SQL_NOT_ROWS' | null {
  if (r.kind === 'read') return null
  if (mode === 'read') return 'AI_SQL_READ_ONLY'
  if (mode === 'rows' && !r.countTarget) return 'AI_SQL_NOT_ROWS'
  return null
}
const MODE_TEXT: Record<'AI_SQL_READ_ONLY' | 'AI_SQL_NOT_ROWS', string> = {
  AI_SQL_READ_ONLY: 'AI_SQL_READ_ONLY — this app only reads the company database (companyDb mode "read")',
  AI_SQL_NOT_ROWS: 'AI_SQL_NOT_ROWS — this app may only insert, update or delete rows with one plain INSERT / UPDATE / DELETE on PostgreSQL or MySQL (no upsert, IGNORE, MERGE, REPLACE, table changes or procedures; SQL Server cannot change rows in this mode)',
}

export function aiSqlTarget(c: Pick<DbConnConfig, 'engine' | 'host' | 'port' | 'database' | 'user'>): { target: string; label: string } {
  const target = createHash('sha256').update(JSON.stringify([c.engine, c.host.toLowerCase(), c.port, c.database, c.user])).digest('hex')
  return { target, label: `${DB_ENGINE_LABEL[c.engine]} · ${c.host}:${c.port}/${c.database} · ${c.user}` }
}

const sqlHash = (sql: string) => createHash('sha256').update(sql).digest('hex').slice(0, 16)

function checked(sql: unknown, engine: DbEngine): AiSqlCheck {
  const r = checkAiSql(sql, engine)
  if (!r.ok) throw new WorkError('INVALID', r.code)
  return r
}

export interface AiSqlScope {
  deps: WorkFileDeps
  userId: string
  projectId: string
  workflowId: string
  kind: string
  caller: SheetActor
  taskId?: string | null
  registry?: V3Registry
  companyDb?: CompanyDbDeps
}

const accessOf = async (s: AiSqlScope, slot: string) => aiSqlAccess(s.deps.db as PrismaClient, await s.deps.dataKey(s.deps.db, s.userId), { userId: s.userId, workflowId: s.workflowId, projectId: s.projectId, kind: s.kind, slot, registry: s.registry })

function readError(slot: string, e: unknown, prefix = ''): never {
  if (!(e instanceof CompanyDbError)) throw e
  console.warn(`[work-ai-sql] read ${slot}: ${e.code} ${e.detail.slice(0, 200)}`)
  throw new WorkError('UNAVAILABLE', `${prefix}${e.code === 'DB_ERROR' ? `DB_ERROR: ${e.detail.slice(0, 200)}` : e.code}`)
}

export async function readAiSql(s: AiSqlScope, slot: string, sql: unknown, maxRows?: number): Promise<{ rows: Record<string, unknown>[]; truncated: boolean }> {
  const on = await accessOf(s, slot)
  const conn = await resolveDbConnection(s.deps.db as PrismaClient, { userId: s.userId, workflowId: s.workflowId, slot, engine: on.slot.engine ?? undefined })
  if (!conn.ok) throw new WorkError('UNAVAILABLE', conn.code)
  const r = checked(sql, conn.config.engine)
  if (!r.readable) throw new WorkError('INVALID', 'SQL_NOT_READ — only SELECT / WITH / SHOW / EXPLAIN / DESCRIBE without locking, file or lock functions (SQL Server: one SELECT only). To change data or tables use work_db_sql_change (a card the person approves)')
  let out: { rows: Record<string, unknown>[]; truncated: boolean }
  try {
    out = await readCompanyDb(conn.config, { sql: sql as string, values: [], maxRows }, s.companyDb)
  } catch (e) {
    readError(slot, e)
  }
  const key = await s.deps.dataKey(s.deps.db, s.userId)
  await writeWorkEvent(s.deps.db as never, key, { userId: s.userId, projectId: s.projectId, taskId: s.taskId ?? undefined, actor: s.caller, action: 'db_sql_read', detail: { slot, sql: sqlHash(sql as string), rows: out.rows.length, truncated: out.truncated } })
  return out
}

export async function createAiSqlCard(s: AiSqlScope, slot: string, sql: unknown, reason: unknown, countSql?: unknown): Promise<{ sendId: string; status: 'card'; oneStep: boolean; kind: string; counted: boolean }> {
  const on = await accessOf(s, slot)
  const conn = await resolveDbConnection(s.deps.db as PrismaClient, { userId: s.userId, workflowId: s.workflowId, slot, engine: on.slot.engine ?? undefined }, { secret: false })
  if (!conn.ok) throw new WorkError('UNAVAILABLE', conn.code)
  const r = checked(sql, conn.config.engine)
  if (r.kind === 'read') throw new WorkError('INVALID', 'this is a read — use work_db_sql_read')
  const mp = aiSqlModeProblem(on.mode, r)
  if (mp) throw new WorkError('FORBIDDEN', MODE_TEXT[mp])
  const hasCount = countSql !== undefined && countSql !== null && countSql !== ''
  if (r.countTarget) {
    if (!hasCount) throw new WorkError('INVALID', 'COUNT_REQUIRED — give countSql: one SELECT that returns the number of rows this statement will change (UPDATE / DELETE: SELECT COUNT(*) with the same FROM and WHERE · INSERT … VALUES: SELECT <number of rows> · INSERT … SELECT: SELECT COUNT(*) of that SELECT)')
    const cp = countSqlProblem(countSql, conn.config.engine)
    if (cp) throw new WorkError('INVALID', `COUNT_INVALID: ${cp} — countSql must be one read-only SELECT returning one number, without sequence functions`)
  } else if (hasCount) {
    throw new WorkError('INVALID', 'countSql is only for a plain INSERT / UPDATE / DELETE on PostgreSQL or MySQL — leave it out for this statement')
  }
  const t = aiSqlTarget(conn.config)
  const card: AiSqlCard = {
    sql: sql as string,
    reason: typeof reason === 'string' ? reason.slice(0, 1_000) : '',
    engine: conn.config.engine,
    connectionId: conn.connectionId,
    target: t.target,
    targetLabel: t.label,
    kind: r.kind,
    oneStep: r.oneStep,
    ...(r.countTarget ? { countSql: countSql as string } : {}),
  }
  const sent = await createSend(s.deps, { userId: s.userId, projectId: s.projectId, taskId: s.taskId ?? null, workflowId: s.workflowId, kind: 'db_sql', slot, auto: false, payload: { aiSql: card }, requestedBy: s.caller, maxPending: AI_SQL_CARD_BURST })
  return { sendId: sent.id, status: 'card', oneStep: r.oneStep, kind: r.kind, counted: r.countTarget }
}

export function aiSqlCardCounted(card: AiSqlCard): boolean {
  const r = checkAiSql(card.sql, card.engine)
  return r.ok && r.countTarget
}

export async function prepareAiSqlCard(deps: WorkFileDeps, k: { userId: string; projectId: string; sendId: string }, opts: { registry?: V3Registry; companyDb?: CompanyDbDeps; now?: Date } = {}): Promise<{ prepareId: string; n: number; at: Date }> {
  const db = deps.db as PrismaClient
  const row = await db.workSend.findFirst({ where: { id: k.sendId, projectId: k.projectId, userId: k.userId }, select: { kind: true, status: true, slot: true, workflowId: true, payload: true, project: { select: { kind: true, status: true, workflowId: true, workflowLinkedAt: true } } } })
  if (!row) throw new WorkError('NOT_FOUND')
  if (row.project.status !== 'active' || (row.project.workflowLinkedAt !== null && row.project.workflowId === null)) throw new WorkError('READ_ONLY')
  if (row.kind !== 'db_sql') throw new WorkError('INVALID', 'only database cards are counted')
  if (row.status !== 'pending') throw new WorkError('STALE', 'the card is no longer waiting')
  const key = await deps.dataKey(deps.db, k.userId)
  const card = decryptJson<SendPayload>(row.payload, key).aiSql
  if (!card || !aiSqlCardCounted(card) || !card.countSql) throw new WorkError('INVALID', 'COUNT_NOT_NEEDED — this card has no row count; confirm it directly')
  const on = await aiSqlAccess(db, key, { userId: k.userId, workflowId: row.workflowId, projectId: k.projectId, kind: row.project.kind, slot: row.slot, registry: opts.registry })
  const now = checkAiSql(card.sql, card.engine)
  if (!now.ok) throw new WorkError('INVALID', now.code)
  const mp = aiSqlModeProblem(on.mode, now)
  if (mp) throw new WorkError('FORBIDDEN', MODE_TEXT[mp])
  const conn = await resolveDbConnection(db, { userId: k.userId, workflowId: row.workflowId, slot: row.slot, engine: card.engine })
  if (!conn.ok) throw new WorkError('UNAVAILABLE', conn.code)
  if (conn.connectionId !== card.connectionId || aiSqlTarget(conn.config).target !== card.target) throw new WorkError('UNAVAILABLE', 'TARGET_CHANGED')
  const cp = countSqlProblem(card.countSql, card.engine)
  if (cp) throw new WorkError('INVALID', `COUNT_INVALID: ${cp}`)
  let out: { rows: Record<string, unknown>[]; truncated: boolean }
  try {
    out = await readCompanyDb(conn.config, { sql: card.countSql, values: [], maxRows: 2 }, opts.companyDb)
  } catch (e) {
    readError(row.slot, e, 'COUNT_FAILED: ')
  }
  const n = countFromRows(out.rows, out.truncated)
  if (n === null) throw new WorkError('INVALID', 'COUNT_INVALID — the count did not return one row with one whole number (0 or more); ask the AI to make the card again')
  const prepareId = randomUUID().replace(/-/g, '').slice(0, 25)
  const at = opts.now ?? new Date()
  const u = await db.workSend.updateMany({ where: { id: k.sendId, projectId: k.projectId, userId: k.userId, status: 'pending' }, data: { prepareId, prepareN: n, prepareAt: at } })
  if (u.count !== 1) throw new WorkError('STALE', 'the card is no longer waiting')
  return { prepareId, n, at }
}

export function aiSqlSender(db: PrismaClient, deps: { companyDb?: CompanyDbDeps; registry?: V3Registry; dataKey?: (db: PrismaClient, userId: string) => Promise<Buffer> } = {}): Sender {
  return {
    async send(input) {
      const card = input.payload.aiSql
      if (!card) return { status: 'refused', code: 'PRECHECK_FAILED' }
      let config: DbConnConfig
      let r: AiSqlCheck
      try {
        const p = await db.workProject.findFirst({ where: { id: input.projectId, userId: input.userId }, select: { kind: true } })
        if (!p) return { status: 'refused', code: 'NO_CONNECTION' }
        const dataKey = deps.dataKey ?? (async (d: PrismaClient, u: string) => (await import('@/lib/user-data-key')).ensureUserDataKey(d, u))
        let mode: AiSqlMode
        try {
          mode = (await aiSqlAccess(db, await dataKey(db, input.userId), { userId: input.userId, workflowId: input.workflowId, projectId: input.projectId, kind: p.kind, slot: input.slot, registry: deps.registry })).mode
        } catch (e) {
          if (e instanceof WorkError && e.code === 'FORBIDDEN') return { status: 'refused', code: 'AI_SQL_OFF' }
          throw e
        }
        const c = checkAiSql(card.sql, card.engine)
        if (!c.ok) return { status: 'refused', code: c.code }
        const mp = aiSqlModeProblem(mode, c)
        if (mp) return { status: 'refused', code: mp }
        if (c.countTarget && input.expectRows === undefined) return { status: 'refused', code: 'PREPARE_REQUIRED' }
        const conn = await resolveDbConnection(db, { userId: input.userId, workflowId: input.workflowId, slot: input.slot, engine: card.engine })
        if (!conn.ok) return { status: 'refused', code: conn.code }
        if (conn.connectionId !== card.connectionId || aiSqlTarget(conn.config).target !== card.target) return { status: 'refused', code: 'TARGET_CHANGED' }
        config = conn.config
        r = c
      } catch (e) {
        console.error('[work-ai-sql] 실행 준비 실패:', e instanceof Error ? e.message.slice(0, 200) : 'error')
        return { status: 'refused', code: 'PREPARE_FAILED' }
      }
      const label = aiSqlTarget(config).label
      try {
        const out = await execCompanyDbSql(config, card.sql, { mysqlTx: r.mysqlTx, mssqlUncertain: r.mssqlUncertain, ...(r.countTarget ? { expectRows: input.expectRows } : {}) }, deps.companyDb)
        if (out.mismatch) return { status: 'refused', code: 'ROWS_CHANGED', detail: `${out.mismatch.actual ?? 'unknown'} rows instead of ${input.expectRows} — nothing was kept`, target: label }
        return { status: 'sent', affectedRows: out.affectedRows, detail: `${out.affectedRows} rows changed`, target: label }
      } catch (e) {
        if (e instanceof CompanyDbError) {
          console.warn(`[work-ai-sql] exec ${e.phase} ${e.code}: ${e.detail.slice(0, 200)}`)
          return { status: writeOutcome(e), code: e.code, detail: e.detail, target: label }
        }
        return { status: 'unknown', code: 'NO_RESPONSE', detail: e instanceof Error ? e.message.slice(0, 300) : 'error', target: label }
      }
    },
  }
}

