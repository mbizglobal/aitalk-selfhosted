import type { PrismaClient } from '@prisma/client'
import { reconcileBookingIndex } from '@/lib/calendar/booking-index-reconcile'

const inFlightSync = new Map<string, Promise<number>>()
const SYNC_RESPONSE_BUDGET_MS = 25_000

export async function reconcileWithLock(
  prisma: PrismaClient,
  userId: string
): Promise<{ synced: number; inProgress: boolean }> {
  if (inFlightSync.has(userId)) return { synced: 0, inProgress: true }

  const job = reconcileBookingIndex(prisma, userId)
    .catch((e) => {
      console.error('[booking-sync] reconcile failed', e)
      return 0
    })
    .finally(() => inFlightSync.delete(userId))
  inFlightSync.set(userId, job)

  const TIMED_OUT = Symbol('timeout')
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<typeof TIMED_OUT>((r) => {
    timer = setTimeout(() => r(TIMED_OUT), SYNC_RESPONSE_BUDGET_MS)
  })
  try {
    const raced = await Promise.race([job, timeout])
    const timedOut = raced === TIMED_OUT
    return { synced: timedOut ? 0 : raced, inProgress: timedOut }
  } finally {
    if (timer) clearTimeout(timer)
  }
}
