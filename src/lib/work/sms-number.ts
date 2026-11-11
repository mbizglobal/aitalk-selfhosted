
export type SmsCountry = 'CH' | 'DE' | 'FR'

export const SMS_COUNTRIES: Readonly<Record<SmsCountry, number>> = { CH: 12, DE: 14, FR: 15 }

export const SMS_MAX_SEGMENTS = 3
export const SMS_BODY_MAX = 459
const FR_OPT_OUT_RESERVE = 20

const MOBILE: Record<SmsCountry, RegExp> = {
  CH: /^\+417[5-9]\d{7}$/,
  DE: /^\+491[5-7]\d{8,9}$/,
  FR: /^\+33[67]\d{8}$/,
}
const PREFIX: Record<SmsCountry, string> = { CH: '+41', DE: '+49', FR: '+33' }

export type SmsNumber =
  | { ok: true; e164: string; country: SmsCountry; display: string; assumed: boolean }
  | { ok: false; code: 'RECIPIENT_EMPTY' | 'RECIPIENT_INVALID' | 'COUNTRY_NOT_SUPPORTED' | 'NOT_MOBILE' }

export function normalizeSmsNumber(raw: unknown): SmsNumber {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, code: 'RECIPIENT_EMPTY' }
  let s = raw.trim().replace(/[\s\-./() ]/g, '')
  if (s.startsWith('00')) s = '+' + s.slice(2)
  let assumed = false
  if (!s.startsWith('+')) {
    if (!/^0\d+$/.test(s)) return { ok: false, code: 'RECIPIENT_INVALID' }
    s = '+41' + s.slice(1)
    assumed = true
  }
  if (!/^\+[1-9]\d{6,14}$/.test(s)) return { ok: false, code: 'RECIPIENT_INVALID' }
  const country = (Object.keys(PREFIX) as SmsCountry[]).find((c) => s.startsWith(PREFIX[c]))
  if (!country) return { ok: false, code: 'COUNTRY_NOT_SUPPORTED' }
  if (!MOBILE[country].test(s)) return { ok: false, code: 'NOT_MOBILE' }
  return { ok: true, e164: s, country, display: displayOf(s, country), assumed }
}

function displayOf(e164: string, c: SmsCountry): string {
  const n = e164.slice(3)
  if (c === 'CH') return `+41 ${n.slice(0, 2)} ${n.slice(2, 5)} ${n.slice(5, 7)} ${n.slice(7)}`
  if (c === 'FR') return `+33 ${n.slice(0, 1)} ${n.slice(1, 3)} ${n.slice(3, 5)} ${n.slice(5, 7)} ${n.slice(7)}`
  return `+49 ${n.slice(0, 3)} ${n.slice(3)}`
}

const GSM_BASIC = new Set(Array.from('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'))
const GSM_EXT = new Set(Array.from('^{}\\[~]|€\f'))

export interface SmsSegments { encoding: 'GSM7' | 'UCS2'; units: number; segments: number }

export function countSmsSegments(text: string, reserve = 0): SmsSegments {
  const chars = Array.from(text)
  const gsm = chars.every((ch) => GSM_BASIC.has(ch) || GSM_EXT.has(ch))
  const sizes = chars.map((ch) => (gsm ? (GSM_EXT.has(ch) ? 2 : 1) : ch.length))
  for (let i = 0; i < reserve; i++) sizes.push(1)
  const units = sizes.reduce((a, b) => a + b, 0)
  const single = gsm ? 160 : 70
  const part = gsm ? 153 : 67
  if (units <= single) return { encoding: gsm ? 'GSM7' : 'UCS2', units, segments: units === 0 ? 0 : 1 }
  let segments = 1
  let fill = 0
  for (const n of sizes) {
    if (fill + n > part) { segments++; fill = 0 }
    fill += n
  }
  return { encoding: gsm ? 'GSM7' : 'UCS2', units, segments }
}

export interface SmsPrice { country: SmsCountry; segments: number; unit: number; total: number }

export function smsPriceFor(country: SmsCountry, text: string): SmsPrice | null {
  const unit = SMS_COUNTRIES[country]
  if (!Number.isInteger(unit) || unit <= 0) return null
  const seg = countSmsSegments(text, country === 'FR' ? FR_OPT_OUT_RESERVE : 0)
  if (seg.segments < 1 || seg.segments > SMS_MAX_SEGMENTS) return null
  return { country, segments: seg.segments, unit, total: unit * seg.segments }
}
