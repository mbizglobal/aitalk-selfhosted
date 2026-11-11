/**
 * Example Work App — light declaration (browser + checks). See index.ts for what this app is.
 * Rules: every i18n key starts with "example." · English is the only required language · core 3: `uses` declares what the
 * app uses from outside (connections, sending, documents, web search, company database) — only declared handles exist in ctx.
 */
import type { WorkAppMeta } from '@/lib/work/package-api'

const en: Record<string, string> = {
  'example.kind_example': 'Expenses (example)',
  'example.sheet_example.expenses': 'Expenses',
  'example.col_date': 'Date',
  'example.col_description': 'Description',
  'example.col_amount': 'Amount',
  'example.mod_example.total': 'Total',
  'example.mod_example.import-csv': 'Import CSV',
  'example.res_total': 'Total',
  'example.res_count': 'Rows',
  'example.stop_row_value_missing': 'A row in {sheet} has no {column}.',
  'example.stop_csv_not_text': 'The file is not a CSV text file.',
  'example.stop_csv_header': 'The first line must be: date,description,amount',
  'example.stop_csv_line': 'Line {line} does not have a date (YYYY-MM-DD), a description and an amount (e.g. 12.50).',
  'example.stop_csv_empty': 'The file has no expense lines.',
  'example.stop_sheet_missing': 'This work app has no {sheet} sheet.',
  'example.stop_csv_already_imported': 'This file was already imported — its expenses are in the sheet.',
  'example.conn_mail': 'Email for sending month totals',
}

export const exampleWorkAppMeta: WorkAppMeta = {
  id: 'example',
  appTemplateKinds: ['example'],
  features: {
    example: {
      available: [
        { id: 'example.total', module: true, label: { en: 'Total' } },
        { id: 'example.import-csv', module: true, label: { en: 'Import CSV' } },
      ],
      planned: [{ id: 'receipts', label: { en: 'Attach receipts to expenses' } }],
    },
  },
  // One email connection — the person picks it in the Start / App step of the workflow (SendGrid or SMTP)
  uses: { example: { connections: [{ id: 'mail', kind: 'email', label: 'example.conn_mail' }] } },
  i18n: { en },
}
