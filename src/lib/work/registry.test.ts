import { test } from 'node:test'
import assert from 'node:assert/strict'
import { composeWorkApps, workAppRegistry } from './registry'
import type { WorkAppFactory, WorkAppPackage } from './package'
import type { WorkAppMeta } from './package-meta'
import { WORK_APP_CORE_API } from './package-api'
import { vatWorkApp } from '@/work-apps/vat'
import { mergeWorkDict } from '@/lib/translations/work'

function emptyPkg(id: string, over: Partial<WorkAppPackage> = {}, i18n: WorkAppMeta['i18n'] = { en: {}, de: {}, fr: {}, ko: {} }): { f: WorkAppFactory; meta: WorkAppMeta } {
  const meta: WorkAppMeta = { id, appTemplateKinds: [], features: {}, i18n }
  const p: WorkAppPackage = { id, version: '0.0.1', core: WORK_APP_CORE_API, meta, appTemplates: [], sheetTemplates: [], modules: [], ...over }
  return { f: () => p, meta: p.meta }
}
const throwsWith = (fn: () => unknown, re: RegExp) => assert.throws(fn, (e: unknown) => e instanceof Error && re.test(e.message))

test('real registry: VAT is attached and passes the check', () => {
  const r = workAppRegistry()
  assert.deepEqual(r.packages.map((p) => p.id), ['vat'])
  assert.deepEqual(r.appTemplates.map((a) => a.kind), ['vat'])
  assert.ok(r.modules.some((m) => m.id === 'vat.boxes'))
  assert.equal(workAppRegistry(), r, '한 번 만들고 같은 것을 돌려준다')
})

test('adding one empty synthetic package still attaches', () => {
  const vat = vatWorkApp()
  const x = emptyPkg('example')
  const r = composeWorkApps([() => vat, x.f], [vat.meta, x.meta])
  assert.deepEqual(r.packages.map((p) => p.id), ['vat', 'example'])
})

test('throws on mismatch; does not quietly drop it and carry on', () => {
  const a = emptyPkg('a')
  throwsWith(() => composeWorkApps([a.f, a.f], [a.meta, a.meta]), /duplicate package id: a/)
  const bad = emptyPkg('Bad_Id')
  throwsWith(() => composeWorkApps([bad.f], [bad.meta]), /bad package id/)
  const old = emptyPkg('old', { core: WORK_APP_CORE_API + 1 })
  throwsWith(() => composeWorkApps([old.f], [old.meta]), /needs core/)
  throwsWith(() => composeWorkApps([a.f], []), /meta lists/)
  const vat = vatWorkApp()
  const wrong = { ...vat, id: 'wrong', meta: { ...vat.meta, id: 'wrong', appTemplateKinds: [] } }
  throwsWith(() => composeWorkApps([() => wrong], [wrong.meta]), /meta app templates/)
  const i18n = emptyPkg('t', {}, { en: { k: 'x' }, de: {}, fr: { k: 'x' }, ko: { k: 'x' } })
  throwsWith(() => composeWorkApps([i18n.f], [i18n.meta]), /i18n keys differ/)
  const noId = emptyPkg('x'); const noIdPkg = { ...noId.f(), id: undefined as unknown as string, meta: { ...noId.meta, id: undefined as unknown as string } }
  throwsWith(() => composeWorkApps([() => noIdPkg], []), /bad package id/)
  const blank = { ...vat, id: 'blank', meta: { ...vat.meta, id: 'blank', appTemplateKinds: [''], features: { '': vat.meta.features.vat } }, appTemplates: [{ ...vat.appTemplates[0], kind: '' }] }
  throwsWith(() => composeWorkApps([() => blank], [blank.meta]), /bad app template name/)
  const emptyKey = emptyPkg('e', {}, { en: { '': 'x' }, de: {}, fr: {}, ko: {} })
  throwsWith(() => composeWorkApps([emptyKey.f], [emptyKey.meta]), /empty i18n key/)
  const noKo = emptyPkg('n', {}, { en: {}, de: {}, fr: {} } as unknown as WorkAppMeta['i18n'])
  const coreKey = emptyPkg('c', {}, { en: { loading: 'x' }, de: { loading: 'x' }, fr: { loading: 'x' }, ko: { loading: 'x' } })
  throwsWith(() => composeWorkApps([coreKey.f], [coreKey.meta]), /i18n key loading is also a core key/)
  throwsWith(() => composeWorkApps([noKo.f], [noKo.meta]), /i18n.ko is missing/)
  const tpl = vat.appTemplates[0]
  const missingSheet = { ...vat, appTemplates: [{ ...tpl, sheets: [...tpl.sheets, { template: 'vat.nope@1', name: 'x' }] }] }
  throwsWith(() => composeWorkApps([() => missingSheet], [vat.meta]), /sheet template vat.nope@1 is not registered/)
  const fakeCalc = { ...vat, appTemplates: [{ ...tpl, calcModule: { ...tpl.calcModule! } }] }
  throwsWith(() => composeWorkApps([() => fakeCalc], [vat.meta]), /is not the registered module/)
  const badFeature = { ...vat, meta: { ...vat.meta, features: { vat: { available: [{ id: 'vat.ghost', module: true, label: { en: 'x', de: 'x', fr: 'x', ko: 'x' } }], planned: [] } } } }
  throwsWith(() => composeWorkApps([() => badFeature], [badFeature.meta]), /available module features must be exactly/)
  const avail = vat.meta.features.vat.available
  const missingModule = { ...vat, meta: { ...vat.meta, features: { vat: { available: avail.filter((x) => x.id !== 'bank.balance-check'), planned: [] } } } }
  throwsWith(() => composeWorkApps([() => missingModule], [missingModule.meta]), /available module features must be exactly/)
  const twice = { ...vat, meta: { ...vat.meta, features: { vat: { available: avail, planned: [avail[0]] } } } }
  throwsWith(() => composeWorkApps([() => twice], [twice.meta]), /feature listed twice: vat.boxes/)
  throwsWith(() => composeWorkApps([], [{ id: '', appTemplateKinds: [], features: {} }]), /meta lists/)
  const noFeat = { ...vat, meta: { ...vat.meta, features: { vat: null as unknown as typeof vat.meta.features.vat } } }
  throwsWith(() => composeWorkApps([() => noFeat], [noFeat.meta]), /malformed package/)
  const emptyPart = { ...vat, meta: { ...vat.meta, features: { vat: { available: [...avail, { id: 'x', partOf: '', label: { en: 'x', de: 'x', fr: 'x', ko: 'x' } }], planned: [] } } } }
  throwsWith(() => composeWorkApps([() => emptyPart], [emptyPart.meta]), /part of , not one of its modules/)
  const strKinds = { ...vat, meta: { ...vat.meta, appTemplateKinds: 'vat' as unknown as string[] } }
  throwsWith(() => composeWorkApps([() => strKinds], [strKinds.meta]), /meta app templates/)
  const twin = { ...vat, id: 'twin', meta: { ...vat.meta, id: 'twin' } }
  throwsWith(() => composeWorkApps([() => vat, () => twin], [vat.meta, twin.meta]), /duplicate app template: vat/)
})

