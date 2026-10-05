import type { PrismaClient } from '@prisma/client'
import { loadFcmConfig, getAccessToken, sendToToken } from '@/lib/miniapp/push'

const PUSH_TIMEOUT_MS = 3000

const TITLE_BY_KIND: Record<'book' | 'reschedule' | 'cancel', string> = {
  book: 'New booking',
  reschedule: 'Booking updated',
  cancel: 'Booking cancelled',
}

function formatLocalTime(startIso?: string, timezone?: string): string | undefined {
  if (!startIso) return undefined
  const d = new Date(startIso)
  if (Number.isNaN(d.getTime())) return undefined
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: timezone || 'UTC',
    }).format(d)
  } catch {
    return undefined
  }
}

function bounded(op: Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms)
  })
  return Promise.race([op.finally(() => clearTimeout(timer)), timeout])
}

export async function sendBookingPush(
  prisma: PrismaClient,
  ownerUserId: string,
  kind: 'book' | 'reschedule' | 'cancel',
  info: { name?: string; startIso?: string; timezone?: string }
): Promise<void> {
  const work = (async () => {
    try {
      if (!ownerUserId) return

      const sa = await loadFcmConfig()
      if (!sa) return

      const tokens = await prisma.appPushToken.findMany({
        where: { userId: ownerUserId, enabled: true },
        select: { id: true, token: true },
      })
      if (tokens.length === 0) return

      const title = TITLE_BY_KIND[kind]
      const time = formatLocalTime(info.startIso, info.timezone)
      const nameTrim = info.name?.trim()
      const name = nameTrim ? Array.from(nameTrim).slice(0, 80).join('') : undefined
      let body: string
      if (name && time) body = `${name} · ${time}`
      else if (name) body = name
      else if (time) body = time
      else body = 'Tap to view the calendar'

      const data: Record<string, string> = {
        type: 'booking',
        kind,
        link: 'aitalk://booking/calendar',
      }

      const accessToken = await getAccessToken(sa)
      for (const t of tokens) {
        try {
          const result = await sendToToken(sa, accessToken, t.token, { title, body }, data, {
            channelId: 'booking',
            icon: 'ic_stat_booking',
            tag: 'booking',
          })
          if (result.status === 'invalid_token') {
            await prisma.appPushToken.update({ where: { id: t.id }, data: { enabled: false } }).catch(() => {})
          }
        } catch {
        }
      }
    } catch {
    }
  })()

  await bounded(work, PUSH_TIMEOUT_MS)
}
