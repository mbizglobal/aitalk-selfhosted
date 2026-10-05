
import crypto from 'crypto'
import type { BankRow } from './types'

export type KeyedBankRow = BankRow & { bankRowKey: string }

export const REVERSAL_SUFFIX = ':rev'

export function txNoGroups(rows: readonly BankRow[]): { reversal: Set<number>; duplicates: Array<{ line: number; first: number }> } {
  const byNo = new Map<string, BankRow[]>()
  for (const r of rows) if (r.bankTxNo) byNo.set(r.bankTxNo, [...(byNo.get(r.bankTxNo) ?? []), r])
  const reversal = new Set<number>()
  const duplicates: Array<{ line: number; first: number }> = []
  for (const list of byNo.values()) {
    if (list.length === 1) continue
    if (list.length === 2 && list[0].direction !== list[1].direction && list[0].amount === list[1].amount && list[0].currency === list[1].currency) {
      const [a, b] = list
      const later = a.date !== b.date ? (a.date > b.date ? a : b) : (a.direction === 'in' ? a : b)
      reversal.add(later.lineNo)
      continue
    }
    for (const r of list.slice(1)) duplicates.push({ line: r.lineNo, first: list[0].lineNo })
  }
  return { reversal, duplicates }
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

export function assignBankRowKeys(rows: BankRow[], accountExportKey: string): KeyedBankRow[] {
  if (!accountExportKey) throw new Error('bankRowKey: 계좌 exportKey 가 비었다')
  const { reversal, duplicates } = txNoGroups(rows)
  if (duplicates.length > 0) throw new Error(`bankRowKey: ${duplicates[0].line}번 줄 거래번호가 파일 안에서 두 번 나온다`)
  const seenTuple = new Map<string, number>()
  return rows.map((r) => {
    if (r.bankTxNo) return { ...r, bankRowKey: `tx:${r.bankTxNo}${reversal.has(r.lineNo) ? REVERSAL_SUFFIX : ''}` }
    const tuple = [accountExportKey, r.date, r.amount, r.direction, norm(r.counterparty)].join('|')
    const n = seenTuple.get(tuple) ?? 0
    seenTuple.set(tuple, n + 1)
    const h = crypto.createHash('sha256').update(`${tuple}|${n}`).digest('hex')
    return { ...r, bankRowKey: `h:${h}` }
  })
}
