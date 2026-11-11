import { test } from 'node:test'
import { cloudOnly } from '@/lib/work/cloud-apps-for-tests'
import assert from 'node:assert/strict'
import { composeWorkAppTemplates, getVisibleWorkAppTemplate, isWorkAppTemplateVisible, getWorkAppTemplate, visibleWorkAppTemplates, workAppTemplateCatalog, workAppTemplateIds, type KindOwners } from './workflow-template-catalog'
import type { WorkAppMeta } from './package-meta'

const throwsWith = (fn: () => unknown, re: RegExp) => assert.throws(fn, (e: unknown) => e instanceof Error && re.test(e.message))

test('real list - seven - countries, maker, included apps', cloudOnly, () => {
  const by = Object.fromEntries(workAppTemplateCatalog().map((e) => [e.template.templateId, e]))
  assert.deepEqual(Object.keys(by).sort(), ['work-app', 'work-app-approvals', 'work-app-invoice', 'work-app-invoices', 'work-app-ledger', 'work-app-receipts', 'work-app-vat'])
  assert.equal(by['work-app-invoices'].countries, 'all')
  assert.deepEqual([...by['work-app-invoices'].includes].sort(), ['invoices', 'ledger'])
  assert.equal(by['work-app'].owner, 'core')
  assert.equal(by['work-app'].countries, 'all')
  assert.deepEqual(by['work-app'].includes, [])
  assert.equal(by['work-app-receipts'].countries, 'all')
  assert.equal(by['work-app-ledger'].countries, 'all')
  assert.deepEqual(by['work-app-ledger'].includes, ['ledger'])
  assert.equal(by['work-app-approvals'].countries, 'all')
  assert.deepEqual(by['work-app-approvals'].includes, ['approvals'])
  assert.deepEqual(by['work-app-vat'].countries, ['CH'])
  assert.deepEqual(by['work-app-invoice'].countries, ['CH'])
  assert.equal(by['work-app-invoice'].owner, 'swiss-acc')
  assert.deepEqual([...by['work-app-invoice'].includes].sort(), ['ledger', 'swiss-acc-invoice'])
  for (const e of Object.values(by)) assert.deepEqual(e.publisher, { kind: 'aitalk' }, e.template.templateId)
  for (const e of Object.values(by)) assert.deepEqual(Object.keys(e.i18n).sort(), ['de', 'fr', 'ko'], e.template.templateId)
  assert.equal(workAppTemplateCatalog(), workAppTemplateCatalog(), '한 번 만들고 같은 것을 돌려준다')
  assert.ok(workAppTemplateIds().has('work-app-vat'))
  assert.equal(visibleWorkAppTemplates().length, 7)
  assert.equal(getVisibleWorkAppTemplate('nope'), null)
  assert.equal(getWorkAppTemplate('nope'), null)
})

test('templates using fields turned off in Self-hosted are hidden - hidden ids also give null for create and detail', cloudOnly, () => {
  const prev = process.env.AITALK_EDITION
  try {
    process.env.AITALK_EDITION = 'selfhosted'
    assert.equal(visibleWorkAppTemplates().length, 7)
    const graph = JSON.parse(appGraph([]))
    graph.nodes.push({ id: 'p', type: 'pstn', data: { nodeType: 'pstn' } })
    const [e] = composeWorkAppTemplates([{ owner: 'p', templates: [tpl('v', [], { workflowJson: JSON.stringify(graph) })] }], owners([]))
    assert.equal(isWorkAppTemplateVisible(e), false)
    process.env.AITALK_EDITION = 'cloud'
    assert.equal(isWorkAppTemplateVisible(e), true)
    const [u] = composeWorkAppTemplates([{ owner: 'p', templates: [tpl('u', ['no-such-app'])] }], owners([]))
    assert.equal(isWorkAppTemplateVisible(u), false)
  } finally {
    if (prev === undefined) delete process.env.AITALK_EDITION
    else process.env.AITALK_EDITION = prev
  }
})

const appGraph = (kinds: string[]) => JSON.stringify({
  nodes: [
    { id: 's', type: 'start', data: { nodeType: 'start', triggerType: 'app' } },
    ...kinds.map((k, i) => ({ id: `a${i}`, type: 'workApp', data: { nodeType: 'workApp', appTemplate: k } })),
  ],
  edges: [],
})
const tpl = (id: string, kinds: string[] = [], over: Record<string, unknown> = {}) => ({
  templateId: id, name: id, description: 'd', categoryCode: 'ai_assistant', complexity: 'beginner',
  keywords: [], nodeTypes: [], features: [], explanation: '', sortOrder: 1, workflowJson: appGraph(kinds), ...over,
})
const meta = (id: string, extra: Partial<WorkAppMeta> = {}): WorkAppMeta => ({ id, appTemplateKinds: [id], features: {}, i18n: { en: {} }, ...extra })
const owners = (xs: Array<[string, WorkAppMeta, boolean?]>): KindOwners => new Map(xs.map(([k, m, custom]) => [k, { meta: m, custom: !!custom }]))

