
import { brandEmail, getInstallationBrand } from '@/lib/brand'
import nodemailer from 'nodemailer'
import { maskEmail } from '@/lib/log-mask'
import { isSelfHosted } from '@/lib/edition'
import { VENDOR_OPS_REPORT_TO, VENDOR_ADDRESSES as VENDOR_ADDRESSES_LIST } from './vendor-contacts'

export interface MailData {
  to: string
  subject: string
  html: string
  from?: string
  bcc?: string
}

export interface MailResult {
  success: boolean
  messageId?: string
  error?: string
}

const HOSTPOINT_DOMAINS = new Set([
  'gmx.de', 'gmx.net', 'gmx.ch', 'gmx.at', 'gmx.com', 'web.de', 'mail.com',
  'icloud.com', 'me.com', 'mac.com',
  // Deutsche Telekom
  't-online.de',
  'bluewin.ch', 'hispeed.ch', 'sunrise.ch',
  'yahoo.com', 'aol.com', 'freenet.de',
  'naver.com', 'daum.net', 'hanmail.net', 'kakao.com',
])

const OPS_REPORT_TO = VENDOR_OPS_REPORT_TO

export function isHostpointRecipient(to: string): boolean {
  if (typeof to !== 'string') return false
  const domain = to.slice(to.lastIndexOf('@') + 1).trim().toLowerCase()
  return HOSTPOINT_DOMAINS.has(domain)
}

const RESERVED_DOMAINS = ['example.com', 'example.net', 'example.org']
const RESERVED_TLDS = ['example', 'test', 'invalid', 'localhost']

export function isReservedRecipient(to: string): boolean {
  if (typeof to !== 'string' || !to.includes('@')) return false
  const domain = to.slice(to.lastIndexOf('@') + 1).trim().toLowerCase().replace(/\.+$/, '')
  if (RESERVED_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) return true
  return RESERVED_TLDS.includes(domain.slice(domain.lastIndexOf('.') + 1))
}

let transport: nodemailer.Transporter | null = null

function getHostpointTransport(): nodemailer.Transporter | null {
  if (transport) return transport
  const host = process.env.HOSTPOINT_SMTP_HOST
  const user = process.env.HOSTPOINT_SMTP_USER
  const pass = process.env.HOSTPOINT_SMTP_PASSWORD
  if (!host || !user || !pass) return null
  transport = nodemailer.createTransport({
    host,
    port: parseInt(process.env.HOSTPOINT_SMTP_PORT || '587', 10),
    secure: false,
    requireTLS: true,
    auth: { user, pass },
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 30_000,
  })
  return transport
}

