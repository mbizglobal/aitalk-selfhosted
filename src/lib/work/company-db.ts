
import type { PrismaClient } from '@prisma/client'
import { isIP } from 'node:net'
import { DnsLookupError, SSRFError } from '@/lib/ssrfGuard'
import { resolveEditionAddress } from '@/lib/edition-connect'
import { agentScopedWhere } from '@/lib/connection-scope'
import { getConnectionSecret } from '@/lib/secret-vault'
import { WorkError } from './errors'
import { appStartSettings } from './app-chat'
import { DB_ENGINE_LABEL, DB_ENGINES, DB_MAX_ROWS_DEFAULT, type DbEngine } from './uses'

export const DB_CONNECT_TIMEOUT_MS = 10_000
export const DB_STATEMENT_TIMEOUT_MS = 15_000
const CLIENT_TIMEOUT_MS = DB_STATEMENT_TIMEOUT_MS + 5_000
export const DB_READ_MAX_BYTES = 2 * 1024 * 1024
export const DB_CELL_MAX_CHARS = 4_000
export const DB_PARAM_MAX_CHARS = 2_000

export const DB_PROVIDER: Record<DbEngine, 'db_mysql' | 'db_postgres' | 'db_mssql'> = { mysql: 'db_mysql', postgres: 'db_postgres', mssql: 'db_mssql' }
export const DB_DEFAULT_PORT: Record<DbEngine, number> = { mysql: 3306, postgres: 5432, mssql: 1433 }
export const engineOfProvider = (provider: string): DbEngine | null => (Object.keys(DB_PROVIDER) as DbEngine[]).find((e) => DB_PROVIDER[e] === provider) ?? null
export const DB_TLS_MODES = ['verify', 'no-verify', 'off'] as const
export type DbTls = (typeof DB_TLS_MODES)[number]

export type DbErrorCode = 'NO_CONNECTION' | 'ENGINE_MISMATCH' | 'ADDRESS_BLOCKED' | 'DB_DNS' | 'DB_TLS' | 'DB_CONNECT' | 'DB_AUTH' | 'TIMEOUT' | 'DB_ERROR' | 'NO_RESPONSE' | 'PREPARE_FAILED'

export type DbPhase = 'prepare' | 'connect' | 'statement' | 'commit'

export class CompanyDbError extends Error {
  constructor(public code: DbErrorCode, public phase: DbPhase, public detail: string = '', public definite = false) {
    super(`${code}${detail ? `: ${detail}` : ''}`)
    this.name = 'CompanyDbError'
  }
}

export interface DbConnConfig {
  engine: DbEngine
  host: string
  port: number
  database: string
  user: string
  password: string
  tls: DbTls
  ca?: string
}

export const DB_CA_MAX_CHARS = 20_000
export function parseDbCa(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (!t || t.length > DB_CA_MAX_CHARS) return null
  return /^(?:-----BEGIN CERTIFICATE-----\s+[A-Za-z0-9+/=\s]+?-----END CERTIFICATE-----\s*)+$/.test(t) ? t : null
}

export interface DbSession {
  read(sql: string, values: unknown[], onRow: (row: Record<string, unknown>) => boolean, names?: readonly string[]): Promise<void>
  exec(sql: string, values: unknown[], names?: readonly string[]): Promise<number>
  begin(readOnly: boolean): Promise<void>
  commit(): Promise<void>
  rollback?(): Promise<number[]>
  close(): Promise<void>
}
export interface DbDriver {
  connect(c: DbConnConfig & { ip: string }): Promise<DbSession>
  classify(e: unknown): { server: boolean; auth: boolean; serverTimeout: boolean; escaped?: boolean }
}

const tlsOf = (c: DbConnConfig) => (c.tls === 'off' ? undefined : { rejectUnauthorized: c.tls === 'verify', ...(isIP(c.host) ? {} : { servername: c.host }), ...(c.tls === 'verify' && c.ca ? { ca: c.ca } : {}) })

