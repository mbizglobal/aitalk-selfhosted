import { test } from 'node:test'
import { cloudOnly } from '@/lib/work/cloud-apps-for-tests'
import assert from 'node:assert/strict'
import { isAppWorkflow } from './start-trigger'
import { fixedAppTemplatesKnown } from './template-kind'
import { validateWorkflowJson } from './validation'
import { referenceLinesOf } from '@/lib/work/reference-lines'
import { handoffRoutesOf } from '@/lib/work/app-canvas'
import { builtinSheetTemplates } from '@/lib/work/registry'
import { appTemplateOf } from '@/lib/work/app-templates'
import { getWorkAppTemplate, workAppTemplateCatalog } from '@/lib/work/workflow-template-catalog'

const load = (id: string) => {
  const t = getWorkAppTemplate(id)!.template
  return { ...t, graph: JSON.parse(t.workflowJson) as { nodes: Array<{ id: string; data: Record<string, unknown> }>; edges: Array<Record<string, unknown>> } }
}
const IDS = ['work-app', 'work-app-vat', 'work-app-receipts', 'work-app-invoice', 'work-app-invoices', 'work-app-ledger', 'work-app-approvals']

test('patterns seven - work app body - fixed app templates all registered - deploy check passes - no sortOrder overlap', cloudOnly, () => {
  const orders = new Set<number>()
  assert.deepEqual(workAppTemplateCatalog().map((e) => e.template.templateId).sort(), [...IDS].sort())
  for (const f of IDS) {
    const t = load(f)
    assert.equal(t.templateId, f, f)
    assert.ok(isAppWorkflow(t.graph), f)
    assert.ok(fixedAppTemplatesKnown(t.graph), f)
    assert.ok(validateWorkflowJson(t.workflowJson, 'structural', 'main').valid, f)
    const filled = JSON.stringify({ ...t.graph, nodes: t.graph.nodes.map((n) => (n.data.nodeType === 'workAppLink' && n.data.autoLink === true ? { ...n, data: { ...n.data, linkedAppWorkflowId: `wf_l_${n.id}` } } : n)) })
    const r = validateWorkflowJson(filled, 'deployable', 'main')
    assert.ok(r.valid, `${f}: ${JSON.stringify(r.issues)}`)
    assert.ok(!orders.has(t.sortOrder), `${f} sortOrder ${t.sortOrder}`)
    orders.add(t.sortOrder)
  }
})

test.skip('Swiss Accounting - four apps - five references (planned sheets, confirmed data only, receipts to year end) - one when closed route VAT to year end', () => {
  const t = load('work-app-swiss-accounting')
  const apps = Object.fromEntries(t.graph.nodes.filter((n) => n.data.nodeType === 'workApp').map((n) => [n.data.appTemplate as string, n.id]))
  assert.deepEqual(Object.keys(apps).sort(), ['receipts', 'swiss-acc-invoice', 'swiss-acc-year-end', 'vat'])
  const { lines, problems } = referenceLinesOf(t.graph)
  assert.deepEqual(problems, [])
  const families = new Set(builtinSheetTemplates().map((x) => x.family))
  const got = lines.map((l) => ({ reader: l.readerWorkflowId, source: l.sourceWorkflowId, sheets: [...(l.sheets as string[])].sort(), unconfirmed: l.includeUnconfirmed }))
  const node = (k: string) => `node:${apps[k]}`
  assert.deepEqual(got.sort((a, b) => (a.reader + a.source).localeCompare(b.reader + b.source)), [
    { reader: node('swiss-acc-year-end'), source: node('swiss-acc-invoice'), sheets: ['swiss-acc.invoice.invoices', 'swiss-acc.invoice.payments'], unconfirmed: false },
    { reader: node('swiss-acc-year-end'), source: node('vat'), sheets: ['bank.accounts', 'bank.balances', 'vat.basis', 'vat.transactions'], unconfirmed: false },
    { reader: node('swiss-acc-year-end'), source: node('receipts'), sheets: ['receipts.receipts'], unconfirmed: false },
    { reader: node('vat'), source: node('receipts'), sheets: ['receipts.receipts'], unconfirmed: false },
    { reader: node('vat'), source: node('swiss-acc-invoice'), sheets: ['swiss-acc.invoice.invoices'], unconfirmed: false },
  ].sort((a, b) => (a.reader + a.source).localeCompare(b.reader + b.source)))
  for (const l of got) for (const s of l.sheets) assert.ok(families.has(s), s)
  const h = handoffRoutesOf(t.graph)
  assert.deepEqual(h.problems, [])
  assert.deepEqual(h.routes.map((r) => [r.fromNodeId, r.toNodeId]), [[apps.vat, apps['swiss-acc-year-end']]])
  assert.doesNotThrow(() => appTemplateOf('swiss-acc-year-end')!.parseSettings({}))
  assert.throws(() => appTemplateOf('vat')!.parseSettings({}))
})

