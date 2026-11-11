import type { DbEngine } from './uses'

export const AI_SQL_MAX_CHARS = 20_000

export type AiSqlCode = 'SQL_EMPTY' | 'SQL_TOO_LONG' | 'SQL_HIDDEN_CHARS' | 'SQL_EXEC_COMMENT' | 'SQL_MULTI' | 'SQL_NOT_READ'

export type AiSqlKind =
  | 'read' | 'insert' | 'update' | 'delete' | 'replace' | 'merge'
  | 'create_table' | 'create_other' | 'alter' | 'drop' | 'truncate' | 'rename' | 'call' | 'other'

export interface AiSqlCheck {
  ok: true
  norm: string
  kind: AiSqlKind
  readable: boolean
  oneStep: boolean
  mysqlTx: boolean
  mssqlUncertain: boolean
  countTarget: boolean
}

const HIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩​-‏﻿]/
const READ_FIRST = new Set(['SELECT', 'WITH', 'SHOW', 'EXPLAIN', 'DESCRIBE', 'DESC', 'TABLE'])
const READ_DENY_PHRASES = [/\bINTO OUTFILE\b/, /\bINTO DUMPFILE\b/, /\bINTO @/, /\bFOR UPDATE\b/, /\bFOR NO KEY UPDATE\b/, /\bFOR SHARE\b/, /\bFOR KEY SHARE\b/, /\bLOCK IN SHARE MODE\b/, /\bCOPY\b/]
const READ_DENY_PREFIX = ['PG_ADVISORY', 'PG_READ_', 'PG_LS_', 'PG_STAT_FILE', 'PG_FILE', 'LO_', 'DBLINK', 'GET_LOCK', 'RELEASE_LOCK', 'LOAD_FILE', 'SLEEP', 'PG_SLEEP', 'BENCHMARK']

