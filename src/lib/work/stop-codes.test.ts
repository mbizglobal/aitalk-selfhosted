import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'fs'
import path from 'path'
import { workDict, workStopText } from '@/lib/translations/work'

const en = workDict('en'), de = workDict('de'), fr = workDict('fr'), ko = workDict('ko')
const ROOT = path.join(process.cwd(), 'src')
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? files(p) : /\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [p] : []
  })

const PATTERNS = [
  /moduleStop\('([a-z0-9_]+)'/g,
  /coreStop\('([a-z0-9_]+)'/g,
  /note\(st, '([a-z0-9_]+)'/g,
  /\bg?note\('([a-z0-9_]+)'/g,
  /\badd\('([a-z0-9_]+)'/g,
  /BankFormatError\([^)]*?, '([a-z0-9_]+)'/g,
  /issues\.push\(\{ code: '([a-z0-9_]+)'/g,
  /\{ code: '(bank_[a-z0-9_]+)'/g,
]

function codesInSource(): Set<string> {
  const out = new Set<string>()
  for (const f of [...files(path.join(ROOT, 'lib/work')), ...files(path.join(ROOT, 'work-apps'))]) {
    const src = readFileSync(f, 'utf8')
    for (const re of PATTERNS) for (const m of src.matchAll(re)) out.add(m[1])
  }
  out.add('bank_format')
  return out
}

test('every stop code in the source has a stop_<code> translation in all four languages', () => {
  const codes = codesInSource()
  assert.ok(codes.size > 40, `codes found: ${codes.size}`)
  const dicts = { en, de, fr, ko } as Record<string, Record<string, string>>
  const missing: string[] = []
  for (const c of codes) for (const [l, d] of Object.entries(dicts)) if (!d[`stop_${c}`]) missing.push(`${l}:stop_${c}`)
  assert.deepEqual(missing, [])
})

test('MODULE_STOPPED is created only through moduleStop; without a stop code the screen cannot translate it and detail ends up in the response', () => {
  const direct: string[] = []
  for (const f of [...files(path.join(ROOT, 'lib/work')), ...files(path.join(ROOT, 'work-apps'))]) {
    const n = (readFileSync(f, 'utf8').match(/new\s+WorkError\s*\(\s*['"`]MODULE_STOPPED['"`]/g) ?? []).length
    const allowed = /\/lib\/work\/modules\.ts$/.test(f) ? 1 : 0
    if (n !== allowed) direct.push(`${path.relative(ROOT, f)}: ${n}`)
  }
  assert.deepEqual(direct, [])
})

test('the {placeholder} in translated sentences is the same in every language', () => {
  const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join()
  for (const k of Object.keys(en).filter((x) => x.startsWith('stop_'))) {
    for (const [l, d] of Object.entries({ de, fr, ko } as Record<string, Record<string, string>>)) {
      assert.equal(holes(d[k]), holes((en as Record<string, string>)[k]), `${l}:${k}`)
    }
  }
})

test('workStopText: fills placeholders, and frame-family values use screen names', () => {
  assert.equal(workStopText('ko', { code: 'effective_same_day', params: { sheet: 'vat.basis' } }), `「${(ko as Record<string, string>)['sheet_vat.basis']}」 에 같은 날 시작하는 줄이 둘 있습니다. 하나만 남겨 주세요.`)
  assert.match(workStopText('en', { code: 'bank_line_columns', params: { line: 7 } })!, /Line 7 /)
  assert.equal(workStopText('en', { code: 'no_such_code' }), null)
})
