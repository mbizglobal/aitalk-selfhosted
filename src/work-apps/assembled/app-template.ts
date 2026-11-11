/** App template "assembled" — no template sheets, no modules, no tasks, no settings. Tables come from the app spec (work_app_spec) */
import { WorkError, type AppTemplate } from '@/lib/work/package-api'

export const assembledAppTemplate: AppTemplate = {
  kind: 'assembled',
  sheets: [],
  modules: [],
  calcModule: null,
  globalFamilies: [],
  tasks: 'none',
  // Read by the AI at every turn (English — the model reads it). The tables (names · columns · about) come with the sheet list,
  // the owner's own instructions for this app come under «What this app is for»
  aiGuide: [
    'This work app was assembled by its owner from ready-made blocks. Its tables are listed below — each with its columns and what it is for. Show and call a table only by its table name, never by its sheet name.',
    'Fill only the columns a table has; leave a value empty when you do not know it — never guess.',
    'A person column takes the email of someone in this app\'s team (the owner or a member). Never invent an email.',
    'Every row you write stays unconfirmed until a person confirms it. Never confirm rows yourself.',
    'A table with fromFile takes documents: for a PDF or photo call work_find_in_document (fileId, table) — it reads every page — and call it again until complete is true. Then make the row with work_file_decisions kind row and the table key as target, filling only the fromFile columns that have one value. Leave a column empty when the result has candidates (ask the person which one, with the pages) or notFound. Tell the person each value with its page (for example "Expiry 2028-03-31 — page 37") so they can check it, and name any unreadable pages. For other files (CSV, Excel, text) read them with work_read_files. Never invent a value the document does not show.',
    'A table with mails can turn a row into an email card with assembled_mail — the text comes from the app; you never write the mail yourself. A person presses send.',
    'A table with docs can turn a row into a PDF with assembled_doc (a receipt, quote, confirmation). A mail with a document attaches the row\'s current PDF — if the row changed after the PDF was made, make it again first.',
    'A table with sendsToApps can send one row to another work app with assembled_send — the values come from the app spec; a person presses send and the other app gets a new unconfirmed row. Each row goes once per send: rows in alreadySentOrWaiting are done — do not try again.',
    'Data of other work apps connected by a reference line: read it with work_read_references (read only). A ref column that points to a table of another app takes the id of one row listed for it (refs.rows) — never another id; when the reference line reads confirmed data only, rows not yet confirmed there are not listed.',
    'This app does only what its blocks do. If the person asks for something no table or block covers, say plainly it is not set up in this app.',
  ].join('\n'),
  parseSettings(raw) {
    if (raw !== undefined && raw !== null && (typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length)) throw new WorkError('INVALID', 'this app has no settings')
    return {}
  },
  ui: { settings: [], period: 'custom', calcInput: [], taskChecks: [], sheetImports: [], modulesTab: false, notesTab: false },
}
