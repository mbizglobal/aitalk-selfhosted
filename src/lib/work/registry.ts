
import { WORK_LIBS } from '@/work-libs/versions'
import { WORK_LIB_I18N } from '@/work-libs/i18n'
import type { WorkAppFactory, WorkAppPackage } from './package'
import { WORK_APP_METAS, type WorkAppMeta } from './package-meta'
import { CUSTOM_WORK_APP_METAS } from '@/work-apps/custom-meta'
import { WORK_APP_CORE_API } from './package-api'
import { workTranslations as coreWorkTranslations } from '@/lib/translations/work/en'
import type { AppTemplate } from './app-templates'
import type { FilterFrom, SheetTemplate } from './sheet-templates'
import { DERIVED_COLUMN_TYPES, FILTERS_MAX, filtersOf, templateId, validateTemplateRegistry } from './sheet-templates'
import type { WorkModule } from './modules'
import { parseNeed, validateModuleRegistry } from './modules'
import { CONNECTION_KINDS, DB_ENGINES, DB_MAX_ROWS_LIMIT, isSendQuery, type DbEngine } from './uses'
import { mssqlQueryFacts } from './ai-sql-check'
import { HANDOFF_FAMILY, handoffSheetTemplate } from './handoff-core'
import { normalizeWorkCountry } from './countries'
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
const LEGACY_NAMES = ['vat']

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

export function composeWorkApps(factories: readonly WorkAppFactory[], metas: readonly WorkAppMeta[], customIds: ReadonlySet<string> = new Set()): WorkAppRegistry {
  try {
    return compose(factories, metas, customIds)
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('work app registry:')) throw e
    fail(`malformed package — ${e instanceof Error ? e.message : String(e)}`)
  }
}

