/**
 * Example Work App — the smallest complete Work App on the core 3 contract. Not registered: to try it, add
 *
 *   src/work-apps/custom.ts       import { exampleWorkApp } from './example'           → CUSTOM_WORK_APPS = [exampleWorkApp]
 *   src/work-apps/custom-meta.ts  import { exampleWorkAppMeta } from './example/meta'  → CUSTOM_WORK_APP_METAS = [exampleWorkAppMeta]
 *
 * and rebuild. It imports only from @/lib/work/package-api (the contract), gets the database, files, AI proposals and sending
 * only through the handles in ctx, and ships English text only (other languages show English).
 *
 *   templates.ts            sheet template "example.expenses" (date · description · amount, confirmed by a person)
 *   modules/total.ts        calculation module — month total, sealed at submission
 *   modules/import-csv.ts   action module — reads a CSV file, writes rows (unconfirmed)
 *   tools.ts                app AI tools "example_summary" · "example_send_total" (email card for a closed month)
 *   app-template.ts         the app template (sheets, modules, AI guide, screen)
 *   meta.ts                 light declaration for the browser (features, texts — keys start with "example.", and `uses`:
 *                           what the app uses — here one email connection, chosen in the Start / App step)
 */
import type { WorkAppFactory } from '@/lib/work/package-api'
import { exampleWorkAppMeta } from './meta'
import { expensesTemplate } from './templates'
import { exampleAppTemplate } from './app-template'
import { totalModule } from './modules/total'
import { importCsvModule } from './modules/import-csv'
import { sendTotalTool, summaryTool } from './tools'

export const exampleWorkApp: WorkAppFactory = () => ({
  id: 'example',
  version: '1.0.0',
  // The contract version this app was written for — a number, not the constant (a newer core keeps supporting 3)
  core: 3,
  meta: exampleWorkAppMeta,
  appTemplates: [exampleAppTemplate],
  sheetTemplates: [expensesTemplate],
  modules: [totalModule, importCsvModule],
  tools: [summaryTool, sendTotalTool],
})
