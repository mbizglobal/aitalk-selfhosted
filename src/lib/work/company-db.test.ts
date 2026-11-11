import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CompanyDbError, dbCell, dbParamValues, execCompanyDbSql, mssqlCell, mssqlDecimal, parseDbCa, parseDbServiceConfig, readCompanyDb, writeCompanyDb, writeOutcome, type DbConnConfig, type DbDriver, type DbSession } from './company-db'
import { WorkError } from './errors'

const CFG: DbConnConfig = { engine: 'postgres', host: 'db.example.com', port: 5432, database: 'd', user: 'u', password: 'p', tls: 'verify' }
const serverErr = Object.assign(new Error('duplicate key'), { server: true })
const netErr = Object.assign(new Error('Connection terminated unexpectedly'), { code: 'ECONNRESET' })

function fake(over: Partial<Record<'connect' | 'begin' | 'exec' | 'commit' | 'close' | 'read' | 'rollback', unknown>> & { rows?: number; warnings?: number[] } = {}, rows: Record<string, unknown>[] = []) {
  const seen: { ip?: string; servername?: string; closed: boolean; committed?: boolean; rolledBack?: boolean } = { closed: false }
  const driver: DbDriver = {
    async connect(c) {
      seen.ip = c.ip
      seen.servername = c.host
      if (over.connect) throw over.connect
      const s: DbSession = {
        async begin() { if (over.begin) throw over.begin },
        async exec() { if (over.exec) throw over.exec; return over.rows ?? 3 },
        async commit() { if (over.commit) throw over.commit; seen.committed = true },
        async rollback() { if (over.rollback) throw over.rollback; seen.rolledBack = true; return over.warnings ?? [] },
        async close() { seen.closed = true; if (over.close) throw over.close },
        async read(_sql, _v, onRow) { if (over.read) throw over.read; for (const r of rows) if (!onRow(r)) return },
      }
      return s
    },
    classify(e) {
      const server = !!(e as { server?: boolean })?.server
      return { server, auth: !!(e as { auth?: boolean })?.auth, serverTimeout: !!(e as { timeout?: boolean })?.timeout, escaped: !!(e as { escaped?: boolean })?.escaped }
    },
  }
  return { deps: { drivers: { postgres: driver }, resolve: async () => '203.0.113.7' }, seen }
}
const outcome = async (p: Promise<unknown>) => p.then(() => 'sent', (e) => (e instanceof CompanyDbError ? `${writeOutcome(e)}:${e.code}@${e.phase}` : `throw:${(e as Error).message}`))

test('write status - sent / failed / unknown / refused at each step', async () => {
  assert.equal(await outcome(writeCompanyDb(CFG, { sql: 'x', values: [] }, fake().deps)), 'sent')
  assert.equal(await outcome(writeCompanyDb(CFG, { sql: 'x', values: [] }, { ...fake().deps, resolve: async () => { const { SSRFError } = await import('@/lib/ssrfGuard'); throw new SSRFError('h', '10.0.0.1', 'private') } })), 'refused:ADDRESS_BLOCKED@prepare')
  assert.equal(await outcome(writeCompanyDb(CFG, { sql: 'x', values: [] }, fake({ connect: Object.assign(new Error('auth'), { auth: true }) }).deps)), 'failed:DB_AUTH@connect')
  assert.equal(await outcome(writeCompanyDb(CFG, { sql: 'x', values: [] }, fake({ connect: netErr }).deps)), 'failed:DB_CONNECT@connect')
  assert.equal(await outcome(writeCompanyDb(CFG, { sql: 'x', values: [] }, fake({ begin: netErr }).deps)), 'failed:DB_CONNECT@connect')
  assert.equal(await outcome(writeCompanyDb(CFG, { sql: 'x', values: [] }, fake({ exec: serverErr }).deps)), 'failed:DB_ERROR@statement')
  assert.equal(await outcome(writeCompanyDb(CFG, { sql: 'x', values: [] }, fake({ exec: Object.assign(new Error('canceled'), { server: true, timeout: true }) }).deps)), 'failed:TIMEOUT@statement')
  assert.equal(await outcome(writeCompanyDb(CFG, { sql: 'x', values: [] }, fake({ exec: netErr }).deps)), 'unknown:NO_RESPONSE@statement')
  assert.equal(await outcome(writeCompanyDb(CFG, { sql: 'x', values: [] }, fake({ exec: new Error('Query read timeout') }).deps)), 'unknown:TIMEOUT@statement')
  assert.equal(await outcome(writeCompanyDb(CFG, { sql: 'x', values: [] }, fake({ commit: netErr }).deps)), 'unknown:NO_RESPONSE@commit')
  assert.equal(await outcome(writeCompanyDb(CFG, { sql: 'x', values: [] }, fake({ commit: serverErr }).deps)), 'failed:DB_ERROR@commit')
  const f = fake({ close: netErr })
  assert.deepEqual(await writeCompanyDb(CFG, { sql: 'x', values: [] }, f.deps), { affectedRows: 3 })
  assert.equal(f.seen.closed, true)
})