test('merging screen translations: throws on overlap (core and apps among themselves), merges when there is none', () => {
  const m = (id: string, en: Record<string, string>): WorkAppMeta => ({ id, appTemplateKinds: [], features: {}, i18n: { en, de: en, fr: en, ko: en } })
  assert.deepEqual(mergeWorkDict({ a: '1' }, 'en', [m('x', { b: '2' })]), { a: '1', b: '2' })
  throwsWith(() => mergeWorkDict({ a: '1' }, 'en', [m('x', { a: '2' })]), /key a from x is already defined/)
  throwsWith(() => mergeWorkDict({}, 'en', [m('x', { b: '1' }), m('y', { b: '2' })]), /key b from y is already defined/)
  const noDe = { ...m('z', { c: '1' }), i18n: { en: { c: '1' }, fr: { c: '1' }, ko: { c: '1' } } } as unknown as WorkAppMeta
  throwsWith(() => mergeWorkDict({}, 'de', [noDe]), /z has no de dictionary/)
  const lessKo = { ...m('w', { c: '1', d: '2' }), i18n: { en: { c: '1', d: '2' }, de: { c: '1', d: '2' }, fr: { c: '1', d: '2' }, ko: { c: '1' } } } as WorkAppMeta
  throwsWith(() => mergeWorkDict({}, 'ko', [lessKo]), /w ko keys differ from en/)
})

test('app-specific AI tools: only name prefix, aiVia and the project\'s app template ones are loaded', async () => {
  const { workAppToolDefs } = await import('./app-ai')
  const names = (k: string) => workAppToolDefs(k).map((d) => d.name)
  assert.ok(names('vat').includes('vat_bank_import_plan') && names('vat').includes('vat_fx_rates') && names('vat').includes('vat_peek_file'))
  assert.ok(!names('free').some((n) => n.startsWith('vat_')), '자유 프로젝트엔 VAT 도구가 없다')
  assert.ok(names('free').includes('work_overview'))
  const vat = vatWorkApp()
  const tool = vat.tools![0]
  const badName = { ...vat, tools: [{ ...tool, def: { ...tool.def, name: 'peek' } }] }
  throwsWith(() => composeWorkApps([() => badName], [vat.meta]), /tool name "peek" must start with "vat_"/)
  const noVia = { ...vat, tools: vat.tools!.filter((t) => t.def.name !== 'vat_bank_import_plan') }
  throwsWith(() => composeWorkApps([() => noVia], [vat.meta]), /aiVia vat_bank_import_plan is not one of its tools/)
  const { WORK_APP_TOOL_NAMES } = await import('./app-ai')
  assert.ok([...WORK_APP_TOOL_NAMES].every((n) => n.startsWith('work_')), '공용 도구는 전부 work_ — 예약이 성립하는 전제')
  const w = emptyPkg('work')
  throwsWith(() => composeWorkApps([w.f], [w.meta]), /package id "work" is reserved/)
  const twice = { ...vat, tools: [...vat.tools!, tool] }
  throwsWith(() => composeWorkApps([() => twice], [vat.meta]), /duplicate tool/)
})
