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
  assert.equal(r.packages[0]?.id, 'vat')
  assert.ok(r.appTemplates.some((a) => a.kind === 'vat'))
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
  const noEn = emptyPkg('n', {}, { de: {} } as unknown as WorkAppMeta['i18n'])
  throwsWith(() => composeWorkApps([noEn.f], [noEn.meta]), /i18n.en is missing/)
  const coreKey = emptyPkg('c', { core: 1 }, { en: { loading: 'x' }, de: { loading: 'x' }, fr: { loading: 'x' }, ko: { loading: 'x' } })
  throwsWith(() => composeWorkApps([coreKey.f], [coreKey.meta]), /i18n key loading is also a core key/)
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
  assert.deepEqual(mergeWorkDict({}, 'de', [noDe]), {})
  throwsWith(() => mergeWorkDict({}, 'de', [{ ...noDe, i18n: { de: {} } } as unknown as WorkAppMeta]), /z has no en dictionary/)
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

test('core version - only an integer from 1 to this core version is accepted (missing, 0, fractions and newer versions are rejected)', () => {
  const ok = (core: unknown) => { const x = emptyPkg('v', { core: core as number }); composeWorkApps([x.f], [x.meta]) }
  ok(1)
  ok(WORK_APP_CORE_API)
  for (const bad of [undefined, 0, 1.5, WORK_APP_CORE_API + 1, '1', null]) throwsWith(() => ok(bad), /needs core/)
})

test('VAT and the core 1 fixture are pinned to core 1 - they keep deps when the core version goes up', async () => {
  const { exampleWorkApp } = await import('./__fixtures__/example-work-app')
  assert.equal(vatWorkApp().core, 1, 'VAT 는 판 1 — 환율 두 호출이 deps 를 쓴다(D7-8 Q1)')
  assert.equal(exampleWorkApp().core, 1, '판 1 시험 재료')
  const { packageCoreOfModule, packageCoreOfKind } = await import('./registry')
  assert.equal(packageCoreOfModule('bank.import'), 1)
  assert.equal(packageCoreOfKind('vat'), 1)
})

test('the core 1 fixture still registers on this core (2 or later) next to VAT', async () => {
  const { exampleWorkApp } = await import('./__fixtures__/example-work-app')
  assert.ok(WORK_APP_CORE_API >= 2)
  const vat = vatWorkApp()
  const ex = exampleWorkApp()
  const r = composeWorkApps([() => vat, () => ex], [vat.meta, ex.meta])
  assert.deepEqual(r.packages.map((p) => p.core), [1, 1])
})

function v2App(id: string, label: string): WorkAppPackage {
  const meta: WorkAppMeta = {
    id,
    appTemplateKinds: [id],
    features: { [id]: { available: [{ id: `${id}.count`, module: true, label: { en: 'Count rows' } }], planned: [{ id: 'export', label: { en: 'Export' } }] } },
    i18n: { en: { [`${id}.kind_${id}`]: label, [`${id}.col_amount`]: `${label} amount`, [`${id}.col_date`]: 'Date', [`${id}.stop_no_rows`]: `${label}: no rows in {sheet}`, [`${id}.sheet_${id}.items`]: `${label} items` } },
  }
  return {
    id, version: '0.1.0', core: 2, meta,
    sheetTemplates: [{ name: `${id}.items`, version: 1, family: `${id}.items`, columns: [{ name: 'date', type: 'date', required: true }, { name: 'amount', type: 'money' }], dateColumn: 'date' }],
    modules: [{ id: `${id}.count`, version: 1, kind: 'read', title: { en: 'Count rows' }, description: { en: 'Counts rows' }, input: { type: 'object' }, output: { type: 'object' }, needs: [`${id}.items>=1`], async run() { return { count: 0 } } }],
    appTemplates: [{ kind: id, sheets: [{ template: `${id}.items@1`, name: 'Items' }], modules: [`${id}.count`], calcModule: null, globalFamilies: [], aiGuide: '', parseSettings: () => ({}), ui: { settings: [], period: 'month', calcInput: [], taskChecks: [], sheetImports: [] } }],
  } as WorkAppPackage
}
const reg = (...ps: WorkAppPackage[]) => composeWorkApps(ps.map((p) => () => p), ps.map((p) => p.meta))

