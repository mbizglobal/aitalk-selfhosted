'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Download, Loader2, X } from 'lucide-react'
import { useLanguage } from '@/hooks/useLanguage'

export interface BackupTarget { scope: 'workflow' | 'app'; id: string; name: string }
interface Part { n: number; bytes: number; files: number; fileName: string }
interface Job { state: 'preparing' | 'ready' | 'failed'; error: string | null; partCount: number; expiresAt: string; parts: Part[] }

const mb = (b: number) => (b / 1_000_000).toFixed(b < 10_000_000 ? 1 : 0)

export function BackupDownloadDialog({ target, onClose }: { target: BackupTarget | null; onClose: () => void }) {
  const { t, currentLanguage } = useLanguage()
  const [jobId, setJobId] = useState<string | null>(null)
  const [job, setJob] = useState<Job | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [started, setStarted] = useState<Set<number>>(new Set())
  const [all, setAll] = useState(false)
  const seq = useRef(0)

  useEffect(() => {
    if (!target) return
    const my = ++seq.current
    setJobId(null); setJob(null); setError(null); setStarted(new Set()); setAll(false)
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async (id: string) => {
      const res = await fetch(`/api/work-backups/${encodeURIComponent(id)}`, { cache: 'no-store' }).catch(() => null)
      const j = res && res.ok ? (await res.json().catch(() => null)) as Job | null : null
      if (my !== seq.current) return
      if (!j) { setError('NETWORK'); return }
      setJob(j)
      if (j.state === 'preparing') timer = setTimeout(() => void poll(id), 2000)
    }
    void (async () => {
      const res = await fetch('/api/work-backups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: target.scope, id: target.id }) }).catch(() => null)
      const j = res ? (await res.json().catch(() => ({}))) as { jobId?: string; error?: string; detail?: string | null } : {}
      if (my !== seq.current) return
      if (!res || !res.ok || !j.jobId) { setError(j.detail || j.error || 'NETWORK'); return }
      setJobId(j.jobId)
      void poll(j.jobId)
    })()
    return () => { seq.current++; if (timer) clearTimeout(timer) }
  }, [target])

  useEffect(() => {
    if (!target) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [target, onClose])

  if (!target) return null
  const href = (n: number) => `/api/work-backups/${encodeURIComponent(jobId ?? '')}/parts/${n}`
  const mark = (n: number) => setStarted((s) => new Set(s).add(n))
  const expired = () => !!job && new Date(job.expiresAt).getTime() <= Date.now()
  const downloadAll = async () => {
    if (!job) return
    const my = seq.current
    if (expired()) { setError('EXPIRED'); return }
    setAll(true)
    for (const p of job.parts) {
      if (my !== seq.current) return
      if (expired()) { setError('EXPIRED'); setAll(false); return }
      const a = document.createElement('a')
      a.href = href(p.n); a.download = p.fileName
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      mark(p.n)
      await new Promise((r) => setTimeout(r, 1500))
    }
    if (my === seq.current) setAll(false)
  }
  const failed = error ?? (job?.state === 'failed' ? job.error ?? 'INTERNAL' : null)
  const expires = job ? new Date(job.expiresAt).toLocaleString(currentLanguage === 'ko' ? 'ko-KR' : currentLanguage === 'de' || currentLanguage === 'de-ch' ? 'de-CH' : currentLanguage === 'fr' ? 'fr-CH' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : ''

  return (
    <div className="fixed inset-0 z-[60] flex items-stretch sm:items-center justify-center bg-black/50 sm:px-4" role="dialog" aria-modal="true">
      <div className="w-full sm:max-w-xl h-full sm:h-auto sm:max-h-[90vh] overflow-y-auto sm:rounded-lg border bg-background p-5 sm:p-6 space-y-4">
        <div className="flex items-start gap-3">
          <h2 className="flex-1 min-w-0 text-lg font-semibold break-words">{t('work_bk_title').replace('{name}', target.name)}</h2>
          <button type="button" onClick={onClose} aria-label={t('work_bk_close')} className="shrink-0 p-1 rounded text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        {failed ? (
          <p className="text-sm text-red-500">{t('work_bk_failed').replace('{why}', failed)}</p>
        ) : !job || job.state === 'preparing' ? (
          <p className="flex items-start gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 mt-0.5 shrink-0 animate-spin" /> {t('work_bk_preparing')}</p>
        ) : (
          <>
            <p className="text-sm">{t('work_bk_ready').replace('{n}', String(job.partCount))}</p>
            <ul className="divide-y rounded-md border">
              {job.parts.map((p) => (
                <li key={p.n} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{t('work_bk_part').replace('{n}', String(p.n)).replace('{of}', String(job.partCount))}</p>
                    <p className="text-xs text-muted-foreground truncate">{p.fileName} · {mb(p.bytes)} MB</p>
                  </div>
                  {started.has(p.n) && <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-300 shrink-0"><Check className="w-3.5 h-3.5" /> {t('work_bk_started')}</span>}
                  <a href={href(p.n)} download={p.fileName} onClick={(e) => { if (expired()) { e.preventDefault(); setError('EXPIRED'); return } mark(p.n) }} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted shrink-0">
                    <Download className="w-3.5 h-3.5" /> {t('work_bk_short')}
                  </a>
                </li>
              ))}
            </ul>
            {job.partCount > 1 && (
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" disabled={all} onClick={() => void downloadAll()} className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50">
                  {all ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} {t('work_bk_all')}
                </button>
                <span className="text-xs text-muted-foreground">{t('work_bk_all_note')}</span>
              </div>
            )}
            <p className="text-xs text-muted-foreground">{t('work_bk_expires').replace('{time}', expires)} {t('work_bk_note')}</p>
          </>
        )}
        <div className="flex justify-end"><button onClick={onClose} className="px-3 py-1.5 rounded-md border text-sm">{t('work_bk_close')}</button></div>
      </div>
    </div>
  )
}
