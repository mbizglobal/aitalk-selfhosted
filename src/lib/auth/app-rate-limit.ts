
interface WindowEntry {
  timestamps: number[]
}

const WINDOW_MS = 15 * 60 * 1000
const EMAIL_LIMIT = 20
const IP_LIMIT = 30
const MAX_KEYS = 50_000

const buckets = new Map<string, WindowEntry>()

function pruned(key: string, now: number): number {
  const entry = buckets.get(key)
  if (!entry) return 0
  entry.timestamps = entry.timestamps.filter((t) => now - t < WINDOW_MS)
  if (entry.timestamps.length === 0) {
    buckets.delete(key)
    return 0
  }
  return entry.timestamps.length
}

function ensureCapacity(now: number): boolean {
  if (buckets.size < MAX_KEYS) return true
  for (const [key, entry] of buckets) {
    entry.timestamps = entry.timestamps.filter((t) => now - t < WINDOW_MS)
    if (entry.timestamps.length === 0) buckets.delete(key)
  }
  return buckets.size < MAX_KEYS
}

function record(key: string, now: number): void {
  let entry = buckets.get(key)
  if (!entry) {
    entry = { timestamps: [] }
    buckets.set(key, entry)
  }
  entry.timestamps.push(now)
}

export function allowLoginAttempt(
  email: string,
  ip: string | null,
  scope: 'login' | 'delete' | 'restore' = 'login',
): { ok: true } | { ok: false; scope: 'email' | 'ip' } {
  const now = Date.now()
  const emailKey = scope === 'login' ? `email:${email}` : `email:${scope}:${email}`
  const ipKey = ip ? `ip:${ip}` : null
  if (pruned(emailKey, now) >= EMAIL_LIMIT) return { ok: false, scope: 'email' }
  if (ipKey && pruned(ipKey, now) >= IP_LIMIT) return { ok: false, scope: 'ip' }
  if ((!buckets.has(emailKey) || (ipKey && !buckets.has(ipKey))) && !ensureCapacity(now)) {
    if (!buckets.has(emailKey)) return { ok: false, scope: 'email' }
    return { ok: false, scope: 'ip' }
  }
  record(emailKey, now)
  if (ipKey) record(ipKey, now)
  return { ok: true }
}

export function clientIpOf(headers: Headers): string | null {
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip') || null
}

export function maskEmail(email: string): string {
  const at = email.indexOf('@')
  if (at <= 0) return '***'
  return `${email.slice(0, Math.min(2, at))}***@${email.slice(at + 1)}`
}