test('a core 2 app with English only registers next to VAT - even with the same column names as VAT', () => {
  const vat = vatWorkApp()
  assert.ok('col_amount' in vat.meta.i18n.en, '시험 전제 — VAT 에도 amount 칼럼 문구가 있다')
  const r = reg(vat, v2App('acme', 'Acme'), v2App('beta', 'Beta'))
  assert.deepEqual(r.packages.map((p) => p.id), ['vat', 'acme', 'beta'])
})

test('inside a core 2 app its own texts come first - other languages show its English, outside the app the core and VAT texts', async () => {
  const { lookupWorkText } = await import('@/lib/translations/work')
  const { workTranslations: coreEn } = await import('@/lib/translations/work/en')
  const { workTranslations: coreKo } = await import('@/lib/translations/work/ko')
  const metas = [vatWorkApp().meta, v2App('acme', 'Acme').meta, v2App('beta', 'Beta').meta]
  const en = mergeWorkDict(coreEn, 'en', metas)
  const ko = mergeWorkDict(coreKo, 'ko', metas)
  assert.equal(lookupWorkText(ko, en, 'col_amount', 'acme'), 'Acme amount')
  assert.equal(lookupWorkText(ko, en, 'col_amount', 'beta'), 'Beta amount')
  assert.equal(lookupWorkText(ko, en, 'col_amount', null), vatWorkApp().meta.i18n.ko!.col_amount, '앱 밖(VAT · 본체)은 그대로')
  assert.equal(lookupWorkText(ko, en, 'col_amount', 'vat'), vatWorkApp().meta.i18n.ko!.col_amount, '판 1 VAT 는 접두어 없는 키 그대로')
  assert.equal(lookupWorkText(ko, en, 'stop_no_rows', 'acme'), 'Acme: no rows in {sheet}')
  assert.equal(lookupWorkText(ko, en, 'loading', 'acme'), coreKo.loading, '앱에 없는 말은 본체 말')
})

test('when a new core adds kind_acme or stop_no_rows, the core 2 acme app still registers and shows its own texts', async () => {
  const { lookupWorkText } = await import('@/lib/translations/work')
  const acme = v2App('acme', 'Acme')
  const future = { kind_acme: 'CORE', stop_no_rows: 'CORE', col_amount: 'CORE' }
  const en = mergeWorkDict(future, 'en', [acme.meta])
  assert.equal(lookupWorkText(en, en, 'kind_acme', 'acme'), 'Acme')
  assert.equal(lookupWorkText(en, en, 'stop_no_rows', 'acme'), 'Acme: no rows in {sheet}')
  for (const l of ['en', 'de', 'fr', 'ko'] as const) {
    const { workTranslations } = await import(`@/lib/translations/work/${l}`)
    assert.deepEqual(Object.keys(workTranslations).filter((k) => k.includes('.')), [], `${l}: 본체 키에 점`)
  }
})

