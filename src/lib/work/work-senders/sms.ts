import type { Sender, SenderOutcome } from '../sends'
import type { SenderDeps } from './index'
import { infobipSendRaw, type InfobipRawResult } from '@/lib/call/sms/infobip'
import { getManagedInfobip } from '../sms-managed'

const SENT = new Set(['PENDING', 'DELIVERED'])
const REFUSED_GROUP = new Set(['REJECTED', 'UNDELIVERABLE', 'EXPIRED'])
const REFUSED_HTTP = new Set([400, 401, 403, 404, 429])

export function smsOutcome(raw: InfobipRawResult): SenderOutcome {
  if (raw.kind === 'error') return { status: 'unknown', code: raw.timeout ? 'TIMEOUT' : 'NO_RESPONSE', detail: raw.message }
  const st = raw.httpStatus
  const j = raw.json as { messages?: Array<{ messageId?: unknown; status?: { groupName?: unknown; name?: unknown; description?: unknown } }>; requestError?: { serviceException?: { text?: unknown; messageId?: unknown } } } | null
  if (st >= 200 && st < 300) {
    const m = Array.isArray(j?.messages) ? j!.messages![0] : undefined
    const g = typeof m?.status?.groupName === 'string' ? m.status.groupName : null
    const detail = JSON.stringify({ messageId: typeof m?.messageId === 'string' ? m.messageId.slice(0, 80) : null, status: typeof m?.status?.name === 'string' ? m.status.name.slice(0, 60) : null, group: g })
    if (g && SENT.has(g)) return { status: 'sent', detail }
    if (g && REFUSED_GROUP.has(g)) return { status: 'failed', code: `IB_${g}`, detail }
    return { status: 'unknown', code: 'BAD_RESPONSE', detail }
  }
  const svc = j?.requestError?.serviceException
  const detail = (typeof svc?.text === 'string' ? svc.text : typeof svc?.messageId === 'string' ? svc.messageId : `HTTP ${st}`).slice(0, 300)
  if (REFUSED_HTTP.has(st)) return { status: 'failed', code: `HTTP_${st}`, detail }
  return { status: 'unknown', code: `HTTP_${st}`, detail }
}

export function smsSender(d: SenderDeps): Sender {
  const config = () => (d.transport.smsConfig ? d.transport.smsConfig() : getManagedInfobip(d.db))
  return {
    async ready() {
      return !!(await config())
    },
    async send(input) {
      const to = input.payload.to?.[0]
      const text = input.payload.text
      if (!to || !text || !input.sendId) return { status: 'refused', code: 'RECIPIENT_EMPTY' }
      const c = await config().catch(() => null)
      if (!c) return { status: 'refused', code: 'NOT_AVAILABLE' }
      return smsOutcome(await infobipSendRaw(c, to, text, input.sendId, d.transport.fetch))
    },
  }
}
