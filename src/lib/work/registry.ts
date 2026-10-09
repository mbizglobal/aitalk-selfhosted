
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
const MORE_LANGS = ['de', 'fr', 'ko'] as const
const RESERVED_V2 = ['work', 'vat', 'bank']

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
    if (!Number.isInteger(p.core) || p.core < 1 || p.core > WORK_APP_CORE_API) fail(`${p.id} needs core ${String(p.core)}, this core supports 1..${WORK_APP_CORE_API}`)
    if (p.meta?.id !== p.id) fail(`${p.id}: meta id "${String(p.meta?.id)}"`)
    if (p.core >= 2) for (const m of p.modules) if (m.kind === 'calc' && m.prepare) fail(`${p.id}: module ${m.id} — prepare is for core 1 packages only`)
    const kinds = p.appTemplates.map((a) => a.kind)
    for (const k of kinds) if (!isId(k)) fail(`${p.id}: bad app template name "${String(k)}"`)
    if (!sameSet(kinds, p.meta.appTemplateKinds)) fail(`${p.id}: meta app templates [${p.meta.appTemplateKinds}] ≠ [${kinds}]`)
    if (!sameSet(Object.keys(p.meta.features), kinds)) fail(`${p.id}: features must cover exactly [${kinds}]`)
    if (!p.meta.i18n?.en || typeof p.meta.i18n.en !== 'object') fail(`${p.id}: i18n.en is missing`)
    const keys = Object.keys(p.meta.i18n.en)
    if (keys.some((k) => !k)) fail(`${p.id}: empty i18n key`)
    const noEmpty = (d: Readonly<Record<string, string>>, l: string) => { for (const [k, v] of Object.entries(d)) if (typeof v !== 'string' || !v) fail(`${p.id}: i18n.${l} ${k} is empty`) }
    noEmpty(p.meta.i18n.en, 'en')
    for (const l of MORE_LANGS) {
      const d = p.meta.i18n[l]
      if (d === undefined) continue
      if (!d || typeof d !== 'object') fail(`${p.id}: i18n.${l} is not a dictionary`)
      if (!sameSet(Object.keys(d), keys)) fail(`${p.id}: i18n keys differ between languages (${l})`)
      noEmpty(d, l)
    }
    for (const m of p.modules) {
      if (!m.title?.en || !m.description?.en) fail(`${p.id}: module ${m.id} needs an English title and description`)
      for (const l of MORE_LANGS) if ((m.title[l] !== undefined && !m.title[l]) || (m.description[l] !== undefined && !m.description[l])) fail(`${p.id}: module ${m.id} has an empty ${l} title or description`)
    }
    checkFeatures(p)
    if (p.core >= 2) checkNames(p, keys)
  }

  const d = (what: string, xs: readonly string[]) => { const x = dupes(xs); if (x.length) fail(`duplicate ${what}: ${x.join(', ')}`) }
  d('package id', packages.map((p) => p.id))
  for (const a of packages) for (const b of packages) {
    if (a !== b && (a.core >= 2 || b.core >= 2) && b.id.startsWith(`${a.id}-`)) fail(`package ids ${a.id} and ${b.id} — one is a prefix of the other`)
  }
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

function checkNames(p: WorkAppPackage, i18nKeys: readonly string[]): void {
  if (RESERVED_V2.includes(p.id)) fail(`package id "${p.id}" is reserved`)
  const own = (x: unknown) => typeof x === 'string' && x.startsWith(`${p.id}.`) && x.length > p.id.length + 1
  for (const k of i18nKeys) if (!own(k)) fail(`${p.id}: i18n key "${k}" must start with "${p.id}."`)
  for (const m of p.modules) if (!own(m.id)) fail(`${p.id}: module id "${String(m.id)}" must start with "${p.id}."`)
  for (const t of p.sheetTemplates) {
    if (!own(t.name)) fail(`${p.id}: sheet template "${String(t.name)}" must start with "${p.id}."`)
    if (!own(t.family)) fail(`${p.id}: sheet family "${String(t.family)}" must start with "${p.id}."`)
  }
  for (const a of p.appTemplates) if (a.kind !== p.id && !a.kind.startsWith(`${p.id}-`)) fail(`${p.id}: app template name "${a.kind}" must be "${p.id}" or start with "${p.id}-"`)
}

function checkFeatures(p: WorkAppPackage): void {
  for (const a of p.appTemplates) {
    const f = p.meta.features[a.kind]
    for (const x of [...f.available, ...f.planned]) {
      if (!x.id) fail(`${a.kind}: feature without id`)
      if (!x.label?.en) fail(`${a.kind}: feature ${x.id} has no en label`)
      for (const l of MORE_LANGS) if (x.label[l] !== undefined && !x.label[l]) fail(`${a.kind}: feature ${x.id} has an empty ${l} label`)
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

export function packageCoreOfModule(moduleId: string): number | null {
  return workAppRegistry().packages.find((p) => p.modules.some((m) => m.id === moduleId))?.core ?? null
}
export function packageCoreOfKind(kind: string): number | null {
  return workAppRegistry().packages.find((p) => p.appTemplates.some((a) => a.kind === kind))?.core ?? null
}
