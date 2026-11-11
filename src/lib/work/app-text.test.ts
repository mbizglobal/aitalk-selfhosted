import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appWorkText } from './app-text'
import { workDict, workStopText, workT, type WorkLang } from '@/lib/translations/work'
import { WORK_APP_METAS } from './package-meta'

const LANGS: WorkLang[] = ['en', 'de', 'fr', 'ko']
function appLookup(text: Readonly<Record<string, string>>, key: string, pkg: string | null, fallback?: string): string {
  if (key.startsWith('sheet_core.')) key = `sheet_core_${key.slice('sheet_core.'.length)}`
  return (pkg && pkg !== 'core' ? text[`${pkg}.${key}`] : undefined) ?? text[key] ?? fallback ?? key
}

test('every key x every package x four languages - same as the web workT (including fallback text)', () => {
  const keys = Object.keys(workDict('en'))
  const pkgs = [null, 'core', ...WORK_APP_METAS.map((m) => m.id)]
  const asked = new Set<string>(keys)
  for (const k of keys) { const i = k.indexOf('.'); if (i > 0) asked.add(k.slice(i + 1)) }
  asked.add('sheet_core.handoff')
  asked.add('no_such_key_anywhere')
  for (const lang of LANGS) {
    const { text } = appWorkText(lang)
    for (const pkg of pkgs) for (const k of asked) assert.equal(appLookup(text, k, pkg, 'FB'), workT(lang, k, 'FB', pkg), `${lang} ${pkg} ${k}`)
  }
})

test('stop reasons - filling params found again by paramKeys gives the same as the web workStopText', () => {
  for (const lang of LANGS) {
    const { text, paramKeys } = appWorkText(lang)
    for (const k of Object.keys(text).filter((x) => x.startsWith('stop_') || x.includes('.stop_'))) {
      const code = k.slice(k.indexOf('stop_') + 5)
      const pkg = k.includes('.') ? k.slice(0, k.indexOf('.')) : null
      const params = { sheet: 'receipts.bills', column: 'amount', count: 3, row: 7, module: 'receipts.month-summary' }
      const tpl = appLookup(text, `stop_${code}`, pkg)
      const mine = tpl.replace(/\{(\w+)\}/g, (m, name: string) => {
        const v = (params as Record<string, unknown>)[name]
        if (v === undefined || v === null) return m
        const pre = paramKeys[name]
        return pre !== undefined ? appLookup(text, `${pre}${String(v)}`, pkg, String(v)) : String(v)
      })
      assert.equal(mine, workStopText(lang, { code, params }, pkg), `${lang} ${k}`)
    }
  }
})

test('stop reason templates have no empty text - app rule (empty = no reason) and the web workStopText do not diverge', () => {
  for (const lang of LANGS) for (const [k, v] of Object.entries(appWorkText(lang).text)) if (k.includes('stop_')) assert.notEqual(v.trim(), '', `${lang} ${k}`)
})

test('same content = same version - differs per language - no empty text', () => {
  assert.equal(appWorkText('de').version, appWorkText('de').version)
  assert.notEqual(appWorkText('de').version, appWorkText('ko').version)
  for (const lang of LANGS) assert.ok(Object.values(appWorkText(lang).text).every((v) => typeof v === 'string'))
})
