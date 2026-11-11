'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Copy, Download, ExternalLink, Loader2, RotateCcw, Trash2, X } from 'lucide-react'
import { useLanguage } from '@/hooks/useLanguage'
import { workAppOpenHref } from '@/lib/work/open-href'
import type { PopupApp, WorkflowDeletePreview } from '@/lib/work/workflow-apps'
import { workLangOf } from './WorkAppCardRows'
import { BackupDownloadDialog, type BackupTarget } from './BackupDownloadDialog'

interface Props {
  workflowId: string | null
  onClose: (changed: boolean) => void
  onWorkflowDeleted?: (workflowId: string) => void
}

export function WorkflowAppsDeleteDialog({ workflowId, onClose, onWorkflowDeleted }: Props) {
  const { t, currentLanguage } = useLanguage()
  const lang = workLangOf(currentLanguage)
  const [preview, setPreview] = useState<WorkflowDeletePreview | null>(null)
  const [backupTarget, setBackupTarget] = useState<BackupTarget | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [ended, setEnded] = useState<'done' | 'gone' | null>(null)
  const [changed, setChanged] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState<{ projectId: string; typed: string; refs: number } | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [confirmWf, setConfirmWf] = useState(false)

  const seq = useRef(0)
  const deletedCb = useRef(onWorkflowDeleted)
  deletedCb.current = onWorkflowDeleted
  const load = useCallback(async (id: string) => {
    const my = ++seq.current
    setLoading(true)
    try {
      const res = await fetch(`/api/workflows/${encodeURIComponent(id)}/apps`, { cache: 'no-store' })
      if (my !== seq.current) return
      if (res.status === 404) { setEnded('gone'); setChanged(true); deletedCb.current?.(id); return }
      if (!res.ok) throw new Error('load')
      const j = (await res.json()) as WorkflowDeletePreview
      if (my !== seq.current) return
      setPreview(j)
      setError(false)
    } catch {
      if (my === seq.current) setError(true)
    } finally {
      if (my === seq.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    setPreview(null); setEnded(null); setChanged(false); setNotice(null); setConfirming(null); setConfirmWf(false); setError(false)
    if (workflowId) void load(workflowId)
    else seq.current++
  }, [workflowId, load])

  useEffect(() => {
    if (!workflowId) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy && !backupTarget) onClose(changed) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [workflowId, busy, changed, onClose, backupTarget])

  if (!workflowId) return null
  const close = () => { if (!busy) onClose(changed) }
  const name = preview?.name || '—'

  const deleteApp = async (a: PopupApp, refs: number) => {
    setBusy(true); setNotice(null)
    try {
      const res = await fetch(`/api/work-projects/${encodeURIComponent(a.projectId)}${refs ? '?confirmReferences=1' : ''}`, { method: 'DELETE' })
      const j = (await res.json().catch(() => ({}))) as { error?: string; referencedBy?: string[]; canvasDeleted?: boolean }
      if (res.status === 409 && j.error === 'REFERENCED') {
        setConfirming({ projectId: a.projectId, typed: confirming?.typed ?? '', refs: j.referencedBy?.length || 1 })
        return
      }
      setConfirming(null)
      if (!res.ok) {
        setNotice(j.error === 'STALE_CONFLICT' ? t('work_delete_stale') : j.error === 'SENDING' || j.error === 'AWAITING_APPROVAL' || j.error === 'SHARED_APP_IN_USE' ? null : t('work_delete_failed'))
        await load(workflowId)
        return
      }
      setChanged(true)
      if (j.canvasDeleted) { setEnded('done'); onWorkflowDeleted?.(workflowId); return }
      await load(workflowId)
    } finally {
      setBusy(false)
    }
  }

  const deleteWorkflow = async () => {
    setBusy(true); setNotice(null)
    try {
      const res = await fetch(`/api/workflows/${encodeURIComponent(workflowId)}`, { method: 'DELETE' })
      const j = (await res.json().catch(() => ({}))) as { code?: string }
      if (res.status === 404) { setEnded('gone'); setChanged(true); onWorkflowDeleted?.(workflowId); return }
      if (!res.ok) {
        setConfirmWf(false)
        if (j.code !== 'HAS_WORK_APPS') setNotice(t('work_delete_failed'))
        await load(workflowId)
        return
      }
      setChanged(true); setEnded('done'); onWorkflowDeleted?.(workflowId)
    } finally {
      setBusy(false)
    }
  }

  const stateLabel = (s: string) => s === 'live' ? t('work_state_live') : s === 'removed' ? t('work_state_removed') : s === 'orphan' ? t('work_state_orphan') : t('work_state_draft')
  const blockText = (a: PopupApp) => {
    const b = a.blocked
    if (!b) return ''
    if (b.code === 'AWAITING_APPROVAL') return t('work_block_awaiting').replace('{n}', String(b.n))
    if (b.code === 'SENDING') return t('work_block_sending')
    return t('work_block_shared').replace('{names}', b.canvases.map((c) => t('work_quote_name').replace('{name}', c.name)).join(', '))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center bg-black/50 sm:px-4" role="dialog" aria-modal="true">
      <div className="w-full sm:max-w-4xl h-full sm:h-auto sm:max-h-[90vh] overflow-y-auto sm:rounded-lg border bg-background p-5 sm:p-6 space-y-4">
        <div className="flex items-start gap-3">
          <h2 className="flex-1 min-w-0 text-lg font-semibold break-words">{t('work_wfdel_title').replace('{name}', name)}</h2>
          {!ended && (
            <button type="button" onClick={() => setBackupTarget({ scope: 'workflow', id: workflowId, name })} title={t('work_bk_note')} className="inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs hover:bg-muted">
              <Download className="w-3.5 h-3.5" /> {t('work_backup')}
            </button>
          )}
          <button type="button" onClick={close} aria-label={t('work_wfdel_close')} className="shrink-0 p-1 rounded text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>

        {ended ? (
          <div className="space-y-4">
            <p className="text-sm">{ended === 'done' ? t('work_wfdel_done') : t('work_wfdel_gone')}</p>
            <div className="flex justify-end"><button onClick={close} className="px-3 py-1.5 rounded-md border text-sm">{t('work_wfdel_close')}</button></div>
          </div>
        ) : error ? (
          <p className="text-sm text-red-500">{t('work_error')}</p>
        ) : !preview ? (
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        ) : (
          <>
            {preview.apps.length > 0 && <p className="text-sm text-muted-foreground">{t('work_wfdel_head')}</p>}
            {notice && <p className="text-sm text-amber-600 dark:text-amber-300">{notice}</p>}
            {preview.apps.length > 0 ? (
              <ul className="space-y-2">
                {preview.apps.map((a) => {
                  const open = confirming?.projectId === a.projectId ? confirming : null
                  const href = workAppOpenHref(a, lang)
                  return (
                    <li key={a.projectId} className={`rounded-lg border p-3 space-y-2 ${a.blocked ? 'border-amber-500/50 bg-amber-50/60 dark:bg-amber-950/20' : ''}`}>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <div className="min-w-0 flex-1 basis-48">
                          <p className="font-medium break-words">{a.name}</p>
                          <p className="text-xs text-muted-foreground">
                            <span className={`mr-2 inline-block text-[11px] px-1.5 py-0.5 rounded ${a.state === 'live' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300' : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'}`}>{stateLabel(a.state)}</span>
                            {t(a.tasks === 1 ? 'work_tasks_count_one' : 'work_tasks_count').replace('{n}', String(a.tasks))}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button type="button" onClick={() => setBackupTarget({ scope: 'app', id: a.projectId, name: a.name })} title={t('work_bk_note')} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted">
                            <Download className="w-3.5 h-3.5" /> {t('work_bk_short')}
                          </button>
                          {a.blocked ? (
                            a.blocked.code === 'AWAITING_APPROVAL' && href ? (
                              <a href={href} target="_blank" rel="noopener" className="inline-flex items-center gap-1 rounded-md border border-primary/50 px-2 py-1 text-xs text-primary hover:bg-muted">{t('work_open')} <ExternalLink className="w-3.5 h-3.5" /></a>
                            ) : null
                          ) : (
                            <button disabled={busy} onClick={() => setConfirming(open ? null : { projectId: a.projectId, typed: '', refs: 0 })} aria-label={t('work_delete')} title={t('work_delete')} className="p-1.5 rounded-md border text-muted-foreground hover:text-red-500 disabled:opacity-50">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                      {a.blocked && (
                        <div className="text-sm text-amber-700 dark:text-amber-300 space-y-1">
                          <p>⚠ {blockText(a)}</p>
                          {a.blocked.code === 'SHARED_APP_IN_USE' && a.blocked.canvases.map((c) => (
                            <a key={c.workflowId} href={`/app/agent-studio?workflowId=${encodeURIComponent(c.workflowId)}`} target="_blank" rel="noopener" className="mr-3 inline-flex items-center gap-1 text-xs text-primary hover:underline">
                              {t('work_block_open_wf')}: {c.name} <ExternalLink className="w-3 h-3" />
                            </a>
                          ))}
                        </div>
                      )}
                      {open && !a.blocked && (
                        <div className="rounded-md border border-dashed border-red-500/50 p-3 space-y-2 text-sm">
                          <p className="text-muted-foreground">{t('work_delete_body')}</p>
                          {a.deletesWorkflow && <p className="text-amber-600 dark:text-amber-300">{t('work_wfdel_last').replace('{name}', name)}</p>}
                          {open.refs > 0 && <p className="text-amber-600 dark:text-amber-300">{t('work_delete_refs').replace('{n}', String(open.refs))}</p>}
                          <p className="text-muted-foreground">{t('work_delete_type')}</p>
                          <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-1.5">
                            <span className="flex-1 min-w-0 break-all font-mono select-all">{a.name}</span>
                            <button type="button" onClick={() => { void navigator.clipboard?.writeText(a.name).then(() => setCopied(a.name), () => {}) }} className="inline-flex items-center gap-1 text-xs text-primary hover:underline shrink-0">
                              {copied === a.name ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {copied === a.name ? t('work_delete_copied') : t('work_delete_copy')}
                            </button>
                          </div>
                          <input autoFocus autoComplete="off" aria-label={t('work_delete_type')} value={open.typed} onChange={(e) => setConfirming({ ...open, typed: e.target.value })} className="w-full rounded-md border bg-background px-3 py-1.5 text-sm" />
                          <div className="flex justify-end gap-2">
                            <button disabled={busy} onClick={() => setConfirming(null)} className="px-3 py-1.5 rounded-md border text-sm">{t('work_cancel')}</button>
                            <button disabled={busy || open.typed.trim() !== a.name.trim()} onClick={() => void deleteApp(a, open.refs)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-red-600 text-white text-sm disabled:opacity-40">
                              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {t('work_delete_confirm')}
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            ) : (
              <div className="space-y-3 text-sm">
                <p>{t('work_wfdel_empty')}</p>
                {confirmWf ? (
                  <div className="rounded-md border border-dashed border-red-500/50 p-3 space-y-2">
                    <p>{t('work_wfdel_confirm_wf').replace('{name}', name)}</p>
                    <div className="flex justify-end gap-2">
                      <button disabled={busy} onClick={() => setConfirmWf(false)} className="px-3 py-1.5 rounded-md border text-sm">{t('work_cancel')}</button>
                      <button disabled={busy} onClick={() => void deleteWorkflow()} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-red-600 text-white text-sm disabled:opacity-40">
                        {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {t('work_wfdel_delete_wf')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setConfirmWf(true)} className="inline-flex items-center gap-1.5 rounded-md border border-red-500/60 px-3 py-1.5 text-sm text-red-600 hover:bg-red-500/10">
                    <Trash2 className="w-4 h-4" /> {t('work_wfdel_delete_wf')}
                  </button>
                )}
              </div>
            )}
            <div className="flex items-center justify-between gap-2 pt-1">
              <button disabled={busy || loading} onClick={() => void load(workflowId)} className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50">
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />} {t('work_wfdel_reload')}
              </button>
              <button disabled={busy} onClick={close} className="px-3 py-1.5 rounded-md border text-sm">{t('work_wfdel_close')}</button>
            </div>
          </>
        )}
      </div>
      <BackupDownloadDialog target={backupTarget} onClose={() => setBackupTarget(null)} />
    </div>
  )
}