async function sendViaHostpoint(data: MailData, defaultFrom: string): Promise<MailResult> {
  const t = getHostpointTransport()
  if (!t) return { success: false, error: 'Hostpoint SMTP not configured' }
  try {
    const info = await t.sendMail({
      from: `AI Talk <${data.from || defaultFrom}>`,
      to: data.to,
      ...(data.bcc && { bcc: data.bcc }),
      subject: data.subject,
      html: data.html,
    })
    const rejected = (info.rejected || []).map((r: string | { address: string }) => (typeof r === 'string' ? r : r.address).trim().toLowerCase())
    if (rejected.includes(data.to.trim().toLowerCase())) {
      return { success: false, error: `recipient rejected: ${info.response}` }
    }
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

const VENDOR_ADDRESSES = VENDOR_ADDRESSES_LIST

let smtpCache: { sig: string; transport: nodemailer.Transporter } | null = null

const smtpValue = (v: string | undefined) => v?.trim() || undefined

function getCompanySmtpTransport(env: Record<string, string | undefined>): nodemailer.Transporter | null {
  const host = smtpValue(env.SMTP_HOST)
  if (!host) return null
  const secure = env.SMTP_SECURE === 'true'
  const port = parseInt(env.SMTP_PORT || (secure ? '465' : '587'), 10)
  const user = env.SMTP_USER
  const sig = [host, port, secure, user ?? '', env.SMTP_PASSWORD ?? ''].join('|')
  if (smtpCache?.sig === sig) return smtpCache.transport
  const t = nodemailer.createTransport({
    host,
    port,
    secure,
    ...(user && { auth: { user, pass: env.SMTP_PASSWORD ?? '' } }),
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 30_000,
  })
  smtpCache = { sig, transport: t }
  return t
}

async function sendViaCompanySmtp(data: MailData, env: Record<string, string | undefined>): Promise<MailResult> {
  const from = smtpValue(env.SMTP_FROM)
  const t = getCompanySmtpTransport(env)
  if (!t || !from) return { success: false, error: 'SMTP not configured (SMTP_HOST and SMTP_FROM are required)' }
  try {
    const info = await t.sendMail({
      from: env.SMTP_FROM_NAME ? { name: env.SMTP_FROM_NAME, address: from } : from,
      to: data.to,
      subject: data.subject,
      html: data.html,
    })
    const rejected = (info.rejected || []).map((r: string | { address: string }) => (typeof r === 'string' ? r : r.address).trim().toLowerCase())
    if (rejected.includes(data.to.trim().toLowerCase())) {
      return { success: false, error: `recipient rejected: ${info.response}` }
    }
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

const isVendorAddress = (to: unknown) => typeof to === 'string' && VENDOR_ADDRESSES.has(to.trim().toLowerCase())

async function sendSelfHosted(data: MailData, env: Record<string, string | undefined>): Promise<MailResult> {
  if (isVendorAddress(data.to)) {
    console.log(`[email] self-hosted: skipped vendor address ${maskEmail(data.to)}`)
    return { success: true }
  }
  if (!smtpValue(env.SMTP_HOST) || !smtpValue(env.SMTP_FROM)) {
    const r = { success: false, error: 'SMTP not configured (SMTP_HOST and SMTP_FROM are required)' }
    console.error(`[email] SMTP send failed to ${maskEmail(data.to)}: ${r.error}`)
    return r
  }
  if (isReservedRecipient(data.to)) {
    console.log(`[email] skipped reserved test address ${maskEmail(data.to)}`)
    return { success: true }
  }
  const brand = getInstallationBrand(env)
  data = { ...data, ...brandEmail({ subject: data.subject, html: data.html }, brand) }
  const r = await sendViaCompanySmtp(data, env)
  if (r.success) return r
  console.error(`[email] SMTP send failed to ${maskEmail(data.to)}: ${r.error}`)

  const reportTo = env.SMTP_OPS_REPORT_TO
  if (reportTo && !isVendorAddress(reportTo) && reportTo.trim().toLowerCase() !== String(data.to).trim().toLowerCase()) {
    void sendViaCompanySmtp({
      to: reportTo,
      subject: `[${brand.productName}] Email delivery failed`,
      html:
        `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111">` +
        `<p>An email could not be sent through the company SMTP server.</p>` +
        `<table style="border-collapse:collapse">` +
        `<tr><td style="padding:4px 12px 4px 0;color:#666">To</td><td>${escapeHtml(maskEmail(data.to))}</td></tr>` +
        `<tr><td style="padding:4px 12px 4px 0;color:#666">Subject</td><td>${escapeHtml(String(data.subject).slice(0, 200))}</td></tr>` +
        `<tr><td style="padding:4px 12px 4px 0;color:#666">Error</td><td style="font-family:monospace">${escapeHtml((r.error || '').slice(0, 1000))}</td></tr>` +
        `</table></div>`,
    }, env).then(
      (report) => { if (!report.success) console.error(`[email] ops report failed: ${report.error}`) },
      (err) => console.error(`[email] ops report failed: ${err instanceof Error ? err.message : String(err)}`),
    )
  }
  return r
}

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export async function sendRoutedEmail(
  data: MailData,
  defaultFrom: string,
  sendViaAcs: (d: MailData) => Promise<MailResult>,
  env: Record<string, string | undefined> = process.env,
): Promise<MailResult> {
  if (isSelfHosted(env)) return sendSelfHosted(data, env)

  if (isReservedRecipient(data.to)) {
    console.log(`[email] skipped reserved test address ${maskEmail(data.to)}`)
    return { success: true }
  }

  if (!isHostpointRecipient(data.to)) {
    const r = await sendViaAcs(data)
    if (!r.success) console.error(`[email] ACS send failed to ${maskEmail(data.to)}: ${r.error}`)
    return r
  }

  const hp = await sendViaHostpoint(data, defaultFrom)
  if (hp.success) return hp

  console.error(`[email] Hostpoint send failed to ${maskEmail(data.to)} — falling back to ACS: ${hp.error}`)
  const acs = await sendViaAcs(data)
  if (!acs.success) console.error(`[email] ACS fallback failed to ${maskEmail(data.to)}: ${acs.error}`)

  void sendViaAcs({
    to: OPS_REPORT_TO,
    subject: `[AiTalk Ops] Hostpoint 메일 발송 실패 → Azure 재발송 ${acs.success ? '접수' : '실패'}`,
    from: defaultFrom,
    html:
      `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111">` +
      `<p>Hostpoint SMTP 발송이 실패했거나 결과를 알 수 없어(연결 끊김 등) Azure(ACS)로 다시 보냈습니다. ` +
      `결과를 알 수 없던 경우라면 고객이 두 통을 받을 수 있습니다.</p>` +
      `<table style="border-collapse:collapse">` +
      `<tr><td style="padding:4px 12px 4px 0;color:#666">받는 사람</td><td>${escapeHtml(maskEmail(data.to))}</td></tr>` +
      `<tr><td style="padding:4px 12px 4px 0;color:#666">메일 제목</td><td>${escapeHtml(data.subject.slice(0, 200))}</td></tr>` +
      `<tr><td style="padding:4px 12px 4px 0;color:#666">Hostpoint 에러</td><td style="font-family:monospace">${escapeHtml((hp.error || '').slice(0, 1000))}</td></tr>` +
      `<tr><td style="padding:4px 12px 4px 0;color:#666">Azure 재발송</td><td>${acs.success ? '성공(ACS 접수)' : escapeHtml(`실패: ${(acs.error || '').slice(0, 500)}`)}</td></tr>` +
      `</table>` +
      `<p style="color:#888;font-size:12px">Azure 재발송이 「성공」이어도 GMX·iCloud 등은 실제로 안 들어갈 수 있습니다. 본문은 인증 링크가 들어 있을 수 있어 싣지 않습니다.</p>` +
      `</div>`,
  }).then(
    (report) => { if (!report.success) console.error(`[email] ops report failed: ${report.error}`) },
    (err) => console.error(`[email] ops report failed: ${err instanceof Error ? err.message : String(err)}`),
  )

  return acs
}
