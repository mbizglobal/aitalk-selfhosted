import { Prisma, type PrismaClient } from '@prisma/client'
import { getManagedPlanCompanyLimit } from '@/lib/invoice/subscription/utils'
import { isSelfHosted } from '@/lib/edition'
import { COMPANY_BOOK_KINDS } from './app-template-kinds'
import { WorkError } from './errors'

type Tx = Prisma.TransactionClient

const COMPANY_SCOPE_LOCK = 4203

export class CompanyLimitError extends WorkError {
  constructor(readonly used: number, readonly limit: number) {
    super('COMPANY_LIMIT', `company limit ${used}/${limit}`)
  }
}

export interface CompanyScope {
  readonly userId: string
  readonly before: number
  readonly limit: number | null
}

export async function companyLimitOf(db: PrismaClient | Tx, userId: string): Promise<number | null> {
  if (isSelfHosted()) return null
  const u = await db.user.findUnique({ where: { id: userId }, select: { subscription: { select: { planType: true } } } })
  return companyLimitFor(u?.subscription?.planType ?? null)
}

export function companyLimitFor(planType: Parameters<typeof getManagedPlanCompanyLimit>[0] | null): number {
  return planType ? getManagedPlanCompanyLimit(planType) : getManagedPlanCompanyLimit('starter')
}

export function exceedsCompanyLimit(before: number, after: number, limit: number | null): boolean {
  return limit !== null && after > before && after > limit
}

export async function countCompanyBooks(tx: Tx, userId: string): Promise<number> {
  if (!COMPANY_BOOK_KINDS.length) return 0
  const rows = await tx.$queryRaw<Array<{ n: number }>>(Prisma.sql`
    SELECT count(*)::int AS n
    FROM work_project p
    LEFT JOIN workflows w ON w."workflowId" = p.workflow_id
    WHERE p.user_id = ${userId}
      AND p.kind IN (${Prisma.join([...COMPANY_BOOK_KINDS])})
      AND p.status = 'active'
      AND NOT (p.workflow_linked_at IS NOT NULL AND p.workflow_id IS NULL)
      AND NOT (p.workflow_id IS NOT NULL AND w.kind = 'app' AND w.status <> 'production')`)
  return rows[0]?.n ?? 0
}

export async function lockCompanyScope(tx: Tx, userId: string, limit: number | null): Promise<CompanyScope> {
  await lockCompanyKey(tx, userId)
  return { userId, before: await countCompanyBooks(tx, userId), limit }
}

export async function lockCompanyKey(tx: Tx, userId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${COMPANY_SCOPE_LOCK}::int, hashtext(${userId}))`
}

export async function assertCompanyRoom(tx: Tx, scope: CompanyScope): Promise<void> {
  if (scope.limit === null) return
  const after = await countCompanyBooks(tx, scope.userId)
  if (exceedsCompanyLimit(scope.before, after, scope.limit)) throw new CompanyLimitError(after, scope.limit)
}

export async function withCompanyScope<T>(tx: Tx, userId: string, limit: number | null, fn: () => Promise<T>): Promise<T> {
  const scope = await lockCompanyScope(tx, userId, limit)
  const r = await fn()
  await assertCompanyRoom(tx, scope)
  return r
}
