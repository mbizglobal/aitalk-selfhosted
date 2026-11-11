import { test } from 'node:test'
import { cloudOnly } from '@/lib/work/cloud-apps-for-tests'
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

test('importing the contract (package-api) as values reaches no database, key or file store', () => {
  const FORBIDDEN = [/^@prisma\/client$/, /^@\/lib\/prisma$/, /lib\/work\/sheet-gate$/, /lib\/work\/files$/, /lib\/work\/sealed$/, /file-store/, /blob/i, /lib\/work\/v3-handles$/, /lib\/work\/sends$/, /lib\/rag-space$/, /lib\/knowledge/, /workflow\/tools\//, /connection-scope/]
  const resolve = (from: string, spec: string): string | null => {
    const base = spec.startsWith('@/') ? path.join(SRC, spec.slice(2)) : spec.startsWith('.') ? path.join(path.dirname(from), spec) : null
    if (!base) return null
    for (const c of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) { try { readFileSync(c); return c } catch { } }
    return null
  }
  const valueImports = (f: string) =>
    [...readFileSync(f, 'utf8').matchAll(/^(?:import|export)\s+(?!type\b)[^'"]*?from\s+['"]([^'"]+)['"]|^import\s+['"]([^'"]+)['"]|\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]/gm)].map((m) => m[1] ?? m[2] ?? m[3])
  const seen = new Set<string>()
  const bad: string[] = []
  const walk = (f: string) => {
    if (seen.has(f)) return
    seen.add(f)
    for (const spec of valueImports(f)) {
      if (FORBIDDEN.some((re) => re.test(spec))) bad.push(`${path.relative(SRC, f)} → ${spec}`)
      const next = resolve(f, spec)
      if (next) walk(next)
    }
  }
  walk(path.join(SRC, 'lib/work/package-api.ts'))
  assert.deepEqual(bad, [])
  assert.ok(seen.size > 3, '따라간 파일이 있어야 한다')
})

const VAT_LIBS = ['@/work-libs/bank', '@/work-libs/invoice', '@/work-libs/expense']
test('VAT imports from the core only the package-api entry point and declared shared library entry points', () => {
  const dir = path.join(SRC, 'work-apps/vat')
  const bad = files(dir)
    .filter((f) => !/\.test\.ts$/.test(f))
    .flatMap((f) => importsOf(f).filter((s) => s.startsWith('@/') && s !== '@/lib/work/package-api' && !VAT_LIBS.includes(s)).map((s) => `${path.relative(dir, f)} → ${s}`))
  assert.deepEqual(bad, [])
})

test('libraries import only the core entry point (package-api), their own folder and the version table', cloudOnly, () => {
  const root = path.join(SRC, 'work-libs')
  const libs = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
  assert.ok(libs.includes('bank'))
  const bad: string[] = []
  for (const lib of libs) {
    const dir = path.join(root, lib)
    for (const f of files(dir)) {
      for (const s of importsOf(f)) {
        if (s.startsWith('@/') && s !== '@/lib/work/package-api') bad.push(`${lib}/${path.relative(dir, f)} → ${s}`)
        if (s.startsWith('.')) {
          const to = path.resolve(path.dirname(f), s)
          if (!to.startsWith(dir + path.sep) && to !== path.join(root, 'versions')) bad.push(`${lib}/${path.relative(dir, f)} → ${s} (폴더 밖)`)
        }
      }
    }
  }
  assert.deepEqual(bad, [])
})

test('packages import libraries only through the entry-point file and declare them in libs', async () => {
  const { workAppRegistry } = await import('./registry')
  const pkgs = new Map(workAppRegistry().packages.map((p) => [p.id, p]))
  const root = path.join(SRC, 'work-apps')
  const bad: string[] = []
  for (const e of readdirSync(root, { withFileTypes: true }).filter((x) => x.isDirectory())) {
    for (const f of files(path.join(root, e.name)).filter((x) => !/\.test\.ts$/.test(x))) {
      for (const s of importsOf(f)) {
        const m = /^@\/work-libs\/(.+)$/.exec(s)
        if (!m) continue
        if (m[1].includes('/')) { bad.push(`${e.name}/${path.basename(f)} → ${s} (창구 파일만)`); continue }
        const p = pkgs.get(e.name)
        if (p && !p.libs?.[m[1]]) bad.push(`${e.name} → ${s} (libs.${m[1]} 선언 없음)`)
      }
    }
  }
  assert.deepEqual(bad, [])
})

test('registry - checks library version declarations', cloudOnly, () => {
  const vat = vatWorkApp()
  for (const libs of [{ bank: 0 }, { bank: 1.5 }, { bank: 99 }, { nolib: 1 }, { toString: 99 }, { constructor: 1 }]) {
    assert.throws(() => composeWorkApps([() => ({ ...vat, libs })], [vat.meta]), /library/, JSON.stringify(libs))
  }
  assert.doesNotThrow(() => composeWorkApps([() => ({ ...vat, libs: { bank: 1 } })], [vat.meta]))
})

test('VAT does not use deps or version-1-only types (version 8 - fetching rates is a handle)', cloudOnly, () => {
  const dir = path.join(SRC, 'work-apps/vat')
  const src = files(dir).filter((f) => !/\.test\.ts$/.test(f)).map((f) => ({ f: path.relative(dir, f), t: readFileSync(f, 'utf8') }))
  assert.ok(src.length > 5, `vat files: ${src.length}`)
  assert.deepEqual(src.flatMap(({ f, t }) => [...t.matchAll(/\bdeps\b[^\n]*/g)].map((m) => `${f}: ${m[0].trim()}`)), [])
  assert.deepEqual(src.filter(({ t }) => /\bV1[A-Z]\w*|\bprepare\s*[:(]/.test(t)).map(({ f }) => f), [])
})

test('example app (src/work-apps/example) imports only the contract, with no deps, no core 1 types and no relative path outside its folder', () => {
  const dir = path.join(SRC, 'work-apps/example')
  const src = files(dir).filter((f) => !/\.test\.ts$/.test(f)).map((f) => ({ f: path.relative(dir, f), t: readFileSync(f, 'utf8'), specs: importsOf(f) }))
  assert.ok(src.length >= 7, `files: ${src.length}`)
  const bad = src.flatMap(({ f, specs }) => specs.filter((s) => (s.startsWith('@/') && s !== '@/lib/work/package-api') || (!s.startsWith('@/') && !s.startsWith('.'))).map((s) => `${f} → ${s}`))
  assert.deepEqual(bad, [])
  const outside = src.flatMap(({ f, specs }) => specs.filter((s) => s.startsWith('.') && !path.resolve(dir, path.dirname(f), s).startsWith(dir + path.sep)).map((s) => `${f} → ${s}`))
  assert.deepEqual(outside, [], '폴더 하나로 옮겨 붙일 수 있게')
  assert.deepEqual(src.filter(({ t }) => /\bdeps\b|\bV1[A-Z]\w*/.test(t)).map(({ f }) => f), [])
})

test('the example app (core 3) is not registered - a company adds it with one line in custom.ts', async () => {
  const { workAppRegistry } = await import('./registry')
  assert.ok(!workAppRegistry().packages.some((p) => p.id === 'example'))
  const { exampleWorkApp } = await import('@/work-apps/example')
  assert.equal(exampleWorkApp().core, 3)
})

test('the example app does not use global fetch - outside goes through ctx.send (card, record, switch off)', () => {
  const dir = path.join(SRC, 'work-apps/example')
  const hits = files(dir).filter((f) => !/\.test\.ts$/.test(f)).filter((f) => /\bfetch\s*\(/.test(readFileSync(f, 'utf8'))).map((f) => path.relative(dir, f))
  assert.deepEqual(hits, [])
})

test('contract 3 declaration types (uses.ts) import no values - the browser (meta) reads them too', () => {
  const t = readFileSync(path.join(SRC, 'lib/work/uses.ts'), 'utf8')
  assert.deepEqual([...t.matchAll(/^import\s+(?!type\b).*$/gm)].map((m) => m[0]), [])
})