const mysqlDriver: DbDriver = {
  async connect(c) {
    const mysql = (await import('mysql2')).default
    const net = await import('node:net')
    if (c.tls === 'verify' && isIP(c.host)) throw Object.assign(new Error('certificate check needs a host name for MySQL — use the host name, or choose "On — don\'t check the certificate"'), { code: 'HOSTNAME_MISMATCH' })
    const tls = tlsOf(c)
    const conn = mysql.createConnection({
      host: c.host, port: c.port, stream: () => net.connect(c.port, c.ip), user: c.user, password: c.password, database: c.database,
      connectTimeout: DB_CONNECT_TIMEOUT_MS, ssl: tls ? { ...tls, verifyIdentity: c.tls === 'verify' } : undefined, multipleStatements: false,
      supportBigNumbers: true, bigNumberStrings: true, decimalNumbers: false, dateStrings: true,
      flags: ['FOUND_ROWS'],
    })
    const q = (sql: string, values: unknown[] = []) => new Promise<unknown>((res, rej) => conn.query({ sql, values, timeout: CLIENT_TIMEOUT_MS }, (e, r) => (e ? rej(e) : res(r))))
    await new Promise<void>((res, rej) => conn.connect((e) => (e ? rej(e) : res())))
    await q("SET SESSION sql_mode = REPLACE(@@SESSION.sql_mode, 'NO_BACKSLASH_ESCAPES', '')")
    await q(`SET SESSION MAX_EXECUTION_TIME = ${DB_STATEMENT_TIMEOUT_MS}`).catch(() => q(`SET SESSION max_statement_time = ${DB_STATEMENT_TIMEOUT_MS / 1000}`).catch(() => undefined))
    return {
      begin: async (ro) => { await q(ro ? 'START TRANSACTION READ ONLY' : 'START TRANSACTION') },
      commit: async () => { await q('COMMIT') },
      rollback: async () => {
        const r = await q('ROLLBACK') as { warningStatus?: number }
        if (!r?.warningStatus) return []
        return (await q('SHOW WARNINGS') as Array<{ Code?: unknown }>).map((w) => Number(w.Code))
      },
      exec: async (sql, values) => Number((await q(sql, values) as { affectedRows?: number }).affectedRows ?? 0),
      read: (sql, values, onRow) => new Promise<void>((res, rej) => {
        let stopped = false
        let gotFields = false
        const query = conn.query({ sql, values, timeout: CLIENT_TIMEOUT_MS })
        query.on('error', (e) => { if (!stopped) rej(e) })
        query.on('fields', () => { gotFields = true })
        query.on('result', (row) => {
          if (stopped || !gotFields || Array.isArray(row) || !row || typeof row !== 'object') return
          if (!onRow(row as Record<string, unknown>)) {
            stopped = true
            conn.destroy()
            res()
          }
        })
        query.on('end', () => { if (!stopped) res() })
      }),
      close: async () => { try { conn.destroy() } catch { } },
    }
  },
  classify(e) {
    const err = e as { fatal?: boolean; errno?: number; code?: string; sqlState?: string }
    const auth = err?.code === 'ER_ACCESS_DENIED_ERROR' || err?.code === 'ER_DBACCESS_DENIED_ERROR' || err?.code === 'ER_BAD_DB_ERROR'
    const serverTimeout = err?.errno === 3024 || err?.errno === 1969
    return { server: !!err && typeof err.errno === 'number' && typeof err.sqlState === 'string' && !err.fatal, auth, serverTimeout }
  },
}

