
import { PrismaClient, WorkflowTempStorageStatus } from '@prisma/client'

export async function saveTempData(
  prisma: PrismaClient,
  conversationId: string,
  agentId: string,
  jsonData: Record<string, any>
): Promise<string> {
  const existing = await prisma.workflowTempStorage.findFirst({
    where: {
      conversationId,
      agentId,
      status: {
        in: [WorkflowTempStorageStatus.pending, WorkflowTempStorageStatus.waiting]
      }
    }
  })

  if (existing) {
    await prisma.workflowTempStorage.update({
      where: { id: existing.id },
      data: {
        jsonData: JSON.stringify(jsonData),
        updatedAt: new Date()
      }
    })
    return existing.id
  } else {
    const created = await prisma.workflowTempStorage.create({
      data: {
        conversationId,
        agentId,
        jsonData: JSON.stringify(jsonData),
        status: WorkflowTempStorageStatus.pending
      }
    })
    return created.id
  }
}

export async function loadTempData(
  prisma: PrismaClient,
  conversationId: string,
  agentId: string
): Promise<Record<string, any> | null> {
  const record = await prisma.workflowTempStorage.findFirst({
    where: {
      conversationId,
      agentId,
      status: {
        in: [WorkflowTempStorageStatus.pending, WorkflowTempStorageStatus.waiting]
      }
    },
    orderBy: {
      updatedAt: 'desc'
    }
  })

  if (!record) return null

  try {
    return JSON.parse(record.jsonData)
  } catch (error) {
    console.error('[TempStorage] Failed to parse JSON data:', error)
    return null
  }
}

export async function confirmTempData(
  prisma: PrismaClient,
  conversationId: string,
  agentId: string
): Promise<boolean> {
  const record = await prisma.workflowTempStorage.findFirst({
    where: {
      conversationId,
      agentId,
      status: WorkflowTempStorageStatus.pending
    }
  })

  if (!record) return false

  await prisma.workflowTempStorage.update({
    where: { id: record.id },
    data: {
      status: WorkflowTempStorageStatus.confirmed,
      updatedAt: new Date()
    }
  })

  return true
}

export async function cancelTempData(
  prisma: PrismaClient,
  conversationId: string,
  agentId: string
): Promise<boolean> {
  const record = await prisma.workflowTempStorage.findFirst({
    where: {
      conversationId,
      agentId,
      status: WorkflowTempStorageStatus.pending
    }
  })

  if (!record) return false

  await prisma.workflowTempStorage.update({
    where: { id: record.id },
    data: {
      status: WorkflowTempStorageStatus.cancelled,
      updatedAt: new Date()
    }
  })

  return true
}

export async function cleanupOldTempData(
  prisma: PrismaClient,
  hoursOld: number = 24
): Promise<number> {
  const cutoffDate = new Date(Date.now() - hoursOld * 60 * 60 * 1000)

  const result = await prisma.workflowTempStorage.deleteMany({
    where: {
      status: WorkflowTempStorageStatus.pending,
      updatedAt: {
        lt: cutoffDate
      }
    }
  })

  return result.count
}

export async function deleteTempData(
  prisma: PrismaClient,
  conversationId: string,
  agentId: string
): Promise<number> {
  const result = await prisma.workflowTempStorage.deleteMany({
    where: {
      conversationId,
      agentId
    }
  })

  return result.count
}
