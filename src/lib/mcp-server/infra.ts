
import { prisma } from '@/lib/prisma'

const RATE_LIMITS: Record<RateClass, number> = { read: 60, write: 12 }

export type RateClass = 'read' | 'write'

export async function reserveRateQuota(tokenId: string, cls: RateClass): Promise<boolean> {
  const windowStart = new Date(Math.floor(Date.now() / 60_000) * 60_000)
  try {
    const rows = await prisma.$queryRaw<Array<{ count: number }>>`
      INSERT INTO mcp_rate_bucket (token_id, class, window_start, count)
      VALUES (${tokenId}, ${cls}, ${windowStart}, 1)
      ON CONFLICT (token_id, class, window_start)
      DO UPDATE SET count = mcp_rate_bucket.count + 1
      RETURNING count`
    const count = rows[0]?.count ?? 1
    if (count === 1 && Math.random() < 0.05) {
      void prisma.mcpRateBucket
        .deleteMany({ where: { windowStart: { lt: new Date(Date.now() - 5 * 60_000) } } })
        .catch(() => {})
    }
    return count > RATE_LIMITS[cls]
  } catch (err) {
    console.error('[MCP] rate bucket increment failed (fail-open):', err)
    return false
  }
}

export async function recordAudit(entry: {
  tokenId: string
  userId: string
  tool: string
  ok: boolean
  code?: string
  workflowId?: string
  durationMs: number
}): Promise<void> {
  try {
    await prisma.mcpAuditLog.create({
      data: {
        tokenId: entry.tokenId,
        userId: entry.userId,
        tool: entry.tool.slice(0, 60),
        ok: entry.ok,
        code: entry.code?.slice(0, 60) ?? null,
        workflowId: entry.workflowId?.slice(0, 25) ?? null,
        durationMs: Math.min(entry.durationMs, 2147483647),
      },
    })
  } catch (err) {
    console.error('[MCP] audit insert failed:', err)
  }
}
