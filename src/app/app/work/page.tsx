'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Briefcase, Check, ChevronDown, ChevronRight, Copy, Download, ExternalLink, Loader2, Pencil, Plus, RotateCcw, Trash2, Upload } from 'lucide-react'
import { useLanguage } from '@/hooks/useLanguage'
import { workKindLabel, type WorkLang } from '@/lib/translations/work'
import { ApprovalEditor } from './ApprovalEditor'
import { CreateWorkAppDialog } from '@/components/work/CreateWorkAppDialog'
import { useEdition } from '@/components/EditionProvider'
import { WorkflowAppsDeleteDialog } from '@/components/work/WorkflowAppsDeleteDialog'
import { BackupDownloadDialog, type BackupTarget } from '@/components/work/BackupDownloadDialog'
import { BackupUploadDialog } from '@/components/work/BackupUploadDialog'
import { workAppOpenHref } from '@/lib/work/open-href'

interface Agent { agentId: string; title: string; createdAt: string }
interface Project { id: string; name: string; kind: string; agentId: string | null }
type AppState = 'live' | 'paused' | 'removed' | 'orphan'
interface ManagedApp { projectId: string; appWorkflowId: string | null; nodeId: string | null; name: string; agentId: string | null; template: string | null; tasks: number; state: AppState }
interface ManagedGroup { type: 'canvas' | 'trash' | 'workflow' | 'none'; id: string; name: string; status: string | null; agentId: string | null; apps: ManagedApp[] }