const postgresDriver: DbDriver = {
  async connect(c) {
    const pg = (await import('pg')).default
    const RAW = new Set([1082, 1083, 1114, 1184, 1266])
    const client = new pg.Client({
      host: c.ip, port: c.port, user: c.user, password: c.password, database: c.database,
      connectionTimeoutMillis: DB_CONNECT_TIMEOUT_MS, ssl: tlsOf(c) ?? false,
      types: { getTypeParser: ((oid: number, format?: 'text' | 'binary') => (RAW.has(oid) ? (v: string) => v : pg.types.getTypeParser(oid, format as 'text'))) as never },
    })
    client.on('error', () => { })
    await client.connect()
    const q = (sql: string, values: unknown[] = []) => client.query({ text: sql, values, queryMode: 'extended', query_timeout: CLIENT_TIMEOUT_MS } as never) as unknown as Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>
    let killed = false
    const kill = () => { killed = true; try { (client as unknown as { connection?: { stream?: { destroy(): void } } }).connection?.stream?.destroy() } catch { } }
    return {
      begin: async (ro) => {
        await q(ro ? 'BEGIN READ ONLY' : 'BEGIN')
        await q(`SET LOCAL statement_timeout = ${DB_STATEMENT_TIMEOUT_MS}`)
      },
      commit: async () => { await q('COMMIT') },
      rollback: async () => { await q('ROLLBACK'); return [] },
      exec: async (sql, values) => (await q(sql, values)).rowCount ?? -1,
      read: (sql, values, onRow) => new Promise<void>((res, rej) => {
        let done = false
        const finish = (e?: unknown) => { if (done) return; done = true; clearTimeout(timer); if (e) rej(e); else res() }
        const timer = setTimeout(() => { const e = Object.assign(new Error('Query read timeout'), { code: 'CLIENT_TIMEOUT' }); finish(e); kill() }, CLIENT_TIMEOUT_MS)
        const query = new pg.Query({ text: sql, values, queryMode: 'extended' } as never)
        query.on('row', (row: Record<string, unknown>) => {
          if (done) return
          if (!onRow(row)) { finish(); kill() }
        })
        query.on('error', (e: unknown) => finish(e))
        query.on('end', () => finish())
        client.query(query as never)
      }),
      close: async () => {
        if (killed) return
        await Promise.race([client.end().catch(() => undefined), new Promise((r) => setTimeout(r, 5_000))])
        kill()
      },
    }
  },
  classify(e) {
    const err = e as { code?: string; severity?: string }
    const code = typeof err?.code === 'string' && /^[0-9A-Z]{5}$/.test(err.code) && typeof err.severity === 'string' ? err.code : null
    return { server: !!code, auth: code === '28P01' || code === '28000' || code === '3D000', serverTimeout: code === '57014' }
  },
}

// ── SQL Server (flow.md §25) ──

export function mssqlCell(v: unknown, type: string, scale?: number): unknown {
  if (v === null || v === undefined) return null
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null
    const iso = v.toISOString()
    if (type === 'Date') return iso.slice(0, 10)
    if (type === 'Time') return iso.slice(11, 23)
    if (type === 'DateTimeOffset') return iso
    return iso.slice(0, 23).replace('T', ' ')
  }
  if (typeof v === 'number' && /^(Decimal|Numeric|Money|SmallMoney)/.test(type)) {
    const d = Math.min(38, Math.max(0, scale ?? 4))
    return v.toLocaleString('en-US', { useGrouping: false, minimumFractionDigits: d, maximumFractionDigits: d })
  }
  return v
}

export function mssqlDecimal(v: number): { precision: number; scale: number } | null {
  const t = Math.abs(v).toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 100 })
  if (!/^\d+(\.\d+)?$/.test(t) || Number(t) === 0) return null
  const [ip, fp = ''] = t.split('.')
  if (fp.length > 38 || ip.replace(/^0+/, '').length + fp.length > 38) return null
  return { precision: 38, scale: fp.length }
}

type TediousTypes = typeof import('tedious').TYPES
function mssqlParam(T: TediousTypes, v: unknown): { type: TediousTypes[keyof TediousTypes]; value: unknown; options?: Record<string, number> } {
  if (v === null || v === undefined) return { type: T.NVarChar, value: null }
  if (typeof v === 'string') return { type: T.NVarChar, value: v, options: { length: Math.max(1, v.length) } }
  if (typeof v === 'boolean') return { type: T.Bit, value: v }
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return v >= -2147483648 && v <= 2147483647 ? { type: T.Int, value: v } : { type: T.BigInt, value: v }
    const d = mssqlDecimal(v)
    return d ? { type: T.Decimal, value: v, options: d } : { type: T.Float, value: v }
  }
  throw new Error('unsupported parameter value')
}

const escapedError = (e?: unknown) => Object.assign(new Error(`the statement ended the transaction AI Talk opened${e ? ` (${e instanceof Error ? e.message : String(e)})` : ''}`), { escaped: true })

