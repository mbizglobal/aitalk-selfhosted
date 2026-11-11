import type { Prisma, PrismaClient } from '@prisma/client'
import { lockCompanyKey } from './company-limit'

export async function deleteUserWorkData(db: PrismaClient | Prisma.TransactionClient, userId: string): Promise<{ projects: number; events: number }> {
  if (typeof userId !== 'string' || userId === '') throw new Error('deleteUserWorkData: userId is required')
  const run = async (tx: Prisma.TransactionClient, own: boolean) => {
    if (own) await lockCompanyKey(tx, userId)
    await tx.$queryRaw`SELECT id FROM "user" WHERE id = ${userId} FOR UPDATE`
    const projects = await tx.workProject.deleteMany({ where: { userId } })
    const events = await tx.workEvent.deleteMany({ where: { userId } })
    return { projects: projects.count, events: events.count }
  }
  return '$transaction' in db ? (db as PrismaClient).$transaction((tx) => run(tx, true), { timeout: 60_000 }) : run(db, false)
}
