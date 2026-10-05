import dns from 'dns/promises'
import type { LookupAddress } from 'dns'
import ipaddr from 'ipaddr.js'

export class SSRFError extends Error {
  constructor(
    public hostname: string,
    public ip: string,
    public range: string,
  ) {
    super(`SSRF blocked: ${hostname} resolves to ${ip} (${range})`)
    this.name = 'SSRFError'
  }
}

export class DnsLookupError extends Error {
  constructor(public hostname: string, public original: string) {
    super(`DNS lookup failed for ${hostname}: ${original}`)
    this.name = 'DnsLookupError'
  }
}

function checkIp(addr: ipaddr.IPv4 | ipaddr.IPv6): { safe: boolean; range: string } {
  if (addr.kind() === 'ipv6') {
    const v6 = addr as ipaddr.IPv6
    if (v6.isIPv4MappedAddress()) {
      const v4 = v6.toIPv4Address()
      const r = v4.range()
      return { safe: r === 'unicast', range: r }
    }
  }
  const r = addr.range()
  return { safe: r === 'unicast', range: r }
}

const HOSTNAME_CACHE_TTL_MS = 15_000
const HOSTNAME_CACHE_MAX_SIZE = 256
type BlockResult = { kind: 'ssrf'; ip: string; range: string } | { kind: 'dns'; reason: string }
type CacheEntry = { expiresAt: number; result: BlockResult }
const hostnameCache = new Map<string, CacheEntry>()

function getCached(hostname: string): BlockResult | null {
  const entry = hostnameCache.get(hostname)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    hostnameCache.delete(hostname)
    return null
  }
  return entry.result
}

function setCached(hostname: string, result: BlockResult): void {
  hostnameCache.delete(hostname)
  if (hostnameCache.size >= HOSTNAME_CACHE_MAX_SIZE) {
    const firstKey = hostnameCache.keys().next().value
    if (firstKey !== undefined) hostnameCache.delete(firstKey)
  }
  hostnameCache.set(hostname, { expiresAt: Date.now() + HOSTNAME_CACHE_TTL_MS, result })
}

export async function assertSafeHostname(hostname: string): Promise<void> {
  const trimmed = hostname.trim().replace(/^\[|\]$/g, '')

  if (ipaddr.isValid(trimmed)) {
    const addr = ipaddr.parse(trimmed)
    const { safe, range } = checkIp(addr)
    if (!safe) throw new SSRFError(hostname, trimmed, range)
    return
  }

  const cached = getCached(trimmed)
  if (cached) {
    if (cached.kind === 'ssrf') throw new SSRFError(hostname, cached.ip, cached.range)
    throw new DnsLookupError(hostname, cached.reason)
  }

  let addrs: LookupAddress[]
  try {
    addrs = await dns.lookup(trimmed, { all: true })
  } catch (err: any) {
    const reason = err?.message ?? String(err)
    setCached(trimmed, { kind: 'dns', reason })
    throw new DnsLookupError(hostname, reason)
  }

  if (addrs.length === 0) {
    const reason = 'no A/AAAA records'
    setCached(trimmed, { kind: 'dns', reason })
    throw new DnsLookupError(hostname, reason)
  }

  for (const { address } of addrs) {
    const addr = ipaddr.parse(address)
    const { safe, range } = checkIp(addr)
    if (!safe) {
      setCached(trimmed, { kind: 'ssrf', ip: address, range })
      throw new SSRFError(hostname, address, range)
    }
  }
}

export async function assertSafeUrl(url: string): Promise<void> {
  const u = new URL(url)
  if (!['http:', 'https:'].includes(u.protocol)) {
    throw new SSRFError(u.hostname, '', `protocol:${u.protocol}`)
  }
  await assertSafeHostname(u.hostname)
}

export interface SafeFetchInit {
  method?: string
  headers?: Record<string, string>
  body?: string
  signal?: AbortSignal
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

export async function safeFetch(
  url: string,
  init: SafeFetchInit = {},
  maxRedirects = 5,
): Promise<Response> {
  let currentUrl = url
  let method = (init.method ?? 'GET').toUpperCase()
  let body = init.body
  const headers: Record<string, string> = { ...(init.headers ?? {}) }
  const deleteHeader = (name: string) => {
    for (const k of Object.keys(headers)) {
      if (k.toLowerCase() === name) delete headers[k]
    }
  }

  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertSafeUrl(currentUrl)

    const response = await fetch(currentUrl, {
      method,
      headers,
      body,
      signal: init.signal,
      redirect: 'manual',
    })

    if (!REDIRECT_STATUSES.has(response.status)) return response

    const location = response.headers.get('location')
    if (!location) return response

    let next: URL
    try {
      next = new URL(location, currentUrl)
    } catch {
      return response
    }

    response.body?.cancel().catch(() => {})

    if (next.origin !== new URL(currentUrl).origin) {
      deleteHeader('authorization')
      deleteHeader('cookie')
      deleteHeader('proxy-authorization')
    }

    if (
      (response.status === 303 && method !== 'GET' && method !== 'HEAD') ||
      ((response.status === 301 || response.status === 302) && method === 'POST')
    ) {
      method = 'GET'
      body = undefined
      for (const h of ['content-type', 'content-length', 'content-encoding', 'content-language', 'content-location']) {
        deleteHeader(h)
      }
    }

    currentUrl = next.href
  }

  throw new Error(`Too many redirects (>${maxRedirects})`)
}
