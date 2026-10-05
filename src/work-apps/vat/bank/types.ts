
export interface BankRow {
  lineNo: number
  date: string
  currency: string
  amount: string
  direction: 'in' | 'out'
  counterparty: string
  bankType: string
  details: string
  bankTxNo: string | null
  balanceAfter: string | null
}

export interface BankStatement {
  accountNumber: string | null
  currency: string | null
  from: string | null
  until: string | null
  opening: string | null
  closing: string | null
  rows: BankRow[]
  problems: string[]
  issues: BankIssue[]
}

export interface BankIssue { code: string; params?: Record<string, string | number> }
