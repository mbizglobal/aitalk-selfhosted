
import type { PrismaClient, WorkflowConnectionProvider } from '@prisma/client'
import { agentScopedWhere } from '@/lib/connection-scope'
import { appStartSettings } from '../app-chat'
import type { Sender, SenderOutcome, Senders, SendKind } from '../sends'
import { emailSender } from './email'
import { telegramSender } from './telegram'
import { httpSender } from './http'
import { calendarSender } from './calendar'
import { smsSender } from './sms'
import { databaseSender } from './database'
import { aiSqlSender } from '../ai-sql'
import type { CompanyDbDeps } from '../company-db'

export interface SmtpInfo { accepted?: unknown[]; rejected?: unknown[]; messageId?: string }
export interface SmtpTransport { sendMail(opts: Record<string, unknown>): Promise<SmtpInfo> }

export interface SenderTransport {
  fetch: (url: string, init: RequestInit) => Promise<Response>
  httpFetch: (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }, maxRedirects: number) => Promise<Response>
  smtp: (config: Record<string, unknown>) => SmtpTransport
  mailAddress: (host: string) => Promise<{ host: string; servername?: string }>
  smsConfig?: () => Promise<import('../sms-managed').ManagedInfobip | null>
}

export const MAIL_TIMEOUT_MS = 30_000
export const HOOK_TIMEOUT_MS = 20_000

export interface ResolvedConnection {
  id: string
  label: string | null
  userId: string
  provider: WorkflowConnectionProvider
  authType: string
  encryptedToken: string | null
  refreshToken: string | null
  tokenExpiresAt: Date | null
  serviceConfig: string | null
}

const CONNECTION_KIND: Partial<Record<SendKind, string>> = { email: 'email', telegram: 'telegram', http: 'http' }
const PROVIDERS: Partial<Record<SendKind, WorkflowConnectionProvider[]>> = {
  email: ['sendgrid', 'smtp'],
  telegram: ['telegram'],
  http: ['http_request'],
}

export async function resolveSlotConnection(db: PrismaClient, input: { userId: string; workflowId: string; kind: SendKind; slot: string }): Promise<ResolvedConnection | null> {
  const providers = PROVIDERS[input.kind]
  const connKind = CONNECTION_KIND[input.kind]
  if (!providers || !connKind) return null
  const w = await db.workflow.findFirst({ where: { workflowId: input.workflowId, agent: { userId: input.userId } }, select: { agentId: true, workflowJson: true } })
  if (!w) return null
  const id = appStartSettings(w.workflowJson).connections[connKind]?.[input.slot]
  if (!id) return null
  return db.workflowConnection.findFirst({
    where: { id, ...agentScopedWhere({ agentId: w.agentId, userId: input.userId }, 'Work app send'), provider: { in: providers }, status: 'active' },
    select: { id: true, label: true, userId: true, provider: true, authType: true, encryptedToken: true, refreshToken: true, tokenExpiresAt: true, serviceConfig: true },
  })
}

export function parseServiceConfig(raw: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const v = JSON.parse(raw)
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch {
    return {}
  }
}

export function outcomeOfStatus(status: number, detail: string): SenderOutcome {
  if (status >= 200 && status < 300) return { status: 'sent', detail }
  if (status >= 400 && status < 500) return { status: 'failed', code: `HTTP_${status}`, detail }
  return { status: 'unknown', code: `HTTP_${status}`, detail }
}

export function outcomeOfError(e: unknown): SenderOutcome {
  const err = e as { name?: string; code?: string; message?: string }
  const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError' || err?.code === 'ETIMEDOUT'
  return { status: 'unknown', code: timeout ? 'TIMEOUT' : 'NO_RESPONSE', detail: String(err?.message ?? 'error').slice(0, 300) }
}

export async function bodySnippet(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300)
  } catch {
    return ''
  }
}

export interface SenderDeps {
  db: PrismaClient
  transport: SenderTransport
}

async function defaultTransport(): Promise<SenderTransport> {
  const { safeFetch } = await import('@/lib/ssrfGuard')
  const nodemailer = (await import('nodemailer')).default
  const { mailConnectTarget } = await import('@/lib/edition-connect')
  return {
    fetch: (url, init) => fetch(url, init),
    httpFetch: (url, init, maxRedirects) => safeFetch(url, init, maxRedirects),
    smtp: (config) => nodemailer.createTransport(config as never) as unknown as SmtpTransport,
    mailAddress: (host) => mailConnectTarget(host),
  }
}

export function createWorkSenders(db: PrismaClient, transport?: Partial<SenderTransport>, companyDb?: CompanyDbDeps): Senders {
  let ready: Promise<SenderDeps> | null = null
  const deps = () => (ready ??= defaultTransport().then((t) => ({ db, transport: { ...t, ...transport } })))
  const lazy = (make: (d: SenderDeps) => Sender): Sender => ({
    async send(input) {
      try {
        return await make(await deps()).send(input)
      } catch (e) {
        console.error('[work-send] 보내기 준비 실패:', e instanceof Error ? e.message.slice(0, 200) : 'error')
        return { status: 'refused', code: 'PREPARE_FAILED', detail: e instanceof Error ? e.message.slice(0, 300) : 'error' }
      }
    },
  })
  return {
    email: lazy(emailSender),
    telegram: lazy(telegramSender),
    http: lazy(httpSender),
    calendar: lazy(calendarSender),
    sms: { send: (input) => lazy(smsSender).send(input), ready: async () => smsSender(await deps()).ready!() },
    db_write: databaseSender(db, companyDb),
    db_sql: aiSqlSender(db, { companyDb }),
  }
}
