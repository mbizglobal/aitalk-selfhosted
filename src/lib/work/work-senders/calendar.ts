
import type { Sender, SenderOutcome } from '../sends'
import { HOOK_TIMEOUT_MS, outcomeOfError, type SenderDeps } from './index'

const G = 'https://www.googleapis.com/calendar/v3/calendars'
const M = 'https://graph.microsoft.com/v1.0/me'

const cut = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : null)
const done = (code: string | undefined, j: Record<string, unknown>, link: unknown): SenderOutcome => ({
  status: 'sent',
  ...(code ? { code } : {}),
  detail: JSON.stringify({ id: cut(j.id, 300), link: cut(link, 600), start: cut((j.start as { dateTime?: string; date?: string } | undefined)?.dateTime ?? (j.start as { date?: string } | undefined)?.date, 40), title: cut(typeof j.summary === 'string' ? j.summary : j.subject, 200) }),
})

function outcomeOf(status: number, detail: string): SenderOutcome {
  if (status === 429) return { status: 'unknown', code: 'HTTP_429', detail }
  if (status >= 400 && status < 500) return { status: 'failed', code: `HTTP_${status}`, detail }
  return { status: 'unknown', code: `HTTP_${status}`, detail }
}

const errText = (j: unknown, raw: string) => {
  const e = (j as { error?: { message?: unknown } } | null)?.error
  return typeof e?.message === 'string' ? e.message.slice(0, 300) : raw.slice(0, 300)
}

export function calendarSender(d: SenderDeps): Sender {
  return {
    async send(input) {
      const p = input.payload
      if (!p.cal || !p.event || !p.eventKey) return { status: 'refused', code: 'RECIPIENT_EMPTY' }
      const w = await d.db.workflow.findFirst({ where: { workflowId: input.workflowId, agent: { userId: input.userId } }, select: { agentId: true } })
      const { calendarOwnedNow } = await import('../assembled-calendar')
      const owned = w ? await calendarOwnedNow(d.db, input.userId, w.agentId, p.cal) : null
      if (!owned || owned.provider !== p.cal.provider) return { status: 'refused', code: 'NO_CONNECTION' }
      let token: string
      try {
        token = owned.provider === 'google'
          ? await (await import('@/lib/google/access-token')).getCalendarAccountAccessToken(d.db as never, owned.accountId)
          : await (await import('@/lib/microsoft/access-token')).getMicrosoftCalendarAccountAccessToken(d.db as never, owned.accountId)
      } catch (e) {
        const code = (e as { code?: string })?.code === 'reconnect_required' ? 'RECONNECT' : 'TOKEN_FAILED'
        return { status: 'refused', code, detail: e instanceof Error ? e.message.slice(0, 200) : 'token' }
      }
      const ev = p.event
      const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
      const when = ev.allDay
        ? { start: { date: ev.start }, end: { date: ev.end } }
        : { start: { dateTime: ev.start, timeZone: ev.timeZone }, end: { dateTime: ev.end, timeZone: ev.timeZone } }
      try {
        if (owned.provider === 'google') {
          const base = `${G}/${encodeURIComponent(owned.calendarId)}/events`
          const res = await d.transport.fetch(`${base}?sendUpdates=none`, { method: 'POST', headers, body: JSON.stringify({ id: p.eventKey, summary: ev.title, description: ev.description, ...when }), signal: AbortSignal.timeout(HOOK_TIMEOUT_MS) })
          const raw = await res.text().catch(() => '')
          let j: Record<string, unknown> = {}
          try { j = JSON.parse(raw) } catch { j = {} }
          if (res.status >= 200 && res.status < 300) return done(undefined, j, j.htmlLink)
          if (res.status !== 409) return outcomeOf(res.status, errText(j, raw))
          const g = await d.transport.fetch(`${base}/${encodeURIComponent(p.eventKey)}`, { method: 'GET', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(HOOK_TIMEOUT_MS) })
          const graw = await g.text().catch(() => '')
          let gj: Record<string, unknown> = {}
          try { gj = JSON.parse(graw) } catch { gj = {} }
          if (!g.ok) return { status: 'unknown', code: 'EXISTS_UNREADABLE', detail: errText(gj, graw) }
          if (gj.status === 'cancelled') return { status: 'failed', code: 'DELETED_IN_CALENDAR', detail: 'the event with this key was deleted in the calendar' }
          return done('ALREADY_EXISTS', gj, gj.htmlLink)
        }
        const url = owned.calendarId === 'primary' ? `${M}/events` : `${M}/calendars/${encodeURIComponent(owned.calendarId)}/events`
        const body = {
          subject: ev.title,
          body: { contentType: 'text', content: ev.description },
          transactionId: p.eventKey,
          ...(ev.allDay
            ? { isAllDay: true, start: { dateTime: `${ev.start}T00:00:00`, timeZone: ev.timeZone }, end: { dateTime: `${ev.end}T00:00:00`, timeZone: ev.timeZone } }
            : when),
        }
        const res = await d.transport.fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(HOOK_TIMEOUT_MS) })
        const raw = await res.text().catch(() => '')
        let j: Record<string, unknown> = {}
        try { j = JSON.parse(raw) } catch { j = {} }
        if (res.status >= 200 && res.status < 300) return done(undefined, j, j.webLink)
        return outcomeOf(res.status, errText(j, raw))
      } catch (e) {
        return outcomeOfError(e)
      }
    },
  }
}
