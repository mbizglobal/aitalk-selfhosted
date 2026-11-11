import type { NextRequest } from 'next/server'

export type AppWorkAccess = { isOwner: true } | { isOwner: false; memberId: number }

export async function resolveAppWorkAccess(_request: NextRequest, _agent: { agentId: string; userId: string }): Promise<AppWorkAccess | null> {
  return null
}
