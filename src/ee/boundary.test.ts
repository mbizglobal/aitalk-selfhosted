import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, dirname } from 'node:path'
import ts from 'typescript'

const SRC = join(process.cwd(), 'src')
const EE = join(SRC, 'ee')
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n)
    return statSync(p).isDirectory() ? (n === 'node_modules' ? [] : walk(p)) : /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(n) ? [p] : []
  })

export function eeBoundaryViolations(files: string[], read: (f: string) => string = (f) => readFileSync(f, 'utf8')): string[] {
  const out: string[] = []
  for (const f of files) {
    if (f === EE || f.startsWith(EE + '/')) continue
    const info = ts.preProcessFile(read(f), true, true)
    for (const { fileName: spec } of [...info.importedFiles, ...info.referencedFiles]) {
      if (spec === '@/ee') continue
      let target: string | null = null
      if (spec === '@/ee' || spec.startsWith('@/ee/')) target = join(SRC, spec.slice(2))
      else if (spec.startsWith('.') || spec.startsWith('/')) target = resolve(dirname(f), spec)
      if (!target || !(target === EE || target.startsWith(EE + '/'))) continue
      out.push(`${relative(process.cwd(), f)} → ${spec}`)
    }
  }
  return out
}

test('the core imports ee/ only through the gateway @/ee', () => {
  const files = walk(SRC)
  assert.ok(files.length > 500)
  assert.deepEqual(eeBoundaryViolations(files), [])
  assert.ok(readFileSync(join(SRC, 'app/layout.tsx'), 'utf8').includes('from "@/ee"'))
})

test('the boundary check actually catches - direct, relative and dynamic imports', () => {
  const fake = (code: string) => eeBoundaryViolations([join(SRC, 'lib/work/x.ts')], () => code)
  assert.deepEqual(fake("import { a } from '@/ee'"), [])
  assert.equal(fake("import { a } from '@/ee/index'").length, 1)
  assert.equal(fake("import { a } from '../../ee'").length, 1)
  assert.equal(fake("const t = await import(`@/ee/approval`)").length, 1)
  assert.equal(fake("const r = require /* c */ ('@/ee/approval')").length, 1)
  assert.equal(fake("import type { T } from '@/ee/approval/types'").length, 1)
  assert.deepEqual(fake("// import x from '@/ee/approval'\n/* require('@/ee/x') */\nconst s = \"from '@/ee/x'\""), [])
  assert.equal(fake("import { a } from '@/ee/approval/request'").length, 1)
  assert.equal(fake("import { a } from '../../ee/approval/request'").length, 1)
  assert.equal(fake("const m = await import('@/ee/approval')").length, 1)
  assert.equal(fake("export { a } from '@/ee/approval'").length, 1)
  assert.deepEqual(fake("import { a } from '@/eel/x'"), [])
  assert.equal(fake(`import { a } from '${join(EE, 'approval/x')}'`).length, 1)
  assert.equal(fake('/// <reference path="../../ee/approval/types.d.ts" />').length, 1)
  assert.deepEqual(eeBoundaryViolations([join(EE, 'approval/x.ts')], () => "import { b } from '@/ee/approval/y'"), [])
})

test('ee/LICENSE = AI Talk Enterprise License (a key is required for production use) - a different license from the core Sustainable Use', () => {
  const t = readFileSync(join(EE, 'LICENSE'), 'utf8')
  assert.match(t, /^# The AI Talk Enterprise License/)
  assert.match(t, /may only be used in production, if\s+you \(and any entity that you represent\) hold a valid AI Talk Enterprise license/)
  assert.doesNotMatch(t, /n8n/i)
})
