import type { PrismaClient } from '@prisma/client'

export class PgvectorMissing extends Error {
  code = 'PGVECTOR_NOT_INSTALLED'
  constructor() {
    super('Document search is off: the database has no pgvector extension. Ask the database administrator to run CREATE EXTENSION vector; (uploads are kept and become searchable once it is installed)')
    this.name = 'PgvectorMissing'
  }
}

let installed = false
let checkedAt: number | null = null
const RECHECK_MS = 60_000

async function queryInstalled(db?: PrismaClient): Promise<boolean> {
  const client = db ?? (await import('@/lib/prisma')).prisma
  const rows = await client.$queryRaw<{ n: number }[]>`select count(*)::int as n from pg_extension where extname = 'vector'`
  return rows[0]?.n > 0
}

export async function pgvectorInstalled(db?: PrismaClient): Promise<boolean> {
  if (installed) return true
  if (checkedAt !== null && performance.now() - checkedAt < RECHECK_MS) return false
  installed = await queryInstalled(db)
  checkedAt = performance.now()
  return installed
}

export async function assertPgvectorInstalled(db?: PrismaClient): Promise<void> {
  if (!(await pgvectorInstalled(db))) throw new PgvectorMissing()
}

export function asPgvectorMissing(e: unknown): unknown {
  const code = (e as { meta?: { code?: string } })?.meta?.code
  const msg = (e as Error)?.message ?? ''
  if (code === '42704' || code === '42883' || /type "vector" does not exist|operator does not exist: vector/i.test(msg)) {
    installed = false
    checkedAt = performance.now()
    return new PgvectorMissing()
  }
  return e
}

export async function pgvectorStatus(): Promise<boolean | null> {
  const { selfHostedKnowledgeKind } = await import('./index')
  if (selfHostedKnowledgeKind() !== 'pgvector') return null
  const now = await queryInstalled()
  installed = now
  checkedAt = performance.now()
  return now
}

export async function warnIfPgvectorMissing(): Promise<void> {
  try {
    if ((await pgvectorStatus()) === false) console.warn(`[Knowledge] ⚠️  ${new PgvectorMissing().message}`)
  } catch (e) {
    console.warn('[Knowledge] could not check the pgvector extension:', (e as Error)?.message)
  }
}

export function resetPgvectorStatusForTest(): void { installed = false; checkedAt = null }
