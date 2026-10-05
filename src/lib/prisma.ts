import { PrismaClient } from '@prisma/client'
import { resolvePrismaLogLevel } from './prisma-log-level'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: resolvePrismaLogLevel(),
})

globalForPrisma.prisma = prisma