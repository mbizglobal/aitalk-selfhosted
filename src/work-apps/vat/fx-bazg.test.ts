
import { describe, it } from 'node:test'
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
