
export interface ImportStop { code: string; params?: Record<string, string | number> }

export interface ImportGroupPlan {
  statement: { accountNumberMatches: boolean | null; currency: string | null; from: string | null; until: string | null; rows: number }
  insert: Array<{ lineNo: number; date: string; amount: string; direction: 'in' | 'out' }>
  existing: Array<{ lineNo: number; rowId: string; locked: boolean }>
  classified: number
  problems: Array<ImportStop & { text: string }>
  balance: { file: 'ok' | 'mismatch' | 'no_data'; ledger: 'ok' | 'mismatch' | 'no_data' | 'skipped' }
  suspects?: Array<{ lineNo: number; date: string; amount: string; direction: 'in' | 'out'; why: 'other_key' | 'other_file' }>
  period?: { source: 'bank' | 'person' | null; personAllowed?: boolean; personFrom?: string | null; personUntil?: string | null; from: string | null; until: string | null; seenFrom: string | null; seenUntil: string | null }
  balanceRanges?: Array<{ key: string; from: string | null; until: string | null; needed: boolean }>
  blocked?: boolean
}
/** + { statement } — a statement the AI read from a PDF or picture (bank ledger · docs/wf_app/05_expenses/plan.md D7) */
export type ImportReader = 'auto' | 'ubs' | { recipe: unknown } | { recipeKey: string } | { statement: unknown }
export interface ImportPlan {
  digest: string
  reader: { type: 'ubs' } | { type: 'recipe'; bank: string; saved: boolean; recipeKey: string | null; label: string | null } | { type: 'bank_file'; format: string } | { type: 'statement' }
  filtered: number
  problems: Array<ImportStop & { text: string }>
  groups: Array<{ id: string; currency: string; account: string | null; accountKey: string | null; candidates: string[]; needsBalances: boolean; plan: ImportGroupPlan | null }>
  notices?: Array<ImportStop & { text: string }>
  writes?: number
}
