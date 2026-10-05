import { config } from 'dotenv'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'

config({ path: '.env.local' })
config()

export const ROOT = path.resolve(__dirname, '..')
export const MIGRATIONS_DIR = path.join(ROOT, 'prisma', 'migrations')
export const SCHEMA = path.join(ROOT, 'prisma', 'schema.prisma')

export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL 이 비었다')
  return url
}

export function dbName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''))
}

export function withDb(url: string, name: string): string {
  const u = new URL(url)
  u.pathname = '/' + encodeURIComponent(name)
  return u.toString()
}

export function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^\[|\]$/g, '') } catch { return '' }
}

export const isLocal = (url: string) => ['localhost', '127.0.0.1', '::1'].includes(hostOf(url))

export async function withClient<T>(url: string, fn: (db: PrismaClient) => Promise<T>): Promise<T> {
  const db = new PrismaClient({ datasourceUrl: url, log: [] })
  try { return await fn(db) } finally { await db.$disconnect() }
}

export async function createScratchDb(baseUrl: string, prefix: string): Promise<string> {
  if (!SCRATCH_PREFIXES.includes(prefix)) throw new Error(`버리는 DB 접두어가 아니다: ${prefix}`)
  const name = `${prefix}_${process.pid}_${Date.now()}`
  if (name === dbName(baseUrl)) throw new Error('버리는 DB 이름이 대상 DB 와 같다')
  const url = withDb(baseUrl, name)
  created.add(name)
  try {
    await withClient(withDb(baseUrl, 'postgres'), (db) => db.$executeRawUnsafe(`CREATE DATABASE "${name}"`))
  } catch (e) {
    await dropScratchDb(url).catch(() => console.warn(`⚠️  버리는 DB 를 만들다 실패 — 남았으면 손으로 지운다: ${name}`))
    throw e
  }
  return url
}

const created = new Set<string>()

export const SCRATCH_PREFIXES = ['aitalk_dbcheck', 'aitalk_baseline', 'aitalk_shadow', 'aitalk_mut']
const SCRATCH_NAME = new RegExp(`^(${SCRATCH_PREFIXES.join('|')})_\\d+_\\d+$`)

export async function dropScratchDbQuietly(url: string): Promise<void> {
  await dropScratchDb(url).catch((e) => console.warn(`⚠️  버리는 DB 를 못 지웠다 — 손으로 지운다: ${dbName(url)} (${e instanceof Error ? e.message : e})`))
}

