import { createPublicKey, verify, type KeyObject } from 'node:crypto'
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs'
import { getEdition } from '@/lib/edition'
import { LICENSE_PUBLIC_KEYS } from './public-keys'

export const EE_FEATURES = ['approval'] as const
export type EeFeature = (typeof EE_FEATURES)[number]

export const GRACE_DAYS = 15
const MAX_KEY_LENGTH = 8192
const DAY_MS = 86_400_000

export interface LicensePayload {
  v: 1
  kid: string
  licenseId: string
  licensee: string
  issuedAt: string
  expiresAt: string
  features: string[]
  clientCompanies?: number
}

export type LicenseState =
  | { status: 'none' }
  | { status: 'invalid'; reason: string }
  | { status: 'expired'; payload: LicensePayload }
  | { status: 'active' | 'grace'; payload: LicensePayload; features: EeFeature[]; graceEndsAt: Date }

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/

function utcDay(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const m = DATE_RE.exec(value)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const t = Date.UTC(y, mo - 1, d)
  const back = new Date(t)
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null
  return t
}

function decodeBase64url(part: string): Buffer | null {
  if (!part || !/^[A-Za-z0-9_-]+$/.test(part)) return null
  return Buffer.from(part, 'base64url')
}

function parsePayload(raw: unknown): LicensePayload | string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'payload_not_object'
  const p = raw as Record<string, unknown>
  if (p.v !== 1) return 'unknown_version'
  if (typeof p.kid !== 'string' || !p.kid) return 'kid_missing'
  if (typeof p.licenseId !== 'string' || !p.licenseId.trim()) return 'license_id_missing'
  if (typeof p.licensee !== 'string' || !p.licensee.trim()) return 'licensee_missing'
  if (CONTROL_RE.test(p.licenseId) || CONTROL_RE.test(p.licensee) || p.licenseId.length > 100 || p.licensee.length > 200) {
    return 'text_invalid'
  }
  if (utcDay(p.issuedAt) === null) return 'issued_at_invalid'
  if (utcDay(p.expiresAt) === null) return 'expires_at_invalid'
  if (!Array.isArray(p.features) || p.features.length === 0 || !p.features.every((f) => typeof f === 'string' && f)) {
    return 'features_invalid'
  }
  if (p.clientCompanies !== undefined && !(Number.isInteger(p.clientCompanies) && (p.clientCompanies as number) >= 0)) {
    return 'client_companies_invalid'
  }
  return p as unknown as LicensePayload
}

export function verifyLicenseText(
  text: string,
  opts: { now?: Date; publicKeys?: Readonly<Record<string, string>> } = {},
): Exclude<LicenseState, { status: 'none' }> {
  const now = (opts.now ?? new Date()).getTime()
  const keys = opts.publicKeys ?? LICENSE_PUBLIC_KEYS
  const line = text.trim()
  if (!line) return { status: 'invalid', reason: 'empty' }
  if (line.length > MAX_KEY_LENGTH) return { status: 'invalid', reason: 'too_long' }
  const parts = line.split('.')
  if (parts.length !== 2) return { status: 'invalid', reason: 'malformed' }
  const [body, sigPart] = parts
  const bodyBytes = decodeBase64url(body)
  const sig = decodeBase64url(sigPart)
  if (!bodyBytes || !sig) return { status: 'invalid', reason: 'malformed' }

  let raw: unknown
  try {
    raw = JSON.parse(bodyBytes.toString('utf8'))
  } catch {
    return { status: 'invalid', reason: 'malformed' }
  }
  const kid = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).kid : undefined
  if (typeof kid !== 'string' || !kid) return { status: 'invalid', reason: 'kid_missing' }
  const spki = Object.prototype.hasOwnProperty.call(keys, kid) ? keys[kid] : undefined
  if (!spki) return { status: 'invalid', reason: 'kid_unknown' }

  let key: KeyObject
  try {
    key = createPublicKey({ key: Buffer.from(spki, 'base64'), format: 'der', type: 'spki' })
  } catch {
    return { status: 'invalid', reason: 'public_key_broken' }
  }
  let ok = false
  try {
    ok = verify(null, Buffer.from(body, 'ascii'), key, sig)
  } catch {
    ok = false
  }
  if (!ok) return { status: 'invalid', reason: 'signature_mismatch' }

  const payload = parsePayload(raw)
  if (typeof payload === 'string') return { status: 'invalid', reason: payload }

  const validUntil = utcDay(payload.expiresAt)! + DAY_MS
  const graceEndsAt = validUntil + GRACE_DAYS * DAY_MS
  if (now >= graceEndsAt) return { status: 'expired', payload }
  const features = EE_FEATURES.filter((f) => payload.features.includes(f))
  return { status: now < validUntil ? 'active' : 'grace', payload, features, graceEndsAt: new Date(graceEndsAt) }
}

let cachedText: { value: string | null; error?: string } | undefined

function readLicenseText(env: Record<string, string | undefined>): { value: string | null; error?: string } {
  const file = env.AITALK_LICENSE_FILE?.trim()
  const inline = env.AITALK_LICENSE?.trim()
  if (file && inline) return { value: null, error: 'both_set' }
  if (inline) return { value: inline }
  if (!file) return { value: null }
  let fd: number | undefined
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK)
    const st = fstatSync(fd)
    if (!st.isFile()) return { value: null, error: 'file_not_regular' }
    const limit = MAX_KEY_LENGTH + 1024
    if (st.size > limit) return { value: null, error: 'file_too_large' }
    const buf = Buffer.alloc(limit + 1)
    let n = 0
    while (n < buf.length) {
      const r = readSync(fd, buf, n, buf.length - n, null)
      if (r === 0) break
      n += r
    }
    if (n > limit) return { value: null, error: 'file_too_large' }
    return { value: buf.subarray(0, n).toString('utf8') }
  } catch {
    return { value: null, error: 'file_unreadable' }
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

export function getLicenseState(
  env: Record<string, string | undefined> = process.env,
  now: Date = new Date(),
): LicenseState {
  if (getEdition(env) !== 'selfhosted') return { status: 'none' }
  const text = env === process.env ? (cachedText ??= readLicenseText(env)) : readLicenseText(env)
  if (text.error) return { status: 'invalid', reason: text.error }
  if (text.value === null) return { status: 'none' }
  return verifyLicenseText(text.value, { now })
}

export function isEeFeatureEnabled(
  feature: EeFeature,
  env: Record<string, string | undefined> = process.env,
  now: Date = new Date(),
): boolean {
  const s = getLicenseState(env, now)
  return (s.status === 'active' || s.status === 'grace') && s.features.includes(feature)
}

export function describeLicenseState(s: LicenseState): string {
  switch (s.status) {
    case 'none':
      return '[License] none'
    case 'invalid':
      return `[License] invalid key — ${s.reason} (Enterprise features off)`
    case 'expired':
      return `[License] expired — ${s.payload.licensee} (${s.payload.licenseId}) · until ${s.payload.expiresAt} · grace ended (Enterprise features off)`
    case 'grace':
      return `[License] ⚠️ grace — ${s.payload.licensee} (${s.payload.licenseId}) · expired ${s.payload.expiresAt} · features off on ${s.graceEndsAt.toISOString().slice(0, 10)} · features: ${s.features.join(', ') || '-'}`
    case 'active':
      return `[License] Enterprise — ${s.payload.licensee} (${s.payload.licenseId}) · until ${s.payload.expiresAt} · features: ${s.features.join(', ') || '-'}`
  }
}