export default function WorkAppsPage() {
  const { t, currentLanguage } = useLanguage()
  const [agents, setAgents] = useState<Agent[] | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [groups, setGroups] = useState<ManagedGroup[]>([])
  const [companies, setCompanies] = useState<{ used: number; limit: number | null } | null>(null)
  const [error, setError] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<{ app: ManagedApp; typed: string; refs: number; last?: { workflowName: string } } | null>(null)
  const [wfDelete, setWfDelete] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [openAppr, setOpenAppr] = useState<string | null>(null)
  const selfHosted = useEdition() === 'selfhosted'
  const lang: WorkLang = currentLanguage === 'de-ch' ? 'de' : (['en', 'de', 'fr', 'ko'] as const).find((l) => l === currentLanguage) ?? 'en'

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/work-projects', { cache: 'no-store' })
      if (!res.ok) throw new Error('load')
      const j = (await res.json()) as { agents: Agent[]; projects: Project[]; groups: ManagedGroup[]; companies?: { used: number; limit: number | null } }
      setAgents(j.agents)
      const co = j.companies
      setCompanies(co && typeof co.used === 'number' && (co.limit === null || typeof co.limit === 'number') ? co : null)
      setProjects(j.projects)
      setGroups(j.groups)
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
  const templateLabel = (a: ManagedApp) => (a.template ? workKindLabel(lang, a.template) : t('work_no_template'))
  const stateLabel = (a: ManagedApp, g: ManagedGroup) =>
    a.state === 'live' ? t('work_state_live')
      : a.state === 'paused' ? (g.status === 'archived' ? t('work_state_archived') : t('work_state_draft'))
        : a.state === 'removed' ? t('work_state_removed') : t('work_state_orphan')
  const groupTitle = (g: ManagedGroup) =>
    g.type === 'trash' ? t('work_group_trash').replace('{name}', g.name || '—') : g.type === 'none' ? t('work_group_none') : g.name
  const openHref = (a: ManagedApp) => workAppOpenHref(a, lang)
  const askDelete = (a: ManagedApp, g: ManagedGroup) => {
    setDeleting({ app: a, typed: '', refs: 0 })
    if (g.type !== 'canvas' && g.type !== 'workflow') return
    void fetch(`/api/workflows/${encodeURIComponent(g.id)}/apps`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { name?: string; apps?: Array<{ projectId: string; deletesWorkflow?: boolean }> } | null) => {
        const me = j?.apps?.find((x) => x.projectId === a.projectId)
        if (me?.deletesWorkflow) setDeleting((d) => (d && d.app.projectId === a.projectId ? { ...d, last: { workflowName: j?.name || g.name } } : d))
      })
      .catch(() => {})
  }

  const restore = async (a: ManagedApp) => {
    setBusy(a.projectId); setNotice(null)
    try {
      const res = await fetch(`/api/work-projects/${encodeURIComponent(a.projectId)}/restore`, { method: 'POST' })
      const j = (await res.json().catch(() => ({}))) as { workflowId?: string; error?: string }
      if (!res.ok || !j.workflowId) {
        setNotice(j.error === 'NO_AGENT' ? t('work_restore_no_agent') : j.error === 'workflow_limit_reached' ? t('work_restore_limit') : t('work_restore_failed'))
        return
      }
      setNotice(t('work_restore_done'))
      await load()
    } finally {
      setBusy(null)
    }
  }

  const doDelete = async () => {
    if (!deleting) return
    const a = deleting.app
    setBusy(a.projectId); setNotice(null)
    try {
      const res = await fetch(`/api/work-projects/${encodeURIComponent(a.projectId)}${deleting.refs ? '?confirmReferences=1' : ''}`, { method: 'DELETE' })
      const j = (await res.json().catch(() => ({}))) as { error?: string; referencedBy?: string[]; canvases?: Array<{ name?: string }> }
      if (res.status === 409 && j.error === 'REFERENCED') {
        setDeleting({ ...deleting, refs: j.referencedBy?.length || 1 })
        return
      }
      setDeleting(null)
      if (!res.ok) {
        setNotice(j.error === 'SENDING' ? t('work_delete_sending') : j.error === 'AWAITING_APPROVAL' ? t('work_delete_awaiting') : j.error === 'STALE_CONFLICT' ? t('work_delete_stale')
          : j.error === 'SHARED_APP_IN_USE' ? t('work_block_shared').replace('{names}', (j.canvases ?? []).map((c) => c?.name ?? '').filter(Boolean).map((n) => t('work_quote_name').replace('{name}', n)).join(', ')) : t('work_delete_failed'))
      }
      await load()
    } finally {
      setBusy(null)
    }
  }
  const allApps = groups.flatMap((g) => g.apps)

  const [backupTarget, setBackupTarget] = useState<BackupTarget | null>(null)
  const [uploading, setUploading] = useState(false)

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="text-2xl font-semibold">{t('work_page_title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('work_page_desc')}</p>
        </div>
        <button disabled={busy !== null || agents === null} onClick={() => setUploading(true)} title={t('work_up_pick')} className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50 shrink-0">
          <Upload className="w-4 h-4" /> {t('work_import')}
        </button>
        <BackupUploadDialog open={uploading} onClose={(changed) => { setUploading(false); if (changed) void load() }} />
        <BackupDownloadDialog target={backupTarget} onClose={() => setBackupTarget(null)} />
        <button disabled={agents === null || agents.length === 0} onClick={() => setCreating(true)} className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50 shrink-0">
          <Plus className="w-4 h-4" /> {t('work_create')}
        </button>
        <CreateWorkAppDialog open={creating} onOpenChange={setCreating} agentIds={(agents ?? []).map((a) => a.agentId)} />
      </div>
      {error && <p className="text-sm text-red-500">{t('work_error')}</p>}
      {companies && companies.limit !== null && (
        <div className={`rounded-md border px-3 py-2 text-sm ${companies.used > companies.limit ? 'border-amber-500/60 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200' : 'text-muted-foreground'}`}>
          <span>{t('work_company_count').replace('{used}', String(companies.used)).replace('{limit}', String(companies.limit))}</span>
          {companies.used >= companies.limit && (
            <span className="block mt-1 text-xs">
              {t(companies.used > companies.limit ? 'work_company_over' : 'work_company_full')}{' '}
              <Link href="/app/subscription" className="text-primary hover:underline">{t('work_company_plans')}</Link>
            </span>
          )}
        </div>
      )}
      {agents === null ? (
        !error && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      ) : allApps.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('work_no_apps')}</p>
      ) : (
        <div className="space-y-4">
          {notice && <p className="text-sm text-amber-600 dark:text-amber-300">{notice}</p>}
          {groups.map((g) => (
            <section key={`${g.type}:${g.id}`} className="rounded-lg border">
              <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b bg-muted/40">
                <span className="font-medium text-sm truncate min-w-0 flex-1">{groupTitle(g)}</span>
                {g.agentId && <span className="text-xs text-muted-foreground truncate shrink-0 max-w-[50%]">{agentLabel(g.agentId)}</span>}
                {(g.type === 'canvas' || g.type === 'workflow') && (
                  <Link href={`/app/agent-studio?workflowId=${encodeURIComponent(g.id)}`} className="inline-flex items-center gap-1 text-xs text-primary hover:underline shrink-0">
                    <Pencil className="w-3.5 h-3.5" /> {t('work_edit_workflow')}
                  </Link>
                )}
                {(g.type === 'canvas' || g.type === 'workflow') && (
                  <button disabled={busy !== null} onClick={() => setWfDelete(g.id)} title={t('work_group_delete')} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-red-500 disabled:opacity-50 shrink-0">
                    <Trash2 className="w-3.5 h-3.5" /> {t('work_group_delete')}
                  </button>
                )}
                {g.type === 'trash' && (
                  <button disabled={busy !== null} onClick={() => void restore(g.apps[0])} title={t('work_restore_trash_note')} className="inline-flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-50 shrink-0">
                    <RotateCcw className="w-3.5 h-3.5" /> {t('work_restore')}
                  </button>
                )}
              </div>
              <ul className="divide-y">
                {g.apps.map((a) => {
                  const href = openHref(a)
                  return (
                    <li key={a.projectId} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                      <Briefcase className={`w-5 h-5 shrink-0 ${a.state === 'live' ? 'text-primary' : 'text-muted-foreground'}`} />
                      <div className="min-w-0 flex-1 basis-48">
                        <p className="font-medium truncate">{a.name}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {a.agentId && a.agentId !== g.agentId ? `${agentLabel(a.agentId)} · ` : ''}{templateLabel(a)} · {t(a.tasks === 1 ? 'work_tasks_count_one' : 'work_tasks_count').replace('{n}', String(a.tasks))}
                        </p>
                        <span className={`mt-1 inline-block text-[11px] px-1.5 py-0.5 rounded ${a.state === 'live' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300' : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'}`}>{stateLabel(a, g)}</span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {href && (
                          <Link href={href} target="_blank" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                            {t('work_open')} <ExternalLink className="w-3.5 h-3.5" />
                          </Link>
                        )}
                        {g.type === 'none' && (
                          <button disabled={busy !== null} onClick={() => void restore(a)} className="inline-flex items-center gap-1 text-sm text-primary hover:underline disabled:opacity-50">
                            <RotateCcw className="w-3.5 h-3.5" /> {t('work_restore')}
                          </button>
                        )}
                        <button type="button" onClick={() => setBackupTarget({ scope: 'app', id: a.projectId, name: a.name })} aria-label={t('work_backup')} title={t('work_bk_note')} className="p-1 rounded text-muted-foreground hover:text-primary">
                          <Download className="w-4 h-4" />
                        </button>
                        <button disabled={busy !== null} onClick={() => askDelete(a, g)} aria-label={t('work_delete')} title={t('work_delete')} className="p-1 rounded text-muted-foreground hover:text-red-500 disabled:opacity-50">
                          {busy === a.projectId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
      {deleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" role="dialog" aria-modal="true" onKeyDown={(e) => { if (e.key === 'Escape' && busy === null) setDeleting(null) }}>
          <div className="w-full max-w-md rounded-lg border bg-background p-5 space-y-3">
            <h2 className="font-semibold">{t('work_delete_title').replace('{name}', deleting.app.name)}</h2>
            <p className="text-sm text-muted-foreground">{t('work_delete_body')}</p>
            {deleting.last && <p className="text-sm text-amber-600 dark:text-amber-300">{t('work_wfdel_last').replace('{name}', deleting.last.workflowName)}</p>}
            {deleting.refs > 0 && <p className="text-sm text-amber-600 dark:text-amber-300">{t('work_delete_refs').replace('{n}', String(deleting.refs))}</p>}
            <div className="space-y-1 text-sm">
              <p className="text-muted-foreground">{t('work_delete_type')}</p>
              <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
                <span className="flex-1 min-w-0 break-all font-mono select-all">{deleting.app.name}</span>
                <button type="button" onClick={() => { const name = deleting.app.name; void navigator.clipboard?.writeText(name).then(() => setCopied(name), () => {}) }} aria-label={t('work_delete_copy')} title={t('work_delete_copy')} className="inline-flex items-center gap-1 text-xs text-primary hover:underline shrink-0">
                  {copied === deleting.app.name ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {copied === deleting.app.name ? t('work_delete_copied') : t('work_delete_copy')}
                </button>
              </div>
              <input autoFocus autoComplete="off" aria-label={t('work_delete_type')} value={deleting.typed} onChange={(e) => setDeleting({ ...deleting, typed: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button disabled={busy !== null} onClick={() => setDeleting(null)} className="px-3 py-1.5 rounded-md border text-sm">{t('work_cancel')}</button>
              <button disabled={busy !== null || deleting.typed.trim() !== deleting.app.name.trim()} onClick={() => void doDelete()} className="px-3 py-1.5 rounded-md bg-red-600 text-white text-sm disabled:opacity-40">
                {t('work_delete_confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
      <WorkflowAppsDeleteDialog workflowId={wfDelete} onClose={(changed) => { setWfDelete(null); if (changed) void load() }} />
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
