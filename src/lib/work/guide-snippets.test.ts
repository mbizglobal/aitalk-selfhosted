/**
 * The contract 3 snippets of opencore/public/BUILD-A-WORK-APP.md, as one package — the registry must accept them and they
 * must compile. Change both together (docs/wf_app/00_core/flow.md §19 F6-4).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { composeWorkApps } from './registry'
import { vatWorkApp } from '@/work-apps/vat'
import type { AppTemplate, SheetTemplate, V3WorkAppTool, WorkAppMeta, WorkAppPackage } from './package-api'

// ── guide: "Declare what your app uses" (meta.ts) ──
const uses: NonNullable<WorkAppMeta['uses']> = {
  acme: {
    connections: [
      { id: 'mail', kind: 'email', label: 'acme.conn_mail' },
      { id: 'erp', kind: 'database', engine: 'postgres', label: 'acme.conn_erp' },
    ],
    sends: [
      // Automatic: the address comes from a setting a person typed — never from the AI
      { id: 'acme.report', via: 'mail', to: { setting: 'reportEmail' }, auto: true, label: 'acme.send_report' },
    ],
    knowledge: true,
    webSearch: true,
    dbQueries: [
      { id: 'acme.open-orders', via: 'erp', mode: 'read', label: 'acme.q_open_orders' },
      { id: 'acme.set-status', via: 'erp', mode: 'write', label: 'acme.q_set_status' },
    ],
    inbox: [{ family: 'acme.requests', identify: { column: 'customer', by: 'telegram' }, readable: ['subject', 'status'] }],
  },
}

// ── guide: "Company database" (index.ts) ──
const dbQueries: WorkAppPackage['dbQueries'] = {
  'acme.open-orders': { sql: 'SELECT id, total FROM orders WHERE customer = $1 AND status = $2', params: ['customer', 'status'], maxRows: 100 },
  'acme.set-status': { sql: 'UPDATE orders SET status = $1 WHERE id = $2', params: ['status', 'id'] },
}

// ── guide: an AI tool that uses the handles ──
const statusTool: V3WorkAppTool = {
  def: {
    name: 'acme_order_status',
    description: 'Open orders of a customer, and what our documents say about late orders.',
    parameters: { type: 'object', properties: { customer: { type: 'string' } }, required: ['customer'], additionalProperties: false },
  },
  async run(ctx, args) {
    const { rows, truncated } = await ctx.db!.query('acme.open-orders', { customer: String(args.customer), status: 'open' })
    const policy = await ctx.knowledge!.search('late order policy', { topK: 3 })
    return { orders: rows, truncated, policy: policy.map((h) => h.content) }
  },
}
const reportTool: V3WorkAppTool = {
  def: { name: 'acme_send_report', description: 'Sends the monthly report.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  async run(ctx) {
    const sent = await ctx.send!({ send: 'acme.report', content: { subject: 'Monthly report', text: 'All orders are closed.' } })
    const card = await ctx.send!({ query: 'acme.set-status', params: { status: 'closed', id: 42 } })
    return { report: sent.status, statusCard: card.status } // 'sent' | 'card' | 'failed' | 'unknown' | 'refused'
  },
}

const requests: SheetTemplate = {
  name: 'acme.requests', version: 1, family: 'acme.requests',
  columns: [{ name: 'customer', type: 'string' }, { name: 'subject', type: 'string', required: true }, { name: 'status', type: 'string' }],
  confirm: { calcColumns: [] },
}
const appTemplate: AppTemplate = {
  kind: 'acme', sheets: [{ template: 'acme.requests@1', name: 'Requests' }], modules: [], calcModule: null, globalFamilies: [],
  aiGuide: 'Customer requests.',
  parseSettings: (raw) => ({ reportEmail: typeof (raw as { reportEmail?: unknown })?.reportEmail === 'string' ? (raw as { reportEmail: string }).reportEmail : '' }),
  ui: { settings: [{ name: 'reportEmail', type: 'text' }], period: 'month', calcInput: [], taskChecks: [], sheetImports: [] },
}
const en = Object.fromEntries(['acme.kind_acme', 'acme.conn_mail', 'acme.conn_erp', 'acme.send_report', 'acme.q_open_orders', 'acme.q_set_status'].map((k) => [k, k]))
const meta: WorkAppMeta = { id: 'acme', appTemplateKinds: ['acme'], features: { acme: { available: [], planned: [] } }, i18n: { en }, uses }
const acme: WorkAppPackage = { id: 'acme', version: '1.0.0', core: 3, meta, appTemplates: [appTemplate], sheetTemplates: [requests], modules: [], tools: [statusTool, reportTool], dbQueries }

test('the guide snippets register as one contract 3 package', () => {
  const r = composeWorkApps([vatWorkApp, () => acme], [vatWorkApp().meta, meta])
  assert.ok(r.packages.some((p) => p.id === 'acme' && p.core === 3))
})

test('the registry refuses an AI-given address in a declared send, and an engine on a mail slot', () => {
  const bad = (u: unknown) => () => composeWorkApps([vatWorkApp, () => ({ ...acme, meta: { ...meta, uses: { acme: u } } } as WorkAppPackage)], [vatWorkApp().meta, { ...meta, uses: { acme: u } } as WorkAppMeta])
  assert.throws(bad({ ...uses.acme, sends: [{ id: 'acme.x', via: 'mail', to: { ai: true }, label: 'acme.send_report' }] }), /work app registry/)
  assert.throws(bad({ ...uses.acme, connections: [{ id: 'mail', kind: 'email', engine: 'mysql', label: 'acme.conn_mail' }, uses.acme.connections![1]] }), /work app registry/)
})
