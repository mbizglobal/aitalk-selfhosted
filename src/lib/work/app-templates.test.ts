import { test } from 'node:test'
import assert from 'node:assert/strict'
import { APP_TEMPLATE_KINDS } from './app-template-kinds'
import { findWorkModule } from './module-registry'
import { appTemplates, builtinSheetTemplates } from './registry'
import { BUILTIN_WORK_APP_METAS } from '@/work-apps/builtin-meta'

const BUILTIN_KINDS = new Set(BUILTIN_WORK_APP_METAS.flatMap((m) => Object.keys(m.features)))

test('app template screen settings fields = the fields the settings check accepts', () => {
  for (const b of appTemplates()) {
    const sample: Record<string, unknown> = {}
    for (const f of b.ui.settings) sample[f.name] = f.type === 'boolean' ? true : f.type === 'money' ? '1.00' : 'x'
    assert.doesNotThrow(() => b.parseSettings(sample), `${b.kind} settings`)
    const requiredOnly = Object.fromEntries(b.ui.settings.filter((f) => f.required).map((f) => [f.name, sample[f.name]]))
    assert.doesNotThrow(() => b.parseSettings(requiredOnly), `${b.kind} required settings only`)
  }
})

test('calculation input fields are within the calculation module\'s input schema', () => {
  for (const b of appTemplates()) {
    if (!b.calcModule) { assert.equal(b.ui.calcInput.length, 0); continue }
    const props = (b.calcModule.input as { properties?: Record<string, unknown> }).properties ?? {}
    for (const f of b.ui.calcInput) assert.ok(f.name in props, `${b.kind} ${f.name}`)
  }
})

test('the work screen check is for modules that are on and outside submission', () => {
  for (const b of appTemplates()) {
    for (const c of b.ui.taskChecks) {
      assert.ok(b.modules.includes(c.module), `${b.kind} ${c.module} enabled`)
      assert.notEqual(findWorkModule(c.module).kind, 'calc', `${c.module} not calc`)
    }
  }
})

test('sheet import is a module that is on and outside submission, and the account column of the app template sheet has values to pick', () => {
  for (const b of appTemplates()) {
    for (const im of b.ui.sheetImports) {
      assert.ok(b.modules.includes(im.module), `${b.kind} ${im.module} enabled`)
      assert.notEqual(findWorkModule(im.module).kind, 'calc', `${im.module} not calc`)
      const tpl = builtinSheetTemplates().find((t) => t.family === im.family && b.sheets.some((s) => s.template === `${t.name}@${t.version}`))
      assert.ok(tpl, `${b.kind} has a ${im.family} sheet`)
      assert.ok(tpl!.ui?.refs?.[im.accountColumn], `${im.family}.${im.accountColumn} has choices`)
    }
  }
})

test('the app template name list (for screens and checks) matches the app template core list', () => {
  assert.deepEqual([...APP_TEMPLATE_KINDS].sort(), appTemplates().map((b) => b.kind).sort())
})

test('app template feature list: module entries = modules to turn on, name = module title, present in every app template', async () => {
  const { APP_TEMPLATE_FEATURES } = await import('./app-template-features')
  for (const b of appTemplates()) {
    const f = APP_TEMPLATE_FEATURES[b.kind as keyof typeof APP_TEMPLATE_FEATURES]
    assert.ok(f, `${b.kind} features`)
    const moduleIds = new Set([...b.modules, ...(b.calcModule ? [b.calcModule.id] : [])])
    const listed = f.available.filter((x) => x.module)
    assert.deepEqual(new Set(listed.map((x) => x.id)), moduleIds, `${b.kind} module features`)
    for (const x of listed) assert.deepEqual(x.label, findWorkModule(x.id).title, `${x.id} label`)
    const langs = BUILTIN_KINDS.has(b.kind) ? (['en', 'de', 'fr', 'ko'] as const) : (['en'] as const)
    for (const x of [...f.available, ...f.planned]) for (const l of langs) assert.ok(x.label[l], `${x.id} ${l}`)
  }
})
