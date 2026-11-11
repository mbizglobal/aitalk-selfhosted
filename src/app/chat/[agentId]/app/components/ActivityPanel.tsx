'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { workT, type WorkLang } from '@/lib/translations/work'
import type { ActivityItem, ActivityList, ActivityPerson, WorkApi } from '../lib/api'
import { errorText } from './SheetTable'
import { useWorkPkg } from './work-pkg'

type T = (k: string, f?: string) => string

function personName(t: T, p: ActivityPerson): string {
  return p.you ? t('room_you') : p.name ?? t('room_someone')
}

function whoText(t: T, a: ActivityItem): string {
  const w = a.who
  const base = w.kind === 'person' ? personName(t, w.person)
    : w.kind === 'ai' ? 'AI'
      : w.kind === 'module' ? (w.module.startsWith('core.') ? t('act_who_system') : t(`mod_${w.module}`, w.module))
        : w.kind === 'import' ? t(`mod_${w.module}`, w.module)
          : w.kind === 'other' ? w.label
            : `${t(`act_who_${w.kind}`)}${w.name ? ` ${w.name}` : ''}`
  return a.requestedBy ? `${t('act_requested').replace('{name}', personName(t, a.requestedBy))} · ${base}` : base
}

function targetText(t: T, a: ActivityItem): string {
  const parts: string[] = []
  if (a.sheet) parts.push(a.sheet.family ? t(`sheet_${a.sheet.family}`, a.sheet.name ?? a.sheet.family) : a.sheet.name ?? t('act_gone_sheet'))
  if (a.task) parts.push(a.task.title ?? t('act_gone_task'))
  if (a.file) parts.push(a.file.name ?? t('act_gone_file'))
  return parts.join(' · ')
}

const shown = (v: unknown): string => (v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v))

function Changes({ t, a }: { t: T; a: ActivityItem }) {
  if (!a.changes) return null
  const lines: Array<{ k: string; from: unknown; to: unknown }> = []
  if (a.sheet) {
    const b = (a.changes.before ?? {}) as { data?: Record<string, unknown>; confirmed?: boolean | null }
    const f = (a.changes.after ?? {}) as { data?: Record<string, unknown>; confirmed?: boolean | null }
    for (const k of [...new Set([...Object.keys(b.data ?? {}), ...Object.keys(f.data ?? {})])]) {
      const x = b.data?.[k]; const y = f.data?.[k]
      if (JSON.stringify(x ?? null) !== JSON.stringify(y ?? null)) lines.push({ k: t(`col_${k}`, k), from: x, to: y })
    }
    const yn = (v: boolean | null | undefined) => (typeof v === 'boolean' ? (v ? t('yes') : t('no')) : undefined)
    if (typeof f.confirmed === 'boolean' && b.confirmed !== f.confirmed) lines.push({ k: t('act_confirmed'), from: yn(b.confirmed), to: yn(f.confirmed) })
  } else if (Array.isArray(a.changes.after)) {
    for (const c of a.changes.after as unknown[]) if (c && typeof c === 'object' && typeof (c as { name?: unknown }).name === 'string') lines.push({ k: t(`set_${(c as { name: string }).name}`, (c as { name: string }).name), from: (c as { from?: unknown }).from, to: (c as { to?: unknown }).to })
  }
  if (!lines.length) return <p className="mt-1 text-xs text-gray-500">{t('act_no_changes')}</p>
  return (
    <dl className="mt-1 space-y-0.5 text-xs">
      {lines.map((l, i) => (
        <div key={i} className="flex gap-2 min-w-0">
          <dt className="shrink-0 text-gray-500">{l.k}</dt>
          <dd className="min-w-0 break-words text-gray-300"><span className="text-gray-500 line-through">{shown(l.from)}</span> → {shown(l.to)}</dd>
        </div>
      ))}
    </dl>
  )
}

export function ActivityPanel({ api, lang, projectId, refresh }: { api: WorkApi; lang: WorkLang; projectId: string; refresh: number }) {
  const pkg = useWorkPkg()
  const t: T = (k, f) => workT(lang, k, f, pkg)
  const [items, setItems] = useState<ActivityItem[] | null>(null)
  const [more, setMore] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)

  useEffect(() => { seq.current++; setItems(null); setMore(false); setOpen(null) }, [projectId])

  const load = useCallback(async () => {
    const my = ++seq.current
    setError(null)
    try {
      const r = await api<ActivityList>('GET', `/projects/${encodeURIComponent(projectId)}/activity`)
      if (my === seq.current) { setItems(r.items); setMore(r.more) }
    } catch (e) { if (my === seq.current) setError(errorText(lang, e, pkg)) }
  }, [api, projectId, lang, pkg])
  useEffect(() => { void load() }, [load, refresh])

  const loadMore = async () => {
    if (!items?.length) return
    const my = seq.current
    setBusy(true)
    try {
      const r = await api<ActivityList>('GET', `/projects/${encodeURIComponent(projectId)}/activity?before=${encodeURIComponent(items[items.length - 1].id)}`)
      if (my === seq.current) { setItems((cur) => [...(cur ?? []), ...r.items]); setMore(r.more) }
    } catch (e) { if (my === seq.current) setError(errorText(lang, e, pkg)) } finally { setBusy(false) }
  }

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-3">
      <p className="text-xs text-gray-500 mb-3">{t('act_help')}</p>
      {error && <p role="alert" className="text-sm text-red-400 mb-2">{error}</p>}
      {items === null ? (
        !error && <div className="py-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-[#E07B53]" /></div>
      ) : items.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-500">{t('act_empty')}</p>
      ) : (
        <ul className="divide-y divide-[#2A2A2A]">
          {items.map((a) => {
            const expandable = !!a.changes
            const target = targetText(t, a)
            return (
              <li key={a.id} className="py-2">
                <button onClick={() => expandable && setOpen((o) => (o === a.id ? null : a.id))} disabled={!expandable}
                  className={`w-full text-left flex items-start gap-1.5 ${expandable ? 'cursor-pointer' : 'cursor-default'}`} aria-expanded={expandable ? open === a.id : undefined}>
                  <span className="mt-0.5 w-3.5 shrink-0 text-gray-500">{expandable && (open === a.id ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2 text-xs">
                      <span className="text-gray-200">{whoText(t, a)}</span>
                      <span className="text-gray-500">{new Date(a.at).toLocaleString(lang, { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                    </span>
                    <span className="block text-sm text-white">
                      {t(`act_${a.action}`, a.action.replace(/_/g, ' '))}{target && <span className="text-gray-400"> · {target}</span>}
                    </span>
                    {a.why && <span className="block text-xs text-gray-400 break-words">{t('act_why').replace('{why}', a.why)}</span>}
                  </span>
                </button>
                {open === a.id && <div className="pl-5"><Changes t={t} a={a} /></div>}
              </li>
            )
          })}
        </ul>
      )}
      {more && (
        <button onClick={() => void loadMore()} disabled={busy} className="mt-2 w-full py-1.5 text-xs rounded-md text-gray-300 hover:bg-[#2A2A2A] disabled:opacity-50">
          {busy ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : t('act_more')}
        </button>
      )}
    </div>
  )
}
