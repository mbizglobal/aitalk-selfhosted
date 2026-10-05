
import { WorkError } from '@/lib/work/errors'
import type { AppTemplate } from '@/lib/work/app-templates'
import { vatBoxesModule } from './modules/boxes'
import { vatChecklist } from './checklist'
import { VAT_FAMILY } from './templates'

function parseVatSettings(raw: unknown): Record<string, unknown> {
  const o = (raw ?? {}) as Record<string, unknown>
  if (typeof o !== 'object' || Array.isArray(o)) throw new WorkError('INVALID', 'settings must be an object')
  const allowed = new Set(['roundTo5Rappen', 'mwstNumber', 'address'])
  for (const k of Object.keys(o)) if (!allowed.has(k)) throw new WorkError('INVALID', `unknown setting ${k}`)
  if (typeof o.roundTo5Rappen !== 'boolean') throw new WorkError('INVALID', 'roundTo5Rappen must be true or false')
  for (const k of ['mwstNumber', 'address'] as const) {
    if (o[k] !== undefined && (typeof o[k] !== 'string' || (o[k] as string).length > 500)) throw new WorkError('INVALID', `${k} must be text`)
  }
  return { roundTo5Rappen: o.roundTo5Rappen, ...(o.mwstNumber ? { mwstNumber: o.mwstNumber } : {}), ...(o.address ? { address: o.address } : {}) }
}

export const VAT_APP_TEMPLATE: AppTemplate = {
  kind: 'vat',
  sheets: [
    { template: `${VAT_FAMILY.transactions}@1`, name: 'Transactions' },
    { template: `${VAT_FAMILY.accounts}@1`, name: 'Bank accounts' },
    { template: `${VAT_FAMILY.balances}@1`, name: 'Bank balances' },
    { template: `${VAT_FAMILY.basis}@1`, name: 'VAT method' },
    { template: `${VAT_FAMILY.rules}@1`, name: 'Classification rules' },
    { template: `${VAT_FAMILY.invoices}@1`, name: 'Invoices' },
    { template: `${VAT_FAMILY.payments}@1`, name: 'Payment links' },
    { template: `${VAT_FAMILY.adjustments}@1`, name: 'Adjustments' },
    { template: `${VAT_FAMILY.transitions}@1`, name: 'Method transitions' },
    { template: `${VAT_FAMILY.recipes}@1`, name: 'Bank file readers' },
  ],
  modules: ['vat.boxes', 'bank.import', 'bank.balance-check'],
  calcModule: vatBoxesModule,
  globalFamilies: [VAT_FAMILY.accounts, VAT_FAMILY.rules],
  aiGuide: [
    'This project is a Swiss VAT return for one company, filed quarterly with the ESTV. Each task is one quarter (e.g. 2026 Q3).',
    'First setup (once per company, ask for what is missing): the bank accounts (sheet "Bank accounts"), the VAT method from January 1 of the year — cash or agreed, and monthly or daily exchange rates (sheet "VAT method" — without it the calculation stops), and classification rules the owner already knows (sheet "Classification rules").',
    'Each quarter: create the task for the quarter, import the bank statements, classify every transaction (type, VAT code), match receipts and invoices to transactions, then ask the person to check and confirm. The box numbers come only from the calculation module — preview them, never compute them yourself.',
    'Bank statements: for each statement file call vat_bank_import_plan with only the fileId first — a saved reader or UBS is used when it fits. If no reader fits (bank_reader_unknown), look at the file with vat_peek_file, write a recipe and plan again; fix the recipe until the balance chain holds. A person presses the import button under your answer. Each account needs a row in "Bank accounts" first (bank, currency); add missing accounts after asking.',
    'Exchange rates: foreign-currency rows use the official ESTV monthly average (published by BAZG). Get them with vat_fx_rates for the months of the quarter and tell the person which rates are used — never ask the person for rates and never take them from other websites. The calculation fetches missing months itself. Daily rates are not fetched yet: if the VAT method says daily, tell the person.',
    'Receipts and invoices: the person uploads them in the Files tab — supplier receipts for expenses and our own issued invoices for income. Read each file once with work_read_files, match it to its transaction (party, date, amount, currency — a card payment may be booked a few days later; one invoice can cover a monthly payment), attach it with work_update_rows fileId and set evidence attached.',
    'Evidence (owner rule): a row that is clearly income or an expense and has no matching invoice or receipt in the Files tab = needed (the person finds it and uploads it). not_needed = transfer between own accounts, currency exchange, bank fee or interest, tax payment or tax refund from an authority. explained = not clearly income or expense, or a refund of an earlier payment (note which one), or a fact the person told you — write it in note.',
    'Transactions: classify every row (type, VAT code, category), set evidence, and confirm every row whose classification you are sure about yourself — including rows with evidence needed (a missing receipt does not block the submission; the person sees a final warning list when submitting). Write the reason in aiReason. Leave unconfirmed only rows where you need a fact from the person. Work in batches: read only unconfirmed rows and only the columns you need, update up to 50 rows per call. Then report briefly: how many rows you confirmed, the receipts to find (evidence needed), and your questions in one list.',
    'VAT method agreed (invoice basis): the boxes come only from the "Invoices" sheet, not from bank transactions (except advance payments). For an agreed-basis quarter, read every issued and received invoice in the Files tab and enter it in the Invoices sheet with work_insert_rows and its fileId: direction (issued = ours, received = a supplier), invoiceDate, taxDate (= invoiceDate for issued; for received the invoice date unless the person says otherwise), currency, amountGross incl. VAT, invoiceVat when printed on the invoice, vatCode, counterparty, number. An invoice paid by another company (so no bank row here) still goes in — note who paid it. Bank statements are still imported and their transactions classified and confirmed. The person confirms the invoice rows.',
    'Other sheets (VAT method, invoices, …) are confirmed by the person. When every transaction of the quarter is done, tell the person the quarter is ready to review and submit. A submitted quarter is locked; a correction means the person unlocks it.',
    'Collect what you do not know and ask it in one message (e.g. "these 12 transactions: which are business expenses?"). Record lasting decisions as project notes (proposed), and decisions for this quarter as task notes.',
    'Bank balances: when a statement file has no balances (UBS exports often do not), use the balances the person gave (text or a screenshot of the bank screen) in vat_bank_import_plan balances — the balance on the last day of the file is its closing balance. Ask for them only if you have none.',
  ].join('\n'),
  parseSettings: parseVatSettings,
  ui: {
    settings: [
      { name: 'roundTo5Rappen', type: 'boolean', required: true },
      { name: 'mwstNumber', type: 'text', maxLength: 500 },
      { name: 'address', type: 'textarea', maxLength: 500 },
    ],
    period: 'quarter',
    calcInput: [
      { name: 'declare383', type: 'boolean', required: true },
      { name: 'box415', type: 'money' },
    ],
    resultTable: { path: 'boxes', labelPrefix: 'box_' },
    taskChecks: [{ module: 'bank.balance-check', table: 'accounts' }],
    sheetImports: [{ module: 'bank.import', family: VAT_FAMILY.transactions, accountColumn: 'accountKey', fileKind: 'bank_csv', accept: '.csv,text/csv' }],
  },
  checklist: vatChecklist,
}
