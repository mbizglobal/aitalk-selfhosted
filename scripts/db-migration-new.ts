import { promises as fs } from 'node:fs'
import path from 'node:path'
import { MIGRATIONS_DIR, ROOT, createScratchDb, dbName, dropScratchDbQuietly, isLocal, migrationNames, prisma, requireDatabaseUrl } from './db-tools'

const LOCK = path.join(ROOT, '.git', 'aitalk-migration.lock')

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
}

async function main() {
  const empty = process.argv.includes('--empty')
  const name = process.argv.slice(2).find((a) => !a.startsWith('--'))
  if (!name || !/^[a-z0-9_]+$/.test(name)) throw new Error('이름을 준다 — 소문자 · 숫자 · _ (예: npm run db:migration:new -- work_task_due)')
  const target = requireDatabaseUrl()
  if (!isLocal(target)) throw new Error('ABORT: DATABASE_URL 이 localhost 가 아니다 — 그림자 DB 를 만들 서버로 로컬만 쓴다')

  try {
    await fs.mkdir(LOCK)
  } catch {
    const who = await fs.readFile(path.join(LOCK, 'owner'), 'utf8').catch(() => '?')
    throw new Error(`다른 세션이 변경 파일을 만드는 중이다(${who.trim()}) — 끝난 뒤 다시. 남은 잠금이면 rmdir 로 지운다: ${LOCK}`)
  }
  let shadow: string | null = null
  try {
    await fs.writeFile(path.join(LOCK, 'owner'), `pid ${process.pid} · ${new Date().toISOString()} · ${name}\n`)
    shadow = await createScratchDb(target, 'aitalk_shadow')
    if (dbName(shadow) === dbName(target)) throw new Error('그림자 DB 가 대상 DB 와 같다')
    const r = prisma(['migrate', 'diff', '--from-migrations', 'prisma/migrations', '--to-schema-datamodel', 'prisma/schema.prisma',
      '--shadow-database-url', shadow, '--script'])
    if (r.status !== 0) throw new Error(`migrate diff 실패\n${r.all}`)
    const diff = r.out.trim()
    const none = !diff || diff === '-- This is an empty migration.'
    if (empty && !none) throw new Error(`스키마와 변경 파일 사이에 차이가 있다 — --empty 없이 먼저 만든다\n${diff}`)
    if (!empty && none) { console.log('스키마와 변경 파일 사이에 차이가 없다 — 만들 것 없음 (손 SQL 만 쓰려면 --empty)'); return }
    const sql = empty ? '-- 손으로 쓰는 변경 — 스키마 파일은 그대로. 여러 번 돌려도 같은 결과가 나게 쓴다' : diff

    const folder = `${stamp()}_${name}`
    const last = (await migrationNames()).pop()
    if (last && folder <= last) throw new Error(`새 변경 파일(${folder})이 마지막 파일(${last})보다 앞에 정렬된다 — 시계 · 마지막 파일 이름을 확인`)
    const dir = path.join(MIGRATIONS_DIR, folder)
    await fs.mkdir(dir)
    await fs.writeFile(path.join(dir, 'migration.sql'), sql + '\n')
    console.log(`\n${sql}\n`)
    console.log(`📄 만들었다: ${path.relative(ROOT, dir)}/migration.sql — 아직 DB 에 안 올렸다`)
    console.log('   (1) 위 SQL 에 내가 고친 칸만 있는지 본다 (2) 손 SQL 이 필요하면 끝에 덧붙인다 (3) npx prisma migrate deploy (4) npm run db:check')
  } finally {
    if (shadow) await dropScratchDbQuietly(shadow)
    await fs.rm(LOCK, { recursive: true, force: true })
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
