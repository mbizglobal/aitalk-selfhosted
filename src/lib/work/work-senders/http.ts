
import { getConnectionSecret } from '@/lib/secret-vault'
import { SSRFError, DnsLookupError } from '@/lib/ssrfGuard'
import type { Sender } from '../sends'
import { RESERVED_HEADERS, httpSlotLabel } from '../http-target'
import { bodySnippet, HOOK_TIMEOUT_MS, outcomeOfError, outcomeOfStatus, resolveSlotConnection, type SenderDeps } from './index'

export function authHeaders(cred: Record<string, unknown>): Record<string, string> | null {
  const str = (k: string) => (typeof cred[k] === 'string' ? (cred[k] as string) : '')
  switch (cred.authType ?? 'none') {
    case 'none':
      return {}
    case 'apiKey': {
      const name = str('authHeaderName') || 'Authorization'
      if (!str('authHeaderValue').trim() || RESERVED_HEADERS.has(name.toLowerCase())) return null
      return { [name]: str('authHeaderValue') }
    }
    case 'bearer':
      return str('bearerToken').trim() ? { Authorization: `Bearer ${str('bearerToken')}` } : null
    case 'basic':
      return str('basicUser').trim() ? { Authorization: `Basic ${Buffer.from(`${str('basicUser')}:${str('basicPassword')}`).toString('base64')}` } : null
    default:
      return null
  }
}

export function httpSender(d: SenderDeps): Sender {
  return {
    async send(input) {
      const conn = await resolveSlotConnection(d.db, input)
      if (!conn) return { status: 'refused', code: 'NO_CONNECTION' }
      if (input.payload.toHttpSlot) {
        const w = await d.db.workflow.findFirst({ where: { workflowId: input.workflowId, agent: { userId: input.userId } }, select: { workflowJson: true } })
        const { appStartSettings } = await import('../app-chat')
        const start = w ? appStartSettings(w.workflowJson).startNodeId : null
        if (!start || conn.label !== httpSlotLabel(start, input.slot)) return { status: 'refused', code: 'NO_CONNECTION' }
      }
      let cred: Record<string, unknown> = {}
      if (conn.encryptedToken) {
        try {
          const v = JSON.parse(await getConnectionSecret(d.db, conn.userId, conn.id, conn.encryptedToken))
          if (v && typeof v === 'object') cred = v
        } catch {
          return { status: 'refused', code: 'NO_CONNECTION' }
        }
      }
      const auth = authHeaders(cred)
      if (!auth) return { status: 'refused', code: 'AUTH_UNSUPPORTED' }
      const body = JSON.stringify(input.payload.json !== undefined ? input.payload.json : { subject: input.payload.subject, text: input.payload.text })
      let res: Response
      try {
        res = await d.transport.httpFetch(input.payload.to![0], {
          method: 'POST',
          headers: { ...auth, 'Content-Type': 'application/json', ...(input.payload.idemKey ? { 'Idempotency-Key': input.payload.idemKey } : {}) },
          body,
          signal: AbortSignal.timeout(HOOK_TIMEOUT_MS),
        }, 0)
      } catch (e) {
        if (e instanceof SSRFError || e instanceof DnsLookupError) return { status: 'refused', code: 'BLOCKED_ADDRESS' }
        if (e instanceof Error && e.message.startsWith('Too many redirects')) return { status: 'failed', code: 'REDIRECT_REFUSED' }
        return outcomeOfError(e)
      }
      if (res.status >= 300 && res.status < 400) {
        res.body?.cancel().catch(() => {})
        return { status: 'failed', code: 'REDIRECT_REFUSED', detail: `HTTP ${res.status}` }
      }
      return outcomeOfStatus(res.status, await bodySnippet(res))
    },
  }
}
