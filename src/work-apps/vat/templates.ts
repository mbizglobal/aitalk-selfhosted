
import { createHmac, randomUUID } from 'crypto'
import { WorkError } from '@/lib/work/errors'
import type { ExceptionJudge, SheetTemplate } from '@/lib/work/sheet-templates'
import { isCalendarDate, parseCents } from './estv'

export const BASES = ['cash', 'agreed'] as const
export const FX_METHODS = ['monthly', 'daily'] as const
export const TX_TYPES = ['income', 'expense', 'internal', 'other'] as const
export const VAT_CODES = ['ch_standard', 'foreign_income', 'no_vat', 'non_consideration', 'acquisition_383'] as const
export const PAYMENT_KINDS = ['payment', 'advance'] as const
export const ADJUSTMENT_KINDS = ['bad_debt', 'discount', 'recovery', 'advance_offset', 'transition'] as const
export const BANKS = ['ubs', 'wise', 'revolut', 'other'] as const
export const TX_SOURCES = ['bank', 'manual', 'import', 'intercompany'] as const
export const TX_EVIDENCE = ['attached', 'needed', 'explained', 'not_needed'] as const
export const RULE_FIELDS = ['counterparty', 'bankType'] as const

export const VAT_FAMILY = {
  accounts: 'bank.accounts',
  balances: 'bank.balances',
  basis: 'vat.basis',
  rules: 'vat.rules',
  transactions: 'vat.transactions',
  invoices: 'vat.invoices',
  payments: 'vat.payments',
  adjustments: 'vat.adjustments',
  transitions: 'vat.transitions',
  recipes: 'bank.recipes',
} as const

const oneOf = (list: readonly string[], v: unknown) => typeof v === 'string' && list.includes(v)
const CURRENCY_RE = /^[A-Z]{3}$/
const isJan1 = (d: unknown) => typeof d === 'string' && isCalendarDate(d) && d.endsWith('-01-01')

function firstProblem(checks: Array<[boolean, string]>): string | null {
  for (const [bad, why] of checks) if (bad) return why
  return null
}

const accounts: SheetTemplate = {
  name: VAT_FAMILY.accounts, version: 1, family: VAT_FAMILY.accounts,
  columns: [
    { name: 'accountKey', type: 'string', required: true },
    { name: 'bank', type: 'string', required: true },
    { name: 'currency', type: 'string', required: true },
    { name: 'label', type: 'string', encrypted: true },
    { name: 'accountNumber', type: 'string', encrypted: true },
  ],
  unique: ['accountKey'],
  ui: { options: { bank: BANKS } },
  checkRow: (d) => firstProblem([
    [!oneOf(BANKS, d.bank), 'bank must be ubs, wise, revolut or other'],
    [!CURRENCY_RE.test(String(d.currency)), 'currency must be a 3-letter ISO code'],
  ]),
}

const balances: SheetTemplate = {
  name: VAT_FAMILY.balances, version: 1, family: VAT_FAMILY.balances, dateColumn: 'date',
  columns: [
    { name: 'accountKey', type: 'string', required: true },
    { name: 'date', type: 'date', required: true },
    { name: 'kind', type: 'string', required: true },
    { name: 'amount', type: 'money', required: true },
  ],
  unique: ['accountKey', 'date', 'kind'],
  ui: { options: { kind: ['opening', 'closing'] }, refs: { accountKey: { family: VAT_FAMILY.accounts, column: 'accountKey' } }, screenRowsFrom: 'bank.balance-check' },
  checkRow: (d) => firstProblem([[!oneOf(['opening', 'closing'], d.kind), 'kind must be opening or closing']]),
}

const basis: SheetTemplate = {
  name: VAT_FAMILY.basis, version: 1, family: VAT_FAMILY.basis, effectiveFromColumn: 'from',
  columns: [
    { name: 'from', type: 'date', required: true },
    { name: 'basis', type: 'string', required: true },
    { name: 'fxMethod', type: 'string', required: true },
  ],
  confirm: { calcColumns: ['from', 'basis', 'fxMethod'] },
  ui: { options: { basis: BASES, fxMethod: FX_METHODS }, help: 'help_vat.basis' },
  checkRow: (d) => firstProblem([
    [!isJan1(d.from), 'from must be January 1 (the method changes by tax year)'],
    [!oneOf(BASES, d.basis), 'basis must be cash or agreed'],
    [!oneOf(FX_METHODS, d.fxMethod), 'fxMethod must be monthly or daily'],
  ]),
}

