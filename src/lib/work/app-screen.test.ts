import { test } from 'node:test'
import { cloudOnly } from '@/lib/work/cloud-apps-for-tests'
import assert from 'node:assert/strict'
import { appLang, appScreenImports, appScreenMissingFrom, appScreenTabs } from './app-screen'

type O = Parameters<typeof appScreenTabs>[1]
const sheet = (id: string, family: string | null, name: string) => ({ id, family, name, template: null, scope: 'period' as const, confirmable: true })
const base: O = { kind: 'receipts', appTemplate: null, sheets: [], tasks: [], references: 0 }
const none = { readApps: [], sends: { v3: false, pending: 0 }, archived: false }

test('empty work app - notes, files and history only (no tasks, references, modules, sends; design and settings are not in the app)', () => {
  assert.deepEqual(appScreenTabs('en', base, none).map((t) => t.key), ['notes', 'files', 'activity'])
})

test('order - tasks, notes, files, sheets, references, modules, sends, history', cloudOnly, () => {
  const o: O = { ...base, sheets: [sheet('s1', 'receipts.bills', 'bills'), sheet('s2', null, 'My table')], tasks: [{ id: 't1', title: 'Oct', periodStart: '2026-10-01', periodEnd: '2026-10-31', status: 'open', submittedAt: null }], references: 1 }
  const tabs = appScreenTabs('en', o, { readApps: ['Bank ledger'], sends: { v3: true, pending: 2 }, archived: false })
  assert.deepEqual(tabs.map((t) => t.key), ['task', 'notes', 'files', 'sheet', 'sheet', 'refs', 'modules', 'sends', 'activity'])
  assert.deepEqual(tabs.filter((t) => t.key === 'sheet').map((t) => [t.sheetId, t.label]), [['s1', 'Bills'], ['s2', 'My table']])
  assert.equal(tabs.find((t) => t.key === 'refs')!.label, 'Bank ledger')
  assert.equal(tabs.find((t) => t.key === 'sends')!.count, 2)
})

test('references - two or no reading apps = References - no tab when the template turns it off', () => {
  const o: O = { ...base, references: 2 }
  assert.equal(appScreenTabs('en', o, { ...none, readApps: ['A', 'B'] }).find((t) => t.key === 'refs')!.label, 'References')
  assert.equal(appScreenTabs('en', o, none).find((t) => t.key === 'refs')!.label, 'References')
  const off = { ...o, appTemplate: { ui: { referenceTab: false } } } as unknown as O
  assert.equal(appScreenTabs('en', off, none).some((t) => t.key === 'refs'), false)
})

test('visible names are never empty - an unnamed sheet uses family or id', () => {
  const o: O = { ...base, sheets: [sheet('s9', 'nope.unknown', ''), sheet('s8', null, ''), sheet('s7', null, '   '), sheet('s6', 'nope.x', '  ')], references: 1 }
  const labels = appScreenTabs('ko', o, none).filter((t) => t.key === 'sheet').map((t) => t.label)
  assert.deepEqual(labels, ['nope.unknown', 's8', 's7', 'nope.x'])
  assert.equal(appScreenTabs('en', o, { ...none, readApps: ['  '] }).find((t) => t.key === 'refs')!.label, 'References')
  assert.ok(appScreenTabs('ko', base, none).every((t) => t.label.trim() !== ''))
})

test('archived project (detached from its workflow) - no history tab (same as the web archive view)', () => {
  assert.deepEqual(appScreenTabs('en', base, { ...none, archived: true }).map((t) => t.key), ['notes', 'files'])
})

test('language - unknown or missing = en', () => {
  assert.equal(appLang('ko'), 'ko')
  assert.equal(appLang('es'), 'en')
  assert.equal(appLang(null), 'en')
})

test('files - kept on the files tab when the app keeps only its own records (ui.files = kept) - otherwise none', () => {
  const kept = { ...base, appTemplate: { ui: { files: 'kept' } } } as unknown as O
  assert.equal(appScreenTabs('en', kept, none).find((t) => t.key === 'files')?.kept, true)
  assert.equal(appScreenTabs('en', base, none).find((t) => t.key === 'files')?.kept, undefined)
})

test('import declarations - only enabled modules (same filter as the web) - empty list without a template', () => {
  const im = { module: 'ledger.import', family: 'ledger.lines', accountColumn: 'accountKey', fileKind: 'bank_csv', accept: '.csv' }
  const o = (modules: string[]) => ({ appTemplate: { ui: { sheetImports: [im] } }, modules }) as unknown as Parameters<typeof appScreenImports>[0]
  assert.deepEqual(appScreenImports(o(['ledger.import'])), [im])
  assert.deepEqual(appScreenImports(o([])), [])
  assert.deepEqual(appScreenImports({ appTemplate: null, modules: ['ledger.import'] } as unknown as Parameters<typeof appScreenImports>[0]), [])
})

test('sheet tab family - family when the template has one - otherwise none (a yellow line finds its tab by open.family)', () => {
  const o: O = { ...base, sheets: [sheet('s1', 'receipts.bills', 'bills'), sheet('s2', null, 'My table')] }
  assert.deepEqual(appScreenTabs('en', o, none).filter((t) => t.key === 'sheet').map((t) => [t.sheetId, t.family]), [['s1', 'receipts.bills'], ['s2', undefined]])
})

test('missing receipt module - only for apps that enable it (same as the web) - otherwise null', () => {
  assert.equal(appScreenMissingFrom({ modules: ['receipts.ledger-state', 'x'] }), 'receipts.ledger-state')
  assert.equal(appScreenMissingFrom({ modules: [] }), null)
})
