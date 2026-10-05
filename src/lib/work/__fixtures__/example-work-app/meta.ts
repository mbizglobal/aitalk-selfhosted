import type { WorkAppMeta } from '@/lib/work/package-api'

const i18n = { kind_example: 'Example', 'sheet_example.items': 'Items', col_exampleDate: 'Date', col_exampleNote: 'Note', 'mod_example.count': 'Count' }

export const exampleWorkAppMeta: WorkAppMeta = {
  id: 'example',
  appTemplateKinds: ['example'],
  features: {
    example: {
      available: [{ id: 'example.count', module: true, label: { en: 'Count items', de: 'Einträge zählen', fr: 'Compter', ko: '줄 세기' } }],
      planned: [],
    },
  },
  i18n: { en: i18n, de: i18n, fr: i18n, ko: i18n },
}
