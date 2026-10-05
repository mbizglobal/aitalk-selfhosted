export const MASK = '***masked***'

const SECRET_KEY_PATTERN =
  /(api[-_]?key|secret|password|passwd|credential|authorization|bearer|private[-_]?key|client[-_]?secret|auth[-_]?header[-_]?value|token$|key$)/i

const SENSITIVE_HEADER_NAME = /(authorization|cookie|credential|bearer)|(^|[-_])(auth|api[-_]?key)([-_]|$)|(key|token|secret|signature)$/i

function isSensitiveHeaderPair(obj: Record<string, unknown>): boolean {
  const label = obj.key ?? obj.name
  return typeof label === 'string' && SENSITIVE_HEADER_NAME.test(label)
}

const URL_SECRET_QUERY = /(^|[-_])(api[-_]?key|access[-_]?token|refresh[-_]?token|apikey|accesstoken|token|secret|password|passwd|sig|signature|auth|bearer|key)([-_]|$)/i
const URL_IN_TEXT = /https?:\/\/[^\s<>"'`)\]}]+/gi

function maskCredentialParams(paramString: string): string | null {
  const params = new URLSearchParams(paramString)
  let changed = false
  for (const [k] of params) {
    if (URL_SECRET_QUERY.test(k)) { params.set(k, MASK); changed = true }
  }
  return changed ? params.toString() : null
}

function maskKnownCredentialPath(u: URL): boolean {
  const host = u.hostname.toLowerCase()
  if (host === 'hooks.slack.com' && u.pathname.startsWith('/services/')) {
    u.pathname = '/services/' + MASK; return true
  }
  if ((host === 'discord.com' || host === 'discordapp.com') && /^\/api\/webhooks\/\d+\/.+/.test(u.pathname)) {
    u.pathname = u.pathname.replace(/^(\/api\/webhooks\/\d+\/).+$/, '$1' + MASK); return true
  }
  if (host === 'api.telegram.org' && /^\/bot[^/]+/.test(u.pathname)) {
    u.pathname = u.pathname.replace(/^\/bot[^/]+/, '/bot' + MASK); return true
  }
  return false
}

function maskOneUrl(match: string): string {
  let u: URL
  try {
    u = new URL(match)
  } catch {
    return match
  }
  let changed = false
  if (u.username || u.password) {
    u.username = u.username ? MASK : ''
    u.password = u.password ? MASK : ''
    changed = true
  }
  for (const [qk] of u.searchParams) {
    if (URL_SECRET_QUERY.test(qk)) { u.searchParams.set(qk, MASK); changed = true }
  }
  if (u.hash.length > 1) {
    const maskedHash = maskCredentialParams(u.hash.slice(1))
    if (maskedHash != null) { u.hash = '#' + maskedHash; changed = true }
  }
  if (maskKnownCredentialPath(u)) changed = true
  return changed ? u.toString() : match
}

export function stripUrlCredentials(raw: string): string {
  if (!raw.includes('://')) return raw
  return raw.replace(URL_IN_TEXT, maskOneUrl)
}

export function maskSecrets<T>(value: T): T {
  if (typeof value === 'string') {
    return stripUrlCredentials(value) as T
  }
  if (Array.isArray(value)) {
    return value.map((v) => maskSecrets(v)) as T
  }
  if (value instanceof Date) {
    return value
  }
  if (value && typeof value === 'object') {
    const src = value as Record<string, unknown>
    const headerPairSecret = isSensitiveHeaderPair(src)
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(src)) {
      const isStructuralLabel = k === 'key' || k === 'name'
      const maskByKey = !isStructuralLabel && SECRET_KEY_PATTERN.test(k)
      const maskByHeaderPair = headerPairSecret && k === 'value'
      if ((maskByKey || maskByHeaderPair) && v != null && v !== '') {
        out[k] = MASK
      } else {
        out[k] = maskSecrets(v)
      }
    }
    return out as T
  }
  return value
}