function compose(factories: readonly WorkAppFactory[], metas: readonly WorkAppMeta[], customIds: ReadonlySet<string>): WorkAppRegistry {
  const packages = factories.map((f) => f())

  for (const p of packages) {
    if (!isId(p.id)) fail(`bad package id "${String(p.id)}"`)
    if (p.id === 'work') fail('package id "work" is reserved for the core')
    if (!Number.isInteger(p.core) || p.core < 1 || p.core > WORK_APP_CORE_API) fail(`${p.id} needs core ${String(p.core)}, this core supports 1..${WORK_APP_CORE_API}`)
    for (const [name, v] of Object.entries(p.libs ?? {})) {
      const lib = Object.hasOwn(WORK_LIBS, name) ? WORK_LIBS[name] : undefined
      if (!lib) fail(`${p.id}: unknown library "${name}"`)
      else if (!Number.isInteger(v) || v < 1 || v > lib.api) fail(`${p.id} needs library ${name} ${String(v)}, this build has 1..${lib.api}`)
    }
    if (p.meta?.id !== p.id) fail(`${p.id}: meta id "${String(p.meta?.id)}"`)
    if (p.core >= 2) for (const m of p.modules) if (m.kind === 'calc' && m.prepare) fail(`${p.id}: module ${m.id} — prepare is for core 1 packages only`)
    if (p.core < 8) for (const m of p.modules) if (m.kind === 'calc' && m.fetchFxMonthly !== undefined) fail(`${p.id}: module ${m.id} — fetchFxMonthly needs core 8`)
    for (const m of p.modules) if (m.kind === 'calc' && m.fetchFxMonthly !== undefined && m.fetchFxMonthly !== true) fail(`${p.id}: module ${m.id} — fetchFxMonthly must be true`)
    if (customIds.has(p.id) && RESERVED_V2.includes(p.id)) fail(`package id "${p.id}" is reserved`)
    if (p.core < 5) for (const t of p.sheetTemplates) if (t.confirm?.before) fail(`${p.id}: sheet template ${t.name} — confirm.before needs core 5`)
    if (p.core < 7) for (const t of p.sheetTemplates) if (t.confirm?.byModule || t.deleteRule) fail(`${p.id}: sheet template ${t.name} — confirm.byModule and deleteRule need core 7`)
    for (const t of p.sheetTemplates) if (t.ui?.derivedFrom !== undefined) checkDerived(p, t)
    for (const t of p.sheetTemplates) if (t.ui?.filterFrom !== undefined) checkFilterFrom(p, t)
    for (const t of p.sheetTemplates) if (t.ui?.choicesFrom !== undefined) checkChoicesFrom(p, t)
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
    checkCountriesAndPublisher(p, customIds.has(p.id))
    if (p.core >= 2 && !(LEGACY_NAMES.includes(p.id) && !customIds.has(p.id))) checkNames(p, keys)
    if (p.core >= 3) checkUses(p)
    else if (p.meta.uses !== undefined || p.dbQueries !== undefined) fail(`${p.id}: uses / dbQueries need core 3`)
    if (p.meta.shared !== undefined) {
      if (p.core < 6) fail(`${p.id}: meta shared needs core 6`)
      if (!Array.isArray(p.meta.shared) || p.meta.shared.length === 0 || dupes(p.meta.shared.map(String)).length) fail(`${p.id}: meta shared must be a non-empty list without repeats`)
      for (const k of p.meta.shared) if (!kinds.includes(k)) fail(`${p.id}: meta shared "${String(k)}" is not one of its app templates`)
    }
    if (p.meta.companyBook !== undefined) {
      if (p.core < 7) fail(`${p.id}: meta companyBook needs core 7`)
      if (!Array.isArray(p.meta.companyBook) || p.meta.companyBook.length === 0 || dupes(p.meta.companyBook.map(String)).length) fail(`${p.id}: meta companyBook must be a non-empty list without repeats`)
      for (const k of p.meta.companyBook) if (!kinds.includes(k)) fail(`${p.id}: meta companyBook "${String(k)}" is not one of its app templates`)
    }
  }

  const d = (what: string, xs: readonly string[]) => { const x = dupes(xs); if (x.length) fail(`duplicate ${what}: ${x.join(', ')}`) }
  d('package id', packages.map((p) => p.id))
  for (const a of packages) for (const b of packages) {
    if (a !== b && (a.core >= 2 || b.core >= 2) && b.id.startsWith(`${a.id}-`)) fail(`package ids ${a.id} and ${b.id} — one is a prefix of the other`)
  }
  if (metas.length !== packages.length || metas.some((m, i) => m?.id !== packages[i].id)) fail(`meta lists [${metas.map((m) => String(m?.id))}] ≠ packages [${packages.map((p) => p.id)}]`)
  for (const m of metas) if (m !== packages.find((p) => p.id === m.id)!.meta) fail(`${m.id}: meta list holds a different meta object than the package`)

  const appTemplates = packages.flatMap((p) => p.appTemplates)
  for (const p of packages) for (const t of p.sheetTemplates) {
    if (String(t.name).startsWith('core.') || String(t.family).startsWith('core.')) fail(`${p.id}: sheet template "${String(t.name)}" — the "core." names belong to the core`)
  }
  const sheetTemplates = [...packages.flatMap((p) => p.sheetTemplates), handoffSheetTemplate]
  const modules = packages.flatMap((p) => p.modules)
  d('app template', appTemplates.map((a) => a.kind))
  d('module', modules.map((m) => m.id))
  d('i18n key', packages.flatMap((p) => Object.keys(p.meta.i18n.en)))
  for (const k of packages.flatMap((p) => Object.keys(p.meta.i18n.en))) if (k in coreWorkTranslations) fail(`i18n key ${k} is also a core key`)
  const libKeys = new Set(Object.values(WORK_LIB_I18N).flatMap((d) => Object.keys(d.en)))
  for (const k of packages.flatMap((p) => Object.keys(p.meta.i18n.en))) if (libKeys.has(k)) fail(`i18n key ${k} is also a library key`)
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
    if (a.handoff !== undefined && typeof a.handoff?.export !== 'function') fail(`${a.kind}: handoff.export must be a function`)
    if (a.sheets.filter((s) => s.template.startsWith(`${HANDOFF_FAMILY}@`)).length > 1) fail(`${a.kind}: the ${HANDOFF_FAMILY} sheet is listed twice`)
    if (a.calcModule) {
      if (!a.modules.includes(a.calcModule.id)) fail(`${a.kind}: calc module ${a.calcModule.id} is not among its modules`)
      if (modules.find((m) => m.id === a.calcModule!.id) !== a.calcModule) fail(`${a.kind}: calc module ${a.calcModule.id} is not the registered module`)
    }
  }
  return { packages, appTemplates, sheetTemplates, modules }
}