test('core 2 naming rules - names without the prefix, reserved ids and prefix-related ids are rejected', () => {
  const acme = v2App('acme', 'Acme')
  const withKeys = (en: Record<string, string>) => ({ ...acme, meta: { ...acme.meta, i18n: { en } } })
  const w = withKeys({ col_amount: 'Amount' })
  throwsWith(() => reg(w), /acme: i18n key "col_amount" must start with "acme."/)
  throwsWith(() => reg(withKeys({ 'acme.': 'x' })), /must start with "acme."/)
  const m = acme.modules[0]
  const mod = { ...acme, modules: [{ ...m, id: 'acme-extra.count' }], appTemplates: [{ ...acme.appTemplates[0], modules: ['acme-extra.count'] }], meta: { ...acme.meta, features: { acme: { available: [{ id: 'acme-extra.count', module: true, label: { en: 'x' } }], planned: [] } } } } as WorkAppPackage
  throwsWith(() => reg(mod), /module id "acme-extra.count" must start with "acme."/)
  const st = acme.sheetTemplates[0]
  throwsWith(() => reg({ ...acme, sheetTemplates: [{ ...st, name: 'items' }] } as WorkAppPackage), /sheet template "items" must start with "acme."/)
  throwsWith(() => reg({ ...acme, sheetTemplates: [{ ...st, family: 'items' }] } as WorkAppPackage), /sheet family "items" must start with "acme."/)
  const kind = (k: string) => ({ ...acme, appTemplates: [{ ...acme.appTemplates[0], kind: k }], meta: { ...acme.meta, appTemplateKinds: [k], features: { [k]: acme.meta.features.acme } } }) as WorkAppPackage
  throwsWith(() => reg(kind('other')), /app template name "other" must be "acme" or start with "acme-"/)
  reg(kind('acme-expenses'))
  for (const id of ['vat', 'bank']) throwsWith(() => reg(emptyPkg(id).f()), new RegExp(`package id "${id}" is reserved`))
  throwsWith(() => reg(v2App('acme', 'A'), v2App('acme-extra', 'B')), /package ids acme and acme-extra/)
  reg(emptyPkg('old', { core: 1 }).f(), emptyPkg('old-x', { core: 1 }).f())
})

test('feature labels and module titles - English is required, given languages are not empty, missing languages show English', async () => {
  const { featureLabel, localeText } = await import('./app-template-features')
  const acme = v2App('acme', 'Acme')
  const f = acme.meta.features.acme.available[0]
  const feat = (label: unknown) => ({ ...acme, meta: { ...acme.meta, features: { acme: { available: [{ ...f, label }], planned: [] } } } }) as WorkAppPackage
  throwsWith(() => reg(feat({ de: 'x' })), /feature acme.count has no en label/)
  throwsWith(() => reg(feat({ en: 'x', de: '' })), /feature acme.count has an empty de label/)
  throwsWith(() => reg({ ...acme, modules: [{ ...acme.modules[0], title: { de: 'x' } }] } as unknown as WorkAppPackage), /module acme.count needs an English title/)
  assert.equal(featureLabel(f, 'ko'), 'Count rows')
  assert.equal(localeText({ en: 'A', de: 'B' }, 'de'), 'B')
  assert.equal(localeText({ en: 'A', de: 'B' }, 'es'), 'A')
  assert.deepEqual(mergeWorkDict({}, 'de', [acme.meta]), {})
})

test('whose texts - the package is found from the app template or the sheet family', async () => {
  const { packageOfKind, packageOfFamily, workT, workKindLabel, workStopText } = await import('@/lib/translations/work')
  assert.equal(packageOfKind('vat'), 'vat')
  assert.equal(packageOfKind('free'), null)
  assert.equal(packageOfKind(null), null)
  assert.equal(packageOfFamily('acme.items'), 'acme')
  assert.equal(packageOfFamily('items'), null)
  assert.equal(packageOfFamily('.x'), null)
  assert.equal(workKindLabel('ko', 'vat'), vatWorkApp().meta.i18n.ko!.kind_vat)
  assert.equal(workT('ko', 'col_amount', undefined, 'nope'), workT('ko', 'col_amount'))
  const stop = { code: 'effective_same_day', params: { sheet: 'vat.basis' } }
  assert.equal(workStopText('ko', stop, 'nope'), workStopText('ko', stop))
})

test('empty texts are rejected - they would show as blank instead of falling back to English', () => {
  const acme = v2App('acme', 'Acme')
  const en = acme.meta.i18n.en
  throwsWith(() => reg({ ...acme, meta: { ...acme.meta, i18n: { en: { ...en, 'acme.col_date': '' } } } }), /i18n.en acme.col_date is empty/)
  throwsWith(() => reg({ ...acme, meta: { ...acme.meta, i18n: { en, ko: { ...en, 'acme.col_date': '' } } } }), /i18n.ko acme.col_date is empty/)
  throwsWith(() => reg({ ...acme, modules: [{ ...acme.modules[0], title: { en: 'x', ko: '' } }] } as WorkAppPackage), /module acme.count has an empty ko title/)
})
