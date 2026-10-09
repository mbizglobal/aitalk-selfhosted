/** Sheet templates — names start with the package id ("example.") */
import type { SheetTemplate } from '@/lib/work/package-api'

export const EXPENSES = 'example.expenses'

export const expensesTemplate: SheetTemplate = {
  name: EXPENSES,
  version: 1,
  family: EXPENSES,
  columns: [
    { name: 'date', type: 'date', required: true },
    { name: 'description', type: 'string', required: true },
    { name: 'amount', type: 'money', required: true },
    // Fingerprint (sha256) of the file a row was imported from — the import refuses a file that is already in the sheet
    { name: 'source', type: 'string' },
  ],
  // Rows dated in a submitted task period are locked
  dateColumn: 'date',
  // A person confirms each row; changing date or amount takes the confirmation away again
  confirm: { calcColumns: ['date', 'amount'] },
  // Filled by the import only — people do not type it (the screen hides it and drops it from manual edits)
  ui: { hidden: ['source'] },
}