test('connects to the checked IP, TLS name = original host, closes even on failure', async () => {
  const f = fake({ exec: serverErr })
  await writeCompanyDb(CFG, { sql: 'x', values: [] }, f.deps).catch(() => undefined)
  assert.equal(f.seen.ip, '203.0.113.7')
  assert.equal(f.seen.servername, 'db.example.com')
  assert.equal(f.seen.closed, true)
})

test('read - row limit, size limit, truncated', async () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({ id: i }))
  assert.deepEqual(await readCompanyDb(CFG, { sql: 'x', values: [], maxRows: 5 }, fake({}, rows).deps), { rows, truncated: false })
  const r4 = await readCompanyDb(CFG, { sql: 'x', values: [], maxRows: 4 }, fake({}, rows).deps)
  assert.equal(r4.rows.length, 4)
  assert.equal(r4.truncated, true)
  const big = Array.from({ length: 3 }, () => ({ body: 'x'.repeat(900_000) }))
  const rb = await readCompanyDb(CFG, { sql: 'x', values: [] }, fake({}, big).deps)
  assert.equal(rb.rows.length, 2)
  assert.equal(rb.truncated, true)
  assert.equal(await outcome(readCompanyDb(CFG, { sql: 'x', values: [] }, fake({ read: serverErr }).deps)), 'failed:DB_ERROR@statement')
  const ko = Array.from({ length: 3 }, () => ({ body: '한'.repeat(400_000) }))
  const rk = await readCompanyDb(CFG, { sql: 'x', values: [] }, fake({}, ko).deps)
  assert.equal(rk.rows.length, 1)
  assert.equal(rk.truncated, true)
})

test('column value conversion', () => {
  assert.equal(dbCell(null), null)
  assert.equal(dbCell(undefined), null)
  assert.equal(dbCell(Buffer.from([1, 2, 3])), '[binary 3 bytes]')
  assert.equal(dbCell(new Date('2026-10-10T00:00:00Z')), '2026-10-10T00:00:00.000Z')
  assert.equal(dbCell(new Date('nope')), null)
  assert.equal(dbCell(9007199254740993n), '9007199254740993')
  assert.equal(dbCell('x'.repeat(4001)), `${'x'.repeat(4000)}…`)
  assert.deepEqual(dbCell({ a: 1 }), { a: 1 })
  assert.equal(dbCell(0), 0)
  assert.equal(dbCell(false), false)
})

