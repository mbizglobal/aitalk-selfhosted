'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Briefcase, ChevronDown, ChevronRight, ExternalLink, Loader2 } from 'lucide-react'
import { useLanguage } from '@/hooks/useLanguage'
import { workKindLabel, type WorkLang } from '@/lib/translations/work'
import { ReferenceEditor } from './ReferenceEditor'
import { ApprovalEditor } from './ApprovalEditor'
import { useEdition } from '@/components/EditionProvider'

interface Agent { agentId: string; title: string; createdAt: string }
interface Project { id: string; name: string; kind: string; agentId: string | null }
interface WorkAppItem { workflowId: string; agentId: string; name: string; appTemplate: string | null; tasks: number; projectKind: string | null }

export default function WorkAppsPage() {
  const { t, currentLanguage } = useLanguage()
  const [agents, setAgents] = useState<Agent[] | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [apps, setApps] = useState<WorkAppItem[]>([])
  const [error, setError] = useState(false)
  const [openRefs, setOpenRefs] = useState<string | null>(null)
  const [openAppr, setOpenAppr] = useState<string | null>(null)
  const selfHosted = useEdition() === 'selfhosted'
  const lang: WorkLang = currentLanguage === 'de-ch' ? 'de' : (['en', 'de', 'fr', 'ko'] as const).find((l) => l === currentLanguage) ?? 'en'

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/work-projects', { cache: 'no-store' })
      if (!res.ok) throw new Error('load')
      const j = (await res.json()) as { agents: Agent[]; projects: Project[]; apps: WorkAppItem[] }
      setAgents(j.agents)
      setProjects(j.projects)
      setApps(j.apps)
      setError(false)
    } catch {
      setError(true)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const agentLabel = (agentId: string) => {
    const a = agents?.find((x) => x.agentId === agentId)
    if (!a) return ''
    const same = (agents ?? []).filter((x) => x.title === a.title).length > 1
    return same ? `${a.title} · ${t('work_agent_created').replace('{date}', a.createdAt.slice(0, 10))}` : a.title
  }
  const templateLabel = (a: WorkAppItem) => {
    const kind = a.projectKind && a.projectKind !== 'free' ? a.projectKind : a.appTemplate
    return kind ? workKindLabel(lang, kind) : t('work_no_template')
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('work_page_title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('work_page_desc')}</p>
      </div>
      {error && <p className="text-sm text-red-500">{t('work_error')}</p>}
      {agents === null ? (
        !error && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      ) : apps.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('work_no_apps')}</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {apps.map((a) => (
            <li key={a.workflowId} className="flex items-center gap-3 px-4 py-3">
              <Briefcase className="w-5 h-5 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate">{a.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {agentLabel(a.agentId)} · {templateLabel(a)} · {t('work_tasks_count').replace('{n}', String(a.tasks))}
                </p>
              </div>
              <Link href={`/chat/${encodeURIComponent(a.agentId)}/app?workflowId=${encodeURIComponent(a.workflowId)}&lang=${lang}`} target="_blank" className="inline-flex items-center gap-1 text-sm text-primary hover:underline shrink-0">
                {t('work_open')} <ExternalLink className="w-3.5 h-3.5" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {agents && projects.length > 1 && (
        <section className="space-y-2">
          <h2 className="font-medium">{t('work_ref_title')}</h2>
          <ul className="divide-y rounded-lg border">
            {projects.map((p) => (
              <li key={p.id} className="px-4 py-3 space-y-3">
                <button onClick={() => setOpenRefs(openRefs === p.id ? null : p.id)} className="w-full flex items-center gap-2 text-left" aria-expanded={openRefs === p.id}>
                  {openRefs === p.id ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
                  <span className="flex-1 min-w-0 truncate">{p.name}</span>
                  <span className="text-xs text-muted-foreground shrink-0">{p.agentId ? agentLabel(p.agentId) : ''}</span>
                </button>
                {openRefs === p.id && <ReferenceEditor projectId={p.id} lang={lang} />}
              </li>
            ))}
          </ul>
        </section>
      )}
      {agents && selfHosted && projects.some((p) => p.agentId) && (
        <section className="space-y-2">
          <h2 className="font-medium">{t('work_appr_title')}</h2>
          <ul className="divide-y rounded-lg border">
            {projects.filter((p) => p.agentId).map((p) => (
              <li key={p.id} className="px-4 py-3 space-y-3">
                <button onClick={() => setOpenAppr(openAppr === p.id ? null : p.id)} className="w-full flex items-center gap-2 text-left" aria-expanded={openAppr === p.id}>
                  {openAppr === p.id ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
                  <span className="flex-1 min-w-0 truncate">{p.name}</span>
                  <span className="text-xs text-muted-foreground shrink-0">{agentLabel(p.agentId!)}</span>
                </button>
                {openAppr === p.id && <ApprovalEditor projectId={p.id} agentId={p.agentId!} />}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
