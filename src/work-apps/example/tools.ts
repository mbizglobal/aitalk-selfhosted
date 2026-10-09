/** App AI tool — names start with "example_". Loaded only in conversations of this app's projects */
import type { WorkAppTool } from '@/lib/work/package-api'
import { EXPENSES } from './templates'

export const summaryTool: WorkAppTool = {
  def: {
    name: 'example_summary',
    description: 'Counts the rows of the Expenses sheet and how many are still unconfirmed. Totals come only from the calculation module example.total.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  async run(ctx) {
    const [sheet] = await ctx.sheets.list(EXPENSES)
    if (!sheet) return { rows: 0, unconfirmed: 0 }
    const { rows } = await ctx.sheets.read(sheet.id)
    return { rows: rows.length, unconfirmed: rows.filter((r) => r.confirmed === false).length }
  },
}
