
import crypto from 'crypto'
import { WorkError } from '@/lib/work/errors'
import type { ImportPlan, ImportReader } from '@/lib/work/bank-import-contract'
import { moduleStop, type ActionWorkModule, type ModuleRunCtx } from '@/lib/work/modules'
import { readProjectFile } from '@/lib/work/files'
import { createProjectSheet, readProjectSheet, submittedPeriods, withProjectSheetWrite, type SheetRowView } from '@/lib/work/sheet-gate'
import { normalizeRow, uniqueKeyHash, type SheetSchema } from '@/lib/work/sheet-columns'
import { dateInAny, type DateRange } from '@/lib/work/sheet-periods'
import { findTemplate, templateSchema, type SheetTemplate } from '@/lib/work/sheet-templates'
import { parseUbsCsv } from '../bank/ubs'
import { BankFormatError, normalizeAmount } from '../bank/parse-csv'
import { fingerprintWith, groupId, parseRecipe, readWithRecipe, recipeHash, type BankRecipe } from '../bank/recipe'
import { REVERSAL_SUFFIX, assignBankRowKeys, type KeyedBankRow } from '../bank/row-key'
import { reconcileBalance, type BalanceCheck } from '../bank/balance'
import { formatCents, parseCents } from '../estv'
import type { BankRow, BankStatement } from '../bank/types'
import { VAT_FAMILY } from '../templates'

const MODULE_ID = 'bank.import'
const MODULE_VERSION = 1

export interface RuleHit { ruleId: string; type: string; vatCode: string; category?: string }

const normalizeForRule = (s: unknown) => (typeof s === 'string' ? s.normalize('NFC').toLowerCase().replace(/[\s\-\u2010-\u2015\u2212]/g, '') : '')

