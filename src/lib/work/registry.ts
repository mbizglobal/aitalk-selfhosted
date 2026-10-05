
import type { WorkAppFactory, WorkAppPackage } from './package'
import { WORK_APP_METAS, type WorkAppMeta } from './package-meta'
import { WORK_APP_CORE_API } from './package-api'
import { workTranslations as coreWorkTranslations } from '@/lib/translations/work/en'
import type { AppTemplate } from './app-templates'
import type { SheetTemplate } from './sheet-templates'
import { templateId, validateTemplateRegistry } from './sheet-templates'
import type { WorkModule } from './modules'
import { validateModuleRegistry } from './modules'
import { BUILTIN_WORK_APPS } from '@/work-apps/builtin'
import { CUSTOM_WORK_APPS } from '@/work-apps/custom'

export interface WorkAppRegistry {
  packages: readonly WorkAppPackage[]
  appTemplates: readonly AppTemplate[]
  sheetTemplates: readonly SheetTemplate[]
  modules: readonly WorkModule[]
}

const ID_RE = /^[a-z][a-z0-9-]*$/
const LANGS = ['en', 'de', 'fr', 'ko'] as const

function fail(msg: string): never {
  throw new Error(`work app registry: ${msg}`)
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  Array.isArray(a) && Array.isArray(b) && JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())
const isId = (v: unknown): v is string => typeof v === 'string' && ID_RE.test(v)

function dupes(xs: readonly string[]): string[] {
  const seen = new Set<string>()
  return [...new Set(xs.filter((x) => (seen.has(x) ? true : (seen.add(x), false))))]
}

export function composeWorkApps(factories: readonly WorkAppFactory[], metas: readonly WorkAppMeta[]): WorkAppRegistry {
  try {
    return compose(factories, metas)
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('work app registry:')) throw e
    fail(`malformed package — ${e instanceof Error ? e.message : String(e)}`)
  }
}

