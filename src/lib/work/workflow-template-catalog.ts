import type { LocalTemplate } from '@/lib/local-templates'
import { isAppWorkflow } from '@/lib/workflow/start-trigger'
import { fixedAppTemplatesKnown } from '@/lib/workflow/template-kind'
import { findEditionOffParts } from '@/lib/workflow/edition-guard'
import { packageCountries, workAppRegistry } from './registry'
import { CUSTOM_WORK_APP_METAS } from '@/work-apps/custom-meta'
import type { WorkAppMeta } from './package-meta'
import blankWorkAppTemplate from './workflow-templates/work-app.json'
import { appNodesOf, linkNodesOf } from './app-canvas'

export type WorkAppTemplateLang = 'de' | 'fr' | 'ko'
export type WorkAppTemplateI18n = Partial<Record<WorkAppTemplateLang, { name: string; description: string; explanation: string }>>

export type WorkAppTemplatePublisher = { kind: 'aitalk' } | { kind: 'community'; names: string[] } | { kind: 'own' }

export interface WorkAppTemplateEntry {
  template: LocalTemplate
  owner: string
  countries: 'all' | string[]
  publisher: WorkAppTemplatePublisher
  includes: string[]
  i18n: WorkAppTemplateI18n
}

export interface WorkAppTemplateSource {
  owner: string
  templates: readonly unknown[]
}

export type KindOwners = ReadonlyMap<string, { meta: WorkAppMeta; custom: boolean }>

const TEMPLATE_ID_RE = /^[a-z0-9][a-z0-9-]{0,49}$/
const COMPLEXITY = ['beginner', 'intermediate', 'advanced']
const BUNDLE_KEYS = ['bundleVersion', 'group', 'dataSheets', 'subWorkflows', 'wiring']

function fail(msg: string): never {
  throw new Error(`work app template catalog: ${msg}`)
}

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')

function fixedKinds(graph: unknown): string[] {
  const nodes = (graph as { nodes?: unknown } | null)?.nodes
  if (!Array.isArray(nodes)) return []
  const out: string[] = []
  for (const n of nodes) {
    const d = (n as { data?: { nodeType?: unknown; appTemplate?: unknown } } | null)?.data
    if ((d?.nodeType === 'workApp' || d?.nodeType === 'workAppLink') && typeof d.appTemplate === 'string' && d.appTemplate && !out.includes(d.appTemplate)) out.push(d.appTemplate)
  }
  return out
}

const I18N_LANGS: readonly string[] = ['de', 'fr', 'ko']

