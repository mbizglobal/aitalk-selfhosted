
import { getConnectionSecret } from '@/lib/secret-vault'
import { DnsLookupError, SSRFError } from '@/lib/ssrfGuard'
import type { Sender, SenderOutcome } from '../sends'
import { bodySnippet, MAIL_TIMEOUT_MS, outcomeOfError, outcomeOfStatus, parseServiceConfig, resolveSlotConnection, type SenderDeps, type SmtpInfo } from './index'

export function emailSender(d: SenderDeps): Sender {
  return {
    async send(input) {
      const conn = await resolveSlotConnection(d.db, input)
      if (!conn?.encryptedToken) return { status: 'refused', code: 'NO_CONNECTION' }
      const to = input.payload.to ?? []
      const subject = input.payload.subject ?? ''
      const text = input.payload.text ?? (input.payload.json === undefined ? '' : JSON.stringify(input.payload.json, null, 2))
      const cfg = parseServiceConfig(conn.serviceConfig)

      if (conn.provider === 'sendgrid') {
        const from = typeof cfg.fromEmail === 'string' ? cfg.fromEmail.trim() : ''
        if (!from) return { status: 'refused', code: 'NO_FROM_ADDRESS' }
        const fromName = typeof cfg.fromName === 'string' && cfg.fromName.trim() ? cfg.fromName.trim() : undefined
        const apiKey = await getConnectionSecret(d.db, conn.userId, conn.id, conn.encryptedToken)
        try {
          const res = await d.transport.fetch('https://api.sendgrid.com/v3/mail/send', {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              personalizations: [{ to: to.map((email) => ({ email })), subject: subject || '(no subject)' }],
              from: { email: from, ...(fromName ? { name: fromName } : {}) },
              content: [{ type: 'text/plain', value: text || ' ' }],
              ...(input.files.length ? { attachments: input.files.map((f) => ({ content: f.buffer.toString('base64'), filename: f.originalName, type: f.mimeType, disposition: 'attachment' })) } : {}),
            }),
            signal: AbortSignal.timeout(MAIL_TIMEOUT_MS),
          })
          return outcomeOfStatus(res.status, await bodySnippet(res))
        } catch (e) {
          return outcomeOfError(e)
        }
      }

      const host = typeof cfg.host === 'string' ? cfg.host : ''
      const port = Number(cfg.port)
      const user = typeof cfg.user === 'string' ? cfg.user : ''
      const email = typeof cfg.email === 'string' && cfg.email ? cfg.email : user
      if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !email) return { status: 'refused', code: 'NO_CONNECTION' }
      let auth: Record<string, unknown>
      if (conn.authType === 'oauth') {
        const { getValidAccessToken } = await import('@/lib/email/microsoft-oauth')
        auth = { type: 'OAuth2', user: email, accessToken: await getValidAccessToken(conn as never, d.db) }
      } else {
        auth = { user, pass: await getConnectionSecret(d.db, conn.userId, conn.id, conn.encryptedToken, conn.authType) }
      }
      let target: { host: string; servername?: string }
      try {
        target = await d.transport.mailAddress(host)
      } catch (e) {
        if (e instanceof SSRFError) return { status: 'refused', code: 'BLOCKED_ADDRESS', detail: String(e.message).slice(0, 300) }
        if (e instanceof DnsLookupError) return { status: 'failed', code: 'EDNS', detail: String(e.message).slice(0, 300) }
        throw e
      }
      const transport = d.transport.smtp({
        ...target, port, secure: typeof cfg.secure === 'boolean' ? cfg.secure : port === 465, auth,
        connectionTimeout: MAIL_TIMEOUT_MS, greetingTimeout: MAIL_TIMEOUT_MS, socketTimeout: MAIL_TIMEOUT_MS,
      })
      try {
        const info = await transport.sendMail({
          from: email, to: to.join(', '), subject, text,
          ...(input.files.length ? { attachments: input.files.map((f) => ({ filename: f.originalName, content: f.buffer, contentType: f.mimeType })) } : {}),
        })
        return smtpOutcome(info)
      } catch (e) {
        return smtpErrorOutcome(e)
      }
    },
  }
}

export function smtpOutcome(info: SmtpInfo): SenderOutcome {
  const accepted = info.accepted?.length ?? 0
  const rejected = info.rejected?.length ?? 0
  if (!accepted && rejected) return { status: 'failed', code: 'SMTP_REJECTED', detail: `rejected ${rejected}` }
  if (!accepted) return { status: 'unknown', code: 'BAD_RESPONSE', detail: 'no accepted recipient in the answer' }
  return { status: 'sent', detail: rejected ? `accepted ${accepted} · rejected ${rejected}` : info.messageId?.slice(0, 200) }
}

export function smtpErrorOutcome(e: unknown): SenderOutcome {
  const err = e as { code?: string; responseCode?: number; message?: string }
  const detail = String(err?.message ?? 'error').slice(0, 300)
  if (typeof err?.responseCode === 'number' && err.responseCode >= 400) return { status: 'failed', code: `SMTP_${err.responseCode}`, detail }
  if (err?.code === 'EAUTH' || err?.code === 'ECONNREFUSED' || err?.code === 'EDNS' || err?.code === 'ENOTFOUND') return { status: 'failed', code: err.code, detail }
  return outcomeOfError(e)
}
