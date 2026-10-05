import type { PrismaClient } from '@prisma/client'

const unavailable = (what: string): never => { throw new Error(`${what} is not part of this installation (self-hosted edition)`) }

export async function getOrCreateUserDataKey(_prisma: PrismaClient, _userId: string): Promise<Buffer> {
  return unavailable('Returning-visitor context')
}
