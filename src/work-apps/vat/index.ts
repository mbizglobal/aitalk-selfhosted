
import type { V1WorkAppFactory as WorkAppFactory } from '@/lib/work/package-api'
import { VAT_APP_TEMPLATE } from './app-template'
import { VAT_SHEET_TEMPLATES } from './templates'
import { vatBoxesModule } from './modules/boxes'
import { bankImportModule } from './modules/bank-import'
import { balanceCheckModule } from './modules/balance-check'
import { vatWorkAppMeta } from './meta'
import { VAT_TOOLS } from './tools'

export const vatWorkApp: WorkAppFactory = () => ({
  id: 'vat',
  version: '1.0.0',
  core: 1,
  meta: vatWorkAppMeta,
  appTemplates: [VAT_APP_TEMPLATE],
  sheetTemplates: VAT_SHEET_TEMPLATES,
  modules: [vatBoxesModule, bankImportModule, balanceCheckModule],
  tools: VAT_TOOLS,
})
