
import { getConnectionSecret } from '@/lib/secret-vault'
import type { Sender } from '../sends'
import { HOOK_TIMEOUT_MS, outcomeOfError, outcomeOfStatus, resolveSlotConnection, type SenderDeps } from './index'

export function telegramSender(d: SenderDeps): Sender {
  return {
    async send(input) {
      const conn = await resolveSlotConnection(d.db, input)
      if (!conn?.encryptedToken) return { status: 'refused', code: 'NO_CONNECTION' }
      const token = await getConnectionSecret(d.db, conn.userId, conn.id, conn.encryptedToken)
      const text = input.payload.text ?? (input.payload.json === undefined ? '' : JSON.stringify(input.payload.json, null, 2))
      const body = [input.payload.subject, text].filter(Boolean).join('\n\n').slice(0, 4096)
      try {
        const res = await d.transport.fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: input.payload.to?.[0], text: body || ' ' }),
          signal: AbortSignal.timeout(HOOK_TIMEOUT_MS),
        })
        const raw = await res.text().catch(() => '')
        let json: { ok?: unknown; description?: unknown } | null = null
        try { json = JSON.parse(raw) } catch { json = null }
        const detail = typeof json?.description === 'string' ? json.description.slice(0, 300) : raw.slice(0, 300)
        if (res.status >= 200 && res.status < 300 && json?.ok !== true) return { status: 'unknown', code: 'BAD_RESPONSE', detail }
        return outcomeOfStatus(res.status, detail)
      } catch (e) {
        return outcomeOfError(e)
      }
    },
  }
}