const mssqlDriver: DbDriver = {
  async connect(c) {
    const { Connection, Request, TYPES } = await import('tedious')
    const conn = new Connection({
      server: c.ip,
      authentication: { type: 'default', options: { userName: c.user, password: c.password } },
      options: {
        port: c.port, database: c.database,
        encrypt: c.tls !== 'off', trustServerCertificate: c.tls === 'no-verify',
        ...(c.tls === 'verify' && !isIP(c.host) ? { serverName: c.host } : {}),
        ...(c.tls === 'verify' && c.ca ? { cryptoCredentialsDetails: { ca: c.ca } } : {}),
        connectTimeout: DB_CONNECT_TIMEOUT_MS, requestTimeout: DB_STATEMENT_TIMEOUT_MS, cancelTimeout: 5_000,
        textsize: DB_READ_MAX_BYTES,
        rowCollectionOnRequestCompletion: false, rowCollectionOnDone: false, useColumnNames: false, useUTC: true,
        abortTransactionOnError: false,
      },
    })
    conn.on('error', () => { })
    await new Promise<void>((res, rej) => conn.connect((e) => (e ? rej(e) : res())))

    type Col = { value: unknown; metadata: { colName: string; type: { name: string }; scale?: number } }
    const run = (sql: string, opts: { values?: unknown[]; names?: readonly string[]; batch?: boolean; onRow?: (cols: Col[]) => void; onStatementDone?: () => void } = {}) =>
      new Promise<{ rowCount: number; statements: number; rows: Col[][] }>((res, rej) => {
        let statements = 0
        let last = 0
        const rows: Col[][] = []
        const r = new Request(sql, (e) => (e ? rej(e) : res({ rowCount: last, statements, rows })))
        const names = opts.names ?? []
        const values = opts.values ?? []
        if (names.length !== values.length) { rej(new Error('parameter names and values differ')); return }
        names.forEach((n, i) => { const p = mssqlParam(TYPES, values[i]); r.addParameter(n, p.type as never, p.value, p.options) })
        r.on('doneInProc', (rowCount?: number) => { statements++; last = rowCount ?? 0; opts.onStatementDone?.() })
        r.on('row', (cols: Col[]) => { if (opts.onRow) opts.onRow(cols); else rows.push(cols) })
        if (opts.batch) conn.execSqlBatch(r)
        else conn.execSql(r)
      })
    let txId: string | null = null
    let open = false
    const txState = async (): Promise<'same' | 'doomed' | 'escaped'> => {
      try {
        const r = await run('SELECT CAST(CURRENT_TRANSACTION_ID() AS NVARCHAR(30)) AS id, XACT_STATE() AS xs', { batch: true })
        const [id, xs] = [r.rows[0]?.[0]?.value, r.rows[0]?.[1]?.value]
        if (id == null || String(id) !== txId || xs === 0) return 'escaped'
        return xs === -1 ? 'doomed' : 'same'
      } catch {
        return 'escaped'
      }
    }
    return {
      begin: async () => {
        const r = await run(`SET XACT_ABORT OFF; SET IMPLICIT_TRANSACTIONS OFF; SET LOCK_TIMEOUT ${DB_STATEMENT_TIMEOUT_MS}; BEGIN TRANSACTION; SELECT CAST(CURRENT_TRANSACTION_ID() AS NVARCHAR(30)) AS id`, { batch: true })
        txId = String(r.rows[0]?.[0]?.value ?? '')
        open = true
      },
      commit: async () => {
        await run('COMMIT TRANSACTION', { batch: true })
        open = false
      },
      rollback: async () => {
        await run('IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION', { batch: true })
        open = false
        return []
      },
      exec: async (sql, values, names) => {
        let out: { rowCount: number }
        try {
          out = await run(sql, { values, names, onRow: () => undefined })
        } catch (e) {
          if ((await txState()) === 'escaped') throw escapedError(e)
          throw e
        }
        const st = await txState()
        if (st === 'escaped') throw escapedError()
        if (st === 'doomed') throw Object.assign(new Error('the transaction cannot be committed — nothing was written'), { doomed: true })
        return out.rowCount
      },
      read: async (sql, values, onRow, names) => {
        let stopped = false
        let done = 0
        let multi = false
        let out: { statements: number }
        try {
          out = await run(sql, {
            values, names,
            onStatementDone: () => { done++ },
            onRow: (cols) => {
              if (stopped) return
              if (done > 0) { multi = true; stopped = true; conn.cancel(); return }
              const row: Record<string, unknown> = {}
              for (const col of cols) row[col.metadata.colName] = mssqlCell(col.value, col.metadata.type.name, col.metadata.scale)
              if (!onRow(row)) { stopped = true; conn.cancel() }
            },
          })
        } catch (e) {
          if (!stopped) {
            if ((await txState()) === 'escaped') throw escapedError(e)
            throw e
          }
          out = { statements: 1 }
        }
        if ((await txState()) !== 'same') throw escapedError()
        if (multi || (!stopped && out.statements > 1)) throw Object.assign(new Error('only one statement may run in a read'), { multi: true })
      },
      close: async () => {
        if (open) await Promise.race([run('IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION', { batch: true }).catch(() => undefined), new Promise((r) => setTimeout(r, 5_000))])
        open = false
        try { conn.close() } catch { }
      },
    }
  },
  classify(e) {
    const err = e as { code?: string; number?: number; escaped?: boolean; doomed?: boolean; multi?: boolean }
    const server = (err?.code === 'EREQUEST' && typeof err.number === 'number' && err.number !== 266) || !!err?.doomed || !!err?.multi
    return { server, auth: err?.code === 'ELOGIN', serverTimeout: false, escaped: !!err?.escaped || (err?.code === 'EREQUEST' && err.number === 266) }
  },
}