const DERIVED_NAME_RE = /^[a-z][A-Za-z0-9]*$/

function checkDerived(p: WorkAppPackage, t: SheetTemplate): void {
  const where = `${p.id}: sheet template ${t.name} ui.derivedFrom`
  if (p.core < 5) fail(`${where} needs core 5`)
  const spec = t.ui!.derivedFrom!
  const m = p.modules.find((x) => x.id === spec?.module)
  if (!m) fail(`${where} — module "${String(spec?.module)}" is not a module of this package`)
  if (m.kind === 'calc' || typeof m.screenRows !== 'function') fail(`${where} — module ${m.id} must be an action module with screenRows`)
  if (!Array.isArray(spec.columns) || spec.columns.length === 0) fail(`${where} — columns must be a non-empty list`)
  const stored = new Set(t.columns.map((c) => c.name))
  const names = spec.columns.map((c) => c?.name)
  if (dupes(names.map(String)).length) fail(`${where} — column listed twice: ${dupes(names.map(String)).join(', ')}`)
  for (const c of spec.columns) {
    if (typeof c?.name !== 'string' || !DERIVED_NAME_RE.test(c.name)) fail(`${where} — bad column name "${String(c?.name)}"`)
    if (stored.has(c.name)) fail(`${where} — column ${c.name} is also a stored column`)
    if (!(DERIVED_COLUMN_TYPES as readonly string[]).includes(c.type)) fail(`${where} — column ${c.name} type "${String(c.type)}"`)
    if (typeof c.label !== 'string' || !(`${p.id}.${c.label}` in p.meta.i18n.en)) fail(`${where} — column ${c.name} label "${String(c.label)}" is not an i18n key`)
    if (c.replaces !== undefined && (typeof c.replaces !== 'string' || !stored.has(c.replaces))) fail(`${where} — column ${c.name} replaces "${String(c.replaces)}", not a stored column`)
  }
}

function checkChoicesFrom(p: WorkAppPackage, t: SheetTemplate): void {
  const where = `${p.id}: sheet template ${t.name} ui.choicesFrom`
  if (p.core < 10) fail(`${where} needs core 10`)
  const spec = t.ui!.choicesFrom!
  const m = p.modules.find((x) => x.id === spec?.module)
  if (!m) fail(`${where} — module "${String(spec?.module)}" is not a module of this package`)
  if (m.kind === 'calc' || typeof m.screenChoices !== 'function') fail(`${where} — module ${m.id} must be an action module with screenChoices`)
  if (!Array.isArray(spec.columns) || spec.columns.length === 0) fail(`${where} — columns must be a non-empty list`)
  if (dupes(spec.columns.map(String)).length) fail(`${where} — column listed twice: ${dupes(spec.columns.map(String)).join(', ')}`)
  const stored = new Set(t.columns.map((c) => c.name))
  const items = new Set(t.ui?.details?.columns ?? [])
  for (const c of spec.columns) if (typeof c !== 'string' || !(stored.has(c) || items.has(c))) fail(`${where} — column "${String(c)}" is not a column or a details column`)
  for (const [c, f] of Object.entries(spec.follow ?? {})) {
    if (!spec.columns.includes(c)) fail(`${where} — follow ${c} is not one of columns`)
    if (typeof f?.from !== 'string' || f.from === c || !(stored.has(f.from) || items.has(f.from))) fail(`${where} — follow ${c} from "${String(f?.from)}" is not another column or details column`)
    if ((stored.has(c) && !stored.has(f.from)) || (items.has(c) && !items.has(f.from))) fail(`${where} — follow ${c} from ${f.from}: both must be row columns or both details columns`)
  }
}

