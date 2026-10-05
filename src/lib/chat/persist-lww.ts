export interface PersistedConversationMeta {
  writerId?: unknown
  writerRevision?: unknown
  lastUpdated?: unknown
}

export interface PersistWriterState {
  writerId: string
  revision: number
  lastUpdated?: string | null
}

export function shouldOverwritePersistedConversation(
  existing: PersistedConversationMeta | null | undefined,
  mine: PersistWriterState
): boolean {
  if (!existing) return true

  if (existing.writerId === mine.writerId) {
    return !(typeof existing.writerRevision === 'number' && existing.writerRevision > mine.revision)
  }

  const existingAt = Date.parse(typeof existing.lastUpdated === 'string' ? existing.lastUpdated : '')
  const mineAt = Date.parse(mine.lastUpdated ?? '')
  if (!Number.isFinite(existingAt) || !Number.isFinite(mineAt)) return true

  if (existingAt > mineAt) return false
  if (existingAt === mineAt && typeof existing.writerId === 'string') {
    return !(existing.writerId > mine.writerId)
  }
  return true
}
