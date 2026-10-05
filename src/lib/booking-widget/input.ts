
import { normalizeWidgetLang, type WidgetLang } from './i18n'

export interface ReserveInput {
  start: string
  party: number | null
  firstName: string
  lastName: string
  email: string
  phone: string
  message: string
  lang: WidgetLang
}

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?[+-]\d{2}:\d{2}$/
const EMAIL = /^[^\s@<>()[\],;:"]{1,64}@[^\s@<>()[\],;:"]{1,180}\.[A-Za-z]{2,24}$/
const PHONE_CHARS = /^\+?[0-9 ()./-]{7,24}$/
const CONTROL = /[\u0000-\u001f\u007f]/

function cleanName(v: unknown): string | null {
  if (typeof v !== 'string') return null
  if (CONTROL.test(v)) return null
  const s = v.trim().replace(/\s+/g, ' ')
  if (s.length < 1 || s.length > 60) return null
  return s
}

export function parseReserveInput(body: any): ReserveInput | null {
  if (!body || typeof body !== 'object') return null
  const start = typeof body.start === 'string' ? body.start.trim() : ''
  if (!ISO_WITH_OFFSET.test(start) || !Number.isFinite(new Date(start).getTime())) return null
  if (!isRealWallTime(start)) return null

  let party: number | null = null
  if (body.party !== undefined && body.party !== null && body.party !== '') {
    if (typeof body.party !== 'number' && typeof body.party !== 'string') return null
    const n = Number(body.party)
    if (!Number.isInteger(n) || n < 1 || n > 500) return null
    party = n
  }

  const firstName = cleanName(body.firstName)
  const lastName = cleanName(body.lastName)
  if (!firstName || !lastName) return null

  const email = typeof body.email === 'string' ? body.email.trim() : ''
  if (email.length > 200 || !EMAIL.test(email)) return null

  const phone = typeof body.phone === 'string' ? body.phone.trim() : ''
  const digits = phone.replace(/\D/g, '')
  if (!PHONE_CHARS.test(phone) || digits.length < 7 || digits.length > 15) return null

  const rawMessage = typeof body.message === 'string' ? body.message.trim() : ''
  if (rawMessage.length > 500) return null
  const message = rawMessage.replace(/[\r\n\t]+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '').trim()

  return { start, party, firstName, lastName, email, phone, message, lang: normalizeWidgetLang(body.lang) ?? 'en' }
}

export function isRealYmd(ymd: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
}

function isRealWallTime(iso: string): boolean {
  const hh = Number(iso.slice(11, 13))
  const mm = Number(iso.slice(14, 16))
  return isRealYmd(iso.slice(0, 10)) && hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59
}

export function ymdOfIso(iso: string): string {
  return iso.slice(0, 10)
}