const rules: SheetTemplate = {
  name: VAT_FAMILY.rules, version: 1, family: VAT_FAMILY.rules,
  columns: [
    { name: 'priority', type: 'number', required: true },
    { name: 'field', type: 'string', required: true },
    { name: 'match', type: 'string', required: true, encrypted: true },
    { name: 'type', type: 'string', required: true },
    { name: 'vatCode', type: 'string', required: true },
    { name: 'category', type: 'string' },
  ],
  ui: { options: { field: RULE_FIELDS, type: TX_TYPES, vatCode: VAT_CODES } },
  checkRow: (d) => firstProblem([
    [!oneOf(RULE_FIELDS, d.field), 'field must be counterparty or bankType'],
    [typeof d.match !== 'string' || d.match.trim() === '', 'match must not be blank'],
    [!oneOf(TX_TYPES, d.type), 'type is not a known transaction type'],
    [!oneOf(VAT_CODES, d.vatCode), 'vatCode is not a known code'],
  ]),
}

export function transactionProblem(d: Readonly<Record<string, unknown>>): string | null {
  const hasRate = d.fxRate != null
  const hasUnit = d.fxUnit != null
  return firstProblem([
    [!CURRENCY_RE.test(String(d.currency)), 'currency must be a 3-letter ISO code'],
    [!oneOf(['in', 'out'], d.direction), 'direction must be in or out'],
    [!oneOf(TX_TYPES, d.type), 'type is not a known transaction type'],
    [!oneOf(VAT_CODES, d.vatCode), 'vatCode is not a known code'],
    [typeof d.amount !== 'string' || parseCents(d.amount) < BigInt(0), 'amount must not be negative'],
    [hasRate !== hasUnit, 'fxRate and fxUnit go together'],
    [hasRate && !(typeof d.fxRate === 'string' && parseCents6Positive(d.fxRate)), 'fxRate must be positive'],
    [hasUnit && !(Number.isInteger(d.fxUnit) && (d.fxUnit as number) > 0), 'fxUnit must be a positive integer'],
    [d.source != null && !oneOf(TX_SOURCES, d.source), 'source is not a known source'],
    [d.evidence != null && !oneOf(TX_EVIDENCE, d.evidence), 'evidence is not a known value'],
  ])
}

function parseCents6Positive(s: string): boolean {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(s)
  return !!m && /[1-9]/.test(m[1] + (m[2] ?? ''))
}

