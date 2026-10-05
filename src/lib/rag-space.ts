import { prisma } from '@/lib/prisma'

export const MAX_RAG_SPACES = 5

export const RAG_SPACE_LIMIT_ERROR = 'RAG_SPACE_LIMIT_EXCEEDED'

export const RAG_SPACE_NOT_FOUND_ERROR = 'RAG_SPACE_NOT_FOUND'

export const RAG_SPACE_UNRESOLVED_ERROR = 'RAG_SPACE_UNRESOLVED'

export class RagSpaceError extends Error {
  constructor(public code: string, message: string) {
    super(message)
    this.name = 'RagSpaceError'
  }
}

export type RagSpaceRow = {
  id: number
  agentId: string
  name: string
  isDefault: boolean
  sortOrder: number
}

export async function getOrCreateDefaultSpace(agentId: string): Promise<RagSpaceRow> {
  const existing = await prisma.ragSpace.findFirst({
    where: { agentId, isDefault: true },
  })
  if (existing) return existing

  try {
    return await prisma.ragSpace.create({
      data: { agentId, name: 'Default', isDefault: true, sortOrder: 0 },
    })
  } catch {
    const fallback = await prisma.ragSpace.findFirst({
      where: { agentId, isDefault: true },
    })
    if (fallback) return fallback
    throw new Error(`Failed to resolve default RAG space for agent ${agentId}`)
  }
}

export async function resolveRagSpaceId(
  agentId: string,
  requested?: number | string | null
): Promise<number> {
  if (requested === null || requested === undefined || requested === '') {
    const def = await getOrCreateDefaultSpace(agentId)
    return def.id
  }

  const reqId = Number(requested)
  if (!Number.isInteger(reqId)) {
    throw new RagSpaceError(RAG_SPACE_NOT_FOUND_ERROR, `Invalid ragSpaceId: ${requested}`)
  }
  const space = await prisma.ragSpace.findFirst({
    where: { id: reqId, agentId },
    select: { id: true },
  })
  if (!space) {
    throw new RagSpaceError(RAG_SPACE_NOT_FOUND_ERROR, `RagSpace ${reqId} not found for agent ${agentId}`)
  }
  return space.id
}

export async function isDefaultSpace(agentId: string, ragSpaceId: number): Promise<boolean> {
  const space = await prisma.ragSpace.findFirst({
    where: { id: ragSpaceId, agentId },
    select: { isDefault: true },
  })
  return space?.isDefault ?? false
}

export async function resolveSearchSpace(
  db: Pick<import('@prisma/client').PrismaClient, 'ragSpace'>,
  agentId: string,
  requested?: number | string | null,
  label = 'search'
): Promise<{ ragSpace: string; ragSpaceIncludeNull: boolean }> {
  let space: { id: number; isDefault: boolean } | null = null

  if (requested != null && Number.isInteger(Number(requested))) {
    space = await db.ragSpace.findFirst({
      where: { id: Number(requested), agentId },
      select: { id: true, isDefault: true },
    })
    if (!space) console.warn(`[RagSpace] ${label}: ragSpaceId=${requested} not found for agent=${agentId} → Default`)
  }

  if (!space) {
    space = await db.ragSpace.findFirst({
      where: { agentId, isDefault: true },
      select: { id: true, isDefault: true },
    })
    if (!space) {
      space = await db.ragSpace.create({
        data: { agentId, name: 'Default', isDefault: true, sortOrder: 0 },
        select: { id: true, isDefault: true },
      }).catch(async () => db.ragSpace.findFirst({
        where: { agentId, isDefault: true },
        select: { id: true, isDefault: true },
      }).catch(() => null))
    }
  }

  if (!space) {
    throw new RagSpaceError(
      RAG_SPACE_UNRESOLVED_ERROR,
      `Could not resolve a RAG space for agent ${agentId} (requested=${requested ?? 'none'})`
    )
  }

  return {
    ragSpace: String(space.id),
    ragSpaceIncludeNull: space.isDefault,
  }
}
