
import { WorkError, moduleStop, type CalcModuleCtx, type V1CalcWorkModule as CalcWorkModule, type PreviewStop, type ReadRow } from '@/lib/work/package-api'
import {
  VatCoreError,
  computeVatReturn,
  formatCents,
  type AdjustmentKind,
  type Basis,
  type FxLookup,
  type TransitionRef,
  type VatAdjustmentInput,
  type VatBoxes,
  type VatCode,
  type VatInvoiceInput,
  type VatPaymentInput,
  type VatReturnInput,
  type VatTxInput,
} from '../estv'
import { BASES, FX_METHODS, INVOICE_CODES, VAT_FAMILY, invoiceProblem, transactionProblem } from '../templates'
import { ensureMonthlyFxRates, monthsBetween } from '../fx-bazg'

export interface SheetRowLike {
  id: string
  data: Readonly<Record<string, unknown>>
  confirmed: boolean | null
}
export interface SheetPairLike {
  id: string
  fromRowId: string
  toRowId: string
  kind: string
  confirmed: boolean
}

export interface VatSheetRows {
  transactions: readonly SheetRowLike[]
  invoices: readonly SheetRowLike[]
  payments: readonly SheetRowLike[]
  adjustments: readonly SheetRowLike[]
  transitions: readonly SheetRowLike[]
  advances?: readonly SheetRowLike[]
  pairs: readonly SheetPairLike[]
}