test('parameters - exact names, value types, length', () => {
  assert.deepEqual(dbParamValues(['a', 'b'], { b: 2, a: 'x' }), ['x', 2])
  assert.deepEqual(dbParamValues([], undefined), [])
  assert.deepEqual(dbParamValues(['a'], { a: null }), [null])
  assert.deepEqual(dbParamValues(['a'], { a: 0 }), [0])
  assert.deepEqual(dbParamValues(['a'], { a: false }), [false])
  assert.deepEqual(dbParamValues(['a'], { a: 'x'.repeat(2000) }), ['x'.repeat(2000)])
  const bad = (names: string[], v: unknown) => assert.throws(() => dbParamValues(names, v), (e: unknown) => e instanceof WorkError && e.code === 'INVALID')
  bad(['a'], {})
  bad(['a'], { a: 1, b: 2 })
  bad(['a'], [1])
  bad(['a'], 'x')
  for (const v of [Number.NaN, Infinity, -Infinity, undefined, ['x'], { x: 1 }, 'x'.repeat(2001), 1n, 2 ** 53, -(2 ** 53)]) bad(['a'], { a: v })
  assert.deepEqual(dbParamValues(['a'], { a: Number.MAX_SAFE_INTEGER }), [Number.MAX_SAFE_INTEGER])
  assert.deepEqual(dbParamValues(['a'], { a: -1.5 }), [-1.5])
  assert.deepEqual(dbParamValues(['a'], { a: '9007199254740993' }), ['9007199254740993'])
})

