
import { parseCents, formatCents } from '../estv'
import { normalizeAmount } from './parse-csv'
import type { BankRow } from './types'

export type BalanceCheck =
  | { status: 'ok'; expectedClosing: string }
  | { status: 'mismatch'; expectedClosing: string; closing: string; diff: string }
  | { status: 'no_data' }

export function reconcileBalance(opening: string | null, closing: string | null, rows: Pick<BankRow, 'amount' | 'direction'>[]): BalanceCheck {
  const o = opening == null ? null : normalizeAmount(opening)
  const c = closing == null ? null : normalizeAmount(closing)
  if (o == null || c == null) return { status: 'no_data' }
  closing = c
  let v = parseCents(o)
  for (const r of rows) v += r.direction === 'in' ? parseCents(r.amount) : -parseCents(r.amount)
  const expectedClosing = formatCents(v)
  const diff = parseCents(closing) - v
  return diff === BigInt(0)
    ? { status: 'ok', expectedClosing }
    : { status: 'mismatch', expectedClosing, closing, diff: formatCents(diff) }
}
