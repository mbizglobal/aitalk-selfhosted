
import { isCalendarDate } from '@/lib/work/package-api'

const B0 = BigInt(0)
const B1 = BigInt(1)
const B2 = BigInt(2)
const B5 = BigInt(5)
const B100 = BigInt(100)
const abs = (v: bigint) => (v < B0 ? -v : v)
const MICRO = BigInt(1_000_000)

export const VAT_RATES_PERMILLE = { standard: 81 } as const
const RATE = BigInt(VAT_RATES_PERMILLE.standard)
const RATE_PLUS_1000 = RATE + BigInt(1000)

export interface VatCoreIssue { code: string; params?: Record<string, string> }
export class VatCoreError extends Error {
  constructor(readonly code: string, message: string, readonly params?: Record<string, string>) {
    super(message)
    this.name = 'VatCoreError'
  }
}
const coreStop = (code: string, message: string, params?: Record<string, string>) => new VatCoreError(code, message, params)

export function roundDiv(n: bigint, d: bigint): bigint {
  if (d <= B0) throw coreStop('core_internal', 'roundDiv: 분모는 양수여야 한다')
  const q = n / d
  const r = n % d
  const absR = r < B0 ? -r : r
  if (absR * B2 >= d) return n < B0 ? q - B1 : q + B1
  return q
}

function parseFixed(s: string, scale: number, what: string): bigint {
  const t = String(s).trim()
  const m = /^([+-])?(\d+)(?:\.(\d+))?$/.exec(t)
  if (!m) throw coreStop('core_bad_number', `${what}: 숫자가 아니다 (${t})`)
  const frac = m[3] ?? ''
  if (frac.length > scale) throw coreStop('core_bad_number', `${what}: 소수 ${scale}자리를 넘는다 (${t})`)
  const v = BigInt(m[2] + frac.padEnd(scale, '0'))
  return m[1] === '-' ? -v : v
}

export function parseCents(s: string): bigint {
  return parseFixed(s, 2, '금액')
}

export function parseMicros(s: string): bigint {
  return parseFixed(s, 6, '환율')
}

/** 12345 → "123.45", -5 → "-0.05" */
export function formatCents(c: bigint): string {
  const neg = c < B0
  const a = neg ? -c : c
  const frac = (a % B100).toString().padStart(2, '0')
  return `${neg ? '-' : ''}${(a / B100).toString()}.${frac}`
}

export interface FxQuote {
  rate: string
  unit: number
}

interface ParsedFx { micros: bigint; unit: bigint }

function parseFx(q: FxQuote | null | undefined): ParsedFx | null {
  if (!q) return null
  const micros = parseMicros(q.rate)
  if (micros <= B0 || !Number.isInteger(q.unit) || q.unit <= 0) return null
  return { micros, unit: BigInt(q.unit) }
}

export function toChf(cents: bigint, fx: ParsedFx): bigint {
  return roundDiv(cents * fx.micros, fx.unit * MICRO)
}

export function reverseVat(grossCents: bigint): bigint {
  return roundDiv(grossCents * RATE, RATE_PLUS_1000)
}

export type Basis = 'cash' | 'agreed'
export type TxType = 'income' | 'expense' | 'internal' | 'other'
export type VatCode = 'ch_standard' | 'foreign_income' | 'no_vat' | 'non_consideration' | 'acquisition_383'

export type IsoDate = string

export type FxLookup = (currency: string, date: IsoDate) => FxQuote | null

export interface VatTxInput {
  id: string
  date: IsoDate
  currency: string
  amount: string
  direction: 'in' | 'out'
  type: TxType
  vatCode: VatCode
  confirmed: boolean
  fxOverride?: FxQuote | null
}

export interface VatInvoiceInput {
  id: string
  direction: 'issued' | 'received'
  invoiceDate: IsoDate
  receivedAt?: IsoDate | null
  currency: string
  amountGross: string
  invoiceVat?: string | null
  vatCode: VatCode
  confirmed: boolean
}

export interface VatPaymentInput {
  id: string
  invoiceId: string | null
  transactionId: string
  txDate: IsoDate
  kind: 'payment' | 'advance'
  amountTx: string
  amountInv: string | null
  confirmed: boolean
}

export type AdjustmentKind = 'bad_debt' | 'discount' | 'recovery' | 'advance_offset' | 'transition'