test('Invoices - invoices + bank ledger link node (filled by the server on create) - two mutual references (including undecided) - both applied without settings', cloudOnly, () => {
  const t = load('work-app-invoices')
  const apps = t.graph.nodes.filter((n) => n.data.nodeType === 'workApp')
  assert.deepEqual(apps.map((n) => n.data.appTemplate), ['invoices'])
  const links = t.graph.nodes.filter((n) => n.data.nodeType === 'workAppLink')
  assert.equal(links.length, 1)
  assert.equal(links[0].data.appTemplate, 'ledger')
  assert.equal(links[0].data.autoLink, true)
  assert.equal(links[0].data.linkedAppWorkflowId, '', '템플릿에는 비워 둔다 — 계정마다 다른 장부')
  const { lines, problems } = referenceLinesOf(t.graph)
  assert.deepEqual(problems, [])
  const inv = `node:${apps[0].id}`
  const led = `link:${links[0].id}`
  const got = lines.map((l) => ({ reader: l.readerWorkflowId, source: l.sourceWorkflowId, sheets: [...(l.sheets as string[])].sort(), unconfirmed: l.includeUnconfirmed }))
  assert.deepEqual(got.sort((a, b) => a.reader.localeCompare(b.reader)), [
    { reader: inv, source: led, sheets: ['ledger.accounts', 'ledger.chart', 'ledger.explanations', 'ledger.lines', 'ledger.parts'], unconfirmed: true },
    { reader: led, source: inv, sheets: ['invoices.customers', 'invoices.invoices', 'invoices.payments'], unconfirmed: true },
  ].sort((a, b) => a.reader.localeCompare(b.reader)))
  const families = new Set(builtinSheetTemplates().map((x) => x.family))
  for (const l of got) for (const s of l.sheets) assert.ok(families.has(s), s)
  assert.deepEqual(handoffRoutesOf(t.graph).routes, [])
  assert.doesNotThrow(() => appTemplateOf('invoices')!.parseSettings({}))
  assert.doesNotThrow(() => appTemplateOf('ledger')!.parseSettings({}))
})

test('Expenses - expenses app + payment approvals app + bank ledger link node - four mutual references (including undecided) - one send line', cloudOnly, () => {
  const t = load('work-app-receipts')
  assert.equal(t.name, 'Expenses')
  const apps = t.graph.nodes.filter((n) => n.data.nodeType === 'workApp')
  assert.deepEqual(apps.map((n) => n.data.appTemplate), ['receipts', 'approvals'])
  const links = t.graph.nodes.filter((n) => n.data.nodeType === 'workAppLink')
  assert.equal(links.length, 1)
  assert.equal(links[0].data.appTemplate, 'ledger')
  assert.equal(links[0].data.autoLink, true)
  assert.equal(links[0].data.linkedAppWorkflowId, '')
  const { lines, problems } = referenceLinesOf(t.graph)
  assert.deepEqual(problems, [])
  const exp = `node:${apps[0].id}`
  const apr = `node:${apps[1].id}`
  const led = `link:${links[0].id}`
  const got = lines.map((l) => ({ reader: l.readerWorkflowId, source: l.sourceWorkflowId, sheets: [...(l.sheets as string[])].sort(), unconfirmed: l.includeUnconfirmed }))
  const key = (x: { reader: string; source: string }) => `${x.reader}<${x.source}`
  assert.deepEqual(got.sort((a, b) => key(a).localeCompare(key(b))), [
    { reader: exp, source: led, sheets: ['ledger.accounts', 'ledger.chart', 'ledger.explanations', 'ledger.lines'], unconfirmed: true },
    { reader: led, source: exp, sheets: ['receipts.bills', 'receipts.claims', 'receipts.receipts'], unconfirmed: true },
    { reader: apr, source: exp, sheets: ['receipts.bills', 'receipts.claims'], unconfirmed: true },
    { reader: exp, source: apr, sheets: ['approvals.requests'], unconfirmed: true },
  ].sort((a, b) => key(a).localeCompare(key(b))))
  const sends = t.graph.edges.filter((e) => e.sourceHandle === 'send')
  assert.deepEqual(sends.map((e) => [e.source, e.target, (e.data as { inboxFamily?: string })?.inboxFamily]), [[apps[0].id, apps[1].id, 'approvals.requests']])
  const families = new Set(builtinSheetTemplates().map((x) => x.family))
  for (const l of got) for (const s of l.sheets) assert.ok(families.has(s), s)
  assert.doesNotThrow(() => appTemplateOf('receipts')!.parseSettings({}))
})