const transactions: SheetTemplate = {
  name: VAT_FAMILY.transactions, version: 1, family: VAT_FAMILY.transactions, dateColumn: 'date',
  columns: [
    { name: 'accountKey', type: 'string', required: true },
    { name: 'bankRowKey', type: 'string', required: true },
    { name: 'date', type: 'date', required: true },
    { name: 'currency', type: 'string', required: true },
    { name: 'amount', type: 'money', required: true },
    { name: 'direction', type: 'string', required: true },
    { name: 'type', type: 'string', required: true },
    { name: 'vatCode', type: 'string', required: true },
    { name: 'category', type: 'string' },
    { name: 'fxRate', type: 'decimal', scale: 6 },
    { name: 'fxUnit', type: 'number' },
    { name: 'balanceAfter', type: 'money' },
    { name: 'lineNo', type: 'number' },
    { name: 'source', type: 'string' },
    { name: 'fileId', type: 'string' },
    { name: 'counterparty', type: 'string', encrypted: true },
    { name: 'bankType', type: 'string', encrypted: true },
    { name: 'details', type: 'text', encrypted: true },
    { name: 'note', type: 'text', encrypted: true },
    { name: 'aiReason', type: 'text', encrypted: true },
    { name: 'evidence', type: 'string' },
    { name: 'receiptFileId', type: 'string' },
  ],
  unique: ['accountKey', 'bankRowKey'],
  confirm: {
    calcColumns: ['date', 'currency', 'amount', 'direction', 'type', 'vatCode', 'category', 'fxRate', 'fxUnit'],
    ai: {
      reasonColumn: 'aiReason',
      check: (d) => d.evidence == null ? 'set evidence before confirming'
        : d.evidence === 'attached' && !(typeof d.receiptFileId === 'string' && d.receiptFileId.trim()) ? 'attach the receipt (fileId) before confirming with evidence attached'
        : d.evidence === 'explained' && !(typeof d.note === 'string' && d.note.trim()) ? 'write the explanation in note before confirming'
        : null,
    },
  },
  ui: {
    options: { direction: ['in', 'out'], type: TX_TYPES, vatCode: VAT_CODES, source: TX_SOURCES, evidence: TX_EVIDENCE },
    hidden: ['bankRowKey', 'fileId', 'lineNo', 'receiptFileId'],
    order: ['accountKey', 'date', 'currency', 'amount', 'direction', 'type', 'category', 'counterparty', 'vatCode'],
    fxShown: { currency: 'currency', date: 'date', rate: 'fxRate', unit: 'fxUnit', method: { family: VAT_FAMILY.basis, column: 'fxMethod' } },
    refs: { accountKey: { family: VAT_FAMILY.accounts, column: 'accountKey' } },
    summary: ['date', 'direction', 'amount', 'currency', 'counterparty'],
    file: 'receiptFileId',
  },
  submitWarning: (d) => d.evidence === 'needed' ? 'evidence_needed'
    : d.evidence == null && (d.type === 'income' || d.type === 'expense') ? 'evidence_unset'
    : d.evidence === 'attached' && !(typeof d.receiptFileId === 'string' && d.receiptFileId.trim()) ? 'evidence_no_file'
    : d.evidence === 'explained' && !(typeof d.note === 'string' && d.note.trim()) ? 'evidence_no_note'
    : null,
  manualRow: (_key, d, before) => ({ ...d, bankRowKey: before ? before.bankRowKey : `m:${randomUUID()}`, ...(before || d.source != null ? {} : { source: 'manual' }) }),
  checkRow: transactionProblem,
}

export const INVOICE_CODES: Record<'issued' | 'received', readonly string[]> = {
  issued: ['ch_standard', 'foreign_income', 'non_consideration', 'no_vat'],
  received: ['ch_standard', 'no_vat', 'acquisition_383'],
}

export function invoiceProblem(d: Readonly<Record<string, unknown>>): string | null {
  const dir = d.direction
  return firstProblem([
    [!oneOf(['issued', 'received'], dir), 'direction must be issued or received'],
    [!CURRENCY_RE.test(String(d.currency)), 'currency must be a 3-letter ISO code'],
    [oneOf(['issued', 'received'], dir) && !INVOICE_CODES[dir as 'issued' | 'received'].includes(String(d.vatCode)), 'vatCode is not allowed for this direction'],
    [dir === 'issued' && d.taxDate !== d.invoiceDate, 'taxDate of an issued invoice is its invoiceDate'],
  ])
}

const invoices: SheetTemplate = {
  name: VAT_FAMILY.invoices, version: 1, family: VAT_FAMILY.invoices, dateColumn: 'taxDate',
  columns: [
    { name: 'direction', type: 'string', required: true },
    { name: 'invoiceDate', type: 'date', required: true },
    { name: 'taxDate', type: 'date', required: true },
    { name: 'currency', type: 'string', required: true },
    { name: 'amountGross', type: 'money', required: true },
    { name: 'invoiceVat', type: 'money' },
    { name: 'vatCode', type: 'string', required: true },
    { name: 'category', type: 'string' },
    { name: 'dedupKey', type: 'string', required: true },
    { name: 'fileId', type: 'string' },
    { name: 'counterparty', type: 'string', encrypted: true },
    { name: 'number', type: 'string', encrypted: true },
    { name: 'note', type: 'text', encrypted: true },
    { name: 'aiReason', type: 'text', encrypted: true },
  ],
  unique: ['dedupKey'],
  confirm: { calcColumns: ['direction', 'invoiceDate', 'taxDate', 'currency', 'amountGross', 'invoiceVat', 'vatCode'] },
  ui: { options: { direction: ['issued', 'received'], vatCode: VAT_CODES }, hidden: ['dedupKey', 'fileId', 'aiReason'], summary: ['taxDate', 'direction', 'number', 'amountGross', 'currency', 'counterparty'], file: 'fileId', help: 'help_vat.invoices' },
  manualRow: (key, d, _before, ctx) => {
    const typed = typeof d.number === 'string' ? d.number.trim() : ''
    if (!typed && !ctx.fileSha256) throw new WorkError('INVALID', 'number is required (or attach the receipt file)')
    const number = typed || `file:${ctx.fileSha256}`
    const { number: _drop, ...rest } = d
    return { ...(typed ? { ...d, number: typed } : rest), dedupKey: invoiceDedupKey(key, { direction: String(d.direction), number, invoiceDate: String(d.invoiceDate), amountGross: String(d.amountGross), currency: String(d.currency) }) }
  },
  checkRow: invoiceProblem,
}

