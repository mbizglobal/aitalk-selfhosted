
import type { PrismaClient } from '@prisma/client'

export const BAZG_MONTHLY_URL = 'https://www.backend-rates.bazg.admin.ch/api/xmlavgmonth'
export const MAX_FX_MONTHS = 24
const FETCH_TIMEOUT_MS = 12_000
const RETRY_AFTER_MS = 10 * 60_000
const missedAt = new Map<string, MissedMonth>()
const MAX_BODY_BYTES = 512 * 1024

export interface BazgRate { currency: string; unit: number; rate: string }
export type FxMonthStatus = 'had' | 'stored' | 'not_published' | 'failed'
export interface MissedMonth { at: number; status: 'not_published' | 'failed'; error?: string }

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/

export function isFxMonth(m: string): boolean {
  return MONTH_RE.test(m)
}

export function monthsBetween(start: string, end: string): string[] {
  const out: string[] = []
  let y = Number(start.slice(0, 4))
  let m = Number(start.slice(5, 7))
  const endKey = end.slice(0, 7)
  for (let i = 0; i < MAX_FX_MONTHS; i++) {
    const key = `${y}-${String(m).padStart(2, '0')}`
    if (key > endKey) break
    out.push(key)
    if (++m > 12) { m = 1; y++ }
  }
  return out
}

export function parseBazgMonthly(xml: string, month: string): BazgRate[] {
  const got = /<monat>\s*(\d{4}-\d{2})\s*<\/monat>/.exec(xml)?.[1]
  if (!got) {
    const body = xml.replace(/^\uFEFF?\s*(<\?xml[^>]*\?>)?\s*/, '').trim()
    if (/^<monatsmittelkurs\b[^>]*?(\/>|>\s*<\/monatsmittelkurs>)$/.test(body)) return []
    throw new Error('bazg: no <monat> in the answer')
  }
  if (got !== month) throw new Error(`bazg: asked for ${month}, got ${got}`)
  const out: BazgRate[] = []
  const seen = new Set<string>()
  const bad: string[] = []
  for (const d of xml.matchAll(/<devise\s+code="([a-zA-Z]{3})">([\s\S]*?)<\/devise>/g)) {
    const code = d[1].toUpperCase()
    const w = /<waehrung>\s*(\d{1,6})\s+([A-Z]{3})\s*<\/waehrung>/.exec(d[2])
    const k = /<kurs>\s*(\d{1,6}(?:\.\d{1,6})?)\s*<\/kurs>/.exec(d[2])
    const unit = w ? Number(w[1]) : 0
    if (!w || !k || w[2] !== code || seen.has(code) || !(unit > 0) || !(Number(k[1]) > 0)) { bad.push(code); continue }
    seen.add(code)
    out.push({ currency: code, unit, rate: k[1] })
  }
  const devises = (xml.match(/<devise\b/g) ?? []).length
  if (bad.length > 0 || out.length !== devises) throw new Error(`bazg: ${month} has unreadable currencies (${bad.join(', ') || `${devises - out.length} entries`})`)
  if (out.length === 0) throw new Error(`bazg: ${month} has a month but no currencies`)
  return out
}

type FetchLike = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>

async function fetchMonth(month: string, fetchImpl: FetchLike): Promise<{ url: string; xml: string }> {
  const [y, m] = month.split('-')
  const url = `${BAZG_MONTHLY_URL}?j=${y}&m=${m}&locale=de`
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetchImpl(url, { signal: ctl.signal, headers: { accept: 'application/xml' } })
    if (!res.ok) throw new Error(`bazg: HTTP ${res.status}`)
    const xml = await res.text()
    if (xml.length > MAX_BODY_BYTES) throw new Error('bazg: answer too large')
    return { url, xml }
  } finally {
    clearTimeout(timer)
  }
}

export async function ensureMonthlyFxRates(
  db: Pick<PrismaClient, 'vatFxRate'>,
  months: readonly string[],
  opts: { fetchImpl?: FetchLike; now?: () => Date; memory?: Map<string, MissedMonth> } = {},
): Promise<Array<{ month: string; status: FxMonthStatus; count?: number; error?: string }>> {
  const fetchImpl = opts.fetchImpl ?? (fetch as unknown as FetchLike)
  const now = opts.now ?? (() => new Date())
  const memory = opts.memory ?? missedAt
  const list = [...new Set(months)].filter(isFxMonth).sort().slice(0, MAX_FX_MONTHS)
  return Promise.all(list.map(async (month): Promise<{ month: string; status: FxMonthStatus; count?: number; error?: string }> => {
    const validFor = new Date(`${month}-01T00:00:00Z`)
    try {
      const had = await db.vatFxRate.count({ where: { kind: 'monthly', validFor } })
      if (had > 0) return { month, status: 'had', count: had }
      const last = memory.get(month)
      if (last && now().getTime() - last.at < RETRY_AFTER_MS) return { month, status: last.status, error: last.error ? `${last.error} (tried recently)` : 'tried recently' }
      const { url, xml } = await fetchMonth(month, fetchImpl)
      const rates = parseBazgMonthly(xml, month)
      if (rates.length === 0) { memory.set(month, { at: now().getTime(), status: 'not_published' }); return { month, status: 'not_published' } }
      const fetchedAt = now()
      const r = await db.vatFxRate.createMany({
        data: rates.map((x) => ({ kind: 'monthly', validFor, currency: x.currency, rate: x.rate, unit: x.unit, source: url, fetchedAt, version: 1 })),
        skipDuplicates: true,
      })
      memory.delete(month)
      return { month, status: 'stored', count: r.count }
    } catch (e) {
      const error = (e as Error).name === 'AbortError' ? 'bazg: timeout' : (e as Error).message.slice(0, 200)
      memory.set(month, { at: now().getTime(), status: 'failed', error })
      return { month, status: 'failed', error }
    }
  }))
}

export async function readMonthlyFxRates(db: Pick<PrismaClient, 'vatFxRate'>, months: readonly string[], currencies?: readonly string[]) {
  const list = [...new Set(months)].filter(isFxMonth).sort().slice(0, MAX_FX_MONTHS)
  if (list.length === 0) return []
  const rows = await db.vatFxRate.findMany({
    where: {
      kind: 'monthly',
      validFor: { in: list.map((m) => new Date(`${m}-01T00:00:00Z`)) },
      ...(currencies?.length ? { currency: { in: currencies.map((c) => c.toUpperCase()) } } : {}),
    },
    orderBy: [{ validFor: 'asc' }, { currency: 'asc' }, { version: 'desc' }],
  })
  const best = new Map<string, (typeof rows)[number]>()
  for (const r of rows) {
    const k = `${r.validFor.toISOString().slice(0, 7)}|${r.currency}`
    if (!best.has(k)) best.set(k, r)
  }
  return [...best.values()].map((r) => ({ month: r.validFor.toISOString().slice(0, 7), currency: r.currency, unit: r.unit, rate: r.rate.toFixed(6), version: r.version, source: r.source }))
}
