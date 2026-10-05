
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  computeVatReturn,
  formatCents,
  parseCents,
  type Basis,
  type FxQuote,
  type VatBoxKey,
  type VatCode,
} from './estv'
import { normalizeRow } from '@/lib/work/sheet-columns'
import { templateSchema } from '@/lib/work/sheet-templates'
import { VAT_SHEET_TEMPLATES, VAT_FAMILY } from './templates'
import { toVatReturnInput, type SheetRowLike } from './modules/boxes'

interface RowRef { date: string; amount: string }
interface GoldenCase {
  name: string
  csv: string
  period: [string, string]
  basis: Basis
  roundTo5Rappen: boolean
  expect: Partial<Record<VatBoxKey, string>>
  invoiceOverrides?: Array<{ match: RowRef; amountGross: string; invoiceVat: string }>
  excludeRows?: RowRef[]
  addInvoices?: Array<{ invoiceDate: string; currency: string; amountGross: string; rate: string; vatCode: VatCode }>
}
interface GoldenFile { nonConsiderationIndex: string[]; cases: GoldenCase[] }

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++ } else if (ch === '"') q = false
      else cur += ch
    } else if (ch === '"') q = true
    else if (ch === ',') { row.push(cur); cur = '' } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cur); cur = ''
      if (row.some((c) => c !== '')) rows.push(row)
      row = []
    } else cur += ch
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row) }
  const [head, ...body] = rows
  const h = head.map((c) => c.replace(/^\uFEFF/, ''))
  return body.map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ''])))
}

const isZero = (s: string) => !s || parseCents(s) === BigInt(0)
const same = (r: Record<string, string>, m: RowRef) => r.date === m.date && parseCents(r.real_amount) === parseCents(m.amount)

const template = (family: string) => VAT_SHEET_TEMPLATES.find((t) => t.family === family)!

function sheetRow(family: string, id: string, data: Record<string, unknown>): SheetRowLike {
  const t = template(family)
  const { plain, sealed } = normalizeRow(templateSchema(t), data)
  const full = { ...plain, ...(sealed ?? {}) }
  const why = t.checkRow?.(full)
  if (why) throw new Error(`${family} ${id}: ${why}`)
  return { id, data: full, confirmed: true }
}

function load(dir: string, gf: GoldenFile, c: GoldenCase) {
  const rows = parseCsv(readFileSync(join(dir, c.csv), 'utf8'))
  const transactions: SheetRowLike[] = []
  const invoices: SheetRowLike[] = []
  const csvLine = new Map<string, { gross: string; vatChf: string; label: string }>()
  const fxByKey = new Map<string, FxQuote>()
  const fxConflicts: string[] = []

  rows.forEach((r, n) => {
    const id = `L${n + 2}`
    if (c.excludeRows?.some((m) => same(r, m))) return
    const type = r.transaction_type
    const vatCode: VatCode =
      type === 'income'
        ? gf.nonConsiderationIndex.includes(r.index) ? 'non_consideration' : isZero(r.vat) ? 'foreign_income' : 'ch_standard'
        : isZero(r.vat_chf) ? 'no_vat' : 'ch_standard'
    csvLine.set(id, {
      gross: type === 'income' ? r.income_chf : r.expenses_chf,
      vatChf: r.vat_chf,
      label: `${id} ${r.date} ${r.currency} ${r.real_amount} ${type}/${r.index}`,
    })

    if (c.basis === 'cash') {
      transactions.push(sheetRow(VAT_FAMILY.transactions, id, {
        accountKey: 'golden', bankRowKey: `g:${id}`, date: r.date, currency: r.currency, amount: r.real_amount,
        direction: type === 'expense' ? 'out' : 'in', type, vatCode,
        ...(r.currency === 'CHF' ? {} : { fxRate: r.ch_rate, fxUnit: 1 }),
      }))
    } else {
      if (type !== 'income' && type !== 'expense') return
      const o = c.invoiceOverrides?.find((x) => same(r, x.match))
      invoices.push(sheetRow(VAT_FAMILY.invoices, id, {
        direction: type === 'income' ? 'issued' : 'received', invoiceDate: r.date, taxDate: r.date, currency: r.currency,
        amountGross: o ? o.amountGross : r.real_amount,
        invoiceVat: o ? o.invoiceVat : type === 'expense' && !isZero(r.vat) ? r.vat : null, vatCode, dedupKey: `g:${id}`,
      }))
      if (r.currency !== 'CHF') {
        const k = `${r.currency}|${r.date}`
        const prev = fxByKey.get(k)
        if (prev && prev.rate !== r.ch_rate) fxConflicts.push(`${k}: ${prev.rate} vs ${r.ch_rate}`)
        fxByKey.set(k, { rate: r.ch_rate, unit: 1 })
      }
    }
  })

  for (const [k, a] of (c.addInvoices ?? []).entries()) {
    invoices.push(sheetRow(VAT_FAMILY.invoices, `add${k}`, {
      direction: 'issued', invoiceDate: a.invoiceDate, taxDate: a.invoiceDate, currency: a.currency, amountGross: a.amountGross,
      vatCode: a.vatCode, dedupKey: `g:add${k}`,
    }))
    fxByKey.set(`${a.currency}|${a.invoiceDate}`, { rate: a.rate, unit: 1 })
  }

  return { transactions, invoices, csvLine, fxByKey, fxConflicts }
}

