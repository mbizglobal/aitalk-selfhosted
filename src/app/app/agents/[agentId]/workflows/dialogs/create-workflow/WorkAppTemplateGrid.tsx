'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useLanguage } from '@/hooks/useLanguage'
import { workCountryName } from '@/lib/work/countries'
import { parseWorkLang, workKindLabel } from '@/lib/translations/work'
import { COMPANY_BOOK_KINDS } from '@/lib/work/app-template-kinds'
import { SearchBar } from './SearchBar'
import { WORK_APP_SEARCH_MIN, countryOptions, defaultCountry, groupWorkApps } from './work-app-groups'
import type { WorkflowTemplate, CreateWorkflowTranslations } from './types'

const ALL = '__all__'

function makesCompanyBook(t: WorkflowTemplate): boolean {
  let g: unknown = t.workflowJson
  if (typeof g === 'string') { try { g = JSON.parse(g) } catch { return false } }
  const nodes = (g as { nodes?: Array<{ data?: { nodeType?: unknown; appTemplate?: unknown } }> } | null | undefined)?.nodes
  return Array.isArray(nodes) && nodes.some((n) => n?.data?.nodeType === 'workApp' && typeof n.data.appTemplate === 'string' && COMPANY_BOOK_KINDS.includes(n.data.appTemplate))
}

interface Props {
  onBack?: () => void
  onSelectTemplate: (template: WorkflowTemplate) => void
  withWorkflowTemplates?: boolean
  t: CreateWorkflowTranslations
}

