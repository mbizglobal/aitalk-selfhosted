'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, FileText, Landmark, X } from 'lucide-react'
import { workT, type WorkLang } from '@/lib/translations/work'
import type { ProjectFileView, WorkApi, WorkFiles } from '../lib/api'
import { errorText } from './SheetTable'
import { DecisionActions, StatusChip, fileDecisionLock } from './FilesPanel'
import { useWorkPkg } from './work-pkg'

const needsAttention = (f: ProjectFileView) => !f.status || f.status.status === 'new' || f.status.status === 'pending' || f.status.status === 'unreadable'

interface MissingReceipt { accountKey: string; lineKey: string; date: string; amount: string; currency: string; counterparty: string; card?: string }

export function AttentionMenu({ files, api, missingFrom, lang, projectId, refresh, readOnly, onAskAi, onChanged }: {
  files: WorkFiles
  api?: WorkApi
  missingFrom?: string
  lang: WorkLang
  projectId: string
  refresh: number
  readOnly: boolean
  onAskAi: (text: string) => void
  onChanged?: () => void
}) {
  const pkg = useWorkPkg()
  const t = (k: string, f?: string) => workT(lang, k, f, pkg)
  const [list, setList] = useState<ProjectFileView[]>([])
  const [missing, setMissing] = useState<{ total: number; lines: MissingReceipt[] }>({ total: 0, lines: [] })
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const close = () => { setOpen(false); btnRef.current?.focus() }

  const load = useCallback(async () => {
    const my = ++seq.current
    try {
      const l = await files.list(projectId)
      if (my === seq.current) { setList(l.filter(needsAttention)); setError(null) }
    } catch {
    }
  }, [files, projectId])
  useEffect(() => { void load() }, [load, refresh])
  useEffect(() => {
    if (!api || !missingFrom) return
    let live = true
    api<{ output?: { missingReceipts?: { total: number; lines: MissingReceipt[] } } }>('POST', `/projects/${encodeURIComponent(projectId)}/modules/${encodeURIComponent(missingFrom)}`, { input: {} })
      .then((r) => { if (live && r.output?.missingReceipts) setMissing(r.output.missingReceipts) })
      .catch(() => { })
    return () => { live = false }
  }, [api, missingFrom, projectId, refresh])
  const count = list.length + missing.total
  useEffect(() => { if (count === 0) setOpen(false) }, [count])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (boxRef.current?.contains(document.activeElement) && document.activeElement?.tagName === 'SELECT') return
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus() } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  if (count === 0) return null

  const decide = async (fileId: string, action: 'exclude' | 'reset' | 'detach', reason?: string) => {
    if (fileDecisionLock.busy) return
    fileDecisionLock.busy = true
    setBusy(true); setError(null)
    try { await files.decide(projectId, fileId, action, reason); await load(); onChanged?.() } catch (e) { setError(errorText(lang, e, pkg)) } finally { fileDecisionLock.busy = false; setBusy(false) }
  }

  return (
    <div ref={boxRef} className="relative shrink-0 flex items-center pt-2 px-2 border-l border-[#2A2A2A]">
      <button ref={btnRef} onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="dialog"
        className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-amber-500/50 text-amber-300 hover:bg-amber-500/10">
        <AlertCircle className="w-3.5 h-3.5" />{t('attention_button').replace('{n}', String(count))}
      </button>
      {open && (
        <div role="dialog" aria-label={t('attention_title')} className="absolute right-0 top-full mt-2 z-30 w-[min(28rem,90vw)] max-h-[70vh] overflow-y-auto rounded-lg border border-[#3A3A3A] bg-[#1A1A1A] shadow-xl">
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[#2A2A2A]">
            <p className="text-sm text-gray-200">{t('attention_title')}</p>
            <button onClick={close} aria-label={t('close')} className="p-1 text-gray-500 hover:text-gray-200"><X className="w-4 h-4" /></button>
          </div>
          {error && <p role="alert" className="px-3 py-2 text-xs text-red-400">{error}</p>}
          <ul className="divide-y divide-[#2A2A2A]">
            {list.map((f) => (
              <li key={f.id} className="group flex items-start gap-2 px-3 py-2">
                <button onClick={() => void files.open(projectId, f.id).catch((e) => setError(errorText(lang, e, pkg)))} className="flex-1 min-w-0 flex items-start gap-2 text-left">
                  <FileText className="w-4 h-4 shrink-0 mt-0.5 text-gray-400" />
                  <span className="min-w-0">
                    <span className="block text-sm text-gray-200 truncate hover:text-white">{f.name}</span>
                    <span className="block mt-0.5"><StatusChip st={f.status} t={t} wrap /></span>
                  </span>
                </button>
                {!readOnly && <DecisionActions f={f} busy={busy} t={t} onAct={(action, reason) => void decide(f.id, action, reason)} />}
              </li>
            ))}
          </ul>
          {missing.total > 0 && (
            <div className="border-t border-[#2A2A2A]">
              <p className="px-3 pt-2 text-xs text-amber-300">{t('missing_receipts_title').replace('{n}', String(missing.total))}</p>
              <ul className="divide-y divide-[#2A2A2A]">
                {missing.lines.slice(0, 30).map((m) => (
                  <li key={`${m.accountKey}|${m.lineKey}`} className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-300">
                    <Landmark className="w-3.5 h-3.5 shrink-0 text-gray-500" />
                    <span className="tabular-nums text-gray-500">{m.date}</span>
                    <span className="tabular-nums">{m.amount} {m.currency}</span>
                    <span className="truncate text-gray-400">{m.counterparty || m.accountKey}</span>
                    {m.card && <span className="ml-auto shrink-0 truncate max-w-[40%] text-gray-500">{m.card}</span>}
                  </li>
                ))}
              </ul>
              {missing.total > 30 && <p className="px-3 pb-1 text-[11px] text-gray-500">{t('missing_receipts_more').replace('{n}', String(missing.total - 30))}</p>}
              {!readOnly && (
                <div className="px-3 py-2">
                  <button onClick={() => { onAskAi(t('missing_receipts_ask_text')); setOpen(false) }}
                    className="w-full px-3 py-1.5 text-xs rounded-md border border-[#E07B53] text-[#E07B53] hover:bg-[#E07B53]/10">{t('missing_receipts_ask_ai')}</button>
                </div>
              )}
            </div>
          )}
          {!readOnly && list.length > 0 && (
            <div className="px-3 py-2 border-t border-[#2A2A2A]">
              <button onClick={() => { onAskAi(t('attention_ask_text')); setOpen(false) }}
                className="w-full px-3 py-1.5 text-xs rounded-md bg-[#E07B53] text-white hover:bg-[#d06a43]">{t('attention_ask_ai')}</button>
              <p className="mt-1 text-[11px] text-gray-500">{t('attention_ask_hint')}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