export interface VatAdjustmentInput {
  id: string
  kind: AdjustmentKind
  invoiceId: string | null
  invoiceDirection: 'issued' | 'received'
  invoiceVatCode: VatCode
  amountChf: string
  vatChf: string
  confirmed: boolean
  toBasis?: Basis
  ref?: TransitionRef
}

export interface VatReturnInput {
  basis: Basis
  roundTo5Rappen: boolean
  period: { start: IsoDate; end: IsoDate }
  transactions: VatTxInput[]
  invoices?: VatInvoiceInput[]
  payments?: VatPaymentInput[]
  adjustments?: VatAdjustmentInput[]
  declare383: boolean
  box415: string | null
  fx: FxLookup
  onlyConfirmed?: boolean
}

export interface VatBoxes {
  200: bigint
  221: bigint
  235: bigint
  289: bigint
  299: bigint
  303: bigint
  '303_tax': bigint
  383: bigint
  '383_tax': bigint
  399: bigint
  400: bigint
  415: bigint
  479: bigint
  500: bigint
  510: bigint
}

export type VatBoxKey = keyof VatBoxes

export interface VatLine {
  kind: 'tx' | 'invoice' | 'advance' | 'adjustment'
  id: string
  contributions: Partial<Record<VatBoxKey | '383_base' | 'domestic', bigint>>
}

export interface VatIssue {
  kind: 'tx' | 'invoice' | 'advance' | 'adjustment' | 'payment'
  id: string
  currency?: string
  date?: IsoDate
}

export interface VatReturnResult {
  boxes: VatBoxes | null
  acquisition383Base: bigint
  fxMissing: VatIssue[]
  unconfirmed: VatIssue[]
  advanceCandidates: Array<{ id: string; remaining: bigint }>
  errors: string[]
  issues: VatCoreIssue[]
  lines: VatLine[]
}

const ZERO_BOXES = (): VatBoxes => ({
  200: B0, 221: B0, 235: B0, 289: B0, 299: B0, 303: B0, '303_tax': B0,
  383: B0, '383_tax': B0, 399: B0, 400: B0, 415: B0, 479: B0, 500: B0, 510: B0,
})

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export { isCalendarDate }

function assertDate(d: unknown, what: string): void {
  if (typeof d !== 'string' || !DATE_RE.test(d)) throw coreStop('core_bad_date', `${what}: 날짜 형식이 아니다 (${String(d)})`)
  if (!isCalendarDate(d)) throw coreStop('core_bad_date', `${what}: 달력에 없는 날짜 (${d})`) // R2 codex
}
function assertUniqueIds(rows: Array<{ id: string }>, what: string): void {
  const seen = new Set<string>()
  for (const r of rows) {
    if (seen.has(r.id)) throw coreStop('core_internal', `${what}: id 가 두 번 들어왔다 (${r.id})`)
    seen.add(r.id)
  }
}
const ALLOWED_CODES: Record<'issued' | 'received', VatCode[]> = {
  issued: ['ch_standard', 'foreign_income', 'non_consideration', 'no_vat'],
  received: ['ch_standard', 'no_vat', 'acquisition_383'],
}

