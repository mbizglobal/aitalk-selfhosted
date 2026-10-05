
import crypto from 'crypto'
import { isCalendarDate } from '../estv'
import { BankFormatError, parseDelimited } from './parse-csv'
import { checkRunningBalance } from './ubs'
import { txNoGroups } from './row-key'
import type { BankIssue, BankRow, BankStatement } from './types'

export const RECIPE_BANKS = ['ubs', 'wise', 'revolut', 'other'] as const
export const RECIPE_DATE_FORMATS = ['YYYY-MM-DD', 'DD-MM-YYYY', 'DD.MM.YYYY', 'DD/MM/YYYY', 'MM/DD/YYYY'] as const
const DELIMITERS = [',', ';', '\t'] as const
const ENCODINGS = ['utf-8', 'windows-1252'] as const
const DECIMALS = ['.', ','] as const
const THOUSANDS = ['', "'", ',', '.', ' '] as const

export const RECIPE_MAX_BYTES = 8 * 1024
const MAX_NAME = 200
const MAX_LIST = 20
const HEADER_SEARCH_ROWS = 50

export type RecipeAmount =
  | { signed: string }
  | { debit: string; credit: string }
  | { value: string; direction: { column: string; in: string[]; out: string[] } }

export interface BankRecipe {
  v: 1
  bank: (typeof RECIPE_BANKS)[number]
  delimiter: (typeof DELIMITERS)[number]
  encoding: (typeof ENCODINGS)[number]
  headerColumns: string[]
  date: { column: string; format: (typeof RECIPE_DATE_FORMATS)[number]; timezone?: 'UTC' }
  amount: RecipeAmount
  number: { decimal: (typeof DECIMALS)[number]; thousands: (typeof THOUSANDS)[number] }
  currency: { column: string } | { fixed: string }
  keep?: Array<{ column: string; in: string[] }>
  account?: string
  txNo?: string
  balanceAfter?: string
  counterparty?: string[]
  bankType?: string
  details?: string[]
}

const bad = (why: string): never => { throw new BankFormatError(`recipe: ${why}`, 'recipe_invalid', { key: why.split(' ')[0] }) }

function name(v: unknown, key: string): string {
  if (typeof v !== 'string' || v.trim() === '' || v.length > MAX_NAME) bad(`${key} must be a column name`)
  return (v as string).trim()
}
function names(v: unknown, key: string, min = 1): string[] {
  if (!Array.isArray(v) || v.length < min || v.length > MAX_LIST) bad(`${key} must be a list of 1-${MAX_LIST} column names`)
  return (v as unknown[]).map((x) => name(x, key))
}
function values(v: unknown, key: string): string[] {
  if (!Array.isArray(v) || v.length < 1 || v.length > MAX_LIST) bad(`${key} must be a list of 1-${MAX_LIST} values`)
  return (v as unknown[]).map((x) => { if (typeof x !== 'string' || x.trim() === '' || x.length > MAX_NAME) bad(`${key} values must be non-empty text`); return (x as string).trim() })
}
function oneOf<T extends string>(list: readonly T[], v: unknown, key: string): T {
  if (typeof v !== 'string' || !(list as readonly string[]).includes(v)) bad(`${key} must be one of ${list.map((x) => JSON.stringify(x)).join(' ')}`)
  return v as T
}
function obj(v: unknown, key: string, allowed: readonly string[]): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) bad(`${key} must be an object`)
  for (const k of Object.keys(v as object)) if (!allowed.includes(k)) bad(`${key} has unknown key ${k}`)
  return v as Record<string, unknown>
}

