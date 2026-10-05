
import { formatCents, isCalendarDate, parseCents } from '../estv'
import { BankFormatError, normalizeAmount, parseDelimited } from './parse-csv'
import { txNoGroups } from './row-key'
import type { BankIssue, BankRow, BankStatement } from './types'

function note(st: BankStatement, code: string, text: string, params?: BankIssue['params']): void {
  st.problems.push(text)
  st.issues.push(params ? { code, params } : { code })
}

const HEADER_LABELS: Record<string, keyof Pick<BankStatement, 'accountNumber' | 'from' | 'until' | 'opening' | 'closing' | 'currency'> | 'count'> = {
  'account number': 'accountNumber',
  from: 'from',
  until: 'until',
  'opening balance': 'opening',
  'closing balance': 'closing',
  'valued in': 'currency',
  'numbers of transactions in this period': 'count',
}

const REQUIRED_COLUMNS = ['Trade date', 'Booking date', 'Currency', 'Debit', 'Credit', 'Individual amount', 'Balance', 'Transaction no.', 'Description1', 'Description2', 'Description3'] as const

export function parseUbsCsv(text: string): BankStatement {
  const table = parseDelimited(text, ';')
  const headerIdx = table.findIndex((r) => (r[0] ?? '').trim() === 'Trade date')
  if (headerIdx < 0) throw new BankFormatError('UBS 표 머리(Trade date)를 찾지 못했다 — 영문 CSV 내보내기만 지원한다', 'bank_not_ubs')

  const st: BankStatement = { accountNumber: null, currency: null, from: null, until: null, opening: null, closing: null, rows: [], problems: [], issues: [] }
  let declaredCount: number | null = null

  for (const r of table.slice(0, headerIdx)) {
    const label = (r[0] ?? '').trim().replace(/:$/, '').toLowerCase()
    const key = HEADER_LABELS[label]
    const value = (r[1] ?? '').trim()
    if (!key) continue
    if (value === '') {
      if (key === 'opening' || key === 'closing' || key === 'count') note(st, 'bank_header_blank', `머리 ${label} 값이 비어 있다`, { field: key })
      continue
    }
    if (key === 'count') {
      declaredCount = /^\d+$/.test(value) ? Number(value) : null
      if (declaredCount == null) note(st, 'bank_header_count', `머리 거래 건수를 읽지 못했다`)
    }
    else if (key === 'opening' || key === 'closing') {
      const v = normalizeAmount(value)
      if (v == null) note(st, 'bank_header_amount', `머리 ${label} 금액을 읽지 못했다`, { field: key })
      st[key] = v
    } else if (key === 'from' || key === 'until') {
      if (isCalendarDate(value)) st[key] = value
      else note(st, 'bank_header_date', `머리 ${label} 날짜를 읽지 못했다`, { field: key })
    } else if (key === 'accountNumber') st.accountNumber = value.replace(/\s/g, '')
    else st.currency = value.toUpperCase()
  }

  const head = table[headerIdx].map((c) => c.trim())
  const col: Record<string, number> = {}
  for (const name of REQUIRED_COLUMNS) {
    const i = head.indexOf(name)
    if (i < 0) throw new BankFormatError(`UBS 표에 ${name} 칸이 없다`, 'bank_column_missing', { column: name })
    col[name] = i
  }
  const cell = (r: string[], name: (typeof REQUIRED_COLUMNS)[number]) => (r[col[name]] ?? '').trim()
  const named = head[head.length - 1] === '' ? head.length - 1 : head.length
  const cellsOk = (r: string[]) => r.length === named || (r.length === named + 1 && r[named].trim() === '')
  const dataRows = table.slice(headerIdx + 1).filter((r) => cellsOk(r) && isCalendarDate(cell(r, 'Trade date')))
  const noBalanceExport = dataRows.length > 0 && dataRows.every((r) => cell(r, 'Balance') === '')
  if (noBalanceExport) {
    for (let k = st.issues.length - 1; k >= 0; k--) {
      const is = st.issues[k]
      if (is.code === 'bank_header_blank' && (is.params?.field === 'opening' || is.params?.field === 'closing')) { st.issues.splice(k, 1); st.problems.splice(k, 1) }
    }
  }

  for (let i = headerIdx + 1; i < table.length; i++) {
    const r = table[i]
    if (r.every((c) => c.trim() === '')) continue
    const lineNo = i + 1
    if (!cellsOk(r)) {
      note(st, 'bank_line_columns', `${lineNo}번 줄: 칸 수가 머리와 달라(${r.length}/${named}) 건너뛰었다 — 칸이 밀렸을 수 있다`, { line: lineNo })
      continue
    }
    if (cell(r, 'Individual amount') !== '' && (cell(r, 'Debit') !== '' || cell(r, 'Credit') !== '')) {
      note(st, 'bank_line_individual', `${lineNo}번 줄: 개별 금액 칸이 채워져 있다 — 이 줄 금액과 따로 들어간 돈이 있는지 확인 필요`, { line: lineNo })
    }
    let debit = cell(r, 'Debit')
    let credit = cell(r, 'Credit')
    const isZero = (v: string) => /^[+-]?0+(\.0+)?$/.test(v.trim()) || /^-?0\.00$/.test(normalizeAmount(v) ?? 'x')
    if (debit !== '' && credit !== '') {
      if (isZero(credit)) credit = ''
      else if (isZero(debit)) debit = ''
    }
    if (debit === '' && credit === '') {
      const why = cell(r, 'Individual amount') ? ' (개별 금액만 있는 줄 — 그 돈이 다른 줄에 들어 있는지 확인 필요)' : cell(r, 'Balance') === '' && !noBalanceExport ? ' — 칸이 밀렸을 수 있다' : ''
      note(st, 'bank_line_no_amount', `${lineNo}번 줄: Debit·Credit 이 비어 있어 건너뛰었다${why}`, { line: lineNo })
      continue
    }
    if (debit !== '' && credit !== '') {
      note(st, 'bank_line_both_amounts', `${lineNo}번 줄: Debit·Credit 이 둘 다 있어 건너뛰었다`, { line: lineNo })
      continue
    }
    const signed = normalizeAmount(debit !== '' ? debit : credit)
    if (signed == null) {
      note(st, 'bank_line_amount', `${lineNo}번 줄: 금액을 읽지 못해 건너뛰었다`, { line: lineNo })
      continue
    }
    const amount = signed.replace(/^-/, '')
    const zero = /^0\.00$/.test(amount)
    if ((credit !== '' && signed.startsWith('-')) || (debit !== '' && !signed.startsWith('-') && !zero)) {
      note(st, 'bank_line_sign', `${lineNo}번 줄: ${credit !== '' ? 'Credit 이 음수' : 'Debit 이 양수'}라 건너뛰었다`, { line: lineNo })
      continue
    }
    const date = cell(r, 'Trade date')
    if (!isCalendarDate(date)) {
      note(st, 'bank_line_date', `${lineNo}번 줄: 거래일(Trade date)을 읽지 못해 건너뛰었다`, { line: lineNo })
      continue
    }
    const balanceAfter = normalizeAmount(cell(r, 'Balance'))
    const txNo = cell(r, 'Transaction no.')
    if ((balanceAfter == null && !noBalanceExport) || txNo === '' || /^[+-]?\d[\d'’]*\.\d{2}$/.test(txNo)) {
      note(st, 'bank_line_shifted', `${lineNo}번 줄: 잔액·거래번호 칸이 이상해 건너뛰었다 — 칸이 밀렸을 수 있다`, { line: lineNo })
      continue
    }
    const currency = (cell(r, 'Currency') || st.currency || '').toUpperCase()
    if (!/^[A-Z]{3}$/.test(currency)) {
      note(st, 'bank_line_currency', `${lineNo}번 줄: 통화를 읽지 못해 건너뛰었다`, { line: lineNo })
      continue
    }
    const desc1 = cell(r, 'Description1')
    const desc2 = cell(r, 'Description2')
    const row: BankRow = {
      lineNo,
      date,
      currency,
      amount,
      direction: debit !== '' ? 'out' : 'in',
      counterparty: desc2 ? desc1.split(';')[0].trim() : '',
      bankType: desc2 || desc1,
      details: cell(r, 'Description3'),
      bankTxNo: txNo || null,
      balanceAfter,
    }
    if (st.currency && row.currency !== st.currency) {
      note(st, 'bank_line_other_currency', `${lineNo}번 줄: 통화 ${row.currency} 가 머리 통화 ${st.currency} 와 달라 건너뛰었다`, { line: lineNo, currency: row.currency, fileCurrency: st.currency })
      continue
    }
    st.rows.push(row)
  }

  for (const d of txNoGroups(st.rows).duplicates) note(st, 'bank_line_dup_txno', `${d.line}번 줄: 거래번호가 ${d.first}번 줄과 같다`, { line: d.line, first: d.first })
  if (declaredCount != null && declaredCount !== st.rows.length) {
    note(st, 'bank_count_mismatch', `머리의 거래 건수 ${declaredCount} 와 읽은 줄 ${st.rows.length} 이 다르다`, { declared: declaredCount, read: st.rows.length })
  }
  if (!noBalanceExport) for (const b of checkRunningBalance(st)) note(st, b.code, b.text, b.params)
  return st
}

const cents = parseCents
const signedCents = (r: BankRow) => (r.direction === 'in' ? cents(r.amount) : -cents(r.amount))

export function checkRunningBalance(st: BankStatement): Array<{ code: string; text: string; params?: BankIssue['params'] }> {
  const rows = st.rows
  if (rows.length === 0) {
    return st.opening != null && st.closing != null && cents(st.opening) !== cents(st.closing)
      ? [{ code: 'bank_empty_balance', text: '읽은 거래가 없는데 머리의 시작·끝 잔액이 다르다' }] : []
  }
  const tryChain = (chrono: BankRow[]): { code: string; text: string; params?: BankIssue['params'] } | null => {
    let prev = st.opening != null ? cents(st.opening) : cents(chrono[0].balanceAfter as string) - signedCents(chrono[0])
    for (const r of chrono) {
      const want = prev + signedCents(r)
      if (cents(r.balanceAfter as string) !== want) return { code: 'bank_chain_broken', text: `${r.lineNo}번 줄: 잔액 사슬이 끊겼다 (은행 ${r.balanceAfter}, 계산 ${formatCents(want)})`, params: { line: r.lineNo } }
      prev = want
    }
    if (st.closing != null && prev !== cents(st.closing)) return { code: 'bank_closing_mismatch', text: `마지막 줄 잔액이 머리의 끝 잔액 ${st.closing} 과 다르다` }
    return null
  }
  const reversed = [...rows].reverse()
  const guessNewestFirst = rows[0].date >= rows[rows.length - 1].date
  const first = tryChain(guessNewestFirst ? reversed : rows)
  if (first == null) return []
  const other = tryChain(guessNewestFirst ? rows : reversed)
  return other == null ? [] : [first]
}
