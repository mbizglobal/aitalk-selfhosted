import { createHash } from 'node:crypto'

export function maskNumber(n: string | null | undefined): string {
  if (!n || n.length < 6) return '****'
  return `${n.slice(0, 3)}****${n.slice(-2)}`
}

export function maskEmail(e: string | null | undefined): string {
  if (!e) return '****'
  const at = e.lastIndexOf('@')
  if (at <= 0) return maskId(e)
  const local = e.slice(0, at)
  const domain = e.slice(at)
  if (local.length <= 2) return `***${domain}`
  return `${local.slice(0, 2)}***${domain}`
}

export function maskId(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v)
  if (!s || s.length < 6) return '****'
  return `${s.slice(0, 2)}***${s.slice(-2)}`
}

export function safeLogId(v: unknown): string {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_:.-]{1,128}$/.test(v)) return 'invalid'
  return maskId(v)
}

export function safeLogDigest(v: unknown): string {
  if (typeof v !== 'string' || !v) return 'none'
  return createHash('sha256').update(v).digest('hex').slice(0, 8)
}

export function safeLogToken(v: unknown): string {
  return typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(v) ? v : 'other'
}

export function safeLogFields(args: unknown): string {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return ''
  const fields = Object.keys(args).map(safeLogToken).join(', ')
  return fields.length > 200 ? fields.slice(0, 200) + '…' : fields
}

export function safeLogNumber(v: unknown): string {
  if (typeof v !== 'string' || !/^\+?[0-9][0-9 ()-]{4,19}$/.test(v)) return '****'
  return maskNumber(v.replace(/[^\d+]/g, ''))
}

export function safeLogRawNumber(v: unknown): string {
  if (typeof v !== 'string' || v === '') return '(none)'
  const kept = v.replace(/[^A-Za-z0-9+:_.()\- ]/g, '').slice(0, 64)
  if (kept === v) return kept
  return kept ? `${kept} [sanitized len=${v.length}]` : `[invalid len=${v.length}]`
}

export function describeUpstreamError(status: number, bodyText: string | null | undefined): string {
  const body = bodyText ?? ''
  let code = ''
  let sawCodeField = false
  const extra: string[] = []

  try {
    const parsed: unknown = JSON.parse(body)

    const err = ownProp(parsed, 'error')
    if (err !== undefined) sawCodeField = true
    code = typeof err === 'string' ? asErrorCode(err) : asErrorCode(ownProp(err, 'code'))

    const aadCodes = ownProp(parsed, 'error_codes')
    if (Array.isArray(aadCodes)) {
      const numeric = aadCodes.filter(isAadCode).slice(0, AAD_CODE_LIMIT)
      if (numeric.length) extra.push(`aad=${numeric.join(',')}`)
    }

    // (`{ ok:false, error_code:403, description:"Forbidden: bot was blocked by the user" }`).
    if (err === undefined) {
      const vendorCode = ownProp(parsed, 'error_code')
      if (vendorCode !== undefined) sawCodeField = true
      if (Number.isInteger(vendorCode) && (vendorCode as number) >= 100 && (vendorCode as number) <= 599) {
        code = String(vendorCode)
      }
    }
  } catch {
  }

  if (!code) {
    code = sawCodeField ? 'malformed' : 'unknown'
    extra.push(`${body.length} chars`)
  }

  return `HTTP ${status}, code=${code}${extra.length ? `, ${extra.join(', ')}` : ''}`
}

const AAD_CODE_LIMIT = 5

function isAadCode(c: unknown): boolean {
  return Number.isInteger(c) && (c as number) > 0 && (c as number) <= 9_999_999
}

const ERROR_CODE_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/

function asErrorName(v: unknown): string {
  return typeof v === 'string' && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(v) ? v : ''
}

export function safeErrorCode(v: unknown): string {
  return typeof v === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(v) ? v : ''
}

const asStrictErrorCode = safeErrorCode

function asPrismaErrorCode(v: unknown): string {
  return typeof v === 'string' && /^P\d{4}$/.test(v) ? v : ''
}

function asErrorCode(v: unknown): string {
  return typeof v === 'string' && ERROR_CODE_PATTERN.test(v) ? v : ''
}

function ownProp(o: unknown, k: string): unknown {
  return o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k)
    ? (o as Record<string, unknown>)[k]
    : undefined
}

export async function readUpstreamJson(response: Response): Promise<any> {
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`Upstream returned non-JSON body (HTTP ${response.status}, ${text.length} chars)`)
  }
}

export function describeCaughtError(e: unknown): string {
  if (e === null || typeof e !== 'object') return typeof e

  const safeName = asErrorName(ownProp(e, 'name')) || 'Error'

  const parts: string[] = []
  const code =
    asStrictErrorCode(ownProp(e, 'code')) ||
    (safeName.startsWith('PrismaClient') ? asPrismaErrorCode(ownProp(e, 'errorCode')) : '')
  if (code) parts.push(code)
  //
  const status = ownProp(e, 'statusCode') ?? ownProp(e, 'status')
  if (Number.isInteger(status) && (status as number) >= 100 && (status as number) <= 599) {
    parts.push(`status=${status}`)
  }

  return parts.length ? `${safeName}(${parts.join(', ')})` : safeName
}

export function maskUrl(u: string | null | undefined): string {
  if (!u) return '(no url)'
  try {
    const url = new URL(u)
    if (![...url.searchParams.keys()].length) return `${url.origin}${url.pathname}`
    const keys = [...url.searchParams.keys()].join(',')
    return `${url.origin}${url.pathname}?<${keys}>`
  } catch {
    const q = u.indexOf('?')
    return q === -1 ? u : `${u.slice(0, q)}?<masked>`
  }
}

export function devSafeUpstreamText(v: unknown, max = 80): string {
  return String(v ?? '')
    .replace(/[^A-Za-z0-9 .,:'()/=-]/g, '·')
    .replace(/\d{4,}/g, (m) => '#'.repeat(m.length))
    .slice(0, max)
}