test('connect failures - certificate = DB_TLS, name not found = DB_DNS (both failed for writes)', async () => {
  const cert = Object.assign(new Error('self-signed certificate in certificate chain'), { code: 'SELF_SIGNED_CERT_IN_CHAIN' })
  assert.equal(await outcome(writeCompanyDb(CFG, { sql: 'x', values: [] }, fake({ connect: cert }).deps)), 'failed:DB_TLS@connect')
  assert.equal(await outcome(writeCompanyDb(CFG, { sql: 'x', values: [] }, fake({ begin: new Error('The server does not support SSL connections') }).deps)), 'failed:DB_TLS@connect')
  assert.equal(await outcome(writeCompanyDb(CFG, { sql: 'x', values: [] }, fake({ connect: Object.assign(new Error('Hostname/IP does not match certificate'), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' }) }).deps)), 'failed:DB_TLS@connect')
  const dns = { ...fake().deps, resolve: async () => { const { DnsLookupError } = await import('@/lib/ssrfGuard'); throw new DnsLookupError('db.example.com', 'ENOTFOUND') } }
  assert.equal(await outcome(readCompanyDb(CFG, { sql: 'x', values: [] }, dns)), 'failed:DB_DNS@connect')
  assert.equal(await outcome(readCompanyDb(CFG, { sql: 'x', values: [] }, fake({ connect: netErr }).deps)), 'failed:DB_CONNECT@connect')
})

test('CA certificate field - PEM only, empty or too long is none, read from the stored config', () => {
  const pem = '-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIU\n-----END CERTIFICATE-----'
  assert.equal(parseDbCa(pem), pem)
  assert.equal(parseDbCa(`  ${pem}\n`), pem)
  assert.equal(parseDbCa(''), null)
  assert.equal(parseDbCa('hello'), null)
  assert.equal(parseDbCa(`-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----`), null)
  assert.equal(parseDbCa(`-----BEGIN CERTIFICATE-----\n${'A'.repeat(20_000)}\n-----END CERTIFICATE-----`), null)
  assert.equal(parseDbCa(42), null)
  assert.equal(parseDbCa(`${pem}\n-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----\n${pem}`), null)
  assert.equal(parseDbCa(`${pem}\nhello\n${pem}`), null)
  assert.equal(parseDbCa(`${pem}\n${pem}`), `${pem}\n${pem}`)
  assert.equal(parseDbServiceConfig(JSON.stringify({ host: 'h', port: 5432, database: 'd', user: 'u', tls: 'verify', ca: pem }))?.ca, pem)
  assert.equal(parseDbServiceConfig(JSON.stringify({ host: 'h', port: 5432, database: 'd', user: 'u', tls: 'verify', ca: 'junk' }))?.ca, undefined)
})

test('AI SQL run - PG in a transaction, MySQL only plain DML in a transaction, other rejections are unknown', async () => {
  const MY: DbConnConfig = { ...CFG, engine: 'mysql' }
  const run = (c: DbConnConfig, mysqlTx: boolean, over: Parameters<typeof fake>[0] = {}) => {
    const f = fake(over)
    const deps = { ...f.deps, drivers: { postgres: f.deps.drivers.postgres, mysql: f.deps.drivers.postgres } }
    return outcome(execCompanyDbSql(c, 'X', { mysqlTx }, deps))
  }
  assert.equal(await run(CFG, false), 'sent')
  assert.equal(await run(CFG, false, { exec: serverErr }), 'failed:DB_ERROR@statement')
  assert.equal(await run(MY, true, { exec: serverErr }), 'failed:DB_ERROR@statement')
  assert.equal(await run(MY, false, { exec: serverErr }), 'unknown:DB_ERROR@statement')
  assert.equal(await run(MY, false, { exec: netErr }), 'unknown:NO_RESPONSE@statement')
  assert.equal(await run(MY, false, { begin: netErr }), 'sent')
  assert.equal(await run(CFG, false, { begin: netErr }), 'failed:DB_CONNECT@connect')
  assert.equal(await run(CFG, false, { commit: netErr }), 'unknown:NO_RESPONSE@commit')
})

test('SQL Server - out of bounds = unknown - write with a procedure rejected = unknown - AI SQL always in a transaction', async () => {
  const MS: DbConnConfig = { ...CFG, engine: 'mssql', port: 1433 }
  const deps = (over: Parameters<typeof fake>[0] = {}) => { const f = fake(over); return { ...f.deps, drivers: { mssql: f.deps.drivers.postgres } } }
  const escaped = Object.assign(new Error('the statement ended the transaction'), { escaped: true })
  assert.equal(await outcome(writeCompanyDb(MS, { sql: 'x', values: [] }, deps({ exec: serverErr }))), 'failed:DB_ERROR@statement')
  assert.equal(await outcome(writeCompanyDb(MS, { sql: 'x', values: [] }, deps({ exec: escaped }))), 'unknown:DB_ERROR@statement')
  assert.equal(await outcome(writeCompanyDb(MS, { sql: 'x', values: [], uncertain: true }, deps({ exec: serverErr }))), 'unknown:DB_ERROR@statement')
  assert.equal(await outcome(execCompanyDbSql(MS, 'X', { mysqlTx: false }, deps({ exec: serverErr }))), 'failed:DB_ERROR@statement')
  assert.equal(await outcome(execCompanyDbSql(MS, 'X', { mysqlTx: false, mssqlUncertain: true }, deps({ exec: serverErr }))), 'unknown:DB_ERROR@statement')
  assert.equal(await outcome(execCompanyDbSql(MS, 'X', { mysqlTx: false }, deps({ begin: netErr }))), 'failed:DB_CONNECT@connect')
  await assert.rejects(readCompanyDb(MS, { sql: 'x', values: [] }, deps({ read: escaped })), (e: unknown) => e instanceof CompanyDbError && e.code === 'DB_ERROR')
})

test('count target — when the changed row count differs from N it rolls back instead of COMMIT · unknown when the rollback cannot be confirmed (company-db.md D3)', async () => {
  const MY: DbConnConfig = { ...CFG, engine: 'mysql' }
  const go = async (c: DbConnConfig, over: Parameters<typeof fake>[0], expectRows: number | undefined, mysqlTx = true) => {
    const f = fake(over)
    const deps = { ...f.deps, drivers: { postgres: f.deps.drivers.postgres, mysql: f.deps.drivers.postgres } }
    try { const r = await execCompanyDbSql(c, 'X', { mysqlTx, ...(expectRows === undefined ? {} : { expectRows }) }, deps); return { r, seen: f.seen } } catch (e) { return { e: e as CompanyDbError, seen: f.seen } }
  }
  let x = await go(CFG, { rows: 3 }, 3)
  assert.equal(x.r?.mismatch, undefined); assert.equal(x.seen.committed, true)
  x = await go(CFG, { rows: 4 }, 3)
  assert.deepEqual(x.r?.mismatch, { actual: 4 }); assert.equal(x.seen.committed, undefined); assert.equal(x.seen.rolledBack, true)
  x = await go(CFG, { rows: -1 }, 0)
  assert.deepEqual(x.r?.mismatch, { actual: null }); assert.equal(x.seen.committed, undefined)
  x = await go(MY, { rows: 5, warnings: [1196] }, 3)
  assert.equal(x.e?.code, 'DB_ERROR'); assert.equal(x.e && writeOutcome(x.e), 'unknown')
  x = await go(CFG, { rows: 5, rollback: netErr }, 3)
  assert.equal(x.e && writeOutcome(x.e), 'unknown')
  x = await go(MY, {}, 3, false)
  assert.equal(x.e?.code, 'PREPARE_FAILED'); assert.equal(x.e && writeOutcome(x.e), 'refused')
  x = await go(MY, { exec: serverErr }, undefined)
  assert.equal(x.e && writeOutcome(x.e), 'failed')
  x = await go(MY, { exec: serverErr, warnings: [1196] }, undefined)
  assert.equal(x.e && writeOutcome(x.e), 'unknown')
  x = await go(CFG, { rows: -1 }, undefined)
  assert.equal(x.r?.affectedRows, 0); assert.equal(x.seen.committed, true)
})

test('SQL Server value shapes - date, time, decimal text (no exponent, null)', () => {
  const d = (iso: string) => new Date(iso)
  assert.equal(mssqlCell(d('2026-01-02T00:00:00.000Z'), 'Date'), '2026-01-02')
  assert.equal(mssqlCell(d('2026-01-02T03:04:05.123Z'), 'DateTime2', 7), '2026-01-02 03:04:05.123')
  assert.equal(mssqlCell(d('2026-01-02T03:04:05.000Z'), 'DateTimeN'), '2026-01-02 03:04:05.000')
  assert.equal(mssqlCell(d('2026-01-02T01:04:05.000Z'), 'DateTimeOffset', 7), '2026-01-02T01:04:05.000Z')
  assert.equal(mssqlCell(d('1970-01-01T03:04:05.123Z'), 'Time', 7), '03:04:05.123')
  assert.equal(mssqlCell(new Date('x'), 'Date'), null)
  assert.equal(mssqlCell(1.5, 'DecimalN', 2), '1.50')
  assert.equal(mssqlCell(1e25, 'DecimalN', 0), '10000000000000000000000000')
  assert.equal(mssqlCell(1e-30, 'NumericN', 30), '0.000000000000000000000000000001')
  assert.equal(mssqlCell(3, 'MoneyN'), '3.0000')
  assert.equal(mssqlCell(null, 'DecimalN', 2), null)
  assert.equal(mssqlCell(7, 'IntN'), 7)
  assert.equal(mssqlCell('9007199254740993', 'BigInt'), '9007199254740993')
})

test('SQL Server decimal insert - DECIMAL digits - over 38 becomes FLOAT - never becomes 0', () => {
  assert.deepEqual(mssqlDecimal(0.1), { precision: 38, scale: 1 })
  assert.deepEqual(mssqlDecimal(-123.456), { precision: 38, scale: 3 })
  assert.deepEqual(mssqlDecimal(1e-7), { precision: 38, scale: 7 })
  assert.deepEqual(mssqlDecimal(1e-38), { precision: 38, scale: 38 })
  assert.equal(mssqlDecimal(1e-39), null)
  assert.equal(mssqlDecimal(-1e-39), null)
  assert.equal(mssqlDecimal(1e-101), null)
})