function compose(factories: readonly WorkAppFactory[], metas: readonly WorkAppMeta[]): WorkAppRegistry {
  const packages = factories.map((f) => f())

  for (const p of packages) {
    if (!isId(p.id)) fail(`bad package id "${String(p.id)}"`)
    if (p.id === 'work') fail('package id "work" is reserved for the core')
    if (p.core !== WORK_APP_CORE_API) fail(`${p.id} needs core ${p.core}, this core is ${WORK_APP_CORE_API}`)
    if (p.meta?.id !== p.id) fail(`${p.id}: meta id "${String(p.meta?.id)}"`)
    const kinds = p.appTemplates.map((a) => a.kind)
    for (const k of kinds) if (!isId(k)) fail(`${p.id}: bad app template name "${String(k)}"`)
    if (!sameSet(kinds, p.meta.appTemplateKinds)) fail(`${p.id}: meta app templates [${p.meta.appTemplateKinds}] ≠ [${kinds}]`)
    if (!sameSet(Object.keys(p.meta.features), kinds)) fail(`${p.id}: features must cover exactly [${kinds}]`)
    for (const l of LANGS) if (!p.meta.i18n?.[l] || typeof p.meta.i18n[l] !== 'object') fail(`${p.id}: i18n.${l} is missing`)
    const keys = Object.keys(p.meta.i18n.en)
    if (keys.some((k) => !k)) fail(`${p.id}: empty i18n key`)
    for (const l of LANGS) if (!sameSet(Object.keys(p.meta.i18n[l]), keys)) fail(`${p.id}: i18n keys differ between languages (${l})`)
    checkFeatures(p)
  }

  const d = (what: string, xs: readonly string[]) => { const x = dupes(xs); if (x.length) fail(`duplicate ${what}: ${x.join(', ')}`) }
  d('package id', packages.map((p) => p.id))
  if (metas.length !== packages.length || metas.some((m, i) => m?.id !== packages[i].id)) fail(`meta lists [${metas.map((m) => String(m?.id))}] ≠ packages [${packages.map((p) => p.id)}]`)
  for (const m of metas) if (m !== packages.find((p) => p.id === m.id)!.meta) fail(`${m.id}: meta list holds a different meta object than the package`)

  const appTemplates = packages.flatMap((p) => p.appTemplates)
  const sheetTemplates = packages.flatMap((p) => p.sheetTemplates)
  const modules = packages.flatMap((p) => p.modules)
  d('app template', appTemplates.map((a) => a.kind))
  d('module', modules.map((m) => m.id))
  d('i18n key', packages.flatMap((p) => Object.keys(p.meta.i18n.en)))
  for (const k of packages.flatMap((p) => Object.keys(p.meta.i18n.en))) if (k in coreWorkTranslations) fail(`i18n key ${k} is also a core key`)
  validateTemplateRegistry(sheetTemplates)
  validateModuleRegistry(modules, sheetTemplates)
  const sheetIds = new Set(sheetTemplates.map(templateId))
  for (const p of packages) {
    const names = (p.tools ?? []).map((t) => t?.def?.name)
    for (const n of names) if (typeof n !== 'string' || !n.startsWith(`${p.id}_`) || n.length <= p.id.length + 1) fail(`${p.id}: tool name "${String(n)}" must start with "${p.id}_"`)
    for (const t of p.tools ?? []) if (typeof t.run !== 'function') fail(`${p.id}: tool ${t.def.name} has no run`)
    for (const m of p.modules) if (m.aiVia !== undefined && !names.includes(m.aiVia)) fail(`${p.id}: module ${m.id} aiVia ${m.aiVia} is not one of its tools`)
  }
  d('tool', packages.flatMap((p) => (p.tools ?? []).map((t) => t.def.name)))
  for (const a of appTemplates) {
    for (const id of a.modules) if (!modules.some((m) => m.id === id)) fail(`${a.kind}: module ${id} is not registered`)
    for (const s of a.sheets) if (!sheetIds.has(s.template)) fail(`${a.kind}: sheet template ${s.template} is not registered`)
    const families = new Set(a.sheets.map((s) => sheetTemplates.find((t) => templateId(t) === s.template)!.family))
    for (const f of a.globalFamilies) if (!families.has(f)) fail(`${a.kind}: global family ${f} is not among its sheets`)
    if (a.calcModule) {
      if (!a.modules.includes(a.calcModule.id)) fail(`${a.kind}: calc module ${a.calcModule.id} is not among its modules`)
      if (modules.find((m) => m.id === a.calcModule!.id) !== a.calcModule) fail(`${a.kind}: calc module ${a.calcModule.id} is not the registered module`)
    }
  }
  return { packages, appTemplates, sheetTemplates, modules }
}

function checkFeatures(p: WorkAppPackage): void {
  for (const a of p.appTemplates) {
    const f = p.meta.features[a.kind]
    for (const x of [...f.available, ...f.planned]) {
      if (!x.id) fail(`${a.kind}: feature without id`)
      for (const l of LANGS) if (!x.label?.[l]) fail(`${a.kind}: feature ${x.id} has no ${l} label`)
    }
    const dup = dupes([...f.available, ...f.planned].map((x) => x.id))
    if (dup.length) fail(`${a.kind}: feature listed twice: ${dup.join(', ')}`)
    if (!sameSet(f.available.filter((x) => x.module).map((x) => x.id), a.modules)) fail(`${a.kind}: available module features must be exactly its modules [${a.modules}]`)
    for (const x of [...f.available, ...f.planned]) if (x.partOf !== undefined && !a.modules.includes(x.partOf)) fail(`${a.kind}: feature ${x.id} is part of ${x.partOf}, not one of its modules`)
  }
}

let registry: WorkAppRegistry | null = null

export function workAppRegistry(): WorkAppRegistry {
  return (registry ??= composeWorkApps([...BUILTIN_WORK_APPS, ...CUSTOM_WORK_APPS], WORK_APP_METAS))
}

export const appTemplates = (): readonly AppTemplate[] => workAppRegistry().appTemplates
export const builtinSheetTemplates = (): readonly SheetTemplate[] => workAppRegistry().sheetTemplates
export const workModules = (): readonly WorkModule[] => workAppRegistry().modules
