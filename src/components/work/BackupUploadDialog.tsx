'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, Upload, X } from 'lucide-react'
import { useLanguage } from '@/hooks/useLanguage'

type Problem = { code: string; file?: number; part?: number; parts?: number[]; count?: number }
interface Report { ok: boolean; format: 1 | 2 | null; problems: Problem[]; signatureValid: boolean; sameAccount: boolean; appName: string | null; files: number }
interface Result { mode: 'copy' | 'original'; apps: Array<{ projectId: string; name: string }>; workflowId: string | null; canvasError: string | null; notRestored: string[]; copyBecause: string[] }
type Phase = 'pick' | 'sending' | 'checking' | 'report' | 'restoring' | 'done' | 'failed'

const mb = (b: number) => Math.round(b / 1_000_000)

export function BackupUploadDialog({ open, onClose }: { open: boolean; onClose: (changed: boolean) => void }) {
  const { t } = useLanguage()
  const [phase, setPhase] = useState<Phase>('pick')
  const [uploadId, setUploadId] = useState<string | null>(null)
  const [pieceBytes, setPieceBytes] = useState(8 * 1024 * 1024)
  const [sent, setSent] = useState({ done: 0, total: 0 })
  const [report, setReport] = useState<Report | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [asCopy, setAsCopy] = useState(false)
  const pickRef = useRef<HTMLInputElement>(null)
  const indexOf = useRef(new Map<string, number>())
  const gen = useRef(0)
  const [retry, setRetry] = useState<'check' | 'restore' | 'status' | null>(null)

  useEffect(() => {
    if (!open) return
    gen.current++
    setPhase('pick'); setUploadId(null); setSent({ done: 0, total: 0 }); setReport(null); setResult(null); setError(null); setAsCopy(false); setRetry(null)
    indexOf.current = new Map()
    return () => { gen.current++ }
  }, [open])

  if (!open) return null
  const close = () => onClose(phase === 'done' || phase === 'failed')
  const fail = (why: string, again: 'check' | 'restore' | 'status' | null) => { setError(why); setRetry(again); setPhase('failed') }

  const putWithRetry = async (url: string, body: Blob) => {
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body, signal: AbortSignal.timeout(120_000) }).catch(() => null)
      if (res && res.ok) return
      if ((res && res.status < 500) || attempt >= 3) {
        const j = res ? (await res.json().catch(() => ({}))) as { error?: string; detail?: string | null } : {}
        throw new Error(j.detail || j.error || (res ? `HTTP ${res.status}` : 'NETWORK'))
      }
      await new Promise((r) => setTimeout(r, 1000 * attempt))
    }
  }

  const check = async (id: string, my: number) => {
    setPhase('checking'); setError(null)
    const res = await fetch(`/api/work-backups/uploads/${encodeURIComponent(id)}/check`, { method: 'POST' }).catch(() => null)
    const j = res && res.ok ? (await res.json().catch(() => null)) as Report | null : null
    if (my !== gen.current) return
    if (!j) { fail(res ? `HTTP ${res.status}` : 'NETWORK', 'check'); return }
    setReport(j); setPhase('report')
  }

  const send = async (picked: File[]) => {
    const files = picked.filter((f) => f.size > 0)
    const skipped = picked.length - files.length
    if (!files.length) { setError(skipped ? t('work_up_empty_file') : null); return }
    const my = gen.current
    setError(null); setPhase('sending')
    let id = uploadId
    let piece = pieceBytes
    if (!id) {
      const res = await fetch('/api/work-backups/uploads', { method: 'POST' }).catch(() => null)
      const j = res && res.ok ? (await res.json().catch(() => null)) as { uploadId: string; pieceBytes: number } | null : null
      if (my !== gen.current) return
      if (!j) { fail(res ? `HTTP ${res.status}` : 'NETWORK', null); return }
      id = j.uploadId; piece = j.pieceBytes
      setUploadId(id); setPieceBytes(piece)
    }
    const total = files.reduce((n, f) => n + f.size, 0)
    let done = 0
    setSent({ done: 0, total })
    try {
      for (const f of files) {
        const k = `${f.name}|${f.size}|${f.lastModified}`
        const index = indexOf.current.get(k) ?? indexOf.current.size + 1
        indexOf.current.set(k, index)
        for (let o = 0; o < f.size; o += piece) {
          if (my !== gen.current) return
          try {
            await putWithRetry(`/api/work-backups/uploads/${encodeURIComponent(id)}/files/${index}?offset=${o}&total=${f.size}`, f.slice(o, Math.min(f.size, o + piece)))
          } catch (e) {
            if (e instanceof Error && /different bytes|part size changed/.test(e.message)) throw new Error(t('work_up_conflict').replace('{name}', f.name))
            throw e
          }
          done += Math.min(piece, f.size - o)
          if (my === gen.current) setSent({ done, total })
        }
      }
    } catch (e) {
      if (my !== gen.current) return
      setError(t('work_up_send_failed').replace('{why}', e instanceof Error ? e.message : 'ERROR'))
      setPhase(report ? 'report' : 'pick')
      return
    }
    await check(id, my)
    if (skipped && my === gen.current) setError(t('work_up_empty_file'))
  }

  const follow = async (id: string, my: number) => {
    setPhase('restoring'); setError(null)
    let misses = 0
    for (;;) {
      await new Promise((r) => setTimeout(r, 2000))
      if (my !== gen.current) return
      const s = await fetch(`/api/work-backups/uploads/${encodeURIComponent(id)}`, { cache: 'no-store' }).catch(() => null)
      const j = s && s.ok ? (await s.json().catch(() => null)) as { state: string; error: string | null; result: Result | null } | null : null
      if (my !== gen.current) return
      if (s && (s.status === 401 || s.status === 404)) { fail(`HTTP ${s.status}`, null); return }
      if (!j) { if (++misses >= 10) { fail('NETWORK', 'status'); return } continue }
      misses = 0
      if (j.state === 'done' && j.result) { setResult(j.result); setPhase('done'); return }
      if (j.state === 'failed') { fail(j.error || 'INTERNAL', 'restore'); return }
      if (j.state === 'checked') { fail('NOT_STARTED', 'restore'); return }
    }
  }

  const restore = async () => {
    if (!uploadId) return
    const my = gen.current
    setPhase('restoring'); setError(null)
    const res = await fetch(`/api/work-backups/uploads/${encodeURIComponent(uploadId)}/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(asCopy ? { mode: 'copy' } : {}) }).catch(() => null)
    if (my !== gen.current) return
    if (res && !res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      if (my !== gen.current) return
      if (j.error !== 'STALE') { fail(j.error || `HTTP ${res.status}`, j.error === 'NO_AGENT' ? null : 'restore'); return }
    }
    await follow(uploadId, my)
  }

  const again = () => {
    if (!uploadId) return
    const my = gen.current
    if (retry === 'check') void check(uploadId, my)
    else if (retry === 'status') void follow(uploadId, my)
    else void restore()
  }

  const problemText = (p: Problem) => t(`work_up_p_${p.code}`)
    .replace('{file}', String(p.file ?? '')).replace('{part}', String(p.part ?? '')).replace('{parts}', (p.parts ?? []).join(', ')).replace('{count}', String(p.count ?? ''))
  const busy = phase === 'restoring'
  const original = report?.format === 2 && report.sameAccount && report.signatureValid
  const failedText = error === 'STALE: WAIT_PURGE' ? t('work_up_wait_purge') : error ? t('work_up_failed').replace('{why}', error) : ''

  return (
    <div className="fixed inset-0 z-[60] flex items-stretch sm:items-center justify-center bg-black/50 sm:px-4" role="dialog" aria-modal="true">
      <div className="w-full sm:max-w-xl h-full sm:h-auto sm:max-h-[90vh] overflow-y-auto sm:rounded-lg border bg-background p-5 sm:p-6 space-y-4">
        <div className="flex items-start gap-3">
          <h2 className="flex-1 min-w-0 text-lg font-semibold">{t('work_up_title')}</h2>
          {!busy && <button type="button" onClick={close} aria-label={t('work_bk_close')} className="shrink-0 p-1 rounded text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>}
        </div>
        <input ref={pickRef} type="file" multiple accept=".zip,application/zip" className="hidden" onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ''; void send(fs) }} />

        {(phase === 'pick' || (phase === 'report' && !report?.ok)) && (
          <div className="space-y-3">
            {phase === 'pick' && <p className="text-sm text-muted-foreground">{t('work_up_pick')}</p>}
            {phase === 'report' && report && (
              <div className="rounded-md border border-amber-500/50 bg-amber-50/60 dark:bg-amber-950/20 p-3 text-sm space-y-1">
                <p className="flex items-center gap-1.5 font-medium"><AlertTriangle className="w-4 h-4 text-amber-600" /> {t('work_up_problems')}</p>
                <ul className="list-disc pl-5">{report.problems.map((p, i) => <li key={i}>{problemText(p)}</li>)}</ul>
              </div>
            )}
            {error && <p className="text-sm text-red-500">{error}</p>}
            <button type="button" onClick={() => pickRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-muted">
              <Upload className="w-4 h-4" /> {phase === 'pick' ? t('work_up_choose') : t('work_up_add')}
            </button>
          </div>
        )}

        {phase === 'sending' && (
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> {t('work_up_sending').replace('{done}', String(mb(sent.done))).replace('{total}', String(mb(sent.total)))}</p>
            <div className="h-2 rounded bg-muted overflow-hidden"><div className="h-full bg-primary transition-all" style={{ width: `${sent.total ? Math.round((sent.done / sent.total) * 100) : 0}%` }} /></div>
          </div>
        )}
        {phase === 'checking' && <p className="flex items-center gap-2 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> {t('work_up_checking')}</p>}

        {phase === 'report' && report?.ok && (
          <div className="space-y-3">
            <p className="flex items-center gap-1.5 text-sm"><CheckCircle2 className="w-4 h-4 text-emerald-600" /> {t('work_up_ok').replace('{name}', report.appName ?? '').replace('{files}', String(report.files))}</p>
            <p className="text-sm text-muted-foreground">{original ? t('work_up_original_hint') : t('work_up_copy_hint')}</p>
            {original && (
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={asCopy} onChange={(e) => setAsCopy(e.target.checked)} /> {t('work_up_as_copy')}</label>
            )}
            {error && <p className="text-sm text-red-500">{error}</p>}
            <button type="button" onClick={() => void restore()} className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm hover:opacity-90">{t('work_up_restore')}</button>
          </div>
        )}

        {phase === 'restoring' && <p className="flex items-center gap-2 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> {t('work_up_restoring')}</p>}

        {phase === 'done' && result && (
          <div className="space-y-3 text-sm">
            <p className="flex items-start gap-1.5"><CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600" /> {result.mode === 'original' ? t('work_up_done_original') : t('work_up_done_copy').replace('{n}', String(result.apps.length))}</p>
            {result.mode === 'copy' && result.copyBecause.length > 0 && (
              <p className="text-muted-foreground">{t('work_up_why')} {result.copyBecause.map((c) => t(`work_up_why_${c}`)).join(' · ')}</p>
            )}
            {result.notRestored.length > 0 && (
              <p className="text-muted-foreground">{t('work_up_not_restored')} {result.notRestored.map((c) => t(`work_up_nr_${c}`)).join(' · ')}</p>
            )}
            {result.canvasError && <p className="text-amber-600 dark:text-amber-300">{t('work_up_canvas_error').replace('{code}', result.canvasError)}</p>}
            {result.workflowId && (
              <Link href={`/app/agent-studio?workflowId=${encodeURIComponent(result.workflowId)}`} target="_blank" className="inline-flex items-center gap-1 text-primary hover:underline">
                {t('work_up_open_workflow')} <ExternalLink className="w-3.5 h-3.5" />
              </Link>
            )}
          </div>
        )}

        {phase === 'failed' && (
          <div className="space-y-3">
            <p className="text-sm text-red-500">{failedText}</p>
            {uploadId && retry && <button type="button" onClick={again} className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-muted">{retry === 'check' ? t('work_up_check_again') : retry === 'status' ? t('work_up_status_again') : t('work_up_restore')}</button>}
          </div>
        )}

        {!busy && <div className="flex justify-end"><button onClick={close} className="px-3 py-1.5 rounded-md border text-sm">{t('work_bk_close')}</button></div>}
      </div>
    </div>
  )
}