export function WorkAppTemplateGrid({ onBack, onSelectTemplate, withWorkflowTemplates = false, t }: Props) {
  const { currentLanguage } = useLanguage()
  const lang = currentLanguage || 'en'
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [companies, setCompanies] = useState<{ used: number; limit: number | null } | null>(null)
  const [myForms, setMyForms] = useState<{ available: boolean; open: { agentId: string; workflowId: string } | null } | null>(null)

  useEffect(() => {
    let alive = true
    const run = async () => {
      const [tplRes, wfRes, billing, co, mf] = await Promise.all([
        fetch('/api/workflow-templates?kind=workApp').catch(() => null),
        withWorkflowTemplates ? fetch('/api/workflow-templates?kind=workflow').catch(() => null) : Promise.resolve(null),
        fetch('/api/billing-info').then((r) => (r.ok ? r.json() : null)).catch(() => null) as Promise<{ data?: { companyCountry?: unknown } | null } | null>,
        fetch('/api/work-projects/companies').then((r) => (r.ok ? r.json() : null)).catch(() => null) as Promise<{ used?: unknown; limit?: unknown } | null>,
        fetch('/api/work-projects/myforms').then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ])
      let list: WorkflowTemplate[] = []
      if (tplRes?.ok) list = ((await tplRes.json().catch(() => ({}))) as { templates?: WorkflowTemplate[] }).templates ?? []
      if (wfRes?.ok) {
        const seen = new Set(list.map((x) => x.templateId))
        list = [...list, ...(((await wfRes.json().catch(() => ({}))) as { templates?: WorkflowTemplate[] }).templates ?? []).filter((x) => !seen.has(x.templateId))]
      }
      if (!alive) return
      setTemplates(list)
      if (co && typeof co.used === 'number' && (co.limit === null || typeof co.limit === 'number')) setCompanies({ used: co.used, limit: co.limit })
      if (mf?.available === true) setMyForms({ available: true, open: mf.open ?? null })
      setSelected(defaultCountry(billing?.data?.companyCountry, countryOptions(list, lang)))
      setLoading(false)
    }
    run().catch((error) => {
      console.error('Failed to fetch work app templates:', error)
      if (alive) setLoading(false)
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const localized = useMemo(() => {
    const wl = parseWorkLang(lang)
    return templates.map((t) => {
      const x = t.i18n?.[wl]
      return x ? { ...t, name: x.name, description: x.description, explanation: x.explanation || t.explanation } : t
    })
  }, [templates, lang])
  const options = useMemo(() => countryOptions(localized, lang), [localized, lang])
  const sections = useMemo(() => groupWorkApps(localized, selected, query, lang), [localized, selected, query, lang])
  const allLabel = t.workflow_workapp_all_countries || 'All countries'
  const showSearch = templates.length >= WORK_APP_SEARCH_MIN
  const showCountry = options.length >= 2

  const myFormsName = workKindLabel(parseWorkLang(lang), 'myforms')
  const myFormsCard = myForms?.available && (!query.trim() || myFormsName.toLowerCase().includes(query.trim().toLowerCase()))
    ? <MyFormsCard name={myFormsName} open={myForms.open} lang={lang} t={t} />
    : null

  return (
    <div className="flex flex-col max-h-[calc(100svh-10rem)]">
      {onBack ? (
        <div className="shrink-0 pt-4 pb-2">
          <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" />
            {t.workflow_back || 'Back'}
          </button>
        </div>
      ) : (
        <div className="shrink-0 pt-2" />
      )}

      {!loading && (showSearch || showCountry) && (
        <div className="shrink-0 flex flex-col sm:flex-row gap-2 pb-4">
          {showSearch && (
            <SearchBar value={query} onChange={setQuery} placeholder={t.workflow_workapp_search || 'Search work apps...'} />
          )}
          {showCountry && <Select value={selected ?? ALL} onValueChange={(v) => setSelected(v === ALL ? null : v)}>
            <SelectTrigger className="w-full sm:w-[200px]">
              <SelectValue placeholder={allLabel} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{allLabel}</SelectItem>
              {options.map((code) => (
                <SelectItem key={code} value={code}>{workCountryName(code, lang)}</SelectItem>
              ))}
            </SelectContent>
          </Select>}
        </div>
      )}

      <div className="flex-1 overflow-y-auto min-h-0 scrollbar-thin">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : templates.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">{t.workflow_workapp_none || 'No Work App patterns yet'}</div>
        ) : sections.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">{t.workflow_template_no_results || 'No templates found'}</div>
        ) : (
          <div className="flex flex-col gap-5 pr-1">
            {sections.map((s) => (
              <section key={s.key} className="flex flex-col gap-3">
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {s.key === 'all' ? (t.workflow_workapp_any_country || 'Works in all countries') : workCountryName(s.key, lang)}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {s.items.map((template) => (
                    <div key={template.templateId} className={(template.includes?.length ?? 0) >= 2 ? 'sm:col-span-2' : ''}>
                      <WorkAppCard template={template} showCountries={selected === null && showCountry} lang={lang} onClick={() => onSelectTemplate(template)} t={t}
                        companyFull={companies && companies.limit !== null && companies.used >= companies.limit && makesCompanyBook(template) ? companies : null} />
                    </div>
                  ))}
                  {s.key === 'all' && myFormsCard}
                </div>
              </section>
            ))}
            {!sections.some((s) => s.key === 'all') && myFormsCard && <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">{myFormsCard}</div>}
          </div>
        )}
      </div>
    </div>
  )
}

function MyFormsCard({ name, open, lang, t }: { name: string; open: { agentId: string; workflowId: string } | null; lang: string; t: CreateWorkflowTranslations }) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const go = (o: { agentId: string; workflowId: string }) => { window.location.href = `/chat/${o.agentId}/app?workflowId=${encodeURIComponent(o.workflowId)}` }
  const click = async () => {
    if (open) return go(open)
    setBusy(true)
    setFailed(false)
    try {
      const r = await fetch('/api/work-projects/myforms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang }) })
      const j = r.ok ? await r.json() as { open?: { agentId: string; workflowId: string } | null } : null
      if (j?.open) return go(j.open)
      setFailed(true)
    } catch {
      setFailed(true)
    }
    setBusy(false)
  }
  return (
    <button onClick={() => void click()} disabled={busy} className="w-full h-full flex flex-col p-4 border rounded-lg hover:border-primary hover:bg-accent/50 transition-colors text-left disabled:opacity-60">
      <div className="flex items-start justify-between gap-3 mb-2">
        <h4 className="font-medium min-w-0 break-words">{name}</h4>
        <span className="text-xs px-2 py-0.5 rounded-full whitespace-nowrap shrink-0 bg-primary/10 text-primary">{t.workflow_workapp_by_aitalk || 'AI Talk'}</span>
      </div>
      <p className="text-sm text-muted-foreground">{t.workflow_workapp_myforms_desc || 'Your own forms for any document — photograph or upload it and AI enters it into the form that fits. Download as CSV, Excel or PDF. One per account.'}</p>
      {busy && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground mt-2" />}
      {open && <p className="text-xs text-muted-foreground mt-2">{t.workflow_workapp_myforms_open || 'Already added — open it'}</p>}
      {failed && <p className="text-xs text-destructive mt-2">{t.workflow_workapp_myforms_failed || 'Could not add it. Please try again.'}</p>}
    </button>
  )
}

function WorkAppCard({ template, showCountries, lang, onClick, t, companyFull }: { template: WorkflowTemplate; showCountries: boolean; lang: string; onClick: () => void; t: CreateWorkflowTranslations; companyFull: { used: number; limit: number | null } | null }) {
  const p = template.publisher
  const by = p?.kind === 'community'
    ? `${t.workflow_workapp_by_community || 'Community'} · ${p.names.join(', ')}`
    : p?.kind === 'own' ? (t.workflow_workapp_by_own || 'Your app') : (t.workflow_workapp_by_aitalk || 'AI Talk')
  const includes = (template.includes?.length ?? 0) >= 2 ? template.includes! : []
  const countries = showCountries && Array.isArray(template.countries) ? template.countries : []
  const workLang = parseWorkLang(lang)

  return (
    <button onClick={onClick} disabled={!!companyFull} className="w-full h-full flex flex-col p-4 border rounded-lg hover:border-primary hover:bg-accent/50 transition-colors text-left disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:border-border disabled:hover:bg-transparent">
      <div className="flex items-start justify-between gap-3 mb-2">
        <h4 className="font-medium min-w-0 break-words">{template.name}</h4>
        <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap shrink-0 ${p?.kind === 'aitalk' || !p ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>{by}</span>
      </div>
      <p className="text-sm text-muted-foreground">{template.description}</p>
      {includes.length > 0 && (
        <p className="text-xs text-muted-foreground mt-2">
          <span className="font-medium text-foreground">{t.workflow_workapp_includes || 'Includes'}:</span>{' '}
          {includes.map((k) => workKindLabel(workLang, k)).join(' · ')}
        </p>
      )}
      {companyFull && (
        <p className="text-xs text-amber-600 dark:text-amber-300 mt-2">
          {(t.workflow_workapp_company_full || 'Companies (bank ledgers) {used} / {limit} — your plan has no room for another ledger. Upgrade, or take a ledger you no longer use offline (Draft).').replace('{used}', String(companyFull.used)).replace('{limit}', String(companyFull.limit))}
        </p>
      )}
      {countries.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-3">
          {countries.map((c) => (
            <span key={c} className="text-xs px-1.5 py-0.5 bg-muted rounded">{workCountryName(c, lang)}</span>
          ))}
        </div>
      )}
    </button>
  )
}
