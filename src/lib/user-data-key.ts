
import type { Prisma, PrismaClient } from '@prisma/client'
import {
  generateDataKey,
  encryptDataKey,
  decryptDataKey,
  decryptDataKeyWithLegacy,
} from '@/lib/encryption'

type UserDataKeyDb = PrismaClient | Prisma.TransactionClient

export type DataKeyFailure = 'USER_NOT_FOUND' | 'PROVISIONING_BLOCKED'

export class DataKeyError extends Error {
  constructor(readonly code: DataKeyFailure) {
    super(`DEK unavailable (${code})`)
    this.name = 'DataKeyError'
  }
}

const DEK_SELECT = {
  encryptedDataKey: true,
  zkiId: true,
  zki: { select: { masterKey: true } },
} as const

export async function ensureUserDataKey(
  db: UserDataKeyDb,
  userId: string
): Promise<Buffer> {
  let user = await db.user.findUnique({ where: { id: userId }, select: DEK_SELECT })
  if (!user) {
    console.error(`[DEK] user not found — userId=${userId}`)
    throw new DataKeyError('USER_NOT_FOUND')
  }

  if (!user.encryptedDataKey) {
    await db.user.updateMany({
      where: {
        id: userId,
        encryptedDataKey: null,
        isAnonymized: false,
      },
      data: {
        encryptedDataKey: new Uint8Array(await encryptDataKey(generateDataKey())),
        zkiId: null,
      },
    })
    user = await db.user.findUnique({ where: { id: userId }, select: DEK_SELECT })
  }

  if (!user?.encryptedDataKey) {
    console.error(`[DEK] provisioning blocked or failed — userId=${userId} (anonymized or deleted)`)
    throw new DataKeyError('PROVISIONING_BLOCKED')
  }

  return user.zkiId && user.zki?.masterKey
    ? decryptDataKeyWithLegacy(Buffer.from(user.encryptedDataKey), user.zki.masterKey)
    : await decryptDataKey(Buffer.from(user.encryptedDataKey))
}