const dir = process.env.VAT_GOLDEN_DIR

describe('VAT golden - owner actual submitted boxes', () => {
  if (!dir) {
    it('skipped when VAT_GOLDEN_DIR is not set', () => {
      console.log('ℹ️  VAT_GOLDEN_DIR 가 없어 골든 테스트를 건너뛴다 (실제 자료는 리포 밖)')
    })
    return
  }

  const gf = JSON.parse(readFileSync(join(dir, 'vat_golden.json'), 'utf8')) as GoldenFile

  for (const c of gf.cases) {
    it(c.name, () => {
      const d = load(dir, gf, c)
      assert.deepEqual(d.fxConflicts, [], '같은 날·같은 통화에 환율이 둘 — agreed 골든 입력을 고쳐야 한다')
      const r = computeVatReturn(toVatReturnInput(
        { transactions: d.transactions, invoices: d.invoices, payments: [], adjustments: [], transitions: [], pairs: [] },
        {
          basis: c.basis,
          roundTo5Rappen: c.roundTo5Rappen,
          period: { start: c.period[0], end: c.period[1] },
          declare383: false,
          box415: null,
          fx: (cur, date) => d.fxByKey.get(`${cur}|${date}`) ?? null,
        },
      ))
      assert.deepEqual(r.fxMissing, [])
      assert.deepEqual(r.errors, [])
      assert.ok(r.boxes)

      const lineDiffs: string[] = []
      if (c.basis === 'cash') {
        for (const l of r.lines) {
          const ref = d.csvLine.get(l.id)
          if (!ref) continue
          const gross = l.contributions[200] ?? l.contributions['383_base']
          if (gross != null && ref.gross && gross !== parseCents(ref.gross)) {
            lineDiffs.push(`${ref.label}: 총액 앱 ${formatCents(gross)} / CSV ${ref.gross}`)
          }
          const vat = l.contributions[400]
          if (vat != null && vat !== parseCents(ref.vatChf)) {
            lineDiffs.push(`${ref.label}: 매입세 앱 ${formatCents(vat)} / CSV ${ref.vatChf} (${formatCents(vat - parseCents(ref.vatChf))})`)
          }
        }
      }

      const boxDiffs: string[] = []
      for (const [k, want] of Object.entries(c.expect) as Array<[VatBoxKey, string]>) {
        const got = r.boxes[k]
        if (got !== parseCents(want)) boxDiffs.push(`칸 ${k}: 앱 ${formatCents(got)} / 제출 ${want} (${formatCents(got - parseCents(want))})`)
      }
      if (lineDiffs.length) console.log(`  [${c.name}] CSV 와 다른 줄:\n    ${lineDiffs.join('\n    ')}`)
      assert.deepEqual(boxDiffs, [], `${c.name} — 칸이 다르다`)
    })
  }
})