const DRIVERS: Record<DbEngine, DbDriver> = { mysql: mysqlDriver, postgres: postgresDriver, mssql: mssqlDriver }

export interface CompanyDbDeps {
  drivers?: Partial<Record<DbEngine, DbDriver>>
  resolve?: (host: string) => Promise<string>
}

export const defaultResolve = resolveEditionAddress

const TLS_CODES = new Set(['SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID', 'CERT_UNTRUSTED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'HOSTNAME_MISMATCH', 'HANDSHAKE_SSL_ERROR'])
function connectCode(driver: DbDriver, e: unknown): DbErrorCode {
  const err = e as { code?: string; message?: string }
  if ((typeof err?.code === 'string' && TLS_CODES.has(err.code)) || /certificate|does not support SSL|SSL connection is required|self[- ]signed/i.test(String(err?.message ?? ''))) return 'DB_TLS'
  return driver.classify(e).auth ? 'DB_AUTH' : 'DB_CONNECT'
}

function oneLine(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).replace(/\s+/g, ' ').slice(0, 300)
}

async function open(c: DbConnConfig, deps: CompanyDbDeps): Promise<{ driver: DbDriver; s: DbSession }> {
  let ip: string
  try {
    ip = await (deps.resolve ?? defaultResolve)(c.host)
  } catch (e) {
    if (e instanceof SSRFError) throw new CompanyDbError('ADDRESS_BLOCKED', 'prepare', oneLine(e))
    if (e instanceof DnsLookupError) throw new CompanyDbError('DB_DNS', 'connect', oneLine(e))
    throw new CompanyDbError('PREPARE_FAILED', 'prepare', oneLine(e))
  }
  const driver = deps.drivers?.[c.engine] ?? DRIVERS[c.engine]
  try {
    return { driver, s: await driver.connect({ ...c, ip }) }
  } catch (e) {
    throw new CompanyDbError(connectCode(driver, e), 'connect', oneLine(e))
  }
}

function afterSend(driver: DbDriver, e: unknown, phase: DbPhase): CompanyDbError {
  const k = driver.classify(e)
  if (k.escaped) return new CompanyDbError('DB_ERROR', phase, oneLine(e), false)
  if (k.server) return new CompanyDbError(k.serverTimeout ? 'TIMEOUT' : 'DB_ERROR', phase, oneLine(e), true)
  const err = e as { code?: string; message?: string }
  const timeout = err?.code === 'PROTOCOL_SEQUENCE_TIMEOUT' || /timeout/i.test(String(err?.message ?? ''))
  return new CompanyDbError(timeout ? 'TIMEOUT' : 'NO_RESPONSE', phase, oneLine(e))
}

export function dbCell(v: unknown): unknown {
  if (v === null || v === undefined) return null
  if (Buffer.isBuffer(v)) return `[binary ${v.length} bytes]`
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString()
  if (typeof v === 'bigint') return v.toString()
  if (typeof v === 'string') return v.length > DB_CELL_MAX_CHARS ? `${v.slice(0, DB_CELL_MAX_CHARS)}…` : v
  if (typeof v === 'object') {
    const s = JSON.stringify(v)
    return s.length > DB_CELL_MAX_CHARS ? `${s.slice(0, DB_CELL_MAX_CHARS)}…` : v
  }
  return v
}
const cellSize = (v: unknown): number => (v === null || v === undefined ? 0 : Buffer.isBuffer(v) ? v.length : typeof v === 'string' ? Buffer.byteLength(v, 'utf8') : typeof v === 'object' ? Buffer.byteLength(JSON.stringify(v), 'utf8') : 8)

export async function readCompanyDb(c: DbConnConfig, q: { sql: string; values: unknown[]; names?: readonly string[]; maxRows?: number }, deps: CompanyDbDeps = {}): Promise<{ rows: Record<string, unknown>[]; truncated: boolean }> {
  const max = q.maxRows ?? DB_MAX_ROWS_DEFAULT
  const { driver, s } = await open(c, deps)
  const rows: Record<string, unknown>[] = []
  let truncated = false
  let bytes = 0
  try {
    try { await s.begin(true) } catch (e) { throw new CompanyDbError(connectCode(driver, e), 'connect', oneLine(e)) }
    try {
      await s.read(q.sql, q.values, (row) => {
        if (rows.length >= max) { truncated = true; return false }
        for (const v of Object.values(row)) bytes += cellSize(v)
        if (bytes > DB_READ_MAX_BYTES) { truncated = true; return false }
        const out: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(row)) out[k] = dbCell(v)
        rows.push(out)
        return true
      }, q.names)
    } catch (e) {
      throw afterSend(driver, e, 'statement')
    }
  } finally {
    await s.close().catch(() => undefined)
  }
  return { rows, truncated }
}

