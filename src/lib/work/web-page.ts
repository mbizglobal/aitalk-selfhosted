
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import zlib from 'node:zlib'
import type { Readable } from 'node:stream'
import * as cheerio from 'cheerio'
import TurndownService from 'turndown'
import { DnsLookupError, SSRFError, resolveConnectAddress } from '@/lib/ssrfGuard'
import { describeCaughtError } from '@/lib/log-mask'

export const WEB_PAGE_MAX_BYTES = 2 * 1024 * 1024
export const WEB_PAGE_MAX_CHARS = 20_000
export const WEB_PAGE_TIMEOUT_MS = 10_000
export const WEB_PAGE_MAX_REDIRECTS = 5
export const WEB_PAGE_TITLE_MAX = 300
export const WEB_PAGE_PER_TURN = 5
export const WEB_PAGE_USER_AGENT = 'AITalk-PageReader/1.0 (+https://www.aitalk.ch)'

export type WebPageCode =
  | 'INVALID_URL' | 'NOT_GIVEN' | 'BLOCKED_ADDRESS' | 'DNS_FAILED' | 'TOO_MANY_REDIRECTS' | 'TIMEOUT'
  | 'TOO_LARGE' | 'UNSUPPORTED_TYPE' | 'EMPTY_PAGE' | 'FETCH_FAILED' | 'LIMIT' | `HTTP_${number}`

export class WebPageError extends Error {
  constructor(readonly code: WebPageCode) { super(code) }
}

export interface WebPage { url: string; finalUrl: string; title: string; text: string; truncated: boolean }

export interface WebPageDeps {
  resolve?: (host: string) => Promise<string>
  timeoutMs?: number
  ports?: readonly string[]
}

const DEFAULT_PORTS: readonly string[] = ['80', '443']

const REDIRECTS = new Set([301, 302, 303, 307, 308])
const TEXT_TYPES = new Set(['text/html', 'application/xhtml+xml', 'text/plain', 'application/json'])

export function parsePageUrl(raw: unknown, ports?: readonly string[]): URL {
  if (typeof raw !== 'string' || !raw.trim()) throw new WebPageError('INVALID_URL')
  let u: URL
  try { u = new URL(raw.trim()) } catch { throw new WebPageError('INVALID_URL') }
  checkUrl(u, ports)
  return u
}

function checkUrl(u: URL, ports: readonly string[] = DEFAULT_PORTS): void {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new WebPageError('INVALID_URL')
  if (u.username || u.password) throw new WebPageError('INVALID_URL')
  if (u.port && !ports.includes(u.port)) throw new WebPageError('BLOCKED_ADDRESS')
}

export function normalizePageUrl(u: URL | string): string | null {
  try {
    const x = new URL(typeof u === 'string' ? u : u.href)
    x.hash = ''
    return x.href
  } catch { return null }
}

export function urlsInText(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi)) {
    let s = m[0]
    for (;;) {
      const last = s.slice(-1)
      if ('.,;:!?'.includes(last)) { s = s.slice(0, -1); continue }
      const pair: Record<string, string> = { ')': '(', ']': '[', '>': '<' }
      if (pair[last] && s.split(last).length > s.split(pair[last]).length) { s = s.slice(0, -1); continue }
      break
    }
    if (/^www\./i.test(s)) s = `https://${s}`
    const n = normalizePageUrl(s)
    if (n) out.push(n)
  }
  return out
}

export function urlWasGiven(url: URL, humanTexts: readonly string[]): boolean {
  const want = normalizePageUrl(url)
  return !!want && humanTexts.some((t) => urlsInText(t).includes(want))
}

async function defaultResolve(host: string): Promise<string> {
  const { isSelfHosted } = await import('@/lib/edition')
  if (isSelfHosted()) return resolveConnectAddress(host)
  const { defaultResolve: cloud } = await import('./company-db')
  return cloud(host)
}

interface Hop { status: number; headers: http.IncomingHttpHeaders; body: http.IncomingMessage }

function requestOnce(u: URL, ip: string, signal: AbortSignal): Promise<Hop> {
  return new Promise((resolve, reject) => {
    const host = u.hostname.replace(/^\[|\]$/g, '')
    const family = net.isIP(ip) === 6 ? 6 : 4
    const opts: https.RequestOptions = {
      protocol: u.protocol,
      hostname: host,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: `${u.pathname}${u.search}`,
      method: 'GET',
      headers: { 'User-Agent': WEB_PAGE_USER_AGENT, Accept: 'text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.1', 'Accept-Encoding': 'gzip, deflate, br' },
      lookup: ((_h: string, o: { all?: boolean }, cb: (...a: unknown[]) => void) => (o?.all ? cb(null, [{ address: ip, family }]) : cb(null, ip, family))) as never,
      signal,
      ...(u.protocol === 'https:' && !net.isIP(host) ? { servername: host } : {}),
    }
    const req = (u.protocol === 'https:' ? https : http).request(opts, (res) => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: res }))
    req.on('error', reject)
    req.end()
  })
}

function decoded(h: Hop): Readable {
  const enc = String(h.headers['content-encoding'] ?? '').trim().toLowerCase()
  if (!enc || enc === 'identity') return h.body
  const z = enc === 'gzip' || enc === 'x-gzip' ? zlib.createGunzip() : enc === 'deflate' ? zlib.createInflate() : enc === 'br' ? zlib.createBrotliDecompress() : null
  if (!z) { h.body.destroy(); throw new WebPageError('FETCH_FAILED') }
  h.body.on('error', (e) => z.destroy(e))
  return h.body.pipe(z)
}

