import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isSelfHosted } from '@/lib/edition'

export async function hasInstallOwner(db: Prisma.TransactionClient = prisma): Promise<boolean> {
  return (await db.user.count({ where: { emailVerified: { not: null } } })) > 0
}

export async function installOwnerId(db: Prisma.TransactionClient = prisma): Promise<string | null> {
  const owner = await db.user.findFirst({
    where: { emailVerified: { not: null } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  })
  return owner?.id ?? null
}

export async function isInstallAdmin(user: { id?: string | null }): Promise<boolean> {
  if (!isSelfHosted() || !user.id) return false
  return (await installOwnerId()) === user.id
}

async function lockSetup(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(4202, 0)`
}

export async function createFirstAdmin(data: { email: string; passwordHash: string; signupIp: string | null }) {
  return prisma.$transaction(async (tx) => {
    await lockSetup(tx)
    if (await hasInstallOwner(tx)) return null
    await tx.user.deleteMany({ where: { email: data.email, emailVerified: null } })
    return tx.user.create({
      data: {
        email: data.email,
        name: data.email.split('@')[0],
        password: data.passwordHash,
        emailVerified: new Date(),
        signupIp: data.signupIp,
      },
    })
  })
}

export async function verifyEmailIfSetupOpen(user: { id: string }): Promise<boolean> {
  if (!isSelfHosted()) {
    await prisma.user.update({ where: { id: user.id }, data: { emailVerified: new Date() } })
    return true
  }
  return prisma.$transaction(async (tx) => {
    await lockSetup(tx)
    if (await hasInstallOwner(tx)) return false
    await tx.user.update({ where: { id: user.id }, data: { emailVerified: new Date() } })
    return true
  })
}
