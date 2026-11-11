'use client'

import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react'
import { useLanguage } from '@/hooks/useLanguage'
import type { ProposalView } from '@/lib/work/assembled-proposals'
import type { SpecChange } from '@/lib/work/assembled-change'

type View = Omit<ProposalView, 'expiresAt'> & { expiresAt: string }

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-muted/30 flex items-start justify-center px-4 py-10">
      <div className="w-full max-w-2xl">{children}</div>
    </div>
  )
}

function StatusCard({ icon, tone, title, message, action }: { icon: React.ReactNode; tone: 'ok' | 'warn' | 'error'; title: string; message: string; action?: React.ReactNode }) {
  const toneClass = tone === 'ok' ? 'text-emerald-600' : tone === 'warn' ? 'text-amber-600' : 'text-red-600'
  return (
    <div className="rounded-xl border bg-background p-8 shadow-sm text-center">
      <div className={`mx-auto mb-4 flex justify-center ${toneClass}`}>{icon}</div>
      <h1 className="text-lg font-semibold mb-2">{title}</h1>
      <p className="text-sm text-muted-foreground whitespace-pre-line">{message}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}

function codeWord(t: (k: string) => string, code: SpecChange['code'], v: string | undefined): string {
  if (!v) return ''
  const tr = (k: string) => { const x = t(k); return x === k ? null : x }
  if (code === 'column_added') return tr(`spec_kind_${v}`) ?? v
  if (code === 'confirm_changed') return v.startsWith('column:') ? (tr('spec_by_column') ?? v).replace('{name}', v.slice(7)) : (tr(`spec_by_${v}`) ?? v)
  return v
}

function changeText(t: (k: string) => string, c: SpecChange): string {
  const p: Record<string, string> = { table: c.table ?? '', name: c.name ?? '', from: codeWord(t, c.code, c.from), to: codeWord(t, c.code, c.to), values: (c.values ?? []).join(', ') }
  const raw = t(`spec_change_${c.code}`)
  const tpl = raw === `spec_change_${c.code}` ? c.code : raw
  const text = tpl.replace(/\{(\w+)\}/g, (all, k: string) => (k in p ? p[k] : all))
  return c.code === 'column_added' && c.values?.includes('hidden') ? `${text} · ${t('spec_confirm_hidden')}` : text
}

export function SpecConfirmClient(props: { proposalId: string; notFound?: boolean; view?: View }) {
  const { t } = useLanguage()
  const [busy, setBusy] = useState<'apply' | 'cancel' | null>(null)
  const [done, setDone] = useState<'applied' | 'canceled' | null>(null)
  const [error, setError] = useState<{ code: string; issues?: Array<{ path: string; code: string; message: string }> } | null>(null)
  const v = props.view

  const openApp = v?.appPath ? (
    <a href={v.appPath} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">{t('spec_confirm_open_app')}</a>
  ) : null

  if (props.notFound || !v) return <Shell><StatusCard icon={<XCircle className="h-10 w-10" />} tone="error" title={t('spec_confirm_not_found_title')} message={t('spec_confirm_not_found_body')} /></Shell>
  if (done === 'applied' || v.state === 'applied') return <Shell><StatusCard icon={<CheckCircle2 className="h-10 w-10" />} tone="ok" title={t('spec_confirm_applied_title')} message={t('spec_confirm_applied_body')} action={openApp} /></Shell>
  if (done === 'canceled' || v.state === 'canceled') return <Shell><StatusCard icon={<XCircle className="h-10 w-10" />} tone="warn" title={t('spec_confirm_canceled_title')} message={t('spec_confirm_ask_again')} action={openApp} /></Shell>
  if (v.state === 'expired' || error?.code === 'EXPIRED') return <Shell><StatusCard icon={<Clock className="h-10 w-10" />} tone="warn" title={t('spec_confirm_expired_title')} message={t('spec_confirm_ask_again')} action={openApp} /></Shell>
  if (v.state === 'stale' || error?.code === 'STALE') return <Shell><StatusCard icon={<AlertTriangle className="h-10 w-10" />} tone="warn" title={t('spec_confirm_stale_title')} message={t('spec_confirm_stale_body')} action={openApp} /></Shell>
  if (error?.code === 'USED') return <Shell><StatusCard icon={<XCircle className="h-10 w-10" />} tone="warn" title={t('spec_confirm_used_title')} message={t('spec_confirm_ask_again')} action={openApp} /></Shell>

  const recheck = () => { window.location.reload() }
  const act = async (kind: 'apply' | 'cancel') => {
    if (busy) return
    setBusy(kind)
    setError(null)
    try {
      const res = await fetch(`/api/work-projects/spec-proposals/${encodeURIComponent(props.proposalId)}`, { method: kind === 'apply' ? 'POST' : 'DELETE' })
      const body = (await res.json().catch(() => ({}))) as { error?: string; issues?: Array<{ path: string; code: string; message: string }>; canceled?: boolean }
      if (res.ok && (kind === 'apply' || body.canceled === true)) { setDone(kind === 'apply' ? 'applied' : 'canceled'); return }
      if (res.ok || body.error === 'USED' || body.error === 'NOT_FOUND' || body.error === 'EXPIRED' || body.error === 'STALE') { recheck(); return }
      setError({ code: body.error ?? 'ERROR', ...(body.issues ? { issues: body.issues } : {}) })
      setBusy(null)
    } catch {
      recheck()
    }
  }

  const expires = new Date(v.expiresAt)
  return (
    <Shell>
      <div className="rounded-xl border bg-background shadow-sm">
        <div className="border-b p-6">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('spec_confirm_eyebrow')}</p>
          <h1 className="mt-1 text-xl font-semibold break-words">{v.appName}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t('spec_confirm_subtitle')}</p>
          <p className="mt-3 text-xs text-muted-foreground">
            {t('spec_confirm_version').replace('{from}', String(v.baseVersion)).replace('{to}', String(v.baseVersion + 1))} · {t('spec_confirm_expires')} {expires.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>

        <div className="p-6 space-y-6">
          <section>
            <h2 className="text-sm font-semibold mb-2">{t('spec_confirm_section_changes')}</h2>
            {v.changes.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('spec_confirm_no_changes')}</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {v.changes.map((c, i) => (
                  <li key={i} className="flex gap-2"><span className="text-muted-foreground">•</span><span className="break-words min-w-0">{changeText(t, c)}</span></li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="text-sm font-semibold mb-2">{t('spec_confirm_section_rows')}</h2>
            <p className="text-xs text-muted-foreground mb-2">{t('spec_confirm_rows_note')}</p>
            <ul className="text-sm divide-y rounded-lg border">
              {v.rows.map((r) => (
                <li key={r.table} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="break-words min-w-0">{r.table}{r.hidden ? <span className="ml-2 text-xs text-muted-foreground">({t('spec_confirm_hidden')})</span> : null}</span>
                  <span className="tabular-nums text-muted-foreground shrink-0">{r.rows}</span>
                </li>
              ))}
            </ul>
          </section>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              <p className="font-medium">{error.code === 'SPEC_INVALID' ? t('spec_confirm_rejected') : t('spec_confirm_error')}</p>
              {error.issues?.length ? (
                <ul className="mt-2 list-disc pl-5 space-y-1 break-words">{error.issues.slice(0, 20).map((x, i) => <li key={i}><code className="text-xs">{x.code}</code> {x.message}</li>)}</ul>
              ) : null}
            </div>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button onClick={() => act('cancel')} disabled={!!busy} className="inline-flex items-center justify-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50">
              {busy === 'cancel' && <Loader2 className="h-4 w-4 animate-spin" />}{t('spec_confirm_cancel')}
            </button>
            <button onClick={() => act('apply')} disabled={!!busy} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
              {busy === 'apply' && <Loader2 className="h-4 w-4 animate-spin" />}{t('spec_confirm_apply')}
            </button>
          </div>
        </div>
      </div>
    </Shell>
  )
}