const paymentLink: ExceptionJudge = async ({ tx, projectId, userId, kind, from, to, isDateLocked }) => {
  if (kind !== 'invoice' || from.data.kind !== 'payment' || from.locked) return false
  const txPairs = await tx.sheetRowPair.findMany({ where: { projectId, userId, fromRowId: from.id, kind: 'tx' }, select: { toRowId: true } })
  if (txPairs.length !== 1) return false
  const txRow = await tx.dataSheetRow.findFirst({ where: { id: txPairs[0].toRowId, projectId, userId, kind: 'project' }, select: { rowData: true } })
  const txDate = txRow ? (JSON.parse(txRow.rowData) as Record<string, unknown>).date : null
  if (typeof txDate !== 'string' || isDateLocked(txDate)) return false
  const taxDate = to.data.taxDate
  if (typeof taxDate !== 'string') return false
  return (await basisAt(tx, projectId, userId, taxDate))?.basis === 'agreed'
}

async function basisAt(
  tx: Parameters<ExceptionJudge>[0]['tx'],
  projectId: string,
  userId: string,
  date: string,
): Promise<{ basis: string; fxMethod: string } | null> {
  const rows = await tx.dataSheetRow.findMany({
    where: { kind: 'project', projectId, userId, sheet: { templateFamily: VAT_FAMILY.basis } },
    select: { rowData: true },
  })
  let best: { from: string; basis: string; fxMethod: string } | null = null
  for (const r of rows) {
    const d = JSON.parse(r.rowData) as { from: string; basis: string; fxMethod: string }
    if (d.from <= date && (!best || d.from > best.from)) best = d
  }
  return best
}

const payments: SheetTemplate = {
  name: VAT_FAMILY.payments, version: 1, family: VAT_FAMILY.payments, dateColumn: 'date',
  columns: [
    { name: 'date', type: 'date', required: true },
    { name: 'kind', type: 'string', required: true },
    { name: 'amountTx', type: 'money', required: true },
    { name: 'amountInv', type: 'money' },
    { name: 'note', type: 'text', encrypted: true },
  ],
  confirm: { calcColumns: ['date', 'kind', 'amountTx', 'amountInv'] },
  pairs: [
    { kind: 'tx', toFamily: VAT_FAMILY.transactions, periodSide: 'from' },
    { kind: 'invoice', toFamily: VAT_FAMILY.invoices, periodSide: 'from' },
  ],
  exceptions: { 'vat.payment-link': paymentLink },
  ui: { options: { kind: PAYMENT_KINDS }, summary: ['date', 'kind', 'amountTx', 'amountInv'], help: 'help_vat.payments' },
  checkRow: (d) => firstProblem([
    [!oneOf(PAYMENT_KINDS, d.kind), 'kind must be payment or advance'],
    [typeof d.amountTx !== 'string' || parseCents(d.amountTx) <= BigInt(0), 'amountTx must be positive'],
    [d.amountInv != null && (typeof d.amountInv !== 'string' || parseCents(d.amountInv) <= BigInt(0)), 'amountInv must be positive'],
  ]),
}