export async function writeCompanyDb(c: DbConnConfig, q: { sql: string; values: unknown[]; names?: readonly string[]; uncertain?: boolean }, deps: CompanyDbDeps = {}): Promise<{ affectedRows: number }> {
  const { driver, s } = await open(c, deps)
  try {
    try { await s.begin(false) } catch (e) { throw new CompanyDbError(connectCode(driver, e), 'connect', oneLine(e)) }
    let affectedRows: number
    try {
      affectedRows = await s.exec(q.sql, q.values, q.names)
    } catch (e) {
      const err = afterSend(driver, e, 'statement')
      if (q.uncertain) err.definite = false
      throw err
    }
    try { await s.commit() } catch (e) { throw afterSend(driver, e, 'commit') }
    return { affectedRows: Math.max(0, affectedRows) }
  } finally {
    await s.close().catch(() => undefined)
  }
}

export const ROLLBACK_PARTIAL_WARNING = 1196

async function rollbackConfirmed(s: DbSession): Promise<boolean> {
  if (!s.rollback) return false
  try {
    return !(await s.rollback()).includes(ROLLBACK_PARTIAL_WARNING)
  } catch {
    return false
  }
}

export async function execCompanyDbSql(c: DbConnConfig, sql: string, opts: { mysqlTx: boolean; mssqlUncertain?: boolean; expectRows?: number }, deps: CompanyDbDeps = {}): Promise<{ affectedRows: number; mismatch?: { actual: number | null } }> {
  const { driver, s } = await open(c, deps)
  const tx = c.engine !== 'mysql' || opts.mysqlTx
  if (opts.expectRows !== undefined && !tx) { await s.close().catch(() => undefined); throw new CompanyDbError('PREPARE_FAILED', 'prepare', 'row count check needs a transaction') }
  try {
    if (tx) {
      try { await s.begin(false) } catch (e) { throw new CompanyDbError(connectCode(driver, e), 'connect', oneLine(e)) }
    }
    let affectedRows: number
    try {
      affectedRows = await s.exec(sql, [])
    } catch (e) {
      const err = afterSend(driver, e, 'statement')
      if (!tx || opts.mssqlUncertain) err.definite = false
      if (err.definite && tx && !(await rollbackConfirmed(s))) err.definite = false
      throw err
    }
    if (tx && opts.expectRows !== undefined && affectedRows !== opts.expectRows) {
      if (!(await rollbackConfirmed(s))) throw new CompanyDbError('DB_ERROR', 'commit', `${affectedRows < 0 ? 'unknown' : affectedRows} rows instead of ${opts.expectRows} — the rollback could not be confirmed`, false)
      return { affectedRows: Math.max(0, affectedRows), mismatch: { actual: affectedRows < 0 ? null : affectedRows } }
    }
    if (tx) {
      try { await s.commit() } catch (e) { throw afterSend(driver, e, 'commit') }
    }
    return { affectedRows: Math.max(0, affectedRows) }
  } finally {
    await s.close().catch(() => undefined)
  }
}

export function writeOutcome(e: CompanyDbError): 'refused' | 'failed' | 'unknown' {
  if (e.phase === 'prepare') return 'refused'
  if (e.phase === 'connect') return 'failed'
  return e.definite ? 'failed' : 'unknown'
}

