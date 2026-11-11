/** App AI tools — names start with "example_". Loaded only in conversations of this app's projects */
import { WorkError, type V3WorkAppTool, type WorkAppTool } from '@/lib/work/package-api'
import { EXPENSES } from './templates'
import { sumRows } from './modules/total'

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

/**
 * Contract 3 — sends the total of a closed month by email. The AI passes the address the person gave, so the send always
 * becomes a card: nothing leaves until a person presses Send. Only closed months — their rows are locked, so the total is final.
 */
export const sendTotalTool: V3WorkAppTool = {
  def: {
    name: 'example_send_total',
    description: 'Puts the total of a closed month on an email card for the address the person gave. The person checks the card and presses Send — tell them so. Only closed (submitted) months.',
    parameters: {
      type: 'object',
      properties: {
        month: { type: 'string', description: 'YYYY-MM' },
        to: { type: 'string', description: 'Email address the person gave' },
      },
      required: ['month', 'to'],
      additionalProperties: false,
    },
  },
  async run(ctx, args) {
    const month = typeof args.month === 'string' && /^\d{4}-\d{2}$/.test(args.month) ? args.month : null
    if (!month) throw new WorkError('INVALID', 'month must be YYYY-MM')
    // The whole month must lie inside closed periods — then its rows are locked and the total is final
    const first = `${month}-01`
    const last = `${month}-${String(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0')}`
    const closed = (await ctx.sheets.submittedPeriods()).some((p) => p.start <= first && p.end >= last)
    if (!closed) return { error: `${month} is not closed yet — close the month first` }
    if (!ctx.send) throw new WorkError('UNAVAILABLE', 'this app declares no email connection')
    const rows = []
    for (const sheet of await ctx.sheets.list(EXPENSES)) {
      for (const r of (await ctx.sheets.read(sheet.id)).rows) {
        const d = r.data.date
        if (typeof d === 'string' && d.startsWith(`${month}-`)) rows.push(r)
      }
    }
    const { total, count } = sumRows(rows)
    const text = `Expenses ${month}: ${total} (${count} rows, closed).`
    const r = await ctx.send({ via: 'mail', to: String(args.to ?? ''), content: { subject: `Expenses ${month}`, text } })
    return { status: r.status, code: r.code, total, count }
  },
}