async function readCapped(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of stream) {
    size += (c as Buffer).length
    if (size > WEB_PAGE_MAX_BYTES) { stream.destroy(); throw new WebPageError('TOO_LARGE') }
    chunks.push(c as Buffer)
  }
  return Buffer.concat(chunks)
}

export async function readWebPage(url: URL, deps: WebPageDeps = {}): Promise<WebPage> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), deps.timeoutMs ?? WEB_PAGE_TIMEOUT_MS)
  const deadline = new Promise<never>((_, reject) => ac.signal.addEventListener('abort', () => reject(new WebPageError('TIMEOUT')), { once: true }))
  deadline.catch(() => {})
  const resolve = deps.resolve ?? defaultResolve
  let cur = url
  try {
    for (let hop = 0; ; hop++) {
      checkUrl(cur, deps.ports)
      const ip = await Promise.race([quiet(resolve(cur.hostname.replace(/^\[|\]$/g, ''))), deadline])
      const h = await Promise.race([quiet(requestOnce(cur, ip, ac.signal)), deadline])
      if (REDIRECTS.has(h.status) && h.headers.location) {
        h.body.destroy()
        if (hop >= WEB_PAGE_MAX_REDIRECTS) throw new WebPageError('TOO_MANY_REDIRECTS')
        let next: URL
        try { next = new URL(String(h.headers.location), cur) } catch { throw new WebPageError('INVALID_URL') }
        cur = next
        continue
      }
      if (h.status < 200 || h.status > 299) { h.body.destroy(); throw new WebPageError(`HTTP_${h.status}`) }
      const type = String(h.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
      if (!TEXT_TYPES.has(type)) { h.body.destroy(); throw new WebPageError('UNSUPPORTED_TYPE') }
      const encoding = String(h.headers['content-encoding'] ?? '').trim().toLowerCase()
      const length = Number(h.headers['content-length'])
      if ((!encoding || encoding === 'identity') && Number.isFinite(length) && length > WEB_PAGE_MAX_BYTES) { h.body.destroy(); throw new WebPageError('TOO_LARGE') }
      const body = await Promise.race([quiet(readCapped(decoded(h))), deadline])
      if ((!encoding || encoding === 'identity') && Number.isFinite(length) && body.length < length) throw new WebPageError('FETCH_FAILED')
      const page = pageToText(body, String(h.headers['content-type'] ?? ''))
      return { url: url.href, finalUrl: cur.href, ...page }
    }
  } catch (e) {
    throw toCode(e, ac.signal.aborted)
  } finally {
    clearTimeout(timer)
    ac.abort()
  }
}

function quiet<T>(p: Promise<T>): Promise<T> {
  p.catch(() => {})
  return p
}

function toCode(e: unknown, aborted: boolean): WebPageError {
  if (e instanceof WebPageError) return e
  if (e instanceof SSRFError) return new WebPageError('BLOCKED_ADDRESS')
  if (e instanceof DnsLookupError) return new WebPageError('DNS_FAILED')
  if (aborted) return new WebPageError('TIMEOUT')
  console.warn('[work-web-page] 받기 실패:', describeCaughtError(e))
  return new WebPageError('FETCH_FAILED')
}

function charsetOf(body: Buffer, contentType: string, html: boolean): { label: string; skip: number } {
  if (body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) return { label: 'utf-8', skip: 3 }
  if (body[0] === 0xff && body[1] === 0xfe) return { label: 'utf-16le', skip: 2 }
  if (body[0] === 0xfe && body[1] === 0xff) return { label: 'utf-16be', skip: 2 }
  const header = /charset\s*=\s*"?([\w.:-]+)/i.exec(contentType)?.[1]
  if (header) return { label: header, skip: 0 }
  if (html) {
    const meta = /<meta[^>]+charset\s*=\s*["']?\s*([\w.:-]+)/i.exec(body.subarray(0, 4096).toString('latin1'))?.[1]
    if (meta) return { label: meta, skip: 0 }
  }
  return { label: 'utf-8', skip: 0 }
}

function decode(body: Buffer, contentType: string, html: boolean): string {
  const { label, skip } = charsetOf(body, contentType, html)
  let dec: TextDecoder
  try { dec = new TextDecoder(label) } catch { dec = new TextDecoder('utf-8') }
  return dec.decode(body.subarray(skip))
}

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' })
turndown.remove(['img' as never])

export function pageToText(body: Buffer, contentType: string): { title: string; text: string; truncated: boolean } {
  const type = contentType.split(';')[0].trim().toLowerCase()
  const html = type === 'text/html' || type === 'application/xhtml+xml'
  const raw = decode(body, contentType, html)
  let title = ''
  let text = raw
  if (html) {
    const $ = cheerio.load(raw)
    title = $('title').first().text().replace(/\s+/g, ' ').trim().slice(0, WEB_PAGE_TITLE_MAX)
    $('script, style, noscript, svg, iframe, template').remove()
    const main = $('main').first()
    const picked = main.length && main.text().replace(/\s+/g, '').length >= 200 ? main.html() : $('body').length ? $('body').html() : $.root().html()
    text = turndown.turndown(picked ?? '')
  }
  text = text.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (!text.replace(/\s+/g, '')) throw new WebPageError('EMPTY_PAGE')
  const truncated = text.length > WEB_PAGE_MAX_CHARS
  return { title, text: truncated ? text.slice(0, WEB_PAGE_MAX_CHARS) : text, truncated }
}
