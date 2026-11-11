import { isIP } from 'node:net'
import { DnsLookupError, resolveConnectAddress, SSRFError } from '@/lib/ssrfGuard'
import { VENDOR_SERVER_IP } from '@/lib/vendor-network'

export async function resolveEditionAddress(host: string): Promise<string> {
  const { isSelfHosted } = await import('@/lib/edition')
  if (isSelfHosted()) return resolveConnectAddress(host, { allowPrivate: true })
  if (!VENDOR_SERVER_IP) throw new SSRFError('(cloud edition)', '', 'server address missing')
  const deny = [VENDOR_SERVER_IP]
  try {
    const appDb = new URL(process.env.DATABASE_URL ?? '').hostname
    if (appDb) deny.push(...(await (await import('dns/promises')).lookup(appDb, { all: true })).map((a) => a.address))
  } catch { }
  return resolveConnectAddress(host, { deny })
}

export async function mailConnectTarget(
  host: unknown,
  resolve: (host: string) => Promise<string> = resolveEditionAddress,
): Promise<{ host: string; servername?: string }> {
  const name = (typeof host === 'string' ? host : '').trim().replace(/^\[|\]$/g, '')
  const ip = await resolve(name)
  return isIP(name) ? { host: ip } : { host: ip, servername: name }
}

export type MailErrorCode = 'ADDRESS_BLOCKED' | 'MAIL_DNS' | 'MAIL_AUTH' | 'MAIL_TLS' | 'MAIL_CONNECT'

export function mailErrorCode(e: unknown): MailErrorCode {
  if (e instanceof SSRFError) return 'ADDRESS_BLOCKED'
  if (e instanceof DnsLookupError) return 'MAIL_DNS'
  const err = e as { code?: string; message?: string; authenticationFailed?: boolean }
  if (err?.code === 'EAUTH' || err?.authenticationFailed) return 'MAIL_AUTH'
  if (err?.code === 'EDNS' || err?.code === 'ENOTFOUND') return 'MAIL_DNS'
  if (err?.code === 'ETLS' || /certificate|self[- ]signed|wrong version number|SSL routines/i.test(String(err?.message ?? ''))) return 'MAIL_TLS'
  return 'MAIL_CONNECT'
}

export const MAIL_ERROR_TEXT: Record<MailErrorCode, string> = {
  ADDRESS_BLOCKED: 'This mail server address is not allowed (private or internal address).',
  MAIL_DNS: 'The mail server name could not be found — check the host.',
  MAIL_AUTH: 'The mail server rejected the user name or password.',
  MAIL_TLS: 'Secure connection failed — check the port and the SSL setting.',
  MAIL_CONNECT: 'Could not reach the mail server — check the host and port.',
}