export function dbParamValues(names: readonly string[], given: unknown): unknown[] {
  if (given === undefined || given === null) given = {}
  if (typeof given !== 'object' || Array.isArray(given)) throw new WorkError('INVALID', 'params must be an object')
  const g = given as Record<string, unknown>
  const missing = names.filter((n) => !Object.prototype.hasOwnProperty.call(g, n))
  const extra = Object.keys(g).filter((k) => !names.includes(k))
  if (missing.length || extra.length) throw new WorkError('INVALID', `params must be exactly: ${names.join(', ') || '(none)'}${missing.length ? ` — missing ${missing.join(', ')}` : ''}${extra.length ? ` — unknown ${extra.join(', ')}` : ''}`)
  return names.map((n) => {
    const v = g[n]
    if (v === null) return null
    if (typeof v === 'string') {
      if (v.length > DB_PARAM_MAX_CHARS) throw new WorkError('INVALID', `param ${n} is longer than ${DB_PARAM_MAX_CHARS} characters`)
      return v
    }
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) throw new WorkError('INVALID', `param ${n} must be a finite number`)
      if (Number.isInteger(v) && !Number.isSafeInteger(v)) throw new WorkError('INVALID', `param ${n} is too large for a number — pass it as text`)
      return v
    }
    if (typeof v === 'boolean') return v
    throw new WorkError('INVALID', `param ${n} must be text, a number, true/false or null`)
  })
}

export type ResolvedDb = { ok: true; config: DbConnConfig; connectionId: string } | { ok: false; code: 'NO_CONNECTION' | 'ENGINE_MISMATCH' }

export const dbTargetLabel = (c: Pick<DbConnConfig, 'engine' | 'host' | 'database'>) => `${DB_ENGINE_LABEL[c.engine]} · ${c.host}/${c.database}`

export function parseDbServiceConfig(raw: string | null): Omit<DbConnConfig, 'engine' | 'password'> | null {
  try {
    const v = JSON.parse(raw ?? '')
    const port = Number(v?.port)
    if (typeof v?.host !== 'string' || !v.host.trim() || !Number.isInteger(port) || port < 1 || port > 65535) return null
    if (typeof v.database !== 'string' || typeof v.user !== 'string') return null
    const ca = parseDbCa(v.ca)
    return { host: v.host.trim(), port, database: v.database, user: v.user, tls: (DB_TLS_MODES as readonly string[]).includes(v.tls) ? v.tls : 'verify', ...(ca ? { ca } : {}) }
  } catch {
    return null
  }
}

export async function resolveDbConnection(db: PrismaClient, input: { userId: string; workflowId: string; slot: string; engine?: DbEngine }, opts: { secret?: boolean } = {}): Promise<ResolvedDb> {
  const w = await db.workflow.findFirst({ where: { workflowId: input.workflowId, agent: { userId: input.userId } }, select: { agentId: true, workflowJson: true } })
  if (!w) return { ok: false, code: 'NO_CONNECTION' }
  const id = appStartSettings(w.workflowJson).connections.database?.[input.slot]
  if (!id) return { ok: false, code: 'NO_CONNECTION' }
  const conn = await db.workflowConnection.findFirst({
    where: { id, ...agentScopedWhere({ agentId: w.agentId, userId: input.userId }, 'Work app database'), status: 'active' },
    select: { id: true, userId: true, provider: true, encryptedToken: true, serviceConfig: true, authType: true },
  })
  if (!conn) return { ok: false, code: 'NO_CONNECTION' }
  const engine = engineOfProvider(conn.provider)
  if (!engine) return { ok: false, code: 'NO_CONNECTION' }
  if (input.engine && engine !== input.engine) return { ok: false, code: 'ENGINE_MISMATCH' }
  const cfg = parseDbServiceConfig(conn.serviceConfig)
  if (!cfg) return { ok: false, code: 'NO_CONNECTION' }
  const password = conn.encryptedToken && opts.secret !== false ? await getConnectionSecret(db, conn.userId, conn.id, conn.encryptedToken, conn.authType) : ''
  return { ok: true, connectionId: conn.id, config: { ...cfg, engine, password } }
}

export const isDbEngine = (x: unknown): x is DbEngine => (DB_ENGINES as readonly string[]).includes(x as string)
