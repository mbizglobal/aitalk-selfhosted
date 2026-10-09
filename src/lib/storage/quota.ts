import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export function storageAlreadyFull(usedBytes: number, limitBytes: number | null | undefined): boolean {
  return limitBytes !== null && limitBytes !== undefined && usedBytes >= limitBytes
}

export async function completeWithinStorageQuota(input: {
  agentId: string
  storageId: number
  textBytes: number | undefined
  data: Prisma.StorageUpdateInput
  overLimitMessage: string
  overLimitData: Prisma.StorageUpdateInput
}): Promise<'completed' | 'over_limit' | 'gone'> {
  const textBytes = Math.max(0, input.textBytes ?? 0)
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(4210, hashtext(${input.agentId}))`
    const agent = await tx.agent.findUnique({
      where: { agentId: input.agentId },
      select: { user: { select: { subscription: { select: { storagePerAgent: true } } } } },
    })
    const limit = agent?.user?.subscription?.storagePerAgent
    if (limit !== null && limit !== undefined) {
      const used = await tx.storage.aggregate({
        where: { agentId: input.agentId, status: 'completed', id: { not: input.storageId } },
        _sum: { fileSizeBytes: true },
      })
      if ((used._sum.fileSizeBytes || 0) + textBytes > limit) {
        const r = await tx.storage.updateMany({
          where: { id: input.storageId, status: 'processing' },
          data: { ...(input.overLimitData as Prisma.StorageUpdateManyMutationInput), status: 'failed', fileSizeBytes: textBytes, errorMessage: input.overLimitMessage },
        })
        return r.count === 1 ? 'over_limit' : 'gone'
      }
    }
    const r = await tx.storage.updateMany({
      where: { id: input.storageId, status: 'processing' },
      data: { ...(input.data as Prisma.StorageUpdateManyMutationInput), status: 'completed', fileSizeBytes: textBytes },
    })
    return r.count === 1 ? 'completed' : 'gone'
  })
}
