import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'fs'
import path from 'path'
import { composeWorkApps } from './registry'
import { mergeWorkDict } from '@/lib/translations/work'
import { vatWorkApp } from '@/work-apps/vat'
import { exampleWorkApp } from './__fixtures__/example-work-app'

const SRC = path.join(process.cwd(), 'src')
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? files(p) : /\.tsx?$/.test(e.name) ? [p] : []
  })
const importsOf = (f: string) => [...readFileSync(f, 'utf8').matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1])

test('the core does not import the Work App package folder', () => {
  const bad: string[] = []
  for (const f of [...files(path.join(SRC, 'lib')), ...files(path.join(SRC, 'app'))]) {
    if (/\.test\.ts$/.test(f) || f.includes(`${path.sep}__fixtures__${path.sep}`)) continue
    for (const spec of importsOf(f)) if (/^@\/work-apps\/[^/]+\//.test(spec) || /^@\/work-apps\/(?!builtin|custom)[a-z0-9-]+$/.test(spec)) bad.push(`${path.relative(SRC, f)} → ${spec}`)
  }
  assert.deepEqual(bad, [])
})

test('second test Work App: imports only the core\'s public entry point', () => {
  const dir = path.join(SRC, 'lib/work/__fixtures__/example-work-app')
  const outside = files(dir).flatMap((f) => importsOf(f).filter((s) => s.startsWith('@/') && s !== '@/lib/work/package-api').map((s) => `${path.basename(f)} → ${s}`))
  assert.deepEqual(outside, [])
})

test('second test Work App: attaches without modifying the core (app template, frame, module, tool, translation)', () => {
  const vat = vatWorkApp()
  const ex = exampleWorkApp()
  const r = composeWorkApps([() => vat, () => ex], [vat.meta, ex.meta])
  assert.deepEqual(r.appTemplates.map((a) => a.kind), ['vat', 'example'])
  assert.ok(r.sheetTemplates.some((t) => t.name === 'example.items'))
  assert.ok(r.modules.some((m) => m.id === 'example.count'))
  assert.deepEqual(r.packages[1].tools?.map((t) => t.def.name), ['example_hello'])
  const dict = mergeWorkDict({ loading: 'Loading' }, 'ko', [vat.meta, ex.meta])
  assert.equal(dict.kind_example, 'Example')
  assert.equal(dict.kind_vat, vat.meta.i18n.ko.kind_vat)
})
