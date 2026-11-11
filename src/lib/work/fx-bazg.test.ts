
import { describe, it } from 'node:test'
import { cloudOnly } from '@/lib/work/cloud-apps-for-tests'
import assert from 'node:assert/strict'

import { ensureMonthlyFxRates, monthsBetween, parseBazgMonthly, type MissedMonth } from './fx-bazg'

const xml = (month: string, devises: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<monatsmittelkurs xmlns="x">\n  <monat>${month}</monat>\n${devises}</monatsmittelkurs>`
const dev = (code: string, waehrung: string, kurs: string) =>
  `  <devise code="${code}">\n    <land_de>X</land_de>\n    <waehrung>${waehrung}</waehrung>\n    <kurs>${kurs}</kurs>\n  </devise>\n`

describe('parseBazgMonthly', () => {
  it('reads currency, unit and rate', () => {
    const r = parseBazgMonthly(xml('2026-08', dev('eur', '1 EUR', '0.9328') + dev('jpy', '100 JPY', '0.5412')), '2026-08')
    assert.deepEqual(r, [{ currency: 'EUR', unit: 1, rate: '0.9328' }, { currency: 'JPY', unit: 100, rate: '0.5412' }])
  })
  it('rejects an answer for another month', () => {
    assert.throws(() => parseBazgMonthly(xml('2026-10', dev('eur', '1 EUR', '0.95')), '2026-08'), /asked for 2026-08, got 2026-10/)
  })
  it('returns nothing for a month not published yet', () => {
    assert.deepEqual(parseBazgMonthly('<?xml version="1.0"?>\n<monatsmittelkurs xmlns="x" xsi:schemaLocation="y"/>', '2026-12'), [])
    assert.deepEqual(parseBazgMonthly('<?xml version="1.0"?>\n<monatsmittelkurs xmlns="x">\n</monatsmittelkurs>', '2026-12'), [])
  })
  it('throws on an answer without a month', () => {
    assert.throws(() => parseBazgMonthly('<html>error</html>', '2026-08'), /no <monat>/)
    assert.throws(() => parseBazgMonthly('<monatsmittelkurs xmlns="x"><error>busy</error></monatsmittelkurs>', '2026-08'), /no <monat>/)
    assert.throws(() => parseBazgMonthly('<html><monatsmittelkurs/></html>', '2026-08'), /no <monat>/)
  })
  it('throws when any currency cannot be read — never stores part of a month', () => {
    for (const bad of [dev('eur', '1 USD', '0.93'), dev('usd', '1 USD', 'n/a'), dev('gbp', '1 GBP', '0'), dev('gbp', '0 GBP', '1.2'), '  <devise code="x1">?</devise>\n', dev('chf', '1 CHF', '1.0')]) {
      assert.throws(() => parseBazgMonthly(xml('2026-08', dev('chf', '1 CHF', '1.0') + bad), '2026-08'), /unreadable currencies/)
    }
  })
  it('throws on a month with no currencies', () => {
    assert.throws(() => parseBazgMonthly(xml('2026-08', ''), '2026-08'), /no currencies/)
  })
})

describe('monthsBetween', () => {
  it('lists the months of a quarter', () => assert.deepEqual(monthsBetween('2026-07-01', '2026-09-30'), ['2026-07', '2026-08', '2026-09']))
  it('crosses a year', () => assert.deepEqual(monthsBetween('2026-11-15', '2027-02-01'), ['2026-11', '2026-12', '2027-01', '2027-02']))
  it('caps at 24 months', () => assert.equal(monthsBetween('2020-01-01', '2026-12-31').length, 24))
})

function fakeDb(existing: string[] = []) {
  const rows: Array<Record<string, unknown>> = []
  const had = new Set(existing)
  return {
    rows,
    db: {
      vatFxRate: {
        count: async ({ where }: { where: { validFor: Date } }) => (had.has(where.validFor.toISOString().slice(0, 7)) ? 3 : 0),
        createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => { rows.push(...data); return { count: data.length } },
      },
    } as never,
  }
}

describe('ensureMonthlyFxRates', () => {
  it('fetches only missing months and stores them as monthly version 1', async () => {
    const asked: string[] = []
    const { db, rows } = fakeDb(['2026-07'])
    const out = await ensureMonthlyFxRates(db, ['2026-08', '2026-07', '2026-08'], {
      memory: new Map(),
      now: () => new Date('2026-09-30T10:00:00Z'),
      fetchImpl: async (url) => { asked.push(url); return { ok: true, status: 200, text: async () => xml('2026-08', dev('eur', '1 EUR', '0.9328')) } },
    })
    assert.deepEqual(asked, ['https://www.backend-rates.bazg.admin.ch/api/xmlavgmonth?j=2026&m=08&locale=de'])
    assert.deepEqual(out, [{ month: '2026-07', status: 'had', count: 3 }, { month: '2026-08', status: 'stored', count: 1 }])
    assert.equal(rows.length, 1)
    assert.equal(rows[0].kind, 'monthly')
    assert.equal((rows[0].validFor as Date).toISOString(), '2026-08-01T00:00:00.000Z')
    assert.equal(rows[0].currency, 'EUR')
    assert.equal(rows[0].rate, '0.9328')
    assert.equal(rows[0].version, 1)
  })
  it('does not store a wrong month, an unpublished month, or an HTTP error — and keeps going', async () => {
    const { db, rows } = fakeDb()
    const answers: Record<string, () => { ok: boolean; status: number; text: () => Promise<string> }> = {
      '09': () => ({ ok: true, status: 200, text: async () => xml('2026-10', dev('eur', '1 EUR', '0.95')) }),
      '10': () => ({ ok: true, status: 200, text: async () => '<monatsmittelkurs xmlns="x"/>' }),
      '11': () => ({ ok: false, status: 503, text: async () => '' }),
    }
    let calls = 0
    let clock = Date.parse('2026-09-30T10:00:00Z')
    const memory = new Map<string, MissedMonth>()
    const opts = { memory, now: () => new Date(clock), fetchImpl: async (url: string) => { calls++; return answers[/m=(\d\d)/.exec(url)![1]]() } }
    const out = await ensureMonthlyFxRates(db, ['2026-09', '2026-10', '2026-11', 'bad'], opts)
    assert.deepEqual(out.map((o) => o.status), ['failed', 'not_published', 'failed'])
    assert.match(out[0].error!, /got 2026-10/)
    assert.match(out[2].error!, /HTTP 503/)
    assert.equal(rows.length, 0)
    const again = await ensureMonthlyFxRates(db, ['2026-10', '2026-11'], opts)
    assert.equal(calls, 3)
    assert.deepEqual(again.map((o) => o.status), ['not_published', 'failed'])
    assert.match(again[1].error!, /HTTP 503.*tried recently/)
    clock += 11 * 60_000
    await ensureMonthlyFxRates(db, ['2026-10'], opts)
    assert.equal(calls, 4)
  })
})

import { fetchFxMonthlyRates } from './fx-bazg'
import { v5Handles, v8Handles } from './v5-handles'
import { entryCtx } from './handles'

function storedDb(rows: Array<{ month: string; currency: string; unit: number; rate: number; version?: number }>) {
  return {
    vatFxRate: {
      count: async ({ where }: { where: { validFor: Date } }) => rows.filter((r) => r.month === where.validFor.toISOString().slice(0, 7)).length,
      createMany: async () => { throw new Error('must not fetch') },
      findMany: async ({ where }: { where: { validFor: { in: Date[] }; currency?: { in: string[] } } }) => rows
        .filter((r) => where.validFor.in.some((d) => d.toISOString().slice(0, 7) === r.month) && (!where.currency || where.currency.in.includes(r.currency)))
        .map((r) => ({ validFor: new Date(`${r.month}-01T00:00:00Z`), currency: r.currency, unit: r.unit, rate: { toFixed: (n: number) => r.rate.toFixed(n) }, version: r.version ?? 1, source: 'x' })),
    },
  } as never
}

describe('fetchFxMonthlyRates - version 8 handle', () => {
  const db = storedDb([{ month: '2026-07', currency: 'EUR', unit: 1, rate: 0.93 }, { month: '2026-07', currency: 'USD', unit: 1, rate: 0.8 }, { month: '2026-08', currency: 'EUR', unit: 1, rate: 0.94 }])
  it('months already present = no call - currencies filtered in uppercase - same shape the tool returned', async () => {
    const r = await fetchFxMonthlyRates(db, { months: ['2026-07', '2026-08', '2026-07'], currencies: ['eur'] })
    assert.deepEqual(r, {
      months: [{ month: '2026-07', status: 'had' }, { month: '2026-08', status: 'had' }].map((m) => ({ ...m })),
      rates: [{ month: '2026-07', currency: 'EUR', unit: 1, rate: '0.930000' }, { month: '2026-08', currency: 'EUR', unit: 1, rate: '0.940000' }],
    } as never)
  })
  it('wrong input = INVALID - month shape, 25 months, empty list, currency shape, 21 currencies', async () => {
    const bad = async (q: { months: unknown[]; currencies: unknown[] }, re: RegExp) => assert.rejects(fetchFxMonthlyRates(db, q), (e: unknown) => (e as { code?: string }).code === 'INVALID' && re.test(String((e as { detail?: string }).detail)))
    await bad({ months: ['2026-7'], currencies: ['EUR'] }, /month must be YYYY-MM: 2026-7/)
    await bad({ months: [''], currencies: ['EUR'] }, /month must be YYYY-MM: $/)
    await bad({ months: ['', '2026-13'], currencies: ['EUR'] }, /month must be YYYY-MM/)
    await bad({ months: Array.from({ length: 25 }, (_, i) => `${2024 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`), currencies: ['EUR'] }, /at most 24 months/)
    await bad({ months: [], currencies: ['EUR'] }, /months is required/)
    await bad({ months: ['2026-07'], currencies: [] }, /currencies is required/)
    await bad({ months: ['2026-07'], currencies: ['EURO'] }, /ISO codes like EUR: EURO/)
    await bad({ months: ['2026-07'], currencies: Array.from({ length: 21 }, (_, i) => `C${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`) }, /at most 20 currencies/)
    assert.equal((await fetchFxMonthlyRates(db, { months: ['2026-07'], currencies: Array.from({ length: 21 }, () => 'eur') })).rates.length, 1)
  })
})

describe('version boundary - fetchFxMonthly only in version 8 tool and module ctx, deps only in version 1', () => {
  const deps = { db: storedDb([]) } as never
  it('v8Handles - version null, 1, 7 = none - version 8 = present', () => {
    for (const core of [null, 1, 7]) assert.deepEqual(Object.keys(v8Handles(core, deps)), [], String(core))
    assert.deepEqual(Object.keys(v8Handles(8, deps)), ['fetchFxMonthly'])
  })
  it('version 7 fxMonthly(currency, date) stays in version 8 - the names differ', () => {
    const v = v5Handles(8, { deps, userId: 'u', projectId: 'p' })
    assert.equal(typeof v.fxMonthly, 'function')
    assert.equal('fetchFxMonthly' in v, false)
  })
  it('run ctx assembly - version 1 = deps, no fetchFxMonthly - version 8 = the opposite', () => {
    const c1 = entryCtx({ ...v8Handles(1, deps) }, 1, deps, {}) as Record<string, unknown>
    assert.ok('deps' in c1 && !('fetchFxMonthly' in c1))
    const c8 = entryCtx({ ...v8Handles(8, deps) }, 8, deps, {}) as Record<string, unknown>
    assert.ok(!('deps' in c8) && typeof c8.fetchFxMonthly === 'function')
  })
})

describe('prepareCalc - version 8 VAT looks at the table for each month of the task period', () => {
  const fake = (kind: string, asked: string[]) => ({
    db: {
      workProject: { findFirst: async () => ({ kind }) },
      workTask: { findFirst: async () => ({ periodStart: new Date('2026-07-01T00:00:00Z'), periodEnd: new Date('2026-09-30T00:00:00Z') }) },
      vatFxRate: { count: async ({ where }: { where: { validFor: Date } }) => { asked.push(where.validFor.toISOString().slice(0, 7)); return 1 } },
    },
  }) as never
  it('VAT (fetchFxMonthly) = months 7, 8, 9 - an app without a calc module looks at nothing', cloudOnly, async () => {
    const { prepareCalc } = await import('./projects')
    const asked: string[] = []
    await prepareCalc(fake('vat', asked), 'u', 't', 'p')
    assert.deepEqual(asked.sort(), ['2026-07', '2026-08', '2026-09'])
    const none: string[] = []
    await prepareCalc(fake('ledger', none), 'u', 't', 'p')
    assert.deepEqual(none, [])
  })
})