export function parseRecipe(raw: unknown): BankRecipe {
  if (JSON.stringify(raw ?? null).length > RECIPE_MAX_BYTES) bad(`recipe is larger than ${RECIPE_MAX_BYTES} bytes`)
  const o = obj(raw, 'recipe', ['v', 'bank', 'delimiter', 'encoding', 'headerColumns', 'date', 'amount', 'number', 'currency', 'keep', 'account', 'txNo', 'balanceAfter', 'counterparty', 'bankType', 'details'])
  if (o.v !== 1) bad('v must be 1')
  const d = obj(o.date, 'date', ['column', 'format', 'timezone'])
  if (d.timezone !== undefined && d.timezone !== 'UTC') bad('date.timezone must be "UTC" or left out')
  const a = obj(o.amount, 'amount', ['signed', 'debit', 'credit', 'value', 'direction'])
  let amount: RecipeAmount
  if (a.signed !== undefined) {
    if (Object.keys(a).length !== 1) bad('amount takes signed alone, or debit+credit, or value+direction')
    amount = { signed: name(a.signed, 'amount.signed') }
  } else if (a.debit !== undefined || a.credit !== undefined) {
    if (Object.keys(a).length !== 2) bad('amount takes signed alone, or debit+credit, or value+direction')
    amount = { debit: name(a.debit, 'amount.debit'), credit: name(a.credit, 'amount.credit') }
  } else {
    if (Object.keys(a).length !== 2) bad('amount takes signed alone, or debit+credit, or value+direction')
    const dir = obj(a.direction, 'amount.direction', ['column', 'in', 'out'])
    const inV = values(dir.in, 'amount.direction.in')
    const outV = values(dir.out, 'amount.direction.out')
    if (inV.some((x) => outV.includes(x))) bad('amount.direction in and out overlap')
    amount = { value: name(a.value, 'amount.value'), direction: { column: name(dir.column, 'amount.direction.column'), in: inV, out: outV } }
  }
  const n = obj(o.number, 'number', ['decimal', 'thousands'])
  const number = { decimal: oneOf(DECIMALS, n.decimal, 'number.decimal'), thousands: oneOf(THOUSANDS, n.thousands ?? '', 'number.thousands') }
  if (number.decimal === number.thousands) bad('number.decimal and number.thousands must differ')
  const c = obj(o.currency, 'currency', ['column', 'fixed'])
  if (Object.keys(c).length !== 1) bad('currency takes column or fixed')
  let currency: BankRecipe['currency']
  if (c.fixed !== undefined) {
    if (typeof c.fixed !== 'string' || !/^[A-Z]{3}$/.test(c.fixed)) bad('currency.fixed must be a 3-letter ISO code')
    currency = { fixed: c.fixed as string }
  } else currency = { column: name(c.column, 'currency.column') }
  let keep: BankRecipe['keep']
  if (o.keep !== undefined) {
    if (!Array.isArray(o.keep) || o.keep.length > MAX_LIST) bad(`keep must be a list of at most ${MAX_LIST}`)
    keep = (o.keep as unknown[]).map((k) => { const x = obj(k, 'keep', ['column', 'in']); return { column: name(x.column, 'keep.column'), in: values(x.in, 'keep.in') } })
  }
  const opt = (v: unknown, key: string) => (v === undefined ? undefined : name(v, key))
  const optList = (v: unknown, key: string) => (v === undefined ? undefined : names(v, key))
  return {
    v: 1,
    bank: oneOf(RECIPE_BANKS, o.bank, 'bank'),
    delimiter: oneOf(DELIMITERS, o.delimiter, 'delimiter'),
    encoding: oneOf(ENCODINGS, o.encoding ?? 'utf-8', 'encoding'),
    headerColumns: names(o.headerColumns, 'headerColumns'),
    date: { column: name(d.column, 'date.column'), format: oneOf(RECIPE_DATE_FORMATS, d.format, 'date.format'), ...(d.timezone ? { timezone: 'UTC' as const } : {}) },
    amount,
    number,
    currency,
    ...(keep ? { keep } : {}),
    ...(o.account !== undefined ? { account: opt(o.account, 'account') } : {}),
    ...(o.txNo !== undefined ? { txNo: opt(o.txNo, 'txNo') } : {}),
    ...(o.balanceAfter !== undefined ? { balanceAfter: opt(o.balanceAfter, 'balanceAfter') } : {}),
    ...(o.counterparty !== undefined ? { counterparty: optList(o.counterparty, 'counterparty') } : {}),
    ...(o.bankType !== undefined ? { bankType: opt(o.bankType, 'bankType') } : {}),
    ...(o.details !== undefined ? { details: optList(o.details, 'details') } : {}),
  }
}