test('countries = intersection of fixed app package countries - all is dropped - empty stops - unknown apps are left out of the count', () => {
  const o = owners([['ch', meta('ch', { countries: ['CH'] })], ['any', meta('any')], ['de', meta('de', { countries: ['CH'] })]])
  const [a, b, c] = composeWorkAppTemplates([{ owner: 'p', templates: [tpl('a', ['ch', 'any']), tpl('b', ['any']), tpl('c', ['unknown-kind'])] }], o)
  assert.deepEqual(a.countries, ['CH'])
  assert.equal(b.countries, 'all')
  assert.equal(c.countries, 'all')
  assert.deepEqual(c.includes, ['unknown-kind'])
  assert.deepEqual(composeWorkAppTemplates([{ owner: 'p', templates: [tpl('d', ['ch', 'ch'])] }], o)[0].includes, ['ch'])
  const o2 = owners([['x', meta('x', { countries: ['CH'] })], ['y', meta('y', { countries: ['US-CA'] })]])
  throwsWith(() => composeWorkAppTemplates([{ owner: 'p', templates: [tpl('e', ['x', 'y'])] }], o2), /unknown country "US-CA"/)
})

test('maker - company > community (name once) > AI Talk', () => {
  const o = owners([
    ['mine', meta('mine'), true],
    ['c1', meta('c1', { publisher: { kind: 'community', name: ' Acme ' } })],
    ['c2', meta('c2', { publisher: { kind: 'community', name: 'Acme' } })],
    ['ours', meta('ours')],
  ])
  const r = composeWorkAppTemplates([{ owner: 'p', templates: [tpl('a', ['mine', 'c1']), tpl('b', ['c1', 'c2', 'ours']), tpl('c', ['ours']), tpl('d')] }], o)
  assert.deepEqual(r.map((e) => e.publisher), [{ kind: 'own' }, { kind: 'community', names: ['Acme'] }, { kind: 'aitalk' }, { kind: 'aitalk' }])
})

test('mismatches throw - id, overlap (including the core), bundle field, non-work-app body, field shape', () => {
  const o = owners([])
  const one = (t: unknown) => () => composeWorkAppTemplates([{ owner: 'p', templates: [t] }], o)
  throwsWith(one(tpl('Bad_Id')), /bad templateId/)
  throwsWith(one(tpl('../x')), /bad templateId/)
  throwsWith(one(null), /not an object/)
  throwsWith(one(tpl('a', [], { bundleVersion: 1 })), /"bundleVersion" is not allowed/)
  throwsWith(one(tpl('a', [], { subWorkflows: [] })), /"subWorkflows" is not allowed/)
  throwsWith(one(tpl('a', [], { workflowJson: '{' })), /not valid JSON/)
  throwsWith(one(tpl('a', [], { workflowJson: JSON.stringify({ nodes: [{ id: 's', data: { nodeType: 'start' } }], edges: [] }) })), /not a work app canvas/)
  throwsWith(one(tpl('a', [], { workflowJson: { nodes: [] } })), /must be a JSON string/)
  throwsWith(one(tpl('a', [], { name: ' ' })), /name is missing/)
  throwsWith(one(tpl('a', [], { complexity: 'easy' })), /bad complexity/)
  throwsWith(one(tpl('a', [], { keywords: 'x' })), /keywords must be a list/)
  throwsWith(one(tpl('a', [], { sortOrder: '1' })), /sortOrder must be a number/)
  throwsWith(one(tpl('a', [], { i18n: [] })), /i18n must be an object/)
  throwsWith(one(tpl('a', [], { i18n: { es: { name: 'x', description: 'y', explanation: '' } } })), /i18n language "es"/)
  throwsWith(one(tpl('a', [], { i18n: { de: { name: ' ', description: 'y', explanation: '' } } })), /i18n\.de\.name is missing/)
  throwsWith(one(tpl('a', [], { i18n: { ko: { name: 'x', description: 'y' } } })), /i18n\.ko\.explanation must be a string/)
  throwsWith(() => composeWorkAppTemplates([{ owner: 'p', templates: 'x' as unknown as unknown[] }], o), /must be a list/)
  throwsWith(() => composeWorkAppTemplates([{ owner: 'p', templates: null as unknown as unknown[] }], o), /must be a list/)
  throwsWith(() => composeWorkAppTemplates([{ owner: 'core', templates: [tpl('work-app')] }, { owner: 'p', templates: [tpl('work-app')] }], o), /duplicate templateId work-app \(core and p\)/)
})

test('sortOrder order', () => {
  const r = composeWorkAppTemplates([{ owner: 'p', templates: [tpl('b', [], { sortOrder: 2 }), tpl('a', [], { sortOrder: 1 })] }], owners([]))
  assert.deepEqual(r.map((e) => e.template.templateId), ['a', 'b'])
})

test('template with only a shared app - the workflow to create when there is no ledger', cloudOnly, async () => {
  const { soloWorkAppTemplate } = await import('./workflow-template-catalog')
  assert.equal(soloWorkAppTemplate('ledger')?.template.templateId, 'work-app-ledger')
  assert.equal(soloWorkAppTemplate('invoices'), null, 'Invoices 템플릿은 연결 노드가 있어 「하나만」이 아니다')
  assert.equal(soloWorkAppTemplate('nope'), null)
})
