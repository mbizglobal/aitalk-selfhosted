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
