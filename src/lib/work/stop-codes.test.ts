import { test } from 'node:test'
import { cloudOnly } from '@/lib/work/cloud-apps-for-tests'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'fs'
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
  /(?<![.\w])add\('([a-z0-9_]+)'/g,
  /BankFormatError\([^)]*?, '([a-z0-9_]+)'/g,
  /issues\.push\(\{ code: '([a-z0-9_]+)'/g,
  /\{ code: '(bank_[a-z0-9_]+)'/g,
]

const WORK_APPS = path.join(ROOT, 'work-apps')
const v2Dirs = readdirSync(WORK_APPS, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .filter((d) => { const m = /\bcore:\s*(\d+)/.exec(readFileSync(path.join(WORK_APPS, d, 'index.ts'), 'utf8')); return !!m && Number(m[1]) >= 2 })
  .filter((d) => d !== 'vat')

function codesIn(fileList: string[]): Set<string> {
  const out = new Set<string>()
  for (const f of fileList) {
    const src = readFileSync(f, 'utf8')
    for (const re of PATTERNS) for (const m of src.matchAll(re)) out.add(m[1])
  }
  return out
}

function codesInSource(): Set<string> {
  const out = codesIn([...files(path.join(ROOT, 'lib/work')), ...files(WORK_APPS).filter((f) => !v2Dirs.some((d) => f.startsWith(path.join(WORK_APPS, d) + path.sep)))])
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

test('every stop code of a core 2 app has an English text of that app (<id>.stop_<code>)', async () => {
  assert.ok(v2Dirs.includes('example'), `v2 folders: ${v2Dirs}`)
  const missing: string[] = []
  for (const d of v2Dirs) {
    const codes = codesIn(files(path.join(WORK_APPS, d)))
    const libOnly = files(path.join(WORK_APPS, d)).some((f) => readFileSync(f, 'utf8').includes("'@/work-libs/invoice'"))
    const noModules = !existsSync(path.join(WORK_APPS, d, 'modules'))
    assert.ok(codes.size > 0 || libOnly || noModules, `${d}: no stop codes found`)
    const meta = Object.values(await import(`@/work-apps/${d}/meta`)).find((v) => (v as { id?: unknown })?.id === d) as { i18n: { en: Record<string, string> } }
    for (const c of codes) if (!meta.i18n.en[`${d}.stop_${c}`]) missing.push(`${d}.stop_${c}`)
  }
  assert.deepEqual(missing, [])
})

test('every stop code of the invoice library has an English sentence in each app that uses the library', cloudOnly, async () => {
  const LIB = path.join(ROOT, 'work-libs/invoice')
  const manual = path.join(LIB, 'core/manual-payments.ts')
  const core = codesIn(files(path.join(LIB, 'core')).filter((f) => f !== manual))
  assert.ok(core.size > 20, `invoice core codes: ${core.size}`)
  const byCountry: Record<string, Set<string>> = {
    swissInvoiceCountry: codesIn(files(path.join(LIB, 'countries/ch'))),
    globalInvoiceCountry: codesIn(files(path.join(LIB, 'countries/global'))),
    makeManualPayments: codesIn([manual]),
  }
  const missing: string[] = []
  let users = 0
  for (const d of v2Dirs) {
    const src = files(path.join(WORK_APPS, d)).map((f) => readFileSync(f, 'utf8')).join('\n')
    if (!src.includes("'@/work-libs/invoice'") || !/\bmake(InvoiceModules|InvoiceTools|MonthModule|ManualPayments)\b/.test(src)) continue
    users++
    const meta = Object.values(await import(`@/work-apps/${d}/meta`)).find((v) => (v as { id?: unknown })?.id === d) as { i18n: { en: Record<string, string> } }
    const codes = new Set([...core, ...Object.entries(byCountry).filter(([name]) => src.includes(name)).flatMap(([, c]) => [...c])])
    for (const c of codes) if (!meta.i18n.en[`${d}.stop_${c}`]) missing.push(`${d}.stop_${c}`)
  }
  assert.ok(users >= 2, `apps using the invoice library: ${users}`)
  assert.deepEqual(missing, [])
})

const LIB_TEXTS: ReadonlyArray<{ file: string; user: RegExp; attention?: true }> = [
  { file: 'work-libs/invoice/core/tools.ts', user: /\bmakeInvoiceTools\b/ },
  { file: 'work-libs/invoice/core/manual-payments.ts', user: /\bmakeManualPayments\b/ },
  { file: 'work-libs/accounts/core/invoice.ts', user: /\binvoiceAccountsAttention\b/, attention: true },
]

test('every library card button and yellow line text has an English sentence in each app that uses the library', cloudOnly, async () => {
  const LIBS = path.join(ROOT, 'work-libs')
  const withLabels = files(LIBS).filter((f) => /labelKey: '/.test(readFileSync(f, 'utf8'))).map((f) => path.relative(ROOT, f))
  assert.deepEqual(withLabels.filter((f) => !LIB_TEXTS.some((x) => x.file === f)), [])
  const missing: string[] = []
  for (const x of LIB_TEXTS) {
    const src = readFileSync(path.join(ROOT, x.file), 'utf8')
    const keys = new Set([...src.matchAll(/labelKey: '([a-z0-9_]+)'/g)].map((m) => m[1]))
    if (x.attention) {
      for (const m of src.matchAll(/\bcode: '([a-z0-9_]+)'/g)) keys.add(`attention_${m[1]}`)
      for (const m of src.matchAll(/\bask: '([a-z0-9_]+)'/g)) keys.add(m[1])
    }
    assert.ok(keys.size > 0, `${x.file}: no texts found`)
    let users = 0
    for (const d of v2Dirs) {
      if (!x.user.test(files(path.join(WORK_APPS, d)).map((f) => readFileSync(f, 'utf8')).join('\n'))) continue
      users++
      const meta = Object.values(await import(`@/work-apps/${d}/meta`)).find((v) => (v as { id?: unknown })?.id === d) as { i18n: { en: Record<string, string> } }
      for (const k of keys) if (!meta.i18n.en[`${d}.${k}`]) missing.push(`${d}.${k}`)
    }
    assert.ok(users >= 2, `${x.file}: apps using it = ${users}`) // Invoices · Swiss Invoices
  }
  assert.deepEqual(missing, [])
})

test('MODULE_STOPPED is created only through moduleStop; without a stop code the screen cannot translate it and detail ends up in the response', () => {
  const direct: string[] = []
  for (const f of [...files(path.join(ROOT, 'lib/work')), ...files(path.join(ROOT, 'work-apps'))]) {
    const n = (readFileSync(f, 'utf8').match(/new\s+WorkError\s*\(\s*['"`]MODULE_STOPPED['"`]/g) ?? []).length
    const allowed = /\/lib\/work\/module-stop\.ts$/.test(f) ? 1 : 0
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