function checkFilterFrom(p: WorkAppPackage, t: SheetTemplate): void {
  const list = filtersOf(t)
  if (list.length === 0 || list.length > FILTERS_MAX) fail(`${p.id}: sheet template ${t.name} ui.filterFrom — 1 to ${FILTERS_MAX} pickers`)
  list.forEach((spec, i) => checkOneFilter(p, t, spec, `${p.id}: sheet template ${t.name} ui.filterFrom[${i}]`))
}
function checkOneFilter(p: WorkAppPackage, t: SheetTemplate, spec: FilterFrom, where: string): void {
  if (typeof spec?.label !== 'string' || !(`${p.id}.${spec.label}` in p.meta.i18n.en)) fail(`${where} — label "${String(spec?.label)}" is not an i18n key`)
  if ('column' in spec) {
    if ('module' in spec) fail(`${where} — give module or column, not both`)
    if (!t.search?.keys?.includes(spec.column)) fail(`${where} — column ${String(spec.column)} must be one of search.keys`)
    return
  }
  if (p.core < 7) fail(`${where} needs core 7`)
  const m = p.modules.find((x) => x.id === spec?.module)
  if (!m) fail(`${where} — module "${String(spec?.module)}" is not a module of this package`)
  if (m.kind === 'calc' || typeof m.screenFilter !== 'function') fail(`${where} — module ${m.id} must be an action module with screenFilter`)
}

function checkCountriesAndPublisher(p: WorkAppPackage, custom: boolean): void {
  const c: unknown = p.meta.countries
  if (c !== undefined && c !== 'all') {
    if (!Array.isArray(c) || c.length === 0) fail(`${p.id}: countries must be 'all' or a non-empty list of country codes`)
    const codes = c.map((x) => {
      const code = normalizeWorkCountry(x)
      if (!code) fail(`${p.id}: unknown country "${String(x)}" — add it to src/lib/work/countries.ts first`)
      return code
    })
    if (dupes(codes).length) fail(`${p.id}: duplicate country ${dupes(codes).join(', ')}`)
  }
  const pub: unknown = p.meta.publisher
  if (pub !== undefined) {
    if (custom) fail(`${p.id}: a company's own package does not set publisher`)
    const v = pub as { kind?: unknown; name?: unknown } | null
    if (!v || v.kind !== 'community' || typeof v.name !== 'string' || !v.name.trim()) fail(`${p.id}: publisher must be { kind: 'community', name: '<non-empty>' }`)
  }
}