export function rawSqlProblem(sql: unknown): AiSqlCode | null {
  if (typeof sql !== 'string') return 'SQL_EMPTY'
  if (sql.length > AI_SQL_MAX_CHARS) return 'SQL_TOO_LONG'
  if (HIDDEN.test(sql)) return 'SQL_HIDDEN_CHARS'
  if (/\/\*\s*M?!/i.test(sql)) return 'SQL_EXEC_COMMENT'
  if (/\bu&\s*["']/i.test(sql)) return 'SQL_HIDDEN_CHARS'
  return null
}

export function normalizeSql(sql: string, engine: DbEngine): string {
  let out = ''
  let i = 0
  const n = sql.length
  while (i < n) {
    const c = sql[i]
    const two = sql.slice(i, i + 2)
    if (two === '--' && (engine !== 'mysql' || i + 2 >= n || /[\s\x00-\x1f]/.test(sql[i + 2]))) { const e = sql.indexOf('\n', i); i = e < 0 ? n : e + 1; out += ' '; continue }
    if (engine === 'mysql' && c === '#') { const e = sql.indexOf('\n', i); i = e < 0 ? n : e + 1; out += ' '; continue }
    if (two === '/*') {
      if (engine === 'mysql') { const e = sql.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; out += ' '; continue }
      let depth = 1; i += 2
      while (i < n && depth > 0) {
        if (sql.slice(i, i + 2) === '/*') { depth++; i += 2 } else if (sql.slice(i, i + 2) === '*/') { depth--; i += 2 } else i++
      }
      out += ' '; continue
    }
    if (c === "'") {
      i++
      while (i < n) {
        if (engine === 'mysql' && sql[i] === '\\') { i += 2; continue }
        if (sql[i] === "'") { if (sql[i + 1] === "'") { i += 2; continue } i++; break }
        i++
      }
      out += " '' "; continue
    }
    if (engine === 'postgres' && c === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i))
      if (m) {
        const tag = m[0]; const e = sql.indexOf(tag, i + tag.length)
        i = e < 0 ? n : e + tag.length
        out += " '' "; continue
      }
    }
    if (engine === 'mssql' && c === '[') {
      i++
      let name = ''
      while (i < n) {
        if (sql[i] === ']') { if (sql[i + 1] === ']') { name += ']'; i += 2; continue } i++; break }
        name += sql[i]; i++
      }
      out += ` ${name} `; continue
    }
    if (c === '"' || (engine === 'mysql' && c === '`')) {
      const q = c; i++
      let name = ''
      while (i < n) {
        if (sql[i] === q) { if (sql[i + 1] === q) { name += q; i += 2; continue } i++; break }
        name += sql[i]; i++
      }
      out += engine === 'mssql' ? ` ${name} ` : name; continue
    }
    out += c; i++
  }
  return out.toUpperCase().replace(/\s+/g, ' ').replace(/ \(/g, '(').replace(/[\s;]+$/, '').trim()
}

const words = (norm: string) => norm.match(/[A-Z_@][A-Z0-9_$@]*/g) ?? []

function kindOf(norm: string, engine: DbEngine): AiSqlKind {
  const w = words(norm)
  const first = w[0] ?? ''
  if (engine === 'mssql') {
    if (first === 'SELECT' || first === 'WITH') return w.includes('INTO') ? 'create_table' : 'read'
  } else if (READ_FIRST.has(first)) return 'read'
  switch (first) {
    case 'INSERT': return 'insert'
    case 'UPDATE': return 'update'
    case 'DELETE': return 'delete'
    case 'REPLACE': return 'replace'
    case 'MERGE': case 'UPSERT': return 'merge'
    case 'CREATE': return w[1] === 'TABLE' ? 'create_table' : 'create_other'
    case 'ALTER': return 'alter'
    case 'DROP': return 'drop'
    case 'TRUNCATE': return 'truncate'
    case 'RENAME': return 'rename'
    case 'CALL': case 'EXEC': case 'EXECUTE': case 'DO': return 'call'
    default: return 'other'
  }
}

const MSSQL_STATEMENT_WORDS = new Set([
  'ADD', 'ALTER', 'BACKUP', 'BEGIN', 'BREAK', 'BULK', 'CHECKPOINT', 'CLOSE', 'COMMIT', 'CONTINUE', 'CREATE', 'DBCC', 'DEALLOCATE', 'DECLARE',
  'DELETE', 'DENY', 'DISABLE', 'DROP', 'DUMP', 'ENABLE', 'EXEC', 'EXECUTE', 'FETCH', 'GET', 'GO', 'GOTO', 'GRANT', 'IF', 'INSERT', 'KILL',
  'LOAD', 'MERGE', 'MOVE', 'OPEN', 'PRINT', 'RAISERROR', 'READTEXT', 'RECEIVE', 'RECONFIGURE', 'RESTORE', 'RETURN', 'REVERT', 'REVOKE',
  'ROLLBACK', 'SAVE', 'SEND', 'SET', 'SETUSER', 'SHUTDOWN', 'THROW', 'TRUNCATE', 'UPDATE', 'UPDATETEXT', 'USE', 'WAITFOR', 'WHILE', 'WRITETEXT',
])
const MSSQL_READ_DENY_WORDS = new Set(['INTO', 'OPENROWSET', 'OPENQUERY', 'OPENDATASOURCE', 'NEXT', 'UPDLOCK', 'XLOCK', 'TABLOCKX', 'HOLDLOCK'])
const MSSQL_TX_WORDS = new Set(['BEGIN', 'COMMIT', 'ROLLBACK', 'SAVE'])
const mssqlProc = (x: string) => x.startsWith('XP_') || x.startsWith('SP_')
const MSSQL_LABEL = /(?:^|[^:])\b[A-Z_][A-Z0-9_]*:(?!:)/

function mssqlReadable(norm: string): boolean {
  const w = words(norm)
  if (w.some((x) => MSSQL_STATEMENT_WORDS.has(x) || MSSQL_READ_DENY_WORDS.has(x) || mssqlProc(x))) return false
  return !/\bEND CONVERSATION\b/.test(norm) && !MSSQL_LABEL.test(norm)
}

function mssqlOneStepInsert(norm: string): boolean {
  const m = /^INSERT (?:INTO )?[A-Z_#@][A-Z0-9_.#@$]*(\([^()]*\))? ?VALUES(\(.*)$/.exec(norm)
  if (!m) return false
  let depth = 0
  for (const c of m[2]) {
    if (c === '(') depth++
    else if (c === ')') { depth--; if (depth < 0) return false }
    else if (depth === 0 && c !== ',' && c !== ' ') return false
  }
  if (depth !== 0) return false
  const rest = words(norm).slice(norm.startsWith('INSERT INTO ') ? 2 : 1)
  return !rest.some((x) => MSSQL_STATEMENT_WORDS.has(x) || MSSQL_READ_DENY_WORDS.has(x) || x === 'SELECT' || x === 'OUTPUT' || mssqlProc(x))
}

function topLevelComma(norm: string): boolean {
  let depth = 0
  for (const c of norm) {
    if (c === '(') depth++
    else if (c === ')') depth = Math.max(0, depth - 1)
    else if (c === ',' && depth === 0) return true
  }
  return false
}

function oneStepOf(norm: string, kind: AiSqlKind, engine: DbEngine): boolean {
  if (engine === 'mssql') return kind === 'insert' && mssqlOneStepInsert(norm)
  const w = words(norm)
  if (engine === 'mysql' && kind !== 'insert') return false
  if (kind === 'insert') return !/\bON CONFLICT\b/.test(norm) && !/\bON DUPLICATE KEY\b/.test(norm) && !w.includes('REPLACE')
  if (kind === 'create_table') return /^CREATE TABLE\b/.test(norm)
  if (kind === 'alter') {
    if (!/^ALTER TABLE\b/.test(norm) || topLevelComma(norm)) return false
    const afterTable = w.slice(2)
    const addAt = afterTable.indexOf('ADD')
    if (addAt < 0 || addAt > 3) return false
    return !['DROP', 'RENAME', 'MODIFY', 'CHANGE', 'ALTER', 'OWNER', 'SET', 'DISABLE', 'ENABLE', 'DETACH', 'ATTACH'].some((x) => afterTable.slice(addAt).includes(x) || afterTable.slice(0, addAt).includes(x))
  }
  return false
}

export function checkAiSql(sql: unknown, engine: DbEngine): AiSqlCheck | { ok: false; code: AiSqlCode } {
  const raw = rawSqlProblem(sql)
  if (raw) return { ok: false, code: raw }
  const norm = normalizeSql(sql as string, engine)
  if (!norm || !/[A-Z]/.test(norm)) return { ok: false, code: 'SQL_EMPTY' }
  if (norm.includes(';')) return { ok: false, code: 'SQL_MULTI' }
  const kind = kindOf(norm, engine)
  const w = words(norm)
  const denied = engine === 'mssql' ? !mssqlReadable(norm) || !['SELECT', 'WITH'].includes(mssqlFirstToken(sql as string)) : READ_DENY_PHRASES.some((r) => r.test(norm)) || w.some((x) => READ_DENY_PREFIX.some((p) => x.startsWith(p)))
  return {
    ok: true,
    norm,
    kind,
    readable: kind === 'read' && !denied,
    oneStep: oneStepOf(norm, kind, engine),
    mysqlTx: kind === 'insert' || kind === 'update' || kind === 'delete',
    mssqlUncertain: engine === 'mssql' && mssqlUncertainOf(norm, sql as string),
    countTarget: countTargetOf(norm, kind, engine),
  }
}

function countTargetOf(norm: string, kind: AiSqlKind, engine: DbEngine): boolean {
  if (engine === 'mssql') return false
  if (kind !== 'insert' && kind !== 'update' && kind !== 'delete') return false
  const w: string[] = [...words(norm)]
  if (/\bON CONFLICT\b/.test(norm) || /\bON DUPLICATE KEY\b/.test(norm) || w.includes('IGNORE') || w.includes('REPLACE')) return false
  return true
}

const COUNT_DENY_WORDS = new Set(['NEXTVAL', 'SETVAL', 'LASTVAL', 'CURRVAL', 'LAST_INSERT_ID'])
export function countSqlProblem(sql: unknown, engine: DbEngine): string | null {
  const r = checkAiSql(sql, engine)
  if (!r.ok) return r.code
  if (!r.readable) return 'COUNT_NOT_READ'
  const w = words(r.norm)
  if (w.some((x) => COUNT_DENY_WORDS.has(x)) || /\bNEXT VALUE FOR\b/.test(r.norm)) return 'COUNT_NUMBER_FUNCTION'
  return null
}

export const COUNT_MAX = 2_147_483_647
export function countFromRows(rows: ReadonlyArray<Record<string, unknown>>, truncated: boolean): number | null {
  if (truncated || rows.length !== 1) return null
  const vals = Object.values(rows[0])
  if (vals.length !== 1) return null
  const v = vals[0]
  const n = typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : typeof v === 'string' && /^\d{1,15}$/.test(v) ? Number(v) : NaN
  return Number.isSafeInteger(n) && n >= 0 && n <= COUNT_MAX ? n : null
}

const MSSQL_KNOWN_FIRST = new Set(['SELECT', 'WITH', 'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'CREATE', 'ALTER', 'DROP', 'TRUNCATE'])
function mssqlFirstToken(sql: string): string {
  let i = 0
  const n = sql.length
  while (i < n) {
    if (/\s/.test(sql[i])) { i++; continue }
    if (sql.startsWith('--', i)) { const e = sql.indexOf('\n', i); i = e < 0 ? n : e + 1; continue }
    if (sql.startsWith('/*', i)) {
      let depth = 1; i += 2
      while (i < n && depth > 0) { if (sql.startsWith('/*', i)) { depth++; i += 2 } else if (sql.startsWith('*/', i)) { depth--; i += 2 } else i++ }
      continue
    }
    break
  }
  return (/^[\p{L}\p{N}_@#$[\]"]+/u.exec(sql.slice(i))?.[0] ?? '').toUpperCase()
}
function mssqlUncertainOf(norm: string, sql: string): boolean {
  return !MSSQL_KNOWN_FIRST.has(mssqlFirstToken(sql)) || words(norm).some((x) => MSSQL_TX_WORDS.has(x) || x === 'EXEC' || x === 'EXECUTE' || mssqlProc(x))
}

export function mssqlQueryFacts(sql: string): { readable: boolean; txControl: boolean; uncertain: boolean } {
  const r = checkAiSql(sql, 'mssql')
  const norm = normalizeSql(sql, 'mssql')
  return { readable: r.ok && r.readable, txControl: words(norm).some((x) => MSSQL_TX_WORDS.has(x)), uncertain: mssqlUncertainOf(norm, sql) }
}
