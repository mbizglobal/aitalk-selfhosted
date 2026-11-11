import { test } from 'node:test'
import assert from 'node:assert/strict'
import { entryCtx, frozenActor } from './handles'
import { composeWorkApps } from './registry'
import type { WorkAppFactory } from './package'
import type { ModuleRunCtx as PublicModuleRunCtx, ScreenRowsCtx as PublicScreenRowsCtx, WorkAppToolCtx as PublicToolCtx } from './package-api'

test('only core 1 packages get deps - core 2 and unknown (null) do not even get the key', () => {
  const deps = { db: 'x' }
  const h = { sheets: {} }
  assert.equal(entryCtx(h, 1, deps, { userId: 'u' }).deps, deps)
  for (const core of [2, 3, null]) assert.equal('deps' in entryCtx(h, core, deps, { userId: 'u' }), false, String(core))
})

test('the actor is copied and frozen - a package cannot change it and it is not the original object', () => {
  const ai = { type: 'ai' as const, workflowId: 'w1' }
  const f = frozenActor(ai)
  assert.notEqual(f, ai)
  assert.ok(Object.isFrozen(f))
  try { (f as { type: string }).type = 'human' } catch { }
  assert.equal(f.type, 'ai')
  ai.workflowId = 'changed'
  assert.equal((f as { workflowId: string }).workflowId, 'w1', '원본을 바꿔도 얼린 복사는 그대로')
})

test('a core 2 calculation module with prepare (which gets the database) is rejected', () => {
  const meta = { id: 'acme', appTemplateKinds: [], features: {}, i18n: { en: {}, de: {}, fr: {}, ko: {} } }
  const calc = { id: 'acme.calc', version: 1, kind: 'calc', title: { en: 'c', de: 'c', fr: 'c', ko: 'c' }, description: { en: 'c', de: 'c', fr: 'c', ko: 'c' }, needs: [], run: async () => ({}), prepare: async () => {} }
  const f = (core: number): WorkAppFactory => () => ({ id: 'acme', version: '0.0.1', core, meta, appTemplates: [], sheetTemplates: [], modules: [calc] } as never)
  assert.throws(() => composeWorkApps([f(2)], [meta as never]), /prepare is for core 1 packages only/)
  assert.doesNotThrow(() => composeWorkApps([f(1)], [meta as never]))
})

type NoDeps<T> = 'deps' extends keyof T ? false : true
const _publicCtxHaveNoDeps: [NoDeps<PublicModuleRunCtx>, NoDeps<PublicScreenRowsCtx>, NoDeps<PublicToolCtx>] = [true, true, true]
void _publicCtxHaveNoDeps

test('only version 5 has the references key - 1, 2, 3, 4 and null have no key', async () => {
  const { v5Handles } = await import('./v5-handles')
  const s = { deps: {} as never, userId: 'u', projectId: 'p' }
  for (const core of [1, 2, 3, 4, null]) assert.deepEqual(Object.keys(v5Handles(core, s)), [], String(core))
  assert.deepEqual(Object.keys(v5Handles(5, s)).sort(), ['fingerprint', 'references'])
})

import type { V5ActionWorkModule, V5WorkAppTool, V5AppTemplate } from './package-api'
export const __v5TypeUse: { m: V5ActionWorkModule['run']; s: NonNullable<V5ActionWorkModule['screenRows']>; t: V5WorkAppTool['run']; c: NonNullable<V5AppTemplate['checklist']> } = {
  m: async (ctx) => (await ctx.references()).references(),
  s: async (ctx) => { (await ctx.references()).references(); return { rows: [] } as never },
  t: async (ctx) => (await ctx.references()).references(),
  c: async (ctx) => { (await ctx.references()).references(); return [] },
}

test('confirm cards and ledger link cards cannot be raised with propose - proposeConfirm and proposeLedgerLink only for version 5 tools', async () => {
  const { toolHandles } = await import('./handles')
  const { v5ToolHandles } = await import('./v5-handles')
  const h = toolHandles({ deps: {} as never, userId: 'u', projectId: 'p', caller: { type: 'human' }, writeAs: { type: 'human' } }, 'run', async () => null)
  assert.throws(() => h.propose({ type: 'confirm_rows', sheetId: 's', rowIds: ['r'], fingerprint: 'f'.repeat(64), count: 1, detail: '' }), /proposeConfirm/)
  const s = { deps: {} as never, userId: 'u', projectId: 'p', workflowId: 'w', runId: 'run' }
  for (const core of [1, 2, 3, 4, null]) assert.deepEqual(Object.keys(v5ToolHandles(core, s)), [], String(core))
  assert.deepEqual(Object.keys(v5ToolHandles(5, s)).sort(), ['appLinkSetup', 'fingerprint', 'ledgerLinkSetup', 'proposeAppSend', 'proposeConfirm', 'proposeLedgerLink', 'proposeLedgerStatement', 'references'])
  assert.throws(() => h.propose({ type: 'ledger_link', ledgerProjectId: 'l', items: [], expl: [], fingerprint: 'f'.repeat(64), count: 1, replaces: 0, rows: [], detail: '' }), /proposeLedgerLink/)
  assert.throws(() => h.propose({ type: 'ledger_files', ledgerProjectId: 'l', files: [{ fileId: 'f', name: 'n' }], ledgerUrl: null }), /made by the core/)
  assert.throws(() => h.propose({ type: 'ledger_statement', ledgerProjectId: 'l', fileId: 'f', fileName: 'n', statement: {}, account: { last4: '0310', currency: 'CHF', bank: 'ubs', label: '' }, summary: { lines: 0, from: '', until: '', opening: '0.00', closing: '0.00' } }), /proposeLedgerStatement/)
})