export function packageCountries(meta: WorkAppMeta): 'all' | string[] {
  if (meta.countries === undefined || meta.countries === 'all') return 'all'
  return meta.countries.map((x) => normalizeWorkCountry(x) ?? fail(`${meta.id}: unknown country "${String(x)}"`))
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

function checkUses(p: WorkAppPackage): void {
  const uses = p.meta.uses ?? {}
  const label = (where: string, key: unknown) => {
    if (typeof key !== 'string' || !(key in p.meta.i18n.en)) fail(`${p.id}: ${where} label "${String(key)}" is not an i18n key`)
  }
  const own = (x: unknown) => typeof x === 'string' && x.startsWith(`${p.id}.`) && x.length > p.id.length + 1
  const isBool = (v: unknown) => v === undefined || typeof v === 'boolean'
  const sendIds: string[] = []
  const queryIds: string[] = []
  const queryInfo = new Map<string, { engine: DbEngine; mode: 'read' | 'write' }>()
  for (const kind of Object.keys(uses)) {
    const a = p.appTemplates.find((x) => x.kind === kind)
    if (!a) fail(`${p.id}: uses for unknown app template "${kind}"`)
    const u = uses[kind]
    if (!u || typeof u !== 'object') fail(`${p.id}: uses.${kind} is not an object`)
    if (!isBool(u.webSearch) || !isBool(u.knowledge)) fail(`${p.id}: uses.${kind} webSearch / knowledge must be true or false`)

    const conns = u.connections ?? []
    if (!Array.isArray(conns)) fail(`${p.id}: uses.${kind}.connections is not a list`)
    for (const c of conns) {
      if (!isId(c?.id)) fail(`${p.id}: uses.${kind} connection id "${String(c?.id)}"`)
      if (!(CONNECTION_KINDS as readonly string[]).includes(c.kind)) fail(`${p.id}: uses.${kind} connection ${c.id} kind "${String(c.kind)}"`)
      if (c.kind === 'database' ? 'engine' in c && !(DB_ENGINES as readonly string[]).includes(c.engine as string) : c.engine !== undefined) fail(`${p.id}: uses.${kind} connection ${c.id} engine "${String(c.engine)}"`)
      label(`uses.${kind} connection ${c.id}`, c.label)
      if (c.hint !== undefined) label(`uses.${kind} connection ${c.id} hint`, c.hint)
    }
    const dupConn = dupes(conns.map((c) => c.id))
    if (dupConn.length) fail(`${p.id}: uses.${kind} connection listed twice: ${dupConn.join(', ')}`)
    const conn = (id: unknown) => conns.find((c) => c.id === id)

    const queries = u.dbQueries ?? []
    if (!Array.isArray(queries)) fail(`${p.id}: uses.${kind}.dbQueries is not a list`)
    for (const q of queries) {
      if (!own(q?.id)) fail(`${p.id}: db query id "${String(q?.id)}" must start with "${p.id}."`)
      if (conn(q.via)?.kind !== 'database') fail(`${p.id}: db query ${q.id} via "${String(q.via)}" is not a database connection of ${kind}`)
      if (!conn(q.via)!.engine) fail(`${p.id}: db query ${q.id} — slot "${String(q.via)}" has no engine; a slot needs an engine to run queries written in the app`)
      if (q.mode !== 'read' && q.mode !== 'write') fail(`${p.id}: db query ${q.id} mode "${String(q.mode)}"`)
      label(`db query ${q.id}`, q.label)
      queryIds.push(q.id)
      queryInfo.set(q.id, { engine: conn(q.via)!.engine!, mode: q.mode })
    }

    const settingNames = new Set(a.ui.settings.map((f) => f.name))
    const sends = u.sends ?? []
    if (!Array.isArray(sends)) fail(`${p.id}: uses.${kind}.sends is not a list`)
    for (const x of sends) {
      if (!own(x?.id)) fail(`${p.id}: send id "${String(x?.id)}" must start with "${p.id}."`)
      if (!isBool(x.auto)) fail(`${p.id}: send ${x.id} auto must be true or false`)
      label(`send ${x.id}`, x.label)
      sendIds.push(x.id)
      if (isSendQuery(x)) {
        const q = queries.find((y) => y.id === x.query)
        if (!q || q.mode !== 'write') fail(`${p.id}: send ${x.id} query "${x.query}" is not a write query of ${kind}`)
        if (x.auto) fail(`${p.id}: send ${x.id} writes to a database — database writes are always cards, auto must be false`)
        continue
      }
      const c = conn(x.via)
      if (!c || c.kind === 'database') fail(`${p.id}: send ${x.id} via "${String(x.via)}" is not a sending connection of ${kind}`)
      const to = x.to as unknown
      if (!to || typeof to !== 'object') fail(`${p.id}: send ${x.id} needs to: { setting } or { fixed }`)
      if ('setting' in to) {
        if (!settingNames.has((to as { setting: string }).setting)) fail(`${p.id}: send ${x.id} setting "${String((to as { setting: unknown }).setting)}" is not a setting of ${kind}`)
      } else if ('fixed' in to) {
        const f = (to as { fixed: unknown }).fixed
        const list = Array.isArray(f) ? f : [f]
        if (!list.length || list.some((v) => typeof v !== 'string' || !v.trim())) fail(`${p.id}: send ${x.id} fixed recipient is empty`)
      } else fail(`${p.id}: send ${x.id} needs to: { setting } or { fixed }`)
    }

    const inbox = u.inbox ?? []
    if (!Array.isArray(inbox)) fail(`${p.id}: uses.${kind}.inbox is not a list`)
    const appSheets = a.sheets.map((s) => p.sheetTemplates.find((t) => templateId(t) === s.template)).filter((t): t is SheetTemplate => !!t)
    const calcFamilies = new Set((a.calcModule?.needs ?? []).map((n) => p.sheetTemplates.find((t) => t.name === parseNeed(n).name)?.family).filter(Boolean))
    for (const b of inbox) {
      const ts = appSheets.filter((t) => t.family === b?.family)
      if (!ts.length) fail(`${p.id}: uses.${kind} inbox family "${String(b?.family)}" is not a sheet of ${kind}`)
      if (calcFamilies.has(b.family)) fail(`${p.id}: uses.${kind} inbox family ${b.family} is read by the calculation module`)
      const cols = new Set(ts.flatMap((t) => t.columns.map((c) => c.name)))
      if (b.identify?.by !== 'phone' && b.identify?.by !== 'telegram') fail(`${p.id}: inbox ${b.family} identify.by "${String(b.identify?.by)}"`)
      if (!cols.has(b.identify.column)) fail(`${p.id}: inbox ${b.family} identify column "${String(b.identify.column)}" is not a column`)
      if (ts.some((t) => !['string', 'text'].includes(t.columns.find((c) => c.name === b.identify.column)?.type ?? ''))) fail(`${p.id}: inbox ${b.family} identify column "${b.identify.column}" is not a text column`)
      if (ts.some((t) => !t.confirm)) fail(`${p.id}: inbox ${b.family} sheet template must declare confirm`)
      if (!Array.isArray(b.readable)) fail(`${p.id}: inbox ${b.family} readable is not a list`)
      for (const r of b.readable) if (!cols.has(r)) fail(`${p.id}: inbox ${b.family} readable column "${String(r)}" is not a column`)
    }
    const dupInbox = dupes(inbox.map((b) => b.family))
    if (dupInbox.length) fail(`${p.id}: uses.${kind} inbox family listed twice: ${dupInbox.join(', ')}`)
  }
  const ds = dupes(sendIds)
  if (ds.length) fail(`${p.id}: send id listed twice: ${ds.join(', ')}`)
  const dq = dupes(queryIds)
  if (dq.length) fail(`${p.id}: db query id listed twice: ${dq.join(', ')}`)
  const impl = p.dbQueries ?? {}
  if (!sameSet(Object.keys(impl), queryIds)) fail(`${p.id}: dbQueries [${Object.keys(impl)}] ≠ declared [${queryIds}]`)
  for (const [id, q] of Object.entries(impl)) {
    if (typeof q?.sql !== 'string' || !q.sql.trim()) fail(`${p.id}: db query ${id} has no sql`)
    if (!Array.isArray(q.params) || q.params.some((x) => typeof x !== 'string' || !x)) fail(`${p.id}: db query ${id} params must be names`)
    if (dupes(q.params).length) fail(`${p.id}: db query ${id} param listed twice: ${dupes(q.params).join(', ')}`)
    if (q.maxRows !== undefined && (!Number.isInteger(q.maxRows) || q.maxRows < 1 || q.maxRows > DB_MAX_ROWS_LIMIT)) fail(`${p.id}: db query ${id} maxRows must be 1–${DB_MAX_ROWS_LIMIT}`)
    const info = queryInfo.get(id)
    if (info?.engine === 'mssql') checkMssqlQuery(p.id, id, q.sql, q.params, info.mode)
  }
}

function checkMssqlQuery(pkg: string, id: string, sql: string, params: readonly string[], mode: 'read' | 'write'): void {
  for (const n of params) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(n)) fail(`${pkg}: db query ${id} param "${n}" — SQL Server parameter names are letters, digits and _`)
    if (!new RegExp(`@${n}(?![A-Za-z0-9_@#$])`, 'i').test(sql)) fail(`${pkg}: db query ${id} param "${n}" — SQL Server queries use @${n}`)
  }
  const f = mssqlQueryFacts(sql)
  if (mode === 'read' && !f.readable) fail(`${pkg}: db query ${id} — a SQL Server read must be one SELECT (or WITH … SELECT) with no other statement, INTO, locking hint or system procedure`)
  if (mode === 'write' && f.txControl) fail(`${pkg}: db query ${id} — a SQL Server write cannot BEGIN, COMMIT, ROLLBACK or SAVE a transaction (AI Talk wraps it in one)`)
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
  return (registry ??= composeWorkApps([...BUILTIN_WORK_APPS, ...CUSTOM_WORK_APPS], WORK_APP_METAS, new Set(CUSTOM_WORK_APP_METAS.map((m) => m.id))))
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