const adjustments: SheetTemplate = {
  name: VAT_FAMILY.adjustments, version: 1, family: VAT_FAMILY.adjustments, dateColumn: 'date',
  columns: [
    { name: 'date', type: 'date', required: true },
    { name: 'kind', type: 'string', required: true },
    { name: 'amountInv', type: 'money' },
    { name: 'amountChf', type: 'money', required: true },
    { name: 'vatChf', type: 'money', required: true },
    { name: 'note', type: 'text', encrypted: true },
  ],
  confirm: { calcColumns: ['date', 'kind', 'amountInv', 'amountChf', 'vatChf'] },
  pairs: [
    { kind: 'invoice', toFamily: VAT_FAMILY.invoices, periodSide: 'from' },
    { kind: 'advance', toFamily: VAT_FAMILY.payments, periodSide: 'from' },
    { kind: 'transition', toFamily: VAT_FAMILY.transitions, periodSide: 'from' },
  ],
  ui: { options: { kind: ADJUSTMENT_KINDS }, help: 'help_vat.adjustments' },
  checkRow: (d) => firstProblem([
    [!oneOf(ADJUSTMENT_KINDS, d.kind), 'kind is not a known adjustment'],
    [d.kind !== 'transition' && (parseCents(String(d.amountChf)) < BigInt(0) || parseCents(String(d.vatChf)) < BigInt(0)), 'amounts must not be negative'],
  ]),
}

const transitions: SheetTemplate = {
  name: VAT_FAMILY.transitions, version: 1, family: VAT_FAMILY.transitions, dateColumn: 'bookDate',
  columns: [
    { name: 'bookDate', type: 'date', required: true },
    { name: 'transitionDate', type: 'date', required: true },
    { name: 'fromBasis', type: 'string', required: true },
    { name: 'toBasis', type: 'string', required: true },
    { name: 'items', type: 'json', required: true, encrypted: true },
  ],
  unique: ['transitionDate'],
  ui: { options: { fromBasis: BASES, toBasis: BASES }, summary: ['bookDate', 'fromBasis', 'toBasis'], help: 'help_vat.transitions' },
  confirm: { calcColumns: ['bookDate', 'transitionDate', 'fromBasis', 'toBasis', 'items'] },
  checkRow: (d) => firstProblem([
    [!isJan1(d.bookDate), 'bookDate must be January 1'],
    [typeof d.bookDate === 'string' && d.transitionDate !== `${Number(d.bookDate.slice(0, 4)) - 1}-12-31`, 'transitionDate must be December 31 of the previous year'],
    [!oneOf(BASES, d.fromBasis) || !oneOf(BASES, d.toBasis) || d.fromBasis === d.toBasis, 'fromBasis and toBasis must be two different methods'],
    [!Array.isArray(d.items) || d.items.some((it) => !it || typeof it !== 'object' || typeof (it as { invoiceId?: unknown }).invoiceId !== 'string'), 'items must be a list of items with an invoiceId'],
  ]),
}

const recipes: SheetTemplate = {
  name: VAT_FAMILY.recipes, version: 1, family: VAT_FAMILY.recipes,
  columns: [
    { name: 'recipeKey', type: 'string', required: true },
    { name: 'bank', type: 'string', required: true },
    { name: 'fingerprint', type: 'string', required: true },
    { name: 'recipe', type: 'json', required: true, encrypted: true },
    { name: 'label', type: 'string', encrypted: true },
  ],
  unique: ['recipeKey'],
  aiWrite: false,
  ui: { options: { bank: BANKS }, hidden: ['recipeKey', 'fingerprint', 'recipe'], noManualRows: true, help: 'help_bank.recipes' },
  checkRow: (d) => firstProblem([
    [!oneOf(BANKS, d.bank), 'bank must be ubs, wise, revolut or other'],
    [typeof d.fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(d.fingerprint), 'fingerprint must be a sha256'],
  ]),
}

export const VAT_SHEET_TEMPLATES: readonly SheetTemplate[] = [accounts, balances, basis, rules, transactions, invoices, payments, adjustments, transitions, recipes]

export function invoiceDedupKey(key: Buffer, f: { direction: string; number: string; invoiceDate: string; amountGross: string; currency: string }): string {
  const number = f.number.trim()
  if (!number) throw new Error('invoiceDedupKey: number is blank — pass the file sha256 for receipts without a number')
  return createHmac('sha256', key)
    .update('vat.invoice.dedup\0')
    .update(JSON.stringify([f.direction, number, f.invoiceDate, f.amountGross, f.currency]))
    .digest('hex')
}