export interface VatReturnOptions {
  basis: Basis
  roundTo5Rappen: boolean
  period: { start: string; end: string }
  declare383: boolean
  box415: string | null
  fx: FxLookup
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
const need = (v: unknown, what: string): string => {
  const s = str(v)
  if (s == null) throw moduleStop('row_value_missing', `${what} is missing`)
  return s
}
const isTrue = (c: boolean | null) => c === true

function outgoing(pairs: readonly SheetPairLike[], rowId: string, kind: string, max: number, what: string): SheetPairLike[] {
  const list = pairs.filter((p) => p.fromRowId === rowId && p.kind === kind)
  if (list.length > max) throw moduleStop('pair_too_many', `${what} has ${list.length} ${kind} links (at most ${max})`, { kind, max })
  return list
}

export function toVatReturnInput(rows: VatSheetRows, o: VatReturnOptions): VatReturnInput {
  const { pairs } = rows

  const transactions: VatTxInput[] = rows.transactions.map((r) => {
    const why = transactionProblem(r.data)
    if (why) throw moduleStop('row_rule', `transaction row: ${why}`, { sheet: VAT_FAMILY.transactions })
    const d = r.data
    return {
      id: r.id,
      date: need(d.date, 'transaction date'),
      currency: need(d.currency, 'transaction currency'),
      amount: need(d.amount, 'transaction amount'),
      direction: d.direction as 'in' | 'out',
      type: d.type as VatTxInput['type'],
      vatCode: d.vatCode as VatCode,
      confirmed: isTrue(r.confirmed),
      fxOverride: d.fxRate != null ? { rate: String(d.fxRate), unit: d.fxUnit as number } : null,
    }
  })
  const txById = new Map(transactions.map((t) => [t.id, t]))

  const invoices: VatInvoiceInput[] = rows.invoices.map((r) => {
    const why = invoiceProblem(r.data)
    if (why) throw moduleStop('row_rule', `invoice row: ${why}`, { sheet: VAT_FAMILY.invoices })
    const d = r.data
    const invoiceDate = need(d.invoiceDate, 'invoiceDate')
    const taxDate = need(d.taxDate, 'taxDate')
    return {
      id: r.id,
      direction: d.direction as 'issued' | 'received',
      invoiceDate,
      receivedAt: d.direction === 'received' && taxDate !== invoiceDate ? taxDate : null,
      currency: need(d.currency, 'invoice currency'),
      amountGross: need(d.amountGross, 'amountGross'),
      invoiceVat: str(d.invoiceVat),
      vatCode: d.vatCode as VatCode,
      confirmed: isTrue(r.confirmed),
    }
  })
  const invById = new Map(invoices.map((i) => [i.id, i]))
  const pairConfirmed = (list: SheetPairLike[]) => list.every((p) => p.confirmed)

  const payments: VatPaymentInput[] = rows.payments.map((r) => {
    const d = r.data
    const kind = d.kind
    if (kind !== 'payment' && kind !== 'advance') throw moduleStop('row_rule', 'payment row: kind must be payment or advance', { sheet: VAT_FAMILY.payments })
    const txLinks = outgoing(pairs, r.id, 'tx', 1, 'a payment row')
    if (txLinks.length !== 1) throw moduleStop('payment_needs_tx', 'a payment row must point to exactly one transaction')
    const invLinks = outgoing(pairs, r.id, 'invoice', 1, 'a payment row')
    const t = txById.get(txLinks[0].toRowId)
    if (!t) throw moduleStop('pair_target_missing', 'a payment row points to a transaction that was not read')
    const invoiceId = invLinks[0]?.toRowId ?? null
    const inv = invoiceId ? invById.get(invoiceId) : null
    if (invoiceId && !inv) throw moduleStop('pair_target_missing', 'a payment row points to an invoice that was not read')
    const amountTx = need(d.amountTx, 'amountTx')
    const amountInv = str(d.amountInv) ?? (inv && inv.currency === t.currency ? amountTx : null)
    return {
      id: r.id,
      invoiceId,
      transactionId: t.id,
      txDate: need(d.date, 'payment date'),
      kind,
      amountTx,
      amountInv,
      confirmed: isTrue(r.confirmed) && pairConfirmed([...txLinks, ...invLinks]),
    }
  })

  const transitionById = new Map(rows.transitions.map((r) => [r.id, r]))
  const advanceById = new Map((rows.advances ?? []).map((r) => [r.id, r]))
  const adjustments: VatAdjustmentInput[] = rows.adjustments.map((r) => {
    const d = r.data
    const kind = d.kind as AdjustmentKind
    const invLinks = outgoing(pairs, r.id, 'invoice', 1, 'an adjustment row')
    const inv = invLinks[0] ? invById.get(invLinks[0].toRowId) : undefined
    if (!inv) throw moduleStop('adjustment_needs_invoice', 'an adjustment row must point to an invoice that was read')
    const advLinks = outgoing(pairs, r.id, 'advance', 1, 'an adjustment row')
    let advanceOk = true
    if (kind === 'advance_offset') {
      const adv = advLinks[0] ? advanceById.get(advLinks[0].toRowId) : undefined
      if (!adv) throw moduleStop('advance_offset_needs_advance', 'an advance_offset adjustment must point to one advance payment row that was read')
      if (adv.data.kind !== 'advance') throw moduleStop('advance_offset_needs_advance', 'an advance_offset adjustment must point to an advance, not a payment')
      const advTx = outgoing(pairs, adv.id, 'tx', 1, 'an advance row')
      const t = advTx[0] ? txById.get(advTx[0].toRowId) : undefined
      if (!t) throw moduleStop('pair_target_missing', 'the advance of an advance_offset must point to a transaction that was read')
      advanceOk = isTrue(adv.confirmed) && pairConfirmed(advLinks) && pairConfirmed(advTx) && t.confirmed
    } else if (advLinks.length > 0) {
      throw moduleStop('adjustment_advance_kind', `a ${String(kind)} adjustment cannot point to an advance`, { kind: String(kind) })
    }
    const base = {
      id: r.id,
      kind,
      invoiceId: inv.id,
      amountChf: need(d.amountChf, 'amountChf'),
      vatChf: need(d.vatChf, 'vatChf'),
      confirmed: isTrue(r.confirmed) && pairConfirmed(invLinks) && advanceOk,
    }
    if (kind !== 'transition') return { ...base, invoiceDirection: inv.direction, invoiceVatCode: inv.vatCode }
    const trLinks = outgoing(pairs, r.id, 'transition', 1, 'an adjustment row')
    const tr = trLinks[0] ? transitionById.get(trLinks[0].toRowId) : undefined
    if (!tr) throw moduleStop('transition_adjustment_needs_list', 'a transition adjustment must point to a transition list that was read')
    const items = transitionItems(tr)
    const item = items.filter((x) => x.invoiceId === inv.id)
    if (item.length !== 1) throw moduleStop('transition_list_invoice', 'the transition list must hold the invoice exactly once')
    return {
      ...base,
      confirmed: base.confirmed && isTrue(tr.confirmed) && pairConfirmed(trLinks),
      invoiceDirection: item[0].direction,
      invoiceVatCode: item[0].vatCode,
      toBasis: tr.data.toBasis as Basis,
      ref: item[0].ref,
    }
  })
  const seen = new Set<string>()
  for (const a of adjustments) {
    if (a.kind !== 'transition') continue
    const k = `${a.invoiceId}`
    if (seen.has(k)) throw moduleStop('transition_adjustment_twice', 'a transition adjustment for the same invoice appears twice')
    seen.add(k)
  }

  return {
    basis: o.basis,
    roundTo5Rappen: o.roundTo5Rappen,
    period: o.period,
    transactions,
    invoices,
    payments,
    adjustments,
    declare383: o.declare383,
    box415: o.box415,
    fx: o.fx,
  }
}

type TransitionItemLike = { invoiceId: string; direction: 'issued' | 'received'; vatCode: VatCode; ref: TransitionRef }

export function transitionItems(tr: SheetRowLike): TransitionItemLike[] {
  const items = tr.data.items
  if (!Array.isArray(items)) throw moduleStop('transition_list_malformed', 'transition items must be a list')
  for (const it of items) {
    const o = it as Record<string, unknown> | null
    if (!o || typeof o !== 'object' || typeof o.invoiceId !== 'string' || (o.direction !== 'issued' && o.direction !== 'received')
      || typeof o.vatCode !== 'string' || typeof o.ref !== 'string' || !['235', '200+303', '200+221', '400'].includes(o.ref)) {
      throw moduleStop('transition_list_malformed', 'a transition item is malformed')
    }
  }
  return items as TransitionItemLike[]
}

export function boxesToStrings(b: VatBoxes): Record<string, string> {
  return Object.fromEntries(Object.entries(b).map(([k, v]) => [k, formatCents(v as bigint)]))
}

export interface VatBoxesInput {
  declare383: boolean
  box415: string | null
}

export interface VatBoxesOutput {
  basis: Basis
  fxMethod: 'monthly' | 'daily'
  boxes: Record<string, string>
  acquisition383Base: string
}

function parseInput(raw: unknown): VatBoxesInput {
  const o = (raw ?? {}) as Record<string, unknown>
  if (typeof o !== 'object' || Array.isArray(o)) throw new WorkError('INVALID', 'module input must be an object')
  for (const k of Object.keys(o)) if (k !== 'declare383' && k !== 'box415') throw new WorkError('INVALID', `unknown input ${k}`)
  if (typeof o.declare383 !== 'boolean') throw new WorkError('INVALID', 'declare383 must be true or false')
  const box415 = o.box415 ?? null
  if (box415 !== null && (typeof box415 !== 'string' || !/^\d+(\.\d{1,2})?$/.test(box415))) throw new WorkError('INVALID', 'box415 must be zero or a positive amount — it is subtracted, as on the ESTV form')
  return { declare383: o.declare383, box415: box415 as string | null }
}

const yearOf = (d: string) => d.slice(0, 4)

function basisFor(ctx: CalcModuleCtx, period: { start: string; end: string }): { basis: Basis; fxMethod: 'monthly' | 'daily'; row: ReadRow } {
  const rows = ctx.effectiveRows(VAT_FAMILY.basis)
  const covering = rows.filter((r) => String(r.data.from) <= period.start)
  const inside = rows.filter((r) => String(r.data.from) > period.start)
  if (inside.length > 0) throw moduleStop('basis_changes_in_period', 'the calculation method changes inside the task period')
  const row = covering.sort((a, b) => (String(a.data.from) < String(b.data.from) ? 1 : -1))[0]
  if (!row) throw moduleStop('basis_missing', 'no calculation method (vat.basis) covers the task period')
  if (!BASES.includes(row.data.basis as Basis) || !FX_METHODS.includes(row.data.fxMethod as 'monthly')) throw moduleStop('row_rule', 'vat.basis row: unknown method', { sheet: VAT_FAMILY.basis })
  return { basis: row.data.basis as Basis, fxMethod: row.data.fxMethod as 'monthly' | 'daily', row }
}

export const vatBoxesModule: CalcWorkModule = {
  id: 'vat.boxes',
  version: 1,
  kind: 'calc',
  title: { en: 'VAT return boxes', de: 'MWST-Abrechnungsziffern', fr: 'Chiffres du décompte TVA', ko: 'VAT 신고 칸 숫자' },
  description: {
    en: 'Computes the ESTV quarterly return boxes (effective method, gross) from the project sheets.',
    de: 'Berechnet die Ziffern der ESTV-Quartalsabrechnung (effektive Methode, brutto) aus den Projektblättern.',
    fr: 'Calcule les chiffres du décompte trimestriel AFC (méthode effective, brut) à partir des feuilles du projet.',
    ko: '프로젝트 시트에서 ESTV 분기 신고 칸 숫자를 계산한다(실효세율 방식 · 총액).',
  },
  input: {
    type: 'object',
    additionalProperties: false,
    required: ['declare383'],
    properties: { declare383: { type: 'boolean' }, box415: { type: ['string', 'null'], pattern: '^\\d+(\\.\\d{1,2})?$' } },
  },
  output: { type: 'object', properties: { basis: { type: 'string' }, fxMethod: { type: 'string' }, boxes: { type: 'object' }, acquisition383Base: { type: 'string' } } },
  needs: ['vat.basis>=1', 'vat.transactions>=1', 'vat.invoices>=1', 'vat.payments>=1', 'vat.adjustments>=1', 'vat.transitions>=1'],

  run: (ctx: CalcModuleCtx, raw: unknown) => computeBoxes(ctx, raw, 'submit') as Promise<VatBoxesOutput>,
  preview: (ctx: CalcModuleCtx, raw: unknown) => computeBoxes(ctx, raw, 'preview') as Promise<{ confirmed: VatBoxesOutput; draft: VatBoxesOutput | null; draftStopped?: PreviewStop; unconfirmed: number | null }>,
  prepare: async (db, period) => { await ensureMonthlyFxRates(db, monthsBetween(period.start, period.end)) },
}

async function computeBoxes(ctx: CalcModuleCtx, raw: unknown, mode: 'submit' | 'preview'): Promise<VatBoxesOutput | { confirmed: VatBoxesOutput; draft: VatBoxesOutput | null; draftStopped?: PreviewStop; unconfirmed: number | null }> {
  {
    const input = parseInput(raw)
    const period = ctx.task.period
    if (!period) throw moduleStop('task_no_period', 'the task has no period')
    if (yearOf(period.start) !== yearOf(period.end)) throw moduleStop('task_period_year', 'the task period must stay within one year')
    const { basis, fxMethod } = basisFor(ctx, period)
    const settings = ctx.project.settings
    if (typeof settings.roundTo5Rappen !== 'boolean') throw moduleStop('setting_missing', 'project setting roundTo5Rappen is missing', { setting: 'roundTo5Rappen' })

    const txs = new Map(ctx.periodRows(VAT_FAMILY.transactions).map((r) => [r.id, r]))
    const invs = new Map(ctx.periodRows(VAT_FAMILY.invoices).map((r) => [r.id, r]))
    const pays = new Map(ctx.periodRows(VAT_FAMILY.payments).map((r) => [r.id, r]))
    const adjs = ctx.periodRows(VAT_FAMILY.adjustments)
    const trans = new Map(ctx.periodRows(VAT_FAMILY.transitions).map((r) => [r.id, r]))
    const pairs = new Map<string, ReturnType<CalcModuleCtx['pairsFrom']>[number]>()
    const keepPairs = (list: ReturnType<CalcModuleCtx['pairsFrom']>) => { for (const p of list) pairs.set(p.id, p) }
    const add = (m: Map<string, ReadRow>, ids: Iterable<string>) => { for (const id of ids) m.set(id, ctx.row(id)) }

    const jan1 = `${yearOf(period.start)}-01-01`
    const prevYear = period.start <= jan1 && jan1 <= period.end ? ctx.effectiveRowAt(VAT_FAMILY.basis, `${Number(yearOf(jan1)) - 1}-12-31`) : null
    const changed = !!prevYear && prevYear.data.basis !== basis
    if (!changed && trans.size > 0) throw moduleStop('transition_list_unneeded', 'a transition list exists but the method did not change')
    if (changed) {
      const lists = [...trans.values()]
      if (lists.length !== 1) throw moduleStop('transition_list_needed', 'the method changed this year — one transition list is needed')
      if (lists[0].data.fromBasis !== prevYear!.data.basis || lists[0].data.toBasis !== basis) throw moduleStop('transition_list_mismatch', 'the transition list does not match the method change')
    }

    const follow = (paymentIds: string[]) => {
      if (paymentIds.length === 0) return
      const toTx = ctx.pairsFrom(paymentIds, 'tx')
      const toInv = ctx.pairsFrom(paymentIds, 'invoice')
      keepPairs(toTx)
      keepPairs(toInv)
      add(txs, toTx.map((p) => p.toRowId))
      add(invs, toInv.map((p) => p.toRowId))
    }
    follow([...pays.keys()])
    const advs = new Map<string, ReadRow>()
    if (adjs.length) {
      const ids = adjs.map((a) => a.id)
      const toInv = ctx.pairsFrom(ids, 'invoice')
      const toTr = ctx.pairsFrom(ids, 'transition')
      const toAdv = ctx.pairsFrom(ids, 'advance')
      keepPairs(toInv)
      keepPairs(toTr)
      keepPairs(toAdv)
      add(invs, toInv.map((p) => p.toRowId))
      add(trans, toTr.map((p) => p.toRowId))
      add(advs, toAdv.map((p) => p.toRowId))
      if (advs.size) {
        const advTx = ctx.pairsFrom([...advs.keys()], 'tx')
        keepPairs(advTx)
        add(txs, advTx.map((p) => p.toRowId))
      }
    }
    const periodInvoiceIds = [...invs.values()].filter((r) => {
      const d = String(r.data.taxDate)
      return period.start <= d && d <= period.end
    }).map((r) => r.id)
    const incoming = basis === 'cash'
      ? ctx.pairsTo([...invs.keys()], 'invoice', { dateUpTo: period.end })
      : ctx.pairsTo(periodInvoiceIds, 'invoice', { equals: { kind: 'advance' } })
    keepPairs(incoming)
    const newPayments = incoming.map((p) => p.fromRowId).filter((id) => !pays.has(id))
    add(pays, newPayments)
    follow(newPayments)

    for (const t of trans.values()) {
      const items = transitionItems(t)
      const linked = [...pairs.values()].filter((p) => p.kind === 'transition' && p.toRowId === t.id).map((p) => p.fromRowId)
      const covered = new Map<string, number>()
      for (const adjId of linked) {
        const inv = [...pairs.values()].find((p) => p.kind === 'invoice' && p.fromRowId === adjId)
        if (inv) covered.set(inv.toRowId, (covered.get(inv.toRowId) ?? 0) + 1)
      }
      if (items.some((it) => covered.get(it.invoiceId) !== 1) || covered.size !== items.length) {
        throw moduleStop('transition_adjustment_missing', 'every invoice on the transition list needs exactly one transition adjustment in this period')
      }
    }

    const rows: VatSheetRows = {
      transactions: [...txs.values()],
      invoices: [...invs.values()],
      payments: [...pays.values()],
      adjustments: adjs,
      transitions: [...trans.values()],
      advances: [...advs.values()],
      pairs: [...pairs.values()],
    }

    const currencies = new Set<string>()
    let lo = period.start
    let hi = period.end
    for (const r of [...rows.transactions, ...rows.invoices]) {
      const c = r.data.currency
      if (typeof c === 'string' && c !== 'CHF') currencies.add(c)
      for (const k of ['date', 'taxDate']) {
        const d = r.data[k]
        if (typeof d === 'string') { if (d < lo) lo = d; if (d > hi) hi = d }
      }
    }
    const table = await ctx.loadFx({ currencies: [...currencies], from: lo, to: hi })
    const fx: FxLookup = (currency, date) => table.lookup(currency, date, fxMethod)

    const coreInput = toVatReturnInput(rows, {
      basis,
      roundTo5Rappen: settings.roundTo5Rappen,
      period,
      declare383: input.declare383,
      box415: input.box415,
      fx,
    })
    const compute = (onlyConfirmed: boolean): VatBoxesOutput & { unconfirmed: number } => {
      let r: ReturnType<typeof computeVatReturn>
      try {
        r = computeVatReturn({ ...coreInput, onlyConfirmed })
      } catch (e) {
        if (e instanceof WorkError) throw e
        if (e instanceof VatCoreError) throw moduleStop(e.code, `VAT core: ${e.message}`, e.params)
        throw moduleStop('core_internal', `VAT core: ${(e as Error).message}`)
      }
      if (r.fxMissing.length > 0 || !r.boxes) {
        const currencies = [...new Set(r.fxMissing.map((m) => m.currency))].sort().join(', ')
        throw moduleStop('fx_needed', `exchange rate needed (${r.fxMissing.length})`, { n: r.fxMissing.length, currencies })
      }
      if (r.errors.length > 0) throw moduleStop(r.issues[0]?.code ?? 'core_internal', `VAT core: ${r.errors.join(' · ')}`, r.issues[0]?.params)
      return { basis, fxMethod, boxes: boxesToStrings(r.boxes), acquisition383Base: formatCents(r.acquisition383Base), unconfirmed: r.unconfirmed.length }
    }
    if (mode === 'preview') {
      const { unconfirmed: _c, ...confirmed } = compute(true)
      try {
        const { unconfirmed, ...draft } = compute(false)
        return { confirmed, draft, unconfirmed }
      } catch (e) {
        if (!(e instanceof WorkError)) throw e
        return { confirmed, draft: null, draftStopped: e.stop ? { code: e.stop.code, ...(e.stop.params ? { params: e.stop.params } : {}) } : { code: e.code, detail: e.detail }, unconfirmed: null }
      }
    }
    const { unconfirmed, ...out } = compute(false)
    if (unconfirmed > 0) throw new WorkError('UNCONFIRMED', `${unconfirmed} unconfirmed items in the calculation`)
    return out
  }
}

export { INVOICE_CODES }