export function recipeHash(r: BankRecipe): string {
  const stable = (v: unknown): string => {
    if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null)
    if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
    const x = v as Record<string, unknown>
    return `{${Object.keys(x).filter((k) => x[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(x[k])}`).join(',')}}`
  }
  return crypto.createHash('sha256').update(stable(r)).digest('hex')
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function parseRecipeAmount(raw: string, n: BankRecipe['number']): string | null {
  const t = raw.trim()
  if (t === '') return null
  const sep = n.thousands === "'" ? "['’]" : esc(n.thousands)
  const group = n.thousands === '' ? '\\d+' : `\\d{1,3}(?:${sep}\\d{3})+|\\d+`
  const m = new RegExp(`^([+-])?(${group})(?:${esc(n.decimal)}(\\d{1,2}))?$`).exec(t)
  if (!m) return null
  const int = n.thousands === '' ? m[2] : m[2].replace(new RegExp(sep, 'g'), '')
  const frac = (m[3] ?? '').padEnd(2, '0')
  const neg = m[1] === '-' && /[1-9]/.test(int + frac)
  return `${neg ? '-' : ''}${BigInt(int).toString()}.${frac}`
}

const ZURICH_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit' })

export function parseRecipeDate(raw: string, format: BankRecipe['date']['format'], timezone?: 'UTC'): { date: string; shifted: boolean } | { error: 'date' | 'no_time' } {
  const t = raw.trim()
  const datePart = format === 'YYYY-MM-DD' ? '(\\d{4})-(\\d{2})-(\\d{2})' : `(\\d{2})${esc(format[2])}(\\d{2})${esc(format[2])}(\\d{4})`
  const m = new RegExp(`^${datePart}(?:[ T](\\d{2}):(\\d{2})(?::(\\d{2})(?:\\.\\d{1,6})?)?(Z)?)?$`).exec(t)
  if (!m) return { error: 'date' }
  const [y, mo, d] = format === 'YYYY-MM-DD' ? [m[1], m[2], m[3]] : format === 'MM/DD/YYYY' ? [m[3], m[1], m[2]] : [m[3], m[2], m[1]]
  const date = `${y}-${mo}-${d}`
  if (!isCalendarDate(date)) return { error: 'date' }
  if (!timezone && m[7] === undefined) return { date, shifted: false }
  if (m[4] === undefined) return { error: 'no_time' }
  const [hh, mm, ss] = [Number(m[4]), Number(m[5]), Number(m[6] ?? 0)]
  if (hh > 23 || mm > 59 || ss > 59) return { error: 'date' }
  const local = ZURICH_DAY.format(new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), hh, mm, ss)))
  return { date: local, shifted: local !== date }
}

function decode(buffer: Buffer, encoding: BankRecipe['encoding']): string {
  if (encoding === 'windows-1252') return new TextDecoder('windows-1252').decode(buffer)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    throw new BankFormatError('file is not valid UTF-8 — try encoding windows-1252', 'bank_encoding')
  }
}

function findHeader(table: string[][], recipe: BankRecipe): number | null {
  for (let i = 0; i < Math.min(table.length, HEADER_SEARCH_ROWS); i++) {
    const cells = table[i].map((c) => c.trim())
    if (recipe.headerColumns.every((h) => cells.includes(h))) return i
  }
  return null
}

export function headerFingerprint(cells: readonly string[]): string {
  const trimmed = [...cells].map((c) => c.trim())
  while (trimmed.length && trimmed[trimmed.length - 1] === '') trimmed.pop()
  return crypto.createHash('sha256').update(JSON.stringify(trimmed)).digest('hex')
}

export function fingerprintWith(buffer: Buffer, recipe: BankRecipe): string | null {
  try {
    const table = parseDelimited(decode(buffer, recipe.encoding), recipe.delimiter)
    const h = findHeader(table, recipe)
    return h == null ? null : headerFingerprint(table[h])
  } catch {
    return null
  }
}

export interface RecipeGroup {
  id: string
  currency: string
  account: string | null
  st: BankStatement
}

export interface RecipeRead {
  fingerprint: string
  groups: RecipeGroup[]
  filtered: number
  problems: string[]
  issues: BankIssue[]
}

export const groupId = (currency: string, account: string | null) => `${currency}|${account ?? ''}`

export function readWithRecipe(buffer: Buffer, recipe: BankRecipe): RecipeRead {
  const table = parseDelimited(decode(buffer, recipe.encoding), recipe.delimiter)
  const headerIdx = findHeader(table, recipe)
  if (headerIdx == null) throw new BankFormatError('the header row with every headerColumns was not found', 'bank_header_not_found')
  const head = table[headerIdx].map((c) => c.trim())
  const named = head[head.length - 1] === '' ? head.length - 1 : head.length
  const col = (c: string): number => {
    const i = head.indexOf(c)
    if (i < 0) throw new BankFormatError(`the file has no column ${c}`, 'bank_column_missing', { column: c })
    if (head.indexOf(c, i + 1) >= 0) throw new BankFormatError(`the file has the column ${c} twice`, 'bank_column_duplicate', { column: c })
    return i
  }
  const a = recipe.amount
  const ix = {
    date: col(recipe.date.column),
    ...('signed' in a ? { signed: col(a.signed) } : 'debit' in a ? { debit: col(a.debit), credit: col(a.credit) } : { value: col(a.value), dir: col(a.direction.column) }),
    currency: 'column' in recipe.currency ? col(recipe.currency.column) : null,
    account: recipe.account ? col(recipe.account) : null,
    txNo: recipe.txNo ? col(recipe.txNo) : null,
    balance: recipe.balanceAfter ? col(recipe.balanceAfter) : null,
    counterparty: (recipe.counterparty ?? []).map(col),
    bankType: recipe.bankType ? col(recipe.bankType) : null,
    details: (recipe.details ?? []).map(col),
    keep: (recipe.keep ?? []).map((k) => ({ i: col(k.column), in: k.in })),
  } as {
    date: number; signed?: number; debit?: number; credit?: number; value?: number; dir?: number
    currency: number | null; account: number | null; txNo: number | null; balance: number | null
    counterparty: number[]; bankType: number | null; details: number[]; keep: Array<{ i: number; in: string[] }>
  }

  const out: RecipeRead = { fingerprint: headerFingerprint(table[headerIdx]), groups: [], filtered: 0, problems: [], issues: [] }
  const note = (code: string, text: string, params?: BankIssue['params']) => { out.problems.push(text); out.issues.push(params ? { code, params } : { code }) }
  const groups = new Map<string, RecipeGroup>()
  const cellsOk = (r: string[]) => r.length === named || (r.length > named && r.slice(named).every((c) => c.trim() === ''))

  for (let i = headerIdx + 1; i < table.length; i++) {
    const r = table[i]
    if (r.every((c) => c.trim() === '')) continue
    const lineNo = i + 1
    if (!cellsOk(r)) { note('bank_line_columns', `line ${lineNo}: ${r.length} cells, the header has ${named}`, { line: lineNo }); continue }
    const cell = (k: number) => (r[k] ?? '').trim()
    if (ix.keep.some((k) => !k.in.includes(cell(k.i)))) { out.filtered++; continue }

    const d = parseRecipeDate(cell(ix.date), recipe.date.format, recipe.date.timezone)
    if ('error' in d) {
      if (d.error === 'no_time') note('bank_line_no_time', `line ${lineNo}: the date has no time — timezone UTC needs one`, { line: lineNo })
      else note('bank_line_date', `line ${lineNo}: date not readable`, { line: lineNo })
      continue
    }

    let amount: string
    let direction: 'in' | 'out'
    if (ix.signed !== undefined) {
      const v = parseRecipeAmount(cell(ix.signed), recipe.number)
      if (v == null) { note('bank_line_amount', `line ${lineNo}: amount not readable`, { line: lineNo }); continue }
      direction = v.startsWith('-') ? 'out' : 'in'
      amount = v.replace(/^-/, '')
    } else if (ix.debit !== undefined) {
      const isZero = (s: string) => { const v = parseRecipeAmount(s, recipe.number); return v != null && /^-?0\.00$/.test(v) }
      let deb = cell(ix.debit)
      let cre = cell(ix.credit!)
      if (deb !== '' && cre !== '') { if (isZero(cre)) cre = ''; else if (isZero(deb)) deb = '' }
      if (deb === '' && cre === '') { note('bank_line_no_amount', `line ${lineNo}: debit and credit are both empty`, { line: lineNo }); continue }
      if (deb !== '' && cre !== '') { note('bank_line_both_amounts', `line ${lineNo}: debit and credit are both filled`, { line: lineNo }); continue }
      const v = parseRecipeAmount(deb !== '' ? deb : cre, recipe.number)
      if (v == null) { note('bank_line_amount', `line ${lineNo}: amount not readable`, { line: lineNo }); continue }
      if (cre !== '' && v.startsWith('-')) { note('bank_line_sign', `line ${lineNo}: credit is negative`, { line: lineNo }); continue }
      direction = deb !== '' ? 'out' : 'in'
      amount = v.replace(/^-/, '')
    } else {
      const v = parseRecipeAmount(cell(ix.value!), recipe.number)
      if (v == null) { note('bank_line_amount', `line ${lineNo}: amount not readable`, { line: lineNo }); continue }
      const dv = cell(ix.dir!)
      const dir = recipe.amount as Extract<RecipeAmount, { value: string }>
      if (dir.direction.in.includes(dv)) direction = 'in'
      else if (dir.direction.out.includes(dv)) direction = 'out'
      else { note('bank_line_direction', `line ${lineNo}: direction value not in the recipe`, { line: lineNo }); continue }
      if (direction === 'in' && v.startsWith('-')) { note('bank_line_sign', `line ${lineNo}: an incoming amount is negative`, { line: lineNo }); continue }
      amount = v.replace(/^-/, '')
    }

    const currency = ix.currency == null ? (recipe.currency as { fixed: string }).fixed : cell(ix.currency).toUpperCase()
    if (!/^[A-Z]{3}$/.test(currency)) { note('bank_line_currency', `line ${lineNo}: currency not readable`, { line: lineNo }); continue }
    if (d.shifted) note('bank_tz_shift', `line ${lineNo}: the UTC time falls on the next or previous day in Zurich`, { line: lineNo, date: d.date })

    let balanceAfter: string | null = null
    if (ix.balance != null) {
      balanceAfter = parseRecipeAmount(cell(ix.balance), recipe.number)
      if (balanceAfter == null) note('bank_line_balance', `line ${lineNo}: balance not readable`, { line: lineNo })
    }
    const account = ix.account == null ? null : cell(ix.account).replace(/\s+/g, ' ')
    const firstOf = (cols: number[]) => cols.map(cell).find((x) => x !== '') ?? ''
    const row: BankRow = {
      lineNo,
      date: d.date,
      currency,
      amount,
      direction,
      counterparty: firstOf(ix.counterparty),
      bankType: ix.bankType == null ? '' : cell(ix.bankType),
      details: ix.details.map(cell).filter((x) => x !== '').join(' · '),
      bankTxNo: ix.txNo == null ? null : cell(ix.txNo) || null,
      balanceAfter,
    }
    const id = groupId(currency, account)
    let g = groups.get(id)
    if (!g) {
      g = { id, currency, account, st: { accountNumber: account ? account.replace(/\s/g, '') || null : null, currency, from: null, until: null, opening: null, closing: null, rows: [], problems: [], issues: [] } }
      groups.set(id, g)
    }
    g.st.rows.push(row)
  }

  for (const g of groups.values()) {
    const st = g.st
    const dates = st.rows.map((r) => r.date).sort()
    st.from = dates[0] ?? null
    st.until = dates[dates.length - 1] ?? null
    const gnote = (code: string, text: string, params?: BankIssue['params']) => { st.problems.push(text); st.issues.push(params ? { code, params } : { code }) }
    for (const d of txNoGroups(st.rows).duplicates) gnote('bank_line_dup_txno', `line ${d.line}: same transaction number as line ${d.first}`, { line: d.line, first: d.first })
    if (st.rows.length > 0 && st.rows.every((r) => r.balanceAfter != null)) {
      for (const b of checkRunningBalance(st)) gnote(b.code, b.text, b.params)
    }
  }
  out.groups = [...groups.values()].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
  return out
}
