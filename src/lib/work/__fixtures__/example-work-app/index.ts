import { type ActionWorkModule, type AppTemplate, type SheetTemplate, type WorkAppFactory } from '@/lib/work/package-api'
import { exampleWorkAppMeta } from './meta'

const items: SheetTemplate = {
  name: 'example.items',
  version: 1,
  family: 'example.items',
  columns: [{ name: 'exampleDate', type: 'date', required: true }, { name: 'exampleNote', type: 'text' }],
  dateColumn: 'exampleDate',
}

const count: ActionWorkModule = {
  id: 'example.count',
  version: 1,
  kind: 'read',
  title: { en: 'Count items', de: 'Einträge zählen', fr: 'Compter', ko: '줄 세기' },
  description: { en: 'Counts rows', de: 'Zählt Zeilen', fr: 'Compte les lignes', ko: '줄을 센다' },
  input: { type: 'object', properties: {}, additionalProperties: false },
  output: { type: 'object' },
  needs: ['example.items>=1'],
  async run() { return { count: 0 } },
}

const template: AppTemplate = {
  kind: 'example',
  sheets: [{ template: 'example.items@1', name: 'Items' }],
  modules: ['example.count'],
  calcModule: null,
  globalFamilies: [],
  aiGuide: 'Example work app.',
  parseSettings: () => ({}),
  ui: { settings: [], period: 'month', calcInput: [], taskChecks: [], sheetImports: [] },
}

export const exampleWorkApp: WorkAppFactory = () => ({
  id: 'example',
  version: '0.0.1',
  core: 1,
  meta: exampleWorkAppMeta,
  appTemplates: [template],
  sheetTemplates: [items],
  modules: [count],
  tools: [{
    def: { name: 'example_hello', description: 'Say hello', parameters: { type: 'object', properties: {}, additionalProperties: false } },
    async run(ctx) { return { hello: ctx.project.kind } },
  }],
})
