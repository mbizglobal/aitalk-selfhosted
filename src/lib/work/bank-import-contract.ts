
export interface ImportStop { code: string; params?: Record<string, string | number> }

export interface ImportGroupPlan {
  statement: { accountNumberMatches: boolean | null; currency: string | null; from: string | null; until: string | null; rows: number }
  insert: Array<{ lineNo: number; date: string; amount: string; direction: 'in' | 'out' }>
  existing: Array<{ lineNo: number; rowId: string; locked: boolean }>
  classified: number
  problems: Array<ImportStop & { text: string }>
  balance: { file: 'ok' | 'mismatch' | 'no_data'; ledger: 'ok' | 'mismatch' | 'no_data' | 'skipped' }
}
export type ImportReader = 'ubs' | { recipe: unknown } | { recipeKey: string }
export interface ImportPlan {
  digest: string
  reader: { type: 'ubs' } | { type: 'recipe'; bank: string; saved: boolean; recipeKey: string | null; label: string | null }
  filtered: number
  problems: Array<ImportStop & { text: string }>
  groups: Array<{ id: string; currency: string; account: string | null; accountKey: string | null; candidates: string[]; needsBalances: boolean; plan: ImportGroupPlan | null }>
}
