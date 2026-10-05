import type { PrismaClient } from '@prisma/client'

type Provider = 'google' | 'microsoft'

const WRITE_TIMEOUT_MS = 1500

function toDate(iso: string | undefined | null): Date | null {
  if (!iso || typeof iso !== 'string') return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

function bounded(op: Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms)
  })
  return Promise.race([op.finally(() => clearTimeout(timer)), timeout])
}

export async function recordBookingCreated(
  prisma: PrismaClient,
  params: {
    userId: string
    agentId: string
    accountId: string
    provider: Provider
    calendarId: string
    externalEventId: string
    startIso: string | undefined
    endIso: string | undefined
  }
): Promise<void> {
  const { userId, agentId, accountId, provider, calendarId, externalEventId } = params
  const startAt = toDate(params.startIso)
  if (!userId || !accountId || !externalEventId || !startAt) return
  const endAt = toDate(params.endIso) ?? startAt
  const op = prisma.bookingIndex
    .upsert({
      where: { accountId_calendarId_externalEventId: { accountId, calendarId, externalEventId } },
      create: { userId, agentId, accountId, provider, calendarId, externalEventId, startAt, endAt, status: 'confirmed' },
      update: { startAt, endAt, status: 'confirmed', cancelledAt: null },
    })
    .then(() => {})
    .catch((e) => console.error('[BookingIndex] create failed', e))
  await bounded(op, WRITE_TIMEOUT_MS)
}

export async function recordBookingRescheduled(
  prisma: PrismaClient,
  params: { accountId: string; calendarId: string; externalEventId: string; startIso: string | undefined; endIso: string | undefined }
): Promise<void> {
  const { accountId, calendarId, externalEventId } = params
  const startAt = toDate(params.startIso)
  if (!accountId || !externalEventId || !startAt) return
  const endAt = toDate(params.endIso) ?? startAt
  const op = prisma.bookingIndex
    .updateMany({
      where: { accountId, calendarId, externalEventId },
      data: { startAt, endAt, status: 'confirmed', cancelledAt: null },
    })
    .then(() => {})
    .catch((e) => console.error('[BookingIndex] reschedule failed', e))
  await bounded(op, WRITE_TIMEOUT_MS)
}

export async function recordBookingCancelled(
  prisma: PrismaClient,
  params: { accountId: string; calendarId: string; externalEventId: string }
): Promise<void> {
  const { accountId, calendarId, externalEventId } = params
  if (!accountId || !externalEventId) return
  const op = prisma.bookingIndex
    .updateMany({
      where: { accountId, calendarId, externalEventId },
      data: { status: 'cancelled', cancelledAt: new Date() },
    })
    .then(() => {})
    .catch((e) => console.error('[BookingIndex] cancel failed', e))
  await bounded(op, WRITE_TIMEOUT_MS)
}