function validateInputs(
  txs: VatTxInput[],
  invoices: VatInvoiceInput[],
  payments: VatPaymentInput[],
  adjustments: Array<Pick<VatAdjustmentInput, 'id' | 'kind' | 'amountChf' | 'vatChf' | 'invoiceDirection' | 'invoiceVatCode'>>,
) {
  assertUniqueIds(txs, '거래')
  assertUniqueIds(invoices, '인보이스')
  assertUniqueIds(payments, '짝')
  assertUniqueIds(adjustments, '정정')
  for (const t of txs) {
    assertDate(t.date, `거래 ${t.id}`)
    if (parseCents(t.amount) < B0) throw coreStop('tx_negative_amount', `거래 ${t.id}: 금액은 음수가 될 수 없다`)
  }
  for (const i of invoices) {
    assertDate(i.invoiceDate, `인보이스 ${i.id}`)
    if (i.receivedAt != null) assertDate(i.receivedAt, `인보이스 ${i.id} receivedAt`)
    if (!ALLOWED_CODES[i.direction].includes(i.vatCode)) throw coreStop('invoice_code_direction', `인보이스 ${i.id}: ${i.direction} 인보이스에 ${i.vatCode} 코드는 쓸 수 없다`, { direction: i.direction, vatCode: i.vatCode })
    if (i.invoiceVat != null && i.vatCode !== 'ch_standard' && parseCents(i.invoiceVat) !== B0) {
      throw coreStop('invoice_vat_needs_standard', `인보이스 ${i.id}: 스위스 VAT 가 적혀 있으면 ch_standard 여야 한다`)
    }
    if (i.invoiceVat != null) {
      const v = parseCents(i.invoiceVat)
      const g = parseCents(i.amountGross)
      if (v !== B0 && (v < B0) !== (g < B0)) throw coreStop('invoice_vat_sign', `인보이스 ${i.id}: VAT 부호가 총액 부호와 다르다`)
    }
  }
  for (const p of payments) {
    assertDate(p.txDate, `짝 ${p.id}`)
    if (parseCents(p.amountTx) <= B0) throw coreStop('pair_amount_not_positive', `짝 ${p.id}: amountTx 는 양수여야 한다`)
  }
  const txDate = new Map(txs.map((t) => [t.id, t.date]))
  for (const p of payments) {
    const d = txDate.get(p.transactionId)
    if (d != null && d !== p.txDate) throw coreStop('pair_date_mismatch', `짝 ${p.id}: txDate(${p.txDate}) 가 거래 날짜(${d}) 와 다르다`)
  }
  const txById = new Map(txs.map((t) => [t.id, t]))
  const invById = new Map(invoices.map((i) => [i.id, i]))
  for (const p of payments) {
    if (p.kind === 'payment' && !p.invoiceId) throw coreStop('payment_without_invoice', `짝 ${p.id}: 결제 짝에 인보이스가 없다`)
    if (!p.invoiceId) continue
    const t = txById.get(p.transactionId)
    const inv = invById.get(p.invoiceId)
    if (!inv) throw coreStop('pair_target_missing', `짝 ${p.id}: 인보이스 ${p.invoiceId} 가 입력에 없다`)
    if (!t) throw coreStop('pair_target_missing', `짝 ${p.id}: 거래 ${p.transactionId} 가 입력에 없다`)
    if (parseCents(inv.amountGross) === B0) throw coreStop('pair_zero_invoice', `짝 ${p.id}: 0원 인보이스 ${inv.id} 에는 짝을 붙이지 않는다`)
    if (p.kind === 'advance' && (inv.direction !== 'issued' || parseCents(inv.amountGross) < B0)) {
      throw coreStop('advance_invoice_kind', `선불 짝 ${p.id}: 보낸 양수 인보이스에만 붙는다 (${inv.id})`)
    }
    if (p.kind === 'payment') {
      const want = t.type === 'income' ? 'issued' : t.type === 'expense' ? 'received' : null
      if (want !== inv.direction) throw coreStop('payment_type_direction', `짝 ${p.id}: 거래 종류(${t.type}) 와 인보이스 방향(${inv.direction}) 이 맞지 않는다`, { type: t.type, direction: inv.direction })
      const positive = parseCents(inv.amountGross) > B0
      const wantDir = (inv.direction === 'issued') === positive ? 'in' : 'out'
      if (t.direction !== wantDir) throw coreStop('payment_sign_direction', `짝 ${p.id}: 인보이스 부호와 거래 방향(${t.direction}) 이 맞지 않는다`, { direction: t.direction })
    }
    if (p.amountInv != null && t.currency === inv.currency && abs(parseCents(p.amountInv)) !== parseCents(p.amountTx)) {
      throw coreStop('pair_amounts_differ', `짝 ${p.id}: 통화가 같은데 amountTx 와 amountInv 가 다르다`)
    }
  }
  for (const p of payments) {
    if (p.kind !== 'advance') continue
    const t = txById.get(p.transactionId)
    if (!t) throw coreStop('pair_target_missing', `선불 짝 ${p.id}: 거래 ${p.transactionId} 가 입력에 없다`)
    if (t.type !== 'income' || t.direction !== 'in') throw coreStop('advance_tx_kind', `선불 짝 ${p.id}: 매출 입금(income·in)이 아닌 거래 ${t.id} 에 붙었다`)
  }
  const used = new Map<string, bigint>()
  for (const p of payments) used.set(p.transactionId, (used.get(p.transactionId) ?? B0) + parseCents(p.amountTx))
  for (const [id, u] of used) {
    const t = txById.get(id)
    if (t && u > parseCents(t.amount)) throw coreStop('tx_overallocated', `거래 ${id}: 짝 금액 합이 거래 금액을 넘는다`)
  }
  for (const a of adjustments) {
    if (!ALLOWED_CODES[a.invoiceDirection].includes(a.invoiceVatCode)) {
      throw coreStop('adjustment_code_direction', `정정 ${a.id}: ${a.invoiceDirection} 에 ${a.invoiceVatCode} 코드는 쓸 수 없다`, { direction: a.invoiceDirection, vatCode: a.invoiceVatCode })
    }
    if (a.invoiceDirection === 'issued' && a.invoiceVatCode === 'no_vat') throw coreStop('exempt_sales', `정정 ${a.id}: 면세 매출은 범위 밖이다 (§1 대상)`)
    if (a.kind === 'transition') continue
    if (parseCents(a.amountChf) < B0 || parseCents(a.vatChf) < B0) throw coreStop('adjustment_negative', `정정 ${a.id}: 금액은 음수가 될 수 없다`)
  }
}

