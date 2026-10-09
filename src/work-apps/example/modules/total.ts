/**
 * Calculation module — the total of the task period. It runs inside a submission (the result is sealed) and for the preview.
 * Reads only through ctx (rows of the task period); writes nothing.
 */
import { moduleStop, type CalcModuleCtx, type CalcWorkModule } from '@/lib/work/package-api'
import { EXPENSES } from '../templates'
import { fromCents, toCents } from '../money'

export interface TotalOutput { total: string; count: number }

export function sumRows(rows: ReadonlyArray<{ data: Readonly<Record<string, unknown>> }>): TotalOutput {
  let total = BigInt(0)
  for (const r of rows) {
    const c = toCents(r.data.amount)
    // Stop instead of skipping — a silently skipped row is a wrong total
    if (c === null) throw moduleStop('row_value_missing', 'expense row without a valid amount', { sheet: EXPENSES, column: 'amount' })
    total += c
  }
  return { total: fromCents(total), count: rows.length }
}

export const totalModule: CalcWorkModule = {
  id: 'example.total',
  version: 1,
  kind: 'calc',
  title: { en: 'Total' },
  description: { en: 'Adds up the amounts of the expenses in the task period.' },
  input: { type: 'object', properties: {}, additionalProperties: false },
  output: { type: 'object', properties: { total: { type: 'string' }, count: { type: 'number' } } },
  needs: [`${EXPENSES}>=1`],
  async run(ctx: CalcModuleCtx) {
    return sumRows(ctx.periodRows(EXPENSES))
  },
  // Preview: confirmed rows only vs. all rows — the person sees what is still unconfirmed
  async preview(ctx: CalcModuleCtx) {
    const rows = ctx.periodRows(EXPENSES)
    const unconfirmed = rows.filter((r) => r.confirmed === false).length
    return { confirmed: sumRows(rows.filter((r) => r.confirmed !== false)), draft: unconfirmed ? sumRows(rows) : null, unconfirmed }
  },
}