export function classifyBankRow(rules: readonly SheetRowView[], r: { counterparty?: string | null; bankType?: string | null }): RuleHit | null {
  const fieldOrder = ['counterparty', 'bankType']
  const sorted = [...rules].sort((a, b) =>
    fieldOrder.indexOf(String(a.data.field)) - fieldOrder.indexOf(String(b.data.field))
    || Number(a.data.priority) - Number(b.data.priority)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  for (const rule of sorted) {
    const field = rule.data.field
    if (field !== 'counterparty' && field !== 'bankType') continue
    const needle = normalizeForRule(rule.data.match)
    if (!needle || !normalizeForRule(r[field]).includes(needle)) continue
    const category = typeof rule.data.category === 'string' && rule.data.category.trim() !== '' ? rule.data.category.trim() : undefined
    return { ruleId: rule.id, type: String(rule.data.type), vatCode: String(rule.data.vatCode), ...(category ? { category } : {}) }
  }
  return null
}

export function bankRowToTransaction(r: KeyedBankRow, accountKey: string, fileId: string | null, hit: RuleHit | null = null): Record<string, unknown> {
  return {
    accountKey,
    bankRowKey: r.bankRowKey,
    date: r.date,
    currency: r.currency,
    amount: r.amount,
    direction: r.direction,
    type: hit?.type ?? 'other',
    vatCode: hit?.vatCode ?? 'no_vat',
    ...(hit?.category ? { category: hit.category } : {}),
    balanceAfter: r.balanceAfter,
    lineNo: r.lineNo,
    source: 'bank',
    ...(fileId ? { fileId } : {}),
    counterparty: r.counterparty,
    bankType: r.bankType,
    details: r.details,
  }
}

const signed = (r: Pick<BankRow, 'amount' | 'direction'>) => (r.direction === 'in' ? parseCents(r.amount) : -parseCents(r.amount))

export function chronological(st: BankStatement): BankRow[] {
  const holds = (rows: BankRow[]) => {
    let prev: bigint | null = null
    for (const r of rows) {
      if (r.balanceAfter == null) return false
      const now = parseCents(r.balanceAfter)
      if (prev != null && now !== prev + signed(r)) return false
      prev = now
    }
    return true
  }
  const asIs = st.rows
  const rev = [...st.rows].reverse()
  if (holds(asIs) && !holds(rev)) return asIs
  if (holds(rev) && !holds(asIs)) return rev
  return asIs.length && asIs[0].date > asIs[asIs.length - 1].date ? rev : asIs
}

export interface BankPlanProblem { code: string; params?: Record<string, string | number>; text: string }

export interface BankGroupPlan {
  digest: string
  statement: { accountNumberMatches: boolean | null; currency: string | null; from: string | null; until: string | null; rows: number }
  insert: Array<{ lineNo: number; date: string; amount: string; direction: 'in' | 'out' }>
  existing: Array<{ lineNo: number; rowId: string; locked: boolean }>
  classified: number
  problems: BankPlanProblem[]
  balance: { file: BalanceCheck['status']; ledger: BalanceCheck['status'] | 'skipped' }
}

interface PlanSource {
  periods: readonly DateRange[]
  transactions: readonly SheetRowView[]
  accounts: readonly SheetRowView[]
  rules?: readonly SheetRowView[]
}

const CONTENT_KEYS = ['date', 'amount', 'direction', 'currency'] as const

function stable(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null)
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`
}

export function computeBankPlan(
  src: PlanSource,
  st: BankStatement,
  input: { accountKey: string; file: { id: string; sha256: string }; sheetIds?: readonly string[]; stated?: boolean },
  schema: SheetSchema,
): { plan: BankGroupPlan; rows: Array<Record<string, unknown>> } {
  const problems: BankPlanProblem[] = st.problems.map((text, i) => ({ ...st.issues[i], text }))
  const add = (code: string, text: string, params?: BankPlanProblem['params']) => problems.push(params ? { code, params, text } : { code, text })
  const account = src.accounts.find((a) => a.data.accountKey === input.accountKey)
  if (!account) throw new WorkError('INVALID', 'unknown accountKey')
  if (st.currency && account.data.currency !== st.currency) add('ubs_currency_mismatch', `파일 통화 ${st.currency} 가 계좌 통화 ${String(account.data.currency)} 와 다르다`, { fileCurrency: st.currency, accountCurrency: String(account.data.currency) })
  const acctNo = typeof account.data.accountNumber === 'string' ? account.data.accountNumber.replace(/\s/g, '') : null
  const accountNumberMatches = acctNo && st.accountNumber ? acctNo === st.accountNumber : null
  if (accountNumberMatches === false) add('ubs_account_number', '파일의 계좌 번호가 이 계좌와 다르다')

  let keyed: KeyedBankRow[]
  try {
    keyed = assignBankRowKeys(st.rows, input.accountKey)
  } catch (e) {
    throw moduleStop('bank_dup_txno', `bank file: ${(e as Error).message}`)
  }
  const unique = schema.unique!
  const existingByKey = new Map<string, SheetRowView>()
  for (const r of src.transactions) existingByKey.set(uniqueKeyHash(unique, r.data), r)

  const insert: BankGroupPlan['insert'] = []
  const existing: BankGroupPlan['existing'] = []
  const rows: Array<Record<string, unknown>> = []
  const statuses: unknown[] = []
  const insertedLines = new Set<number>()
  const inFile = new Map<string, number>()
  let classified = 0
  const toData = (r: KeyedBankRow, ruleHit: ReturnType<typeof classifyBankRow>) => {
    const { plain, sealed } = normalizeRow(schema, bankRowToTransaction(r, input.accountKey, input.file.id, ruleHit))
    const data = { ...plain, ...(sealed ?? {}) }
    return { data, hash: uniqueKeyHash(unique, data) }
  }
  const sameContent = (a: Record<string, unknown>, b: Record<string, unknown>) => CONTENT_KEYS.every((k) => a[k] === b[k])
  const mirror = (a: Record<string, unknown>, b: Record<string, unknown>) => a.direction !== b.direction && a.amount === b.amount && a.currency === b.currency
  const choose = (r: KeyedBankRow, ruleHit: ReturnType<typeof classifyBankRow>) => {
    if (!r.bankTxNo) return { r, ...toData(r, ruleHit) }
    const base = `tx:${r.bankTxNo}`
    const order = r.bankRowKey === `${base}${REVERSAL_SUFFIX}` ? [`${base}${REVERSAL_SUFFIX}`, base] : [base, `${base}${REVERSAL_SUFFIX}`]
    const cands = order.map((key) => { const rr = { ...r, bankRowKey: key }; const d = toData(rr, ruleHit); return { r: rr, ...d, hit: existingByKey.get(d.hash) } })
    const free = (c: (typeof cands)[number]) => !inFile.has(c.hash)
    const same = cands.find((c) => c.hit && free(c) && sameContent(c.hit.data, c.data))
    if (same) return same
    const [first, other] = cands
    if (!first.hit && free(first)) return first
    if (first.hit && mirror(first.hit.data, first.data) && !other.hit && free(other)) return other
    return first
  }
  for (const k of keyed) {
    const ruleHit = classifyBankRow(src.rules ?? [], k)
    const { r, data, hash } = choose(k, ruleHit)
    const dupOf = inFile.get(hash)
    if (dupOf != null) throw moduleStop('bank_dup_txno', `bank file: line ${r.lineNo} has the same key as line ${dupOf}`, { line: r.lineNo, first: dupOf })
    inFile.set(hash, r.lineNo)
    const locked = dateInAny(r.date, src.periods)
    const hit = existingByKey.get(hash)
    if (!hit) {
      if (locked) add('ubs_locked_missing', `${r.lineNo}번 줄: 잠긴 기간(${r.date})에 없는 거래 — 수정 신고가 필요할 수 있다`, { line: r.lineNo, date: r.date })
      else { insert.push({ lineNo: r.lineNo, date: r.date, amount: r.amount, direction: r.direction }); rows.push(data); insertedLines.add(r.lineNo); if (ruleHit) classified++ }
      statuses.push({ l: r.lineNo, k: hash, s: locked ? 'locked-missing' : 'insert', ...(ruleHit && !locked ? { rule: [ruleHit.ruleId, ruleHit.type, ruleHit.vatCode, ruleHit.category ?? null] } : {}) })
      continue
    }
    const same = CONTENT_KEYS.every((k) => hit.data[k] === data[k])
    if (same) existing.push({ lineNo: r.lineNo, rowId: hit.id, locked })
    else if (locked) add('ubs_locked_differs', `${r.lineNo}번 줄: 잠긴 거래 내용이 파일과 다르다 — 은행이 고쳤을 수 있다`, { line: r.lineNo })
    else add('ubs_existing_differs', `${r.lineNo}번 줄: 이미 있는 거래와 내용이 다르다`, { line: r.lineNo })
    statuses.push({ l: r.lineNo, k: hash, s: same ? 'same' : 'differs', r: hit.id, locked, c: CONTENT_KEYS.map((k) => hit.data[k]) })
  }

  const fileCheck = reconcileBalance(st.opening, st.closing, st.rows)
  if (fileCheck.status === 'no_data') add('ubs_file_balance_no_data', '파일 머리에 시작·끝 잔액이 없어 파일 전체를 대조하지 못했다')
  if (fileCheck.status === 'mismatch') add('ubs_file_balance_mismatch', `파일 전체 잔액이 맞지 않는다 (차이 ${fileCheck.diff})`)
  let ledger: BankGroupPlan['balance']['ledger'] = 'skipped'
  if (insert.length > 0) {
    const chrono = chronological(st)
    const idx = chrono.map((r, i) => (insertedLines.has(r.lineNo) ? i : -1)).filter((i) => i >= 0)
    const span = chrono.slice(idx[0], idx[idx.length - 1] + 1)
    const first = span[0]
    const last = span[span.length - 1]
    const skipped = span.filter((r) => !insertedLines.has(r.lineNo) && !existing.some((e) => e.lineNo === r.lineNo))
    if (skipped.length > 0) ledger = 'mismatch'
    else if (first.balanceAfter != null && last.balanceAfter != null) {
      ledger = reconcileBalance(formatCents(parseCents(first.balanceAfter) - signed(first)), last.balanceAfter, span).status
    } else {
      ledger = input.stated && fileCheck.status === 'ok' ? 'ok' : 'no_data'
    }
    if (ledger !== 'ok') add('ubs_ledger_chain', '넣는 줄 사이의 계좌 잔액이 이어지지 않는다')
  }

  const digest = crypto.createHash('sha256').update(stable({
    v: MODULE_VERSION,
    file: input.file.sha256,
    account: input.accountKey,
    stated: input.stated ? [st.opening, st.closing] : null,
    sheets: [...(input.sheetIds ?? [])].sort(),
    periods: [...src.periods].map((p) => `${p.start}..${p.end}`).sort(),
    statuses,
    rules: [...(src.rules ?? [])].map((r) => ({ id: r.id, d: r.data })).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    problems,
    balance: { file: fileCheck.status, ledger },
  })).digest('hex')

  return {
    plan: {
      digest,
      statement: { accountNumberMatches, currency: st.currency, from: st.from, until: st.until, rows: st.rows.length },
      insert,
      existing,
      classified,
      problems,
      balance: { file: fileCheck.status, ledger },
    },
    rows,
  }
}


export type ReaderView =
  | { type: 'ubs' }
  | { type: 'recipe'; bank: string; saved: boolean; recipeKey: string | null; label: string | null }

interface ReadGroup { id: string; currency: string; account: string | null; st: BankStatement }

interface ReadFile {
  reader: ReaderView
  toSave: { recipe: BankRecipe; fingerprint: string } | null
  readerKey: string
  groups: ReadGroup[]
  filtered: number
  problems: BankPlanProblem[]
}

type ReaderInput = 'ubs' | { recipe: unknown } | { recipeKey: string }

function parseUbsBuffer(buffer: Buffer): BankStatement {
  try {
    return parseUbsCsv(buffer.toString('utf8'))
  } catch (e) {
    if (e instanceof BankFormatError) throw moduleStop(e.code, `bank file: ${e.message}`, e.params)
    throw moduleStop('bank_format', `bank file: ${(e as Error).message}`)
  }
}

function withRecipe(buffer: Buffer, recipe: BankRecipe) {
  try {
    return readWithRecipe(buffer, recipe)
  } catch (e) {
    if (e instanceof BankFormatError) throw moduleStop(e.code, `bank file: ${e.message}`, e.params)
    throw moduleStop('bank_format', `bank file: ${(e as Error).message}`)
  }
}

function checkedRecipe(raw: unknown): BankRecipe {
  try {
    return parseRecipe(raw)
  } catch (e) {
    if (e instanceof BankFormatError) throw moduleStop(e.code, e.message, e.params)
    throw e
  }
}

const signedOf = (r: Pick<BankRow, 'amount' | 'direction'>) => (r.direction === 'in' ? parseCents(r.amount) : -parseCents(r.amount))

function deriveBalances(st: BankStatement): void {
  if (st.rows.length === 0 || st.rows.some((r) => r.balanceAfter == null)) return
  if (st.issues.some((i) => i.code === 'bank_chain_broken' || i.code === 'bank_closing_mismatch')) return
  const chrono = chronological(st)
  st.opening = formatCents(parseCents(chrono[0].balanceAfter!) - signedOf(chrono[0]))
  st.closing = chrono[chrono.length - 1].balanceAfter
}

function fromRecipe(buffer: Buffer, recipe: BankRecipe, reader: ReaderView, toSave: ReadFile['toSave']): ReadFile {
  const r = withRecipe(buffer, recipe)
  for (const g of r.groups) deriveBalances(g.st)
  return {
    reader,
    toSave: toSave ? { ...toSave, fingerprint: r.fingerprint } : null,
    readerKey: `recipe:${recipeHash(recipe)}`,
    groups: r.groups.map((g) => ({ id: g.id, currency: g.currency, account: g.account, st: g.st })),
    filtered: r.filtered,
    problems: r.problems.map((text, i) => ({ ...r.issues[i], text })),
  }
}

function fromUbs(buffer: Buffer): ReadFile {
  const st = parseUbsBuffer(buffer)
  const currency = st.currency ?? st.rows[0]?.currency ?? ''
  return { reader: { type: 'ubs' }, toSave: null, readerKey: 'ubs', groups: [{ id: groupId(currency, null), currency, account: null, st }], filtered: 0, problems: [] }
}

interface SavedRecipe { rowId: string; recipeKey: string; bank: string; fingerprint: string; label: string | null; recipe: BankRecipe }

function savedRecipes(rows: readonly SheetRowView[]): SavedRecipe[] {
  const out: SavedRecipe[] = []
  for (const r of [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    try {
      out.push({ rowId: r.id, recipeKey: String(r.data.recipeKey), bank: String(r.data.bank), fingerprint: String(r.data.fingerprint), label: typeof r.data.label === 'string' ? r.data.label : null, recipe: parseRecipe(r.data.recipe) })
    } catch {
    }
  }
  return out
}

function looksLikeUbs(buffer: Buffer): boolean {
  const head = buffer.subarray(0, 64 * 1024).toString('utf8').replace(/^\uFEFF/, '')
  return /^\s*"?Trade date"?\s*;/m.test(head)
}

function readFile(buffer: Buffer, reader: ReaderInput | undefined, saved: SavedRecipe[]): ReadFile {
  if (reader === 'ubs') return fromUbs(buffer)
  if (reader && typeof reader === 'object' && 'recipe' in reader) {
    const recipe = checkedRecipe(reader.recipe)
    const same = saved.find((x) => fingerprintWith(buffer, recipe) === x.fingerprint && recipeHash(x.recipe) === recipeHash(recipe))
    if (same) return fromRecipe(buffer, same.recipe, { type: 'recipe', bank: same.bank, saved: true, recipeKey: same.recipeKey, label: same.label }, null)
    return fromRecipe(buffer, recipe, { type: 'recipe', bank: recipe.bank, saved: false, recipeKey: null, label: null }, { recipe, fingerprint: '' })
  }
  if (reader && typeof reader === 'object' && 'recipeKey' in reader) {
    const x = saved.find((s) => s.recipeKey === reader.recipeKey)
    if (!x) throw new WorkError('NOT_FOUND', 'recipe')
    return fromRecipe(buffer, x.recipe, { type: 'recipe', bank: x.bank, saved: true, recipeKey: x.recipeKey, label: x.label }, null)
  }
  if (looksLikeUbs(buffer)) {
    try {
      return fromUbs(buffer)
    } catch (e) {
      if (!(e instanceof WorkError && e.stop?.code === 'bank_not_ubs')) throw e
    }
  }
  const match = saved.find((x) => fingerprintWith(buffer, x.recipe) === x.fingerprint)
  if (match) return fromRecipe(buffer, match.recipe, { type: 'recipe', bank: match.bank, saved: true, recipeKey: match.recipeKey, label: match.label }, null)
  throw moduleStop('bank_reader_unknown', 'no saved reader matches this file and it is not a UBS export — ask the AI in the conversation to write a reader')
}

export interface BankImportGroup {
  id: string
  currency: string
  account: string | null
  accountKey: string | null
  candidates: string[]
  needsBalances: boolean
  plan: Omit<BankGroupPlan, 'digest'> | null
  sample: Array<{ line: number; date: string; amount: string; direction: 'in' | 'out'; counterparty: string; bankType: string }>
}

export interface BankImportPlan {
  digest: string
  reader: ReaderView
  filtered: number
  problems: BankPlanProblem[]
  groups: BankImportGroup[]
}

const keepsCoreImportContract = (p: BankImportPlan): ImportPlan => p
void keepsCoreImportContract
const acceptsCoreImportReader = (r: ImportReader): ReaderInput => r
void acceptsCoreImportReader

interface ImportInput {
  step: 'plan' | 'apply'
  fileId: string
  reader?: ReaderInput
  accounts?: Record<string, string>
  accountKey?: string
  balances?: Record<string, { opening: string; closing: string }>
  label?: string
  digest?: string
  approve?: boolean
}

const INPUT_KEYS = ['step', 'fileId', 'reader', 'accounts', 'accountKey', 'balances', 'label', 'digest', 'approve']

function parseInput(raw: unknown): ImportInput {
  const o = (raw ?? {}) as Record<string, unknown>
  if (typeof o !== 'object' || Array.isArray(o)) throw new WorkError('INVALID', 'module input must be an object')
  for (const k of Object.keys(o)) if (!INPUT_KEYS.includes(k)) throw new WorkError('INVALID', `unknown input ${k}`)
  if (o.step !== 'plan' && o.step !== 'apply') throw new WorkError('INVALID', 'step must be plan or apply')
  if (typeof o.fileId !== 'string' || !o.fileId) throw new WorkError('INVALID', 'fileId is required')
  const r = o.reader
  const readerOk = r === undefined || r === 'ubs'
    || (!!r && typeof r === 'object' && !Array.isArray(r) && ((Object.keys(r).length === 1 && 'recipe' in r) || (Object.keys(r).length === 1 && typeof (r as { recipeKey?: unknown }).recipeKey === 'string')))
  if (!readerOk) throw new WorkError('INVALID', 'reader must be "ubs", { recipe } or { recipeKey }')
  const strMap = (v: unknown, what: string) => {
    if (v === undefined) return
    if (!v || typeof v !== 'object' || Array.isArray(v) || Object.values(v).some((x) => typeof x !== 'string' || !x)) throw new WorkError('INVALID', `${what} must map group ids to text`)
  }
  strMap(o.accounts, 'accounts')
  if (o.accountKey !== undefined && (typeof o.accountKey !== 'string' || !o.accountKey)) throw new WorkError('INVALID', 'accountKey must be text')
  if (o.balances !== undefined) {
    if (!o.balances || typeof o.balances !== 'object' || Array.isArray(o.balances)) throw new WorkError('INVALID', 'balances must map group ids to { opening, closing }')
    for (const b of Object.values(o.balances as object)) {
      const x = b as Record<string, unknown>
      if (!x || typeof x !== 'object' || Object.keys(x).some((k) => k !== 'opening' && k !== 'closing') || normalizeAmount(String(x.opening ?? '')) == null || normalizeAmount(String(x.closing ?? '')) == null) {
        throw new WorkError('INVALID', 'balances need an opening and a closing amount (e.g. 1234.50)')
      }
    }
  }
  if (o.label !== undefined && (typeof o.label !== 'string' || o.label.length > 100)) throw new WorkError('INVALID', 'label must be text of at most 100 characters')
  if (o.step === 'apply' && (typeof o.digest !== 'string' || !/^[0-9a-f]{64}$/.test(o.digest))) throw new WorkError('INVALID', 'digest from the plan is required')
  if (o.approve !== undefined && typeof o.approve !== 'boolean') throw new WorkError('INVALID', 'approve must be true or false')
  return o as unknown as ImportInput
}

const squash = (v: unknown) => (typeof v === 'string' ? v.replace(/\s/g, '').toLowerCase() : '')

function pickAccount(g: ReadGroup, bank: string | null, accounts: readonly SheetRowView[], given: string | undefined): { accountKey: string | null; candidates: string[] } {
  const sameCurrency = accounts.filter((a) => a.data.currency === g.currency)
  const candidates = sameCurrency.map((a) => String(a.data.accountKey)).sort()
  if (given) return { accountKey: given, candidates }
  let pool = bank ? sameCurrency.filter((a) => a.data.bank === bank) : sameCurrency
  if (pool.length > 1 && g.account) pool = pool.filter((a) => squash(a.data.accountNumber) === squash(g.account) || squash(a.data.label) === squash(g.account))
  return { accountKey: pool.length === 1 ? String(pool[0].data.accountKey) : null, candidates }
}

interface PlanSources extends PlanSource { recipes: readonly SheetRowView[] }

export function computeImportPlan(
  src: PlanSources,
  file: ReadFile,
  input: Pick<ImportInput, 'accounts' | 'accountKey' | 'balances'>,
  meta: { file: { id: string; sha256: string }; sheetIds: readonly string[] },
  schema: SheetSchema,
): { plan: BankImportPlan; rows: Array<Record<string, unknown>> } {
  const problems = [...file.problems]
  if (input.accountKey && file.groups.length > 1) throw new WorkError('INVALID', 'this file has several accounts — give accounts per group')
  const bank = file.reader.type === 'ubs' ? 'ubs' : file.reader.bank
  const groups: BankImportGroup[] = []
  const rows: Array<Record<string, unknown>> = []
  const digests: unknown[] = []
  for (const g of file.groups) {
    const given = input.accounts?.[g.id] ?? (file.groups.length === 1 ? input.accountKey : undefined)
    const { accountKey, candidates } = pickAccount(g, bank, src.accounts, given)
    const needsBalances = g.st.rows.length > 0 && g.st.rows.some((r) => r.balanceAfter == null) && (g.st.opening == null || g.st.closing == null)
    const stated = needsBalances ? input.balances?.[g.id] : undefined
    const st: BankStatement = stated ? { ...g.st, opening: normalizeAmount(stated.opening), closing: normalizeAmount(stated.closing) } : g.st
    const sample = g.st.rows.slice(0, 5).map((r) => ({ line: r.lineNo, date: r.date, amount: r.amount, direction: r.direction, counterparty: r.counterparty, bankType: r.bankType }))
    if (!accountKey) {
      problems.push({ code: 'bank_account_unknown', params: { currency: g.currency }, text: `no account chosen for the ${g.currency} rows${g.account ? ` (account ${g.account})` : ''}` })
      groups.push({ id: g.id, currency: g.currency, account: g.account, accountKey: null, candidates, needsBalances, plan: null, sample })
      digests.push({ g: g.id, none: true, candidates })
      continue
    }
    const r = computeBankPlan(src, st, { accountKey, file: meta.file, sheetIds: meta.sheetIds, stated: !!stated }, schema)
    const { digest, ...plan } = r.plan
    groups.push({ id: g.id, currency: g.currency, account: g.account, accountKey, candidates, needsBalances, plan, sample })
    rows.push(...r.rows)
    digests.push({ g: g.id, d: digest })
  }
  const digest = crypto.createHash('sha256').update(stable({
    v: MODULE_VERSION,
    reader: file.readerKey,
    file: meta.file.sha256,
    filtered: file.filtered,
    problems,
    groups: digests,
    recipes: [...src.recipes].map((r) => ({ id: r.id, d: r.data })).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  })).digest('hex')
  return { plan: { digest, reader: file.reader, filtered: file.filtered, problems, groups }, rows }
}

export function fileBalanceRequired(reader: ReaderView, g: Pick<BankImportGroup, 'plan'>): boolean {
  return reader.type === 'recipe' && !!g.plan && g.plan.insert.length > 0 && g.plan.balance.file !== 'ok'
}

async function familySheets(ctx: ModuleRunCtx, family: string): Promise<Array<{ id: string; template: string }>> {
  const list = await ctx.deps.db.dataSheet.findMany({
    where: { kind: 'project', projectId: ctx.projectId, userId: ctx.userId, templateFamily: family },
    select: { id: true, template: true },
    orderBy: { id: 'asc' },
  })
  return list.map((s) => ({ id: s.id, template: s.template! }))
}

async function loadFile(ctx: ModuleRunCtx, fileId: string): Promise<{ buffer: Buffer; file: { id: string; sha256: string } }> {
  const f = await ctx.deps.db.workFile.findFirst({ where: { id: fileId, userId: ctx.userId, projectId: ctx.projectId }, select: { id: true } })
  if (!f) throw new WorkError('NOT_FOUND')
  const { file, buffer } = await readProjectFile(ctx.deps, { userId: ctx.userId, fileId, actor: ctx.by })
  return { buffer, file: { id: file.id, sha256: file.sha256 } }
}

function txSchema(templates: readonly SheetTemplate[], sheets: Array<{ template: string }>): SheetSchema {
  if (sheets.length !== 1) throw moduleStop('sheet_count', `the project needs exactly one ${VAT_FAMILY.transactions} sheet (found ${sheets.length})`, { sheet: VAT_FAMILY.transactions, n: sheets.length })
  return templateSchema(findTemplate(templates, sheets[0].template))
}

async function ensureRecipeSheet(ctx: ModuleRunCtx): Promise<string> {
  const have = await familySheets(ctx, VAT_FAMILY.recipes)
  if (have.length > 0) return have[0].id
  try {
    await createProjectSheet(ctx.deps, { userId: ctx.userId, projectId: ctx.projectId, name: 'Bank file readers', template: `${VAT_FAMILY.recipes}@1` })
  } catch (e) {
    if (!(e instanceof WorkError && e.code === 'DUPLICATE')) throw e
  }
  const again = await familySheets(ctx, VAT_FAMILY.recipes)
  if (again.length === 0) throw new WorkError('NOT_FOUND', 'recipe sheet')
  return again[0].id
}

export const bankImportModule: ActionWorkModule<ModuleRunCtx> = {
  id: MODULE_ID,
  version: MODULE_VERSION,
  kind: 'read',
  aiVia: 'vat_bank_import_plan',
  title: { en: 'Bank statement import', de: 'Kontoauszug einlesen', fr: 'Import de relevé bancaire', ko: '은행 거래 가져오기' },
  description: {
    en: 'Reads a bank statement file into transactions — UBS exports directly, any other CSV with a reader the AI writes. Plan first, then a person inserts what the plan showed.',
    de: 'Liest eine Kontoauszugsdatei als Buchungen ein — UBS direkt, jede andere CSV mit einer Leseanleitung, die die KI schreibt. Zuerst planen, dann fügt eine Person das Geplante ein.',
    fr: 'Lit un relevé bancaire en transactions — UBS directement, tout autre CSV avec une notice de lecture écrite par l’IA. D’abord le plan, puis une personne insère le plan.',
    ko: '은행 거래내역 파일을 거래 행으로 — UBS 는 바로, 그 밖의 CSV 는 AI 가 쓴 읽기 설명서로. 먼저 계획을 보고, 사람이 계획대로 넣는다.',
  },
  input: {
    type: 'object',
    additionalProperties: false,
    required: ['step', 'fileId'],
    properties: {
      step: { enum: ['plan', 'apply'] },
      fileId: { type: 'string' },
      reader: {},
      accounts: { type: 'object' },
      accountKey: { type: 'string' },
      balances: { type: 'object' },
      label: { type: 'string' },
      digest: { type: 'string' },
      approve: { type: 'boolean' },
    },
  },
  output: { type: 'object' },
  needs: ['vat.transactions>=1', 'bank.accounts>=1', 'vat.rules>=1'],

  async run(ctx: ModuleRunCtx, raw: unknown): Promise<BankImportPlan | { inserted: number; rowIds: string[]; recipeKey: string | null }> {
    const input = parseInput(raw)
    if (ctx.by.type === 'ai' && input.step === 'apply') throw new WorkError('FORBIDDEN', 'a person applies an import plan')
    const { buffer, file } = await loadFile(ctx, input.fileId)
    const txSheets = await familySheets(ctx, VAT_FAMILY.transactions)
    txSchema(ctx.deps.templates, txSheets)

    if (input.step === 'plan') {
      const accountSheets = await familySheets(ctx, VAT_FAMILY.accounts)
      const ruleSheets = await familySheets(ctx, VAT_FAMILY.rules)
      const recipeSheets = await familySheets(ctx, VAT_FAMILY.recipes)
      const read = async (sheets: Array<{ id: string }>) =>
        (await Promise.all(sheets.map((s) => readProjectSheet(ctx.deps, { userId: ctx.userId, projectId: ctx.projectId, sheetId: s.id })))).flatMap((x) => x.rows)
      const src: PlanSources = {
        periods: await submittedPeriods(ctx.deps.db, ctx.userId, ctx.projectId),
        transactions: await read(txSheets),
        accounts: await read(accountSheets),
        rules: await read(ruleSheets),
        recipes: await read(recipeSheets),
      }
      const rf = readFile(buffer, input.reader, savedRecipes(src.recipes))
      const sheetIds = [...txSheets, ...accountSheets, ...ruleSheets].map((x) => x.id)
      return computeImportPlan(src, rf, input, { file, sheetIds }, txSchema(ctx.deps.templates, txSheets)).plan
    }

    const saving = !!input.reader && typeof input.reader === 'object' && 'recipe' in input.reader
    const recipeSheetId = saving ? await ensureRecipeSheet(ctx) : null
    return withProjectSheetWrite(
      ctx.deps,
      { userId: ctx.userId, projectId: ctx.projectId, sheetIds: [txSheets[0].id, ...(recipeSheetId ? [recipeSheetId] : [])], actor: { type: 'module', id: MODULE_ID, version: MODULE_VERSION } },
      async (w) => {
        const txNow = await w.sheetsOfFamily(VAT_FAMILY.transactions)
        const accountsNow = await w.sheetsOfFamily(VAT_FAMILY.accounts)
        const rulesNow = await w.sheetsOfFamily(VAT_FAMILY.rules)
        const recipesNow = await w.sheetsOfFamily(VAT_FAMILY.recipes)
        if (txNow.map((x) => x.id).join() !== txSheets.map((x) => x.id).join()) throw new WorkError('STALE', 'the sheets changed since the plan — plan again')
        const lockedSchema = txSchema(ctx.deps.templates, txNow)
        const rowsOf = async (sheets: Array<{ id: string }>) => (await Promise.all(sheets.map((s) => w.rows(s.id)))).flat()
        const src: PlanSources = { periods: w.lockedPeriods(), transactions: await rowsOf(txNow), accounts: await rowsOf(accountsNow), rules: await rowsOf(rulesNow), recipes: await rowsOf(recipesNow) }
        const rf = readFile(buffer, input.reader, savedRecipes(src.recipes))
        const sheetIds = [...txNow, ...accountsNow, ...rulesNow].map((x) => x.id)
        const { plan, rows } = computeImportPlan(src, rf, input, { file, sheetIds }, lockedSchema)
        if (plan.digest !== input.digest) throw new WorkError('STALE', 'the data changed since the plan — plan again')
        if (plan.groups.some((g) => !g.accountKey)) throw new WorkError('INVALID', 'choose an account for every group')
        if (rows.length === 0) throw new WorkError('INVALID', 'nothing new to import')
        const anyProblem = plan.problems.length > 0 || plan.groups.some((g) => g.plan!.problems.length > 0)
        if (anyProblem && input.approve !== true) throw new WorkError('INVALID', 'the plan has problems — a person must approve them')
        for (const g of plan.groups) {
          if (g.plan!.balance.file === 'mismatch') throw moduleStop('ubs_file_balance_mismatch', 'the file balance does not add up')
          if (fileBalanceRequired(plan.reader, g)) throw moduleStop('ubs_file_balance_no_data', 'the file balance could not be checked — fix the reader or enter the balances')
          if (g.plan!.insert.length > 0 && g.plan!.balance.ledger !== 'ok') throw moduleStop('ubs_ledger_chain', 'the account balance does not chain across the inserted rows')
        }
        const rowIds: string[] = []
        for (const data of rows) rowIds.push((await w.insert(txNow[0].id, data)).id)
        let recipeKey: string | null = plan.reader.type === 'recipe' ? plan.reader.recipeKey : null
        if (rf.toSave && recipeSheetId) {
          recipeKey = `r-${rf.toSave.fingerprint.slice(0, 24)}`
          const label = input.label?.trim() || `${rf.toSave.recipe.bank} ${[...new Set(plan.groups.map((g) => g.currency))].join(' ')}`
          const data = { recipeKey, bank: rf.toSave.recipe.bank, fingerprint: rf.toSave.fingerprint, recipe: rf.toSave.recipe, label }
          const existing = (await w.rows(recipeSheetId)).find((r) => r.data.recipeKey === recipeKey)
          if (existing) await w.update(recipeSheetId, existing.id, data)
          else await w.insert(recipeSheetId, data)
        }
        return { inserted: rowIds.length, rowIds, recipeKey }
      },
    )
  },
}