function inPeriod(d: IsoDate, p: { start: IsoDate; end: IsoDate }): boolean {
  return p.start <= d && d <= p.end
}

export function taxPoint(inv: Pick<VatInvoiceInput, 'direction' | 'invoiceDate' | 'receivedAt'>): IsoDate {
  return inv.direction === 'issued' ? inv.invoiceDate : (inv.receivedAt ?? inv.invoiceDate)
}

function txSign(t: Pick<VatTxInput, 'type' | 'direction'>): bigint {
  if (t.type === 'income') return t.direction === 'in' ? B1 : -B1
  return t.direction === 'out' ? B1 : -B1
}

function invoiceVatCents(inv: VatInvoiceInput): bigint {
  return inv.invoiceVat != null ? parseCents(inv.invoiceVat) : reverseVat(parseCents(inv.amountGross))
}

function paymentAmountInv(p: VatPaymentInput): bigint {
  if (p.amountInv == null) throw coreStop('pair_amount_inv_missing', `짝 ${p.id}: amountInv 가 없다`)
  const v = parseCents(p.amountInv)
  if (v === B0 && parseCents(p.amountTx) !== B0) throw coreStop('pair_amount_inv_zero', `짝 ${p.id}: amountInv 가 0 인데 amountTx 는 0 이 아니다`)
  return v
}

function settledInv(p: VatPaymentInput, total: bigint): bigint {
  const v = abs(paymentAmountInv(p))
  return total < B0 ? -v : v
}

