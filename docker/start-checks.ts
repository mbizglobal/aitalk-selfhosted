import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import { formatPreflight, selfHostedPreflight } from '@/lib/selfhosted-preflight'

const ROOT = path.resolve(__dirname, '..')
const MIGRATIONS = path.join(ROOT, 'prisma', 'migrations')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const log = (m: string) => console.log(`[start] ${m}`)

function stop(lines: string[]): never {
  console.error(['', '[start] ❌ NOT STARTING', ...lines.map((l) => `[start]    ${l}`), ''].join('\n'))
  process.exit(1)
}

async function migrationFiles(): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const e of await fs.readdir(MIGRATIONS, { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    const sql = await fs.readFile(path.join(MIGRATIONS, e.name, 'migration.sql')).catch(() => null)
    if (sql) out.set(e.name, createHash('sha256').update(sql).digest('hex'))
  }
  return out
}

const transient = (out: string) => /\bP1001\b|\bP1002\b|\bP1017\b|advisory lock|Can't reach database server|ECONNREFUSED/i.test(out)

async function main() {
  // (0)
  const problems = await selfHostedPreflight(process.env, { requireEdition: true, requireFileVolume: true })
  if (problems.length) stop(formatPreflight(problems).split('\n'))
  log('settings ok')

  // (1)
  const db = new PrismaClient({ log: [] })
  let connected = false
  for (let i = 0; i < 10 && !connected; i++) {
    try { await db.$queryRaw`select 1`; connected = true } catch { log(`waiting for the database (${i + 1}/10)…`); await sleep(Math.min(2000 * (i + 1), 10_000)) }
  }
  if (!connected) stop(['Cannot reach the database — check DATABASE_URL and that the database container is running'])

  try {
    // (2)
    const historyTable = (await db.$queryRaw<{ ok: boolean }[]>`select to_regclass('public._prisma_migrations') is not null as ok`)[0].ok
    const hasHistory = historyTable && (await db.$queryRaw<{ n: number }[]>`select count(*)::int as n from _prisma_migrations`)[0].n > 0
    if (!hasHistory) {
      const tables = (await db.$queryRaw<{ n: number }[]>`select count(*)::int as n from pg_tables where schemaname = 'public' and tablename <> '_prisma_migrations'`)[0].n
      if (tables > 0) stop([
        `The database already has ${tables} tables but no record of this application's changes (P3005).`,
        'This is not a database this installation created. Point DATABASE_URL at an empty database, or contact support.',
        'Do NOT delete the database volume to "fix" this — it holds someone\'s data.',
      ])
      const [priv] = await db.$queryRaw<{ dbc: boolean; sc: boolean | null }[]>`
        select has_database_privilege(current_user, current_database(), 'CREATE') as dbc,
               case when exists (select 1 from pg_namespace where nspname = 'public') then has_schema_privilege(current_user, 'public', 'CREATE') end as sc`
      if (!priv.dbc || priv.sc === false) stop([
        `The database user cannot create objects here (CREATE on the database: ${priv.dbc ? 'yes' : 'no'} · on schema public: ${priv.sc === false ? 'no' : 'yes'}).`,
        'Make the application user the owner of the database (ALTER DATABASE <name> OWNER TO <user>;) or grant CREATE on the database and on schema public (GRANT CREATE ON SCHEMA public TO <user>;), then start again.',
      ])
    } else {
      const files = await migrationFiles()
      type Row = { migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null }
      const read = () => db.$queryRaw<Row[]>`select migration_name, checksum, finished_at, rolled_back_at from _prisma_migrations order by migration_name`
      const lockHeld = async () => (await db.$queryRaw<{ n: number }[]>`select count(*)::int as n from pg_locks
        where locktype = 'advisory' and classid = 0 and objid = 72707369 and objsubid = 1 and granted
          and database = (select oid from pg_database where datname = current_database())`)[0].n > 0
      let rows = await read()
      for (let i = 0; i < 24 && rows.some((r) => !r.finished_at && !r.rolled_back_at) && (await lockHeld()); i++) {
        log(`another container is applying database changes — waiting (${i + 1}/24)…`)
        await sleep(5000)
        rows = await read()
      }
      if (rows.some((r) => !r.finished_at && !r.rolled_back_at) && !(await lockHeld())) rows = await read()
      const failed = rows.find((r) => !r.finished_at && !r.rolled_back_at)
      if (failed && (await lockHeld())) stop(['Another container has been applying database changes for over 2 minutes — leave the volume as it is and start this one again later.'])
      if (failed) stop([
        `A database change failed part-way earlier: ${failed.migration_name} (P3009). Starting again would hit the same failure.`,
        'First install (no data yet): delete the database volume and start again.',
        'Upgrade: restore the database backup taken before the upgrade, then start the previous image version.',
      ])
      for (const r of rows) {
        if (r.rolled_back_at) continue
        const now = files.get(r.migration_name)
        if (!now) stop([`The database has a change this image does not know: ${r.migration_name}. The image is older than the database — start the newer image.`])
        if (now !== r.checksum) stop([`The database change ${r.migration_name} differs from this image (checksum). The image and the database do not match — start the previous image version.`])
      }
    }
    const kind = process.env.KNOWLEDGE_STORE?.trim().toLowerCase()
    if (!kind || kind === 'pgvector') {
      try { await db.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS vector'); log('pgvector ok') }
      catch (e) {
        const there = await db.$queryRaw<{ n: number }[]>`select count(*)::int as n from pg_extension where extname = 'vector'`.then((r) => r[0].n > 0, () => false)
        if (there) log('pgvector ok')
        else console.warn(`[start] ⚠️  Could not enable the pgvector extension (${(e as Error).message.split('\n').pop()?.trim().replace(/[`'"]+$/, '')}) — document search stays off until a database administrator runs CREATE EXTENSION vector;`)
      }
    }

  } finally {
    await db.$disconnect()
  }

  // (4)
  for (let i = 1; i <= 5; i++) {
    const r = spawnSync(path.join(ROOT, 'node_modules', '.bin', 'prisma'), ['migrate', 'deploy'], { cwd: ROOT, encoding: 'utf8' })
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
    if (r.status === 0) { log(/No pending migrations/i.test(out) ? 'database up to date' : 'database changes applied'); return }
    if (transient(out) && i === 5) stop([
      'The database stayed busy or unreachable (lock held by another container, or the database is still starting). Nothing was changed by this attempt.',
      'Leave the volumes as they are and start again in a minute.',
      ...out.trim().split('\n').slice(-3),
    ])
    if (!transient(out)) {
      const name = out.match(/Migration name:\s*(\S+)/)?.[1]
      stop([
        `Applying database changes failed${name ? ` in ${name}` : ''}.`,
        'First install: delete the database volume and start again. Upgrade: restore the backup taken before the upgrade and start the previous image.',
        ...out.trim().split('\n').slice(-6),
      ])
    }
    const wait = Math.min(5000 * 2 ** (i - 1), 60_000)
    log(`database busy (${i}/5) — retrying in ${wait / 1000}s`)
    await sleep(wait)
  }
}

main().catch((e) => stop([`Unexpected error during start checks: ${(e as Error)?.message ?? e}`]))
