/** App template — kind "example" = one expense list, one task per month */
import { WorkError, type AppTemplate } from '@/lib/work/package-api'
import { EXPENSES } from './templates'
import { totalModule } from './modules/total'

export const exampleAppTemplate: AppTemplate = {
  kind: 'example',
  sheets: [{ template: `${EXPENSES}@1`, name: 'Expenses' }],
  modules: ['example.total', 'example.import-csv'],
  calcModule: totalModule,
  globalFamilies: [],
  // Read by the AI at every turn (English — the model reads it)
  aiGuide: [
    'This work app keeps the expenses of one team. Each task is one month.',
    'Expenses arrive as CSV files (date,description,amount) in the Files tab: run the module example.import-csv with the fileId. Single expenses the person tells you: add them with work_insert_rows.',
    'Every row stays unconfirmed until the person confirms it. Never confirm rows yourself.',
    'The month total comes only from the calculation module example.total — preview it, never add up amounts yourself. example_summary only counts rows (all months) and unconfirmed rows.',
  ].join('\n'),
  parseSettings(raw) {
    if (raw !== undefined && raw !== null && (typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length)) throw new WorkError('INVALID', 'this app has no settings')
    return {}
  },
  ui: { settings: [], period: 'month', calcInput: [], taskChecks: [], sheetImports: [] },
}