test('Swiss Invoices - invoices + bank ledger link node - two mutual references (including undecided, payment slice from ledger to invoices) - applied without settings', cloudOnly, () => {
  const t = load('work-app-invoice')
  const apps = t.graph.nodes.filter((n) => n.data.nodeType === 'workApp')
  assert.deepEqual(apps.map((n) => n.data.appTemplate), ['swiss-acc-invoice'])
  const links = t.graph.nodes.filter((n) => n.data.nodeType === 'workAppLink')
  assert.deepEqual(links.map((n) => [n.data.appTemplate, n.data.autoLink, n.data.linkedAppWorkflowId]), [['ledger', true, '']])
  const { lines, problems } = referenceLinesOf(t.graph)
  assert.deepEqual(problems, [])
  const inv = `node:${apps[0].id}`
  const led = `link:${links[0].id}`
  const got = lines.map((l) => ({ reader: l.readerWorkflowId, source: l.sourceWorkflowId, sheets: [...(l.sheets as string[])].sort(), unconfirmed: l.includeUnconfirmed }))
  assert.deepEqual(got.sort((a, b) => a.reader.localeCompare(b.reader)), [
    { reader: inv, source: led, sheets: ['ledger.accounts', 'ledger.chart', 'ledger.explanations', 'ledger.lines', 'ledger.parts'], unconfirmed: true },
    { reader: led, source: inv, sheets: ['swiss-acc.invoice.customers', 'swiss-acc.invoice.invoices', 'swiss-acc.invoice.payments'], unconfirmed: true },
  ].sort((a, b) => a.reader.localeCompare(b.reader)))
  const families = new Set(builtinSheetTemplates().map((x) => x.family))
  for (const l of got) for (const s of l.sheets) assert.ok(families.has(s), s)
  assert.doesNotThrow(() => appTemplateOf('swiss-acc-invoice')!.parseSettings({}))
})

test('year-end settings - empty drops the key - one field only - values are checked as before', cloudOnly, () => {
  const p = appTemplateOf('swiss-acc-year-end')!.parseSettings
  assert.deepEqual(p({}), {})
  assert.deepEqual(p({ legalForm: '', canton: '' }), {})
  assert.deepEqual(p({ canton: 'ZG' }), { canton: 'ZG' })
  assert.deepEqual(p({ legalForm: 'AG', canton: 'LU', seat: 'Luzern' }), { legalForm: 'AG', canton: 'LU', seat: 'Luzern' })
  assert.throws(() => p({ legalForm: 'Sàrl' }), /legalForm/)
  assert.throws(() => p({ canton: 'XX' }), /canton/)
  assert.throws(() => p({ canton: 5 }), /canton/)
})

test('Swiss VAT - VAT app + three link nodes (ledger, Expenses, Swiss Invoices) - three lines read by VAT (including undecided) - no lines read from VAT', cloudOnly, () => {
  const t = load('work-app-vat')
  const apps = t.graph.nodes.filter((n) => n.data.nodeType === 'workApp')
  assert.deepEqual(apps.map((n) => n.data.appTemplate), ['vat'])
  const links = t.graph.nodes.filter((n) => n.data.nodeType === 'workAppLink')
  assert.deepEqual(links.map((n) => n.data.appTemplate).sort(), ['ledger', 'receipts', 'swiss-acc-invoice'])
  for (const l of links) { assert.equal(l.data.autoLink, true); assert.equal(l.data.linkedAppWorkflowId, '') }
  const { lines, problems } = referenceLinesOf(t.graph)
  assert.deepEqual(problems, [])
  const vat = `node:${apps[0].id}`
  const kindOf = new Map(links.map((n) => [`link:${n.id}`, n.data.appTemplate as string]))
  const got = lines.map((l) => ({ reader: l.readerWorkflowId, source: kindOf.get(l.sourceWorkflowId), sheets: [...(l.sheets as string[])].sort(), unconfirmed: l.includeUnconfirmed }))
  assert.deepEqual(got.sort((a, b) => String(a.source).localeCompare(String(b.source))), [
    { reader: vat, source: 'ledger', sheets: ['ledger.accounts', 'ledger.balances', 'ledger.explanations', 'ledger.lines'], unconfirmed: true },
    { reader: vat, source: 'receipts', sheets: ['receipts.bills', 'receipts.claims', 'receipts.receipts'], unconfirmed: true },
    { reader: vat, source: 'swiss-acc-invoice', sheets: ['swiss-acc.invoice.invoices', 'swiss-acc.invoice.payments'], unconfirmed: true },
  ])
  const families = new Set(builtinSheetTemplates().map((x) => x.family))
  for (const l of got) for (const s of l.sheets) assert.ok(families.has(s), s)
})
