import { spawnSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  ROOT, catalog, createScratchDb, diffCatalog, dropScratchDbQuietly, fileChecksum, isLocal, migrationNames, prisma,
  requireDatabaseUrl, withClient,
} from './db-tools'

const LEGACY = new Set(['20250105000000_cpa_single_balance'])

let failed = 0
const ok = (m: string) => console.log(`  ✅ ${m}`)
const bad = (m: string) => { failed++; console.log(`  ❌ ${m}`) }

function git(args: string[]): { status: number; out: string } {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' })
  return { status: r.status ?? 1, out: r.stdout ?? '' }
}

async function checkCommitted(ref: string) {
  const ls = git(['ls-tree', '-r', '--name-only', ref, 'prisma/migrations/'])
  if (ls.status !== 0) { bad(`git ls-tree ${ref} 실패`); return }
  const files = ls.out.split('\n').filter((f) => /^prisma\/migrations\/[^/]+\/migration\.sql$/.test(f))
  const present = new Set(await migrationNames())
  let n = 0
  for (const f of files) {
    const name = f.split('/')[2]
    if (!present.has(name)) { if (!LEGACY.has(name)) bad(`${ref} 에 있던 변경 파일이 지워졌다: ${name}`); continue }
    const shown = spawnSync('git', ['show', `${ref}:${f}`], { cwd: ROOT, maxBuffer: 256 * 1024 * 1024 })
    if (shown.status !== 0 || shown.error) { bad(`git show ${ref}:${f} 실패 — 비교 못 함`); continue }
    const before = shown.stdout as Buffer
    const now = await fs.readFile(path.join(ROOT, f))
    if (!before.equals(now)) bad(`${ref} 에 있던 변경 파일이 바뀌었다: ${name} — 커밋한 변경 파일은 고치지 않는다. 새 변경 파일로`)
    else n++
  }
  ok(`${ref} 의 변경 파일 ${n} 개 그대로`)
}

async function main() {
  const target = requireDatabaseUrl()
  if (!isLocal(target)) throw new Error('ABORT: 대상 DB 가 localhost 가 아니다 — 이 검사는 로컬 DB 에서만 돈다')
  const sinceIdx = process.argv.indexOf('--since')
  const refs = ['HEAD', ...(sinceIdx > 0 ? [process.argv[sinceIdx + 1]] : [])]

  console.log('(1) 커밋된 변경 파일')
  for (const r of refs) await checkCommitted(r)

  console.log('(2) 대상 DB 적용 기록')
  const names = await migrationNames()
  const applied = await withClient(target, async (db) => {
    const t = await db.$queryRawUnsafe<{ n: number }[]>(`select count(*)::int as n from information_schema.tables where table_schema='public' and table_name='_prisma_migrations'`)
    if (!t[0].n) return null
    return db.$queryRawUnsafe<{ migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null }[]>(
      `select migration_name, checksum, finished_at, rolled_back_at from _prisma_migrations order by migration_name`)
  })
  if (!applied) bad('대상 DB 에 적용 기록이 없다 — scripts/db-baseline-check.ts 로 표시부터')
  else {
    for (const a of applied) {
      if (a.rolled_back_at) continue
      if (!a.finished_at) { bad(`실패로 남은 변경: ${a.migration_name}`); continue }
      if (!names.includes(a.migration_name)) { bad(`기록엔 있고 파일은 없다: ${a.migration_name}`); continue }
      if ((await fileChecksum(a.migration_name)) !== a.checksum) bad(`기록과 파일이 다르다(체크섬): ${a.migration_name}`)
    }
    const done = new Set(applied.filter((a) => a.finished_at && !a.rolled_back_at).map((a) => a.migration_name))
    const pending = names.filter((n) => !done.has(n))
    if (pending.length) bad(`대상 DB 에 아직 안 올린 변경 파일: ${pending.join(', ')} — npx prisma migrate deploy`)
    else ok(`적용 기록 ${done.size} 개 = 파일 · 체크섬 일치`)
  }

  console.log('(3) 빈 DB 에 올려 비교')
  const scratch = await createScratchDb(target, 'aitalk_dbcheck')
  try {
    const dep = prisma(['migrate', 'deploy'], { DATABASE_URL: scratch })
    if (dep.status !== 0) { bad(`빈 DB 에 migrate deploy 실패\n${dep.all}`); return }
    const diff = prisma(['migrate', 'diff', '--from-url', scratch, '--to-schema-datamodel', 'prisma/schema.prisma', '--exit-code'])
    if (diff.status === 0) ok('스키마와 Prisma 비교 차이 0')
    else bad(`스키마가 변경 파일보다 앞서 있다 — npm run db:migration:new -- <이름>\n${diff.all.trim()}`)
    const { missing, extra } = diffCatalog(await catalog(target), await catalog(scratch))
    if (!missing.length && !extra.length) ok('카탈로그(손 제약 포함) = 대상 DB')
    else {
      for (const k of missing) bad(`대상 DB 에만 있다(변경 파일에 없음): ${k}`)
      for (const k of extra) bad(`변경 파일에만 있다(대상 DB 에 없음): ${k}`)
    }
  } finally {
    await dropScratchDbQuietly(scratch)
  }
}

main()
  .then(() => {
    console.log(failed ? `\n❌ db:check 실패 ${failed}` : '\n✅ db:check 통과')
    process.exit(failed ? 1 : 0)
  })
  .catch((e) => { console.error(e); process.exit(1) })