export async function dropScratchDb(url: string): Promise<void> {
  const name = dbName(url)
  if (!SCRATCH_NAME.test(name)) throw new Error(`버리는 DB 가 아니다 — 지우지 않는다: ${name}`)
  if (process.env.DATABASE_URL && name === dbName(process.env.DATABASE_URL)) throw new Error(`대상 DB 다 — 지우지 않는다: ${name}`)
  if (!created.has(name)) throw new Error(`이 프로세스가 만든 DB 가 아니다 — 지우지 않는다: ${name}`)
  await withClient(withDb(url, 'postgres'), (db) => db.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`))
  created.delete(name)
}

export function prisma(args: string[], env: Record<string, string> = {}): { status: number; out: string; all: string } {
  const r = spawnSync('npx', ['prisma', ...args], { cwd: ROOT, env: { ...process.env, ...env }, encoding: 'utf8' })
  return { status: r.status ?? 1, out: r.stdout ?? '', all: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

const CATALOG_SQL = `
select 'col|'||table_name||'|'||column_name||'|'||data_type||'|'||udt_schema||'.'||udt_name||'|'||coalesce(character_maximum_length::text,'')||'|'||coalesce(numeric_precision::text,'')||','||coalesce(numeric_scale::text,'')||'|'||coalesce(datetime_precision::text,'')||'|'||is_nullable||'|'||coalesce(column_default,'')||'|'||is_identity||':'||coalesce(identity_generation,'')||'|'||is_generated as k
  from information_schema.columns where table_schema='public' and table_name<>'_prisma_migrations'
union all select 'con|'||conrelid::regclass||'|'||conname||'|'||pg_get_constraintdef(oid)
  from pg_constraint where connamespace='public'::regnamespace and conrelid::regclass::text<>'_prisma_migrations'
union all select 'idx|'||tablename||'|'||indexname||'|'||indexdef
  from pg_indexes where schemaname='public' and tablename<>'_prisma_migrations'
union all select 'enum|'||t.typname||'|'||string_agg(e.enumlabel,',' order by e.enumlabel)
  from pg_type t join pg_enum e on e.enumtypid=t.oid join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' group by t.typname
union all select 'trg|'||tgrelid::regclass||'|'||pg_get_triggerdef(t.oid)||'|'||tgenabled::text from pg_trigger t join pg_class c on c.oid=t.tgrelid
  where not tgisinternal and c.relnamespace='public'::regnamespace
union all select 'fn|'||proname||'('||pg_get_function_identity_arguments(p.oid)||')|'||md5(pg_get_functiondef(p.oid)) from pg_proc p
  where pronamespace='public'::regnamespace and prokind in ('f','p')
  and not exists (select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
union all select 'view|'||viewname||'|'||md5(definition) from pg_views where schemaname='public'
union all select 'mview|'||matviewname||'|'||md5(definition) from pg_matviews where schemaname='public'
union all select 'seq|'||sequencename||'|'||data_type||'|'||start_value||'|'||increment_by||'|'||min_value||'|'||max_value||'|'||cycle from pg_sequences where schemaname='public'`

export async function catalog(url: string): Promise<string[]> {
  const rows = await withClient(url, (db) => db.$queryRawUnsafe<{ k: string }[]>(CATALOG_SQL))
  return rows.map((r) => r.k).sort()
}

export function diffCatalog(want: string[], got: string[]): { missing: string[]; extra: string[] } {
  const g = new Set(got), w = new Set(want)
  return { missing: want.filter((k) => !g.has(k)), extra: got.filter((k) => !w.has(k)) }
}

export const POSTCONDITIONS: { name: string; sql: string }[] = [
  { name: 'work_sheets — 에이전트 시트 주인(user_id) 채움',
    sql: `select count(*)::int as n from data_sheets s join agents a on s."agentId" = a."agentId" where s.user_id is null` },
  { name: 'work_sheets — 워크플로가 붙은 프로젝트의 workflow_linked_at',
    sql: `select count(*)::int as n from work_project where workflow_id is not null and workflow_linked_at is null` },
  { name: 'work_module_bank_import — 옛 모듈 이름 bank.ubs-import',
    sql: `select count(*)::int as n from work_project where 'bank.ubs-import' = any(modules)` },
  { name: 'work_tx_evidence — 거래 시트의 evidence · receiptFileId 칸',
    sql: `select count(*)::int as n from data_sheets where template = 'vat.transactions@1'
            and (schema is null or not coalesce((schema::jsonb -> 'columns') @> '[{"name":"evidence"}]'::jsonb and (schema::jsonb -> 'columns') @> '[{"name":"receiptFileId"}]'::jsonb, false))` },
  { name: 'voice_quiz_lessons_locale — 옛 lang 칸 없음',
    sql: `select count(*)::int as n from information_schema.columns where table_schema='public' and table_name='voice_quiz_lessons' and column_name='lang'` },
  { name: 'voice_quiz_lessons_locale — 아는 로케일만',
    sql: `select count(*)::int as n from voice_quiz_lessons where locale is null or locale not in ('de-CH','de-DE','fr-CH','fr-FR','en-US','en-GB','ko-KR')` },
  { name: '손 제약 — 검사를 건너뛴(NOT VALID) 제약 없음',
    sql: `select count(*)::int as n from pg_constraint where connamespace='public'::regnamespace and not convalidated` },
]

export async function postconditions(url: string): Promise<{ name: string; n: number }[]> {
  return withClient(url, async (db) => {
    const out: { name: string; n: number }[] = []
    for (const p of POSTCONDITIONS) out.push({ name: p.name, n: (await db.$queryRawUnsafe<{ n: number }[]>(p.sql))[0].n })
    return out
  })
}

export async function migrationNames(dir = MIGRATIONS_DIR): Promise<string[]> {
  const names: string[] = []
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory() && (await fs.stat(path.join(dir, e.name, 'migration.sql')).catch(() => null))) names.push(e.name)
  }
  return names.sort()
}

export async function fileChecksum(name: string): Promise<string> {
  return createHash('sha256').update(await fs.readFile(path.join(MIGRATIONS_DIR, name, 'migration.sql'))).digest('hex')
}

export async function partialMigrationsDir(upTo: string, tmpRoot: string): Promise<string> {
  const names = await migrationNames()
  const idx = names.indexOf(upTo)
  if (idx < 0) throw new Error(`변경 파일이 없다: ${upTo}`)
  const dir = path.join(tmpRoot, 'prisma')
  await fs.mkdir(path.join(dir, 'migrations'), { recursive: true })
  await fs.copyFile(SCHEMA, path.join(dir, 'schema.prisma'))
  await fs.copyFile(path.join(MIGRATIONS_DIR, 'migration_lock.toml'), path.join(dir, 'migrations', 'migration_lock.toml'))
  for (const n of names.slice(0, idx + 1)) await fs.cp(path.join(MIGRATIONS_DIR, n), path.join(dir, 'migrations', n), { recursive: true })
  return path.join(dir, 'schema.prisma')
}

export async function pgMajor(url: string): Promise<number> {
  const r = await withClient(url, (db) => db.$queryRawUnsafe<{ v: number }[]>(`select (current_setting('server_version_num')::int / 10000) as v`))
  return Number(r[0].v)
}