function checkI18n(id: string, raw: unknown): WorkAppTemplateI18n {
  if (raw === undefined) return {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(`${id}: i18n must be an object`)
  for (const [lang, v] of Object.entries(raw)) {
    if (!I18N_LANGS.includes(lang)) fail(`${id}: i18n language "${lang}" is not one of ${I18N_LANGS.join(', ')}`)
    const x = v as Record<string, unknown> | null
    if (!x || typeof x !== 'object' || Array.isArray(x)) fail(`${id}: i18n.${lang} must be an object`)
    for (const k of ['name', 'description'] as const) if (typeof x[k] !== 'string' || !(x[k] as string).trim()) fail(`${id}: i18n.${lang}.${k} is missing`)
    if (typeof x.explanation !== 'string') fail(`${id}: i18n.${lang}.explanation must be a string`)
  }
  return raw as WorkAppTemplateI18n
}

function checkTemplate(owner: string, raw: unknown): LocalTemplate {
  const t = raw as Record<string, unknown> | null
  if (!t || typeof t !== 'object' || Array.isArray(t)) fail(`${owner}: a template is not an object`)
  const id = t.templateId
  if (typeof id !== 'string' || !TEMPLATE_ID_RE.test(id)) fail(`${owner}: bad templateId "${String(id)}"`)
  for (const k of ['name', 'description', 'categoryCode'] as const) if (typeof t[k] !== 'string' || !(t[k] as string).trim()) fail(`${id}: ${k} is missing`)
  if (typeof t.explanation !== 'string') fail(`${id}: explanation must be a string`)
  if (!COMPLEXITY.includes(t.complexity as string)) fail(`${id}: bad complexity "${String(t.complexity)}"`)
  for (const k of ['keywords', 'nodeTypes', 'features'] as const) if (!isStrings(t[k])) fail(`${id}: ${k} must be a list of strings`)
  if (typeof t.sortOrder !== 'number' || !Number.isFinite(t.sortOrder)) fail(`${id}: sortOrder must be a number`)
  for (const k of BUNDLE_KEYS) if (k in t) fail(`${id}: package templates are single templates — "${k}" is not allowed`)
  if (typeof t.workflowJson !== 'string') fail(`${id}: workflowJson must be a JSON string`)
  let graph: unknown
  try {
    graph = JSON.parse(t.workflowJson)
  } catch {
    fail(`${id}: workflowJson is not valid JSON`)
  }
  if (!isAppWorkflow(graph)) fail(`${id}: workflowJson is not a work app canvas`)
  return t as unknown as LocalTemplate
}

export function composeWorkAppTemplates(sources: readonly WorkAppTemplateSource[], kindOwners: KindOwners): WorkAppTemplateEntry[] {
  const out: WorkAppTemplateEntry[] = []
  const seen = new Map<string, string>()
  for (const s of sources) {
    if (!Array.isArray(s.templates)) fail(`${s.owner}: workflowTemplates must be a list`)
    for (const raw of s.templates) {
      const template = checkTemplate(s.owner, raw)
      const other = seen.get(template.templateId)
      if (other !== undefined) fail(`duplicate templateId ${template.templateId} (${other} and ${s.owner})`)
      seen.set(template.templateId, s.owner)
      const includes = fixedKinds(JSON.parse(template.workflowJson))
      const owners = includes.flatMap((k) => (kindOwners.has(k) ? [kindOwners.get(k)!] : []))
      let countries: 'all' | string[] = 'all'
      for (const o of owners) {
        const c = packageCountries(o.meta)
        if (c === 'all') continue
        countries = countries === 'all' ? [...c] : countries.filter((x) => c.includes(x))
        if (countries.length === 0) fail(`${template.templateId}: its apps share no country`)
      }
      const names = [...new Set(owners.flatMap((o) => (o.meta.publisher ? [o.meta.publisher.name.trim()] : [])))]
      const publisher: WorkAppTemplatePublisher = owners.some((o) => o.custom) ? { kind: 'own' } : names.length ? { kind: 'community', names } : { kind: 'aitalk' }
      out.push({ template, owner: s.owner, countries, publisher, includes, i18n: checkI18n(template.templateId, (raw as { i18n?: unknown }).i18n) })
    }
  }
  return out.sort((a, b) => a.template.sortOrder - b.template.sortOrder)
}

let catalog: WorkAppTemplateEntry[] | undefined

export function workAppTemplateCatalog(): readonly WorkAppTemplateEntry[] {
  if (catalog) return catalog
  const reg = workAppRegistry()
  const customIds = new Set(CUSTOM_WORK_APP_METAS.map((m) => m.id))
  const kindOwners = new Map(reg.packages.flatMap((p) => p.appTemplates.map((a) => [a.kind, { meta: p.meta, custom: customIds.has(p.id) }] as const)))
  const sources: WorkAppTemplateSource[] = [{ owner: 'core', templates: [blankWorkAppTemplate] }, ...reg.packages.map((p) => ({ owner: p.id, templates: p.workflowTemplates === undefined ? [] : p.workflowTemplates }))]
  return (catalog = composeWorkAppTemplates(sources, kindOwners))
}

export function getWorkAppTemplate(templateId: string): WorkAppTemplateEntry | null {
  return workAppTemplateCatalog().find((e) => e.template.templateId === templateId) ?? null
}

export function workAppTemplateIds(): ReadonlySet<string> {
  return new Set(workAppTemplateCatalog().map((e) => e.template.templateId))
}

export function isWorkAppTemplateVisible(e: WorkAppTemplateEntry): boolean {
  return fixedAppTemplatesKnown(JSON.parse(e.template.workflowJson)) && findEditionOffParts(e.template.workflowJson).length === 0
}

export function visibleWorkAppTemplates(): WorkAppTemplateEntry[] {
  return workAppTemplateCatalog().filter(isWorkAppTemplateVisible)
}

export function getVisibleWorkAppTemplate(templateId: string): WorkAppTemplateEntry | null {
  const e = getWorkAppTemplate(templateId)
  return e && isWorkAppTemplateVisible(e) ? e : null
}

export function soloWorkAppTemplate(kind: string): WorkAppTemplateEntry | null {
  return visibleWorkAppTemplates().find((e) => {
    const g = JSON.parse(e.template.workflowJson)
    const apps = appNodesOf(g)
    return apps.length === 1 && apps[0].data?.appTemplate === kind && linkNodesOf(g).length === 0
  }) ?? null
}

export function bookLinkedWorkAppTemplate(kind: string, bookKinds: readonly string[]): WorkAppTemplateEntry | null {
  return visibleWorkAppTemplates().find((e) => {
    const g = JSON.parse(e.template.workflowJson)
    const links = linkNodesOf(g)
    return appNodesOf(g).filter((n) => n.data?.appTemplate === kind).length === 1 && links.length === 1 && bookKinds.includes(String(links[0].data?.appTemplate))
  }) ?? null
}

export function isBookBoundKind(kind: string, bookKinds: readonly string[]): boolean {
  return !bookKinds.includes(kind) && bookLinkedWorkAppTemplate(kind, bookKinds) !== null
}
