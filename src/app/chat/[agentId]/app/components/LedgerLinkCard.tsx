'use client'

import React, { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Landmark, Loader2 } from 'lucide-react'
import { workT, type WorkLang } from '@/lib/translations/work'
import { WorkApiError, type WorkApi } from '../lib/api'
import { errorText } from './SheetTable'
import { useWorkPkg } from './work-pkg'

export interface LedgerLinkRow { date: string; amount: string; currency: string; counterparty: string; target: string; chosen: boolean; replacesHand?: boolean }

export function LedgerLinkCard({ messageId, index, count, replaces, rows, detail, api, lang, projectId, disabled, onDone }: {
  messageId: string
  index: number
  count: number
  replaces: number
  rows: LedgerLinkRow[]
  detail: string
  api: WorkApi
  lang: WorkLang
  projectId: string
  disabled: boolean
  onDone: () => void
}) {
  const pkg = useWorkPkg()
  const t = (k: string, f?: string) => workT(lang, k, f, pkg)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ linked: number; skipped: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inflight = useRef(false)
  useEffect(() => {
    let alive = true
    api<{ linked: number; total: number }>('GET', `/projects/${encodeURIComponent(projectId)}/ledger-link?messageId=${encodeURIComponent(messageId)}&index=${index}`)
      .then((r) => { if (alive && r.total > 0 && r.linked === r.total) setDone((d) => d ?? { linked: r.linked, skipped: 0 }) })
      .catch(() => { })
    return () => { alive = false }
  }, [api, projectId, messageId, index])
  const run = async () => {
    if (inflight.current) return
    inflight.current = true
    setBusy(true); setError(null)
    try {
      const r = await api<{ linked: number; skipped: unknown[] }>('POST', `/projects/${encodeURIComponent(projectId)}/ledger-link`, { messageId, index })
      setDone({ linked: r.linked, skipped: r.skipped.length })
      onDone()
    } catch (e) {
      setError(e instanceof WorkApiError && e.code === 'STALE' ? t('ledger_link_stale') : errorText(lang, e, pkg))
    } finally {
      inflight.current = false
      setBusy(false)
    }
  }
  return (
    <div className="rounded-lg border border-[#3A3A3A] bg-[#232323] p-3 text-sm space-y-1.5">
      {detail && <p className="text-gray-200 break-words whitespace-pre-line">{detail}</p>}
      {rows.length > 0 && (
        <ul className="max-h-56 overflow-y-auto space-y-0.5 text-xs text-gray-300">
          {rows.map((r, i) => (
            <li key={i} className="flex flex-wrap gap-x-1.5">
              <span className="text-gray-500 tabular-nums">{r.date}</span>
              <span className="tabular-nums">{r.amount} {r.currency}</span>
              {r.counterparty && <span className="text-gray-400 truncate max-w-[12rem]">{r.counterparty}</span>}
              <span className="text-gray-500">→</span>
              <span className="break-words">{r.target}</span>
              {r.chosen && <span className="text-amber-400">({t('ledger_link_chosen')})</span>}
              {r.replacesHand && <span className="text-sky-400">({t('ledger_link_replaces_hand')})</span>}
            </li>
          ))}
        </ul>
      )}
      {replaces > 0 && <p className="text-xs text-amber-400">{t('ledger_link_replaces').replace('{n}', String(replaces))}</p>}
      {error && <p role="alert" className="text-xs text-red-400 whitespace-pre-line">{error}</p>}
      {done !== null ? (
        <p className="text-xs text-emerald-400 inline-flex items-center gap-1 flex-wrap">
          <CheckCircle2 className="w-3.5 h-3.5" />{t('ledger_link_done').replace('{n}', String(done.linked))}
          {done.skipped > 0 && <span className="text-gray-400">· {t('ledger_link_skipped').replace('{n}', String(done.skipped))}</span>}
        </p>
      ) : (
        <>
          <button disabled={disabled || busy} onClick={() => void run()}
            className="px-3 py-1.5 text-sm rounded-md bg-[#E07B53] text-white hover:opacity-90 disabled:opacity-40 inline-flex items-center gap-1">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Landmark className="w-3.5 h-3.5" />}{t('ledger_link_button').replace('{n}', String(count))}
          </button>
          <p className="text-[11px] text-gray-500">{t('ledger_link_note')}</p>
        </>
      )}
    </div>
  )
}