function byPaymentOrder(a: VatPaymentInput, b: VatPaymentInput): number {
  return a.txDate < b.txDate ? -1 : a.txDate > b.txDate ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function allocateInvoiceVat(inv: VatInvoiceInput, payments: VatPaymentInput[]): Map<string, bigint> {
  const out = new Map<string, bigint>()
  const total = parseCents(inv.amountGross)
  const vat = invoiceVatCents(inv)
  const mine = payments.filter((p) => p.invoiceId === inv.id && p.kind === 'payment').sort(byPaymentOrder)
  if (total === B0) {
    for (const p of mine) out.set(p.id, B0)
    return out
  }
  const absTotal = total < B0 ? -total : total
  let cum = B0
  let given = B0
  for (const p of mine) {
    cum += settledInv(p, total)
    const absCum = cum < B0 ? -cum : cum
    const target = absCum >= absTotal ? vat : roundDiv(cum * vat * (total < B0 ? -B1 : B1), absTotal)
    out.set(p.id, target - given)
    given = target
  }
  return out
}

function addSales(acc: Acc, line: VatLine, vatCode: VatCode, chf: bigint) {
  const { boxes } = acc
  if (vatCode === 'non_consideration') return
  boxes[200] += chf
  line.contributions[200] = (line.contributions[200] ?? B0) + chf
  if (vatCode === 'ch_standard') {
    acc.domestic += chf
    line.contributions.domestic = (line.contributions.domestic ?? B0) + chf
  } else if (vatCode === 'foreign_income') {
    boxes[221] += chf
    line.contributions[221] = (line.contributions[221] ?? B0) + chf
  }
}

interface Acc { boxes: VatBoxes; domestic: bigint }

function addInput(boxes: VatBoxes, line: VatLine, vatChf: bigint) {
  boxes[400] += vatChf
  line.contributions[400] = (line.contributions[400] ?? B0) + vatChf
}

export function computeVatReturn(input: VatReturnInput): VatReturnResult {
  const { basis, period, fx } = input
  const invoices = input.invoices ?? []
  const payments = input.payments ?? []
  const adjustments = input.adjustments ?? []
  const onlyConfirmed = input.onlyConfirmed ?? false
  assertDate(period.start, '분기 시작')
  assertDate(period.end, '분기 끝')
  if (period.start > period.end) throw coreStop('core_internal', `분기 시작(${period.start}) 이 끝(${period.end}) 보다 늦다`) // R4 grok
  validateInputs(input.transactions, invoices, payments, adjustments)

  const boxes = ZERO_BOXES()
  const acc: Acc = { boxes, domestic: B0 }
  let base383 = B0
  const fxMissing: VatIssue[] = []
  const unconfirmed: VatIssue[] = []
  const advanceCandidates: VatReturnResult['advanceCandidates'] = []
  const errors: string[] = []
  const issues: VatCoreIssue[] = []
  const lines: VatLine[] = []

  const invoiceById = new Map(invoices.map((i) => [i.id, i]))
  const txById = new Map(input.transactions.map((t) => [t.id, t]))

  const quote = (currency: string, date: IsoDate, override?: FxQuote | null): ParsedFx | null => {
    if (override) return parseFx(override)
    if (currency === 'CHF') return { micros: MICRO, unit: B1 }
    return parseFx(fx(currency, date))
  }

  if (basis === 'cash') {
    const vatShare = new Map<string, bigint>()
    for (const inv of invoices) for (const [k, v] of allocateInvoiceVat(inv, payments)) vatShare.set(k, v)

    for (const t of input.transactions) {
      if (!inPeriod(t.date, period)) continue
      if (!t.confirmed) unconfirmed.push({ kind: 'tx', id: t.id })
      if (t.type !== 'income' && t.type !== 'expense') continue
      if (onlyConfirmed && !t.confirmed) continue

      const sign = txSign(t)
      const line: VatLine = { kind: 'tx', id: t.id, contributions: {} }
      const txFx = quote(t.currency, t.date, t.fxOverride)
      const pairs = payments.filter((p) => p.transactionId === t.id && p.kind === 'payment' && p.invoiceId)
      let pairsOk = true
      for (const p of pairs) {
        if (!p.confirmed) { unconfirmed.push({ kind: 'payment', id: p.id }); pairsOk = false }
        const pi = invoiceById.get(p.invoiceId as string)
        if (pi && !pi.confirmed) { unconfirmed.push({ kind: 'invoice', id: pi.id }); pairsOk = false }
      }
      if (onlyConfirmed && !pairsOk) continue

      const parts: Array<{ vatCode: VatCode; gross: bigint; vat: bigint }> = []
      let missing = false
      let pairedTx = B0
      for (const p of pairs) {
        const inv = invoiceById.get(p.invoiceId as string)
        if (!inv) throw coreStop('pair_target_missing', `짝 ${p.id}: 인보이스 ${p.invoiceId} 가 입력에 없다`)
        pairedTx += parseCents(p.amountTx)
        const invFx = inv.currency === t.currency ? txFx : quote(inv.currency, t.date)
        if (!invFx) { fxMissing.push({ kind: 'tx', id: t.id, currency: inv.currency, date: t.date }); missing = true; continue }
        parts.push({
          vatCode: inv.vatCode,
          gross: abs(toChf(paymentAmountInv(p), invFx)),
          vat: abs(toChf(vatShare.get(p.id) ?? B0, invFx)),
        })
      }
      const rest = parseCents(t.amount) - pairedTx
      if (rest > B0) {
        if (!txFx) { fxMissing.push({ kind: 'tx', id: t.id, currency: t.currency, date: t.date }); missing = true }
        else {
          parts.push({ vatCode: t.vatCode, gross: toChf(rest, txFx), vat: t.vatCode === 'ch_standard' ? toChf(reverseVat(rest), txFx) : B0 })
        }
      }
      if (missing) continue

      for (const part of parts) {
        const g = part.gross * sign
        if (t.type === 'income') {
          addSales(acc, line, part.vatCode, g)
        } else if (part.vatCode === 'ch_standard') {
          addInput(boxes, line, part.vat * sign)
        } else if (part.vatCode === 'acquisition_383') {
          base383 += g
          line.contributions['383_base'] = (line.contributions['383_base'] ?? B0) + g
        }
      }
      lines.push(line)
    }
  } else {
    const advanceByInvoice = new Map<string, bigint>()
    const unconfirmedAdvanceByInvoice = new Map<string, string[]>()
    for (const p of payments) {
      if (p.kind !== 'advance' || !p.invoiceId) continue
      const t = txById.get(p.transactionId) as VatTxInput
      if (!p.confirmed || !t.confirmed) {
        unconfirmedAdvanceByInvoice.set(p.invoiceId, [...(unconfirmedAdvanceByInvoice.get(p.invoiceId) ?? []), p.id])
        if (onlyConfirmed) continue
      }
      advanceByInvoice.set(p.invoiceId, (advanceByInvoice.get(p.invoiceId) ?? B0) + abs(paymentAmountInv(p)))
    }

    for (const inv of invoices) {
      const tp = taxPoint(inv)
      if (!inPeriod(tp, period)) continue
      const total = parseCents(inv.amountGross)
      if (total === B0) continue
      if (!inv.confirmed) unconfirmed.push({ kind: 'invoice', id: inv.id })
      for (const pid of unconfirmedAdvanceByInvoice.get(inv.id) ?? []) unconfirmed.push({ kind: 'advance', id: pid })
      if (onlyConfirmed && !inv.confirmed) continue
      const invFx = quote(inv.currency, tp)
      if (!invFx) { fxMissing.push({ kind: 'invoice', id: inv.id, currency: inv.currency, date: tp }); continue }
      const line: VatLine = { kind: 'invoice', id: inv.id, contributions: {} }

      if (inv.direction === 'issued') {
        let taxable = total
        if (total > B0) {
          const adv = advanceByInvoice.get(inv.id) ?? B0
          taxable = total - (adv < total ? adv : total)
        }
        addSales(acc, line, inv.vatCode, toChf(taxable, invFx))
      } else if (inv.vatCode === 'ch_standard') {
        addInput(boxes, line, toChf(invoiceVatCents(inv), invFx))
      } else if (inv.vatCode === 'acquisition_383') {
        const g = toChf(total, invFx)
        base383 += g
        line.contributions['383_base'] = g
      }
      lines.push(line)
    }

    const advanceRows = new Map<string, VatPaymentInput[]>()
    for (const p of payments) {
      if (p.kind !== 'advance') continue
      const rows = advanceRows.get(p.transactionId) ?? []
      rows.push(p)
      advanceRows.set(p.transactionId, rows)
    }
    for (const [txId, rows] of advanceRows) {
      const t = txById.get(txId) as VatTxInput
      if (!inPeriod(t.date, period)) continue
      if (!t.confirmed || rows.some((r) => !r.confirmed)) unconfirmed.push({ kind: 'advance', id: t.id })
      if (onlyConfirmed && !t.confirmed) continue
      const line: VatLine = { kind: 'advance', id: t.id, contributions: {} }
      let missing = false
      const parts: Array<{ vatCode: VatCode; chf: bigint }> = []
      for (const r of rows) {
        if (onlyConfirmed && !r.confirmed) continue
        const inv = r.invoiceId ? (invoiceById.get(r.invoiceId) as VatInvoiceInput) : null
        const cur = inv ? inv.currency : t.currency
        const f = quote(cur, t.date, cur === t.currency ? t.fxOverride : null)
        if (!f) { fxMissing.push({ kind: 'advance', id: t.id, currency: cur, date: t.date }); missing = true; continue }
        const amt = inv ? abs(paymentAmountInv(r)) : parseCents(r.amountTx)
        parts.push({ vatCode: inv ? inv.vatCode : t.vatCode, chf: toChf(amt, f) * txSign(t) })
      }
      if (missing) continue
      for (const part of parts) addSales(acc, line, part.vatCode, part.chf)
      lines.push(line)
    }

    const usedTx = new Map<string, bigint>()
    for (const p of payments) usedTx.set(p.transactionId, (usedTx.get(p.transactionId) ?? B0) + parseCents(p.amountTx))
    for (const t of input.transactions) {
      if (!inPeriod(t.date, period) || t.type !== 'income' || t.direction !== 'in') continue
      const remaining = parseCents(t.amount) - (usedTx.get(t.id) ?? B0)
      if (remaining > B0) advanceCandidates.push({ id: t.id, remaining })
    }
  }

  for (const a of adjustments) {
    if (!a.confirmed) unconfirmed.push({ kind: 'adjustment', id: a.id })
    if (onlyConfirmed && !a.confirmed) continue
    if (basis === 'cash' && (a.kind === 'bad_debt' || a.kind === 'recovery' || a.kind === 'advance_offset')) {
      errors.push(`정정 ${a.id}: cash 회사에는 ${a.kind} 정정이 없다`)
      issues.push({ code: 'cash_adjustment_kind', params: { kind: a.kind } })
      continue
    }
    applyAdjustment(acc, a, (l) => lines.push(l))
  }

  const tax383 = roundDiv(base383 * RATE, BigInt(1000))
  if (input.declare383) {
    boxes[383] = base383
    boxes['383_tax'] = tax383
    boxes[400] += tax383
  }

  boxes[303] = acc.domestic - boxes[235]
  boxes['303_tax'] = roundDiv(boxes[303] * RATE, RATE_PLUS_1000)
  boxes[289] = boxes[221] + boxes[235]
  boxes[299] = boxes[200] - boxes[289]
  boxes[399] = boxes['303_tax'] + boxes['383_tax']
  boxes[415] = input.box415 == null ? B0 : parseCents(input.box415)
  boxes[479] = boxes[400] - boxes[415]
  const net = boxes[399] - boxes[479]
  if (net >= B0) boxes[500] = input.roundTo5Rappen ? net - (net % B5) : net
  else {
    const refund = -net
    const rem = refund % B5
    boxes[510] = input.roundTo5Rappen && rem !== B0 ? refund + (B5 - rem) : refund
  }

  if (boxes[299] !== boxes[303]) {
    errors.push(`299(${formatCents(boxes[299])}) ≠ 303(${formatCents(boxes[303])}) — 국내·해외 구분이 없는 매출이 있거나 계산 오류`)
    issues.push({ code: 'box_299_303', params: { b299: formatCents(boxes[299]), b303: formatCents(boxes[303]) } })
  }

  return {
    boxes: fxMissing.length > 0 ? null : boxes,
    acquisition383Base: base383,
    fxMissing,
    unconfirmed,
    advanceCandidates,
    errors,
    issues,
    lines,
  }
}

function applyAdjustment(acc: Acc, a: VatAdjustmentInput, push: (l: VatLine) => void) {
  const { boxes } = acc
  const amt = parseCents(a.amountChf)
  const vat = parseCents(a.vatChf)
  const line: VatLine = { kind: 'adjustment', id: a.id, contributions: {} }
  const c = line.contributions
  const foreign = a.invoiceVatCode === 'foreign_income'
  const domesticSale = a.invoiceVatCode === 'ch_standard'

  let salesDown: bigint | null = null
  let inputDown: bigint | null = null

  switch (a.kind) {
    case 'bad_debt':
    case 'discount':
      if (a.invoiceDirection === 'issued') salesDown = amt
      else inputDown = vat
      break
    case 'recovery':
      if (a.invoiceDirection === 'issued') salesDown = -amt
      else inputDown = -vat
      break
    case 'advance_offset':
      if (a.invoiceDirection === 'issued') {
        boxes[200] -= amt
        c[200] = -amt
        if (domesticSale) { acc.domestic -= amt; c.domestic = -amt } else if (foreign) { boxes[221] -= amt; c[221] = -amt }
      }
      push(line)
      return
    case 'transition': {
      const s = a.toBasis === 'cash' ? -B1 : a.toBasis === 'agreed' ? B1 : null
      if (s == null) throw coreStop('transition_ref', `정정 ${a.id}: transition 에 toBasis 가 없다`)
      const valid = a.ref === '200+221' || a.ref === '400' || (a.ref === '235' && s < B0) || (a.ref === '200+303' && s > B0)
      if (!valid) throw coreStop('transition_ref', `정정 ${a.id}: transition ref(${a.ref}) 가 toBasis(${a.toBasis}) 와 맞지 않는다`)
      if (a.ref === '235') { boxes[235] += amt; c[235] = amt }
      else if (a.ref === '200+303') { boxes[200] += amt; acc.domestic += amt; c[200] = amt; c.domestic = amt }
      else if (a.ref === '200+221') { boxes[200] += s * amt; boxes[221] += s * amt; c[200] = s * amt; c[221] = s * amt }
      else { boxes[400] += s * vat; c[400] = s * vat }
      push(line)
      return
    }
  }

  if (salesDown != null) {
    if (foreign) {
      boxes[200] -= salesDown
      boxes[221] -= salesDown
      c[200] = -salesDown
      c[221] = -salesDown
    } else if (domesticSale) {
      boxes[235] += salesDown
      c[235] = salesDown
    }
  }
  if (inputDown != null && a.invoiceVatCode === 'ch_standard') {
    boxes[400] -= inputDown
    c[400] = -inputDown
  }
  push(line)
}

export interface TransitionItem {
  invoiceId: string
  direction: 'issued' | 'received'
  currency: string
  vatCode: VatCode
  openAmountInv: string
  fxRate: FxQuote
  baseChf: string
  vatChf: string
  ref: TransitionRef
}

export type TransitionRef = '235' | '200+303' | '200+221' | '400'

export interface TransitionBuildResult {
  ready: boolean
  items: TransitionItem[]
  fxMissing: VatIssue[]
  unconfirmed: VatIssue[]
}

export function buildTransitionItems(args: {
  toBasis: Basis
  transitionDate: IsoDate
  invoices: VatInvoiceInput[]
  payments: VatPaymentInput[]
  transactions: VatTxInput[]
  adjustmentsUpTo: Array<Pick<VatAdjustmentInput, 'id' | 'invoiceId' | 'kind' | 'confirmed'> & { amountInv: string | null }>
  fx: FxLookup
}): TransitionBuildResult {
  const { toBasis, transitionDate, fx } = args
  assertDate(transitionDate, '전환일')
  validateInputs(args.transactions, args.invoices, args.payments, [])
  assertUniqueIds(args.adjustmentsUpTo, '정정')
  const txById = new Map(args.transactions.map((t) => [t.id, t]))
  for (const p of args.payments) {
    if (!txById.has(p.transactionId)) throw coreStop('pair_target_missing', `짝 ${p.id}: 거래 ${p.transactionId} 가 입력에 없다`)
  }
  const items: TransitionItem[] = []
  const fxMissing: VatIssue[] = []
  const unconfirmed: VatIssue[] = []

  for (const inv of args.invoices) {
    const tp = taxPoint(inv)
    if (tp > transitionDate) continue
    const total = parseCents(inv.amountGross)
    if (total === B0) continue
    if (inv.direction === 'issued') {
      if (inv.vatCode === 'non_consideration') continue
    } else if (inv.vatCode !== 'ch_standard') continue
    if (!inv.confirmed) unconfirmed.push({ kind: 'invoice', id: inv.id })

    let paid = B0
    for (const p of args.payments) {
      if (p.invoiceId !== inv.id || p.txDate > transitionDate) continue
      if (!p.confirmed) unconfirmed.push({ kind: 'payment', id: p.id })
      const t = txById.get(p.transactionId) as VatTxInput
      if (!t.confirmed) unconfirmed.push({ kind: 'tx', id: t.id })
      paid += settledInv(p, total)
    }
    for (const a of args.adjustmentsUpTo) {
      if (a.invoiceId !== inv.id) continue
      if (a.kind === 'bad_debt' || a.kind === 'discount' || a.kind === 'advance_offset') {
        if (!a.confirmed) unconfirmed.push({ kind: 'adjustment', id: a.id })
        if (a.amountInv == null) throw coreStop('pair_amount_inv_missing', `정정(${a.kind}) — 인보이스 ${inv.id}: amountInv 가 없다`)
        const v = abs(parseCents(a.amountInv))
        paid += total < B0 ? -v : v
      }
    }
    const open = total - paid
    if (total > B0 ? open <= B0 : open >= B0) continue
    if (inv.direction === 'issued' && inv.vatCode !== 'ch_standard' && inv.vatCode !== 'foreign_income') {
      throw coreStop('exempt_sales', `인보이스 ${inv.id}: 면세 등 ${inv.vatCode} 매출은 범위 밖이다 (§1 대상)`)
    }

    const q = inv.currency === 'CHF' ? { rate: '1', unit: 1 } : fx(inv.currency, tp)
    const pf = parseFx(q)
    if (!q || !pf) { fxMissing.push({ kind: 'invoice', id: inv.id, currency: inv.currency, date: tp }); continue }
    const vatOpenInv = roundDiv(open * invoiceVatCents(inv) * (total < B0 ? -B1 : B1), total < B0 ? -total : total)
    const ref: TransitionItem['ref'] =
      inv.direction === 'received' ? '400'
        : inv.vatCode === 'foreign_income' ? '200+221'
          : toBasis === 'cash' ? '235' : '200+303'
    items.push({
      invoiceId: inv.id,
      direction: inv.direction,
      currency: inv.currency,
      vatCode: inv.vatCode,
      openAmountInv: formatCents(open),
      fxRate: q,
      baseChf: formatCents(toChf(open, pf)),
      vatChf: formatCents(toChf(vatOpenInv, pf)),
      ref,
    })
  }
  return { ready: unconfirmed.length === 0 && fxMissing.length === 0, items, fxMissing, unconfirmed }
}
