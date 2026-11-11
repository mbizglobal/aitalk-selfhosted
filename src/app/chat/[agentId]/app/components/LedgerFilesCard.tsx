'use client'

import React, { useRef, useState } from 'react'
import { ArrowUpRight, CheckCircle2, FileText, Landmark, Loader2 } from 'lucide-react'
import { workT, type WorkLang } from '@/lib/translations/work'
import { WorkApiError, saveCardDone, type CardDone, type WorkApi } from '../lib/api'
import { errorText } from './SheetTable'
import { useWorkPkg } from './work-pkg'

export function LedgerFilesCard({ messageId, index, files, ledgerUrl, api, lang, projectId, disabled, onDone, initialDone }: {
  messageId: string
  index: number
  files: Array<{ fileId: string; name: string }>
  ledgerUrl: string | null
  api: WorkApi
  lang: WorkLang
  projectId: string
  disabled: boolean
  onDone: () => void
  initialDone?: CardDone
}) {
  const pkg = useWorkPkg()
  const t = (k: string, f?: string) => workT(lang, k, f, pkg)
  const [busy, setBusy] = useState(false)
  const num = (v: unknown) => (typeof v === 'number' ? v : 0)
  const [done, setDone] = useState<{ sent: number; already: number; gone: number; url: string | null } | null>(
    initialDone ? { sent: num(initialDone.sent), already: num(initialDone.already), gone: num(initialDone.gone), url: typeof initialDone.url === 'string' ? initialDone.url : null } : null)
  const [error, setError] = useState<string | null>(null)
  const inflight = useRef(false)
  const run = async () => {
    if (inflight.current) return
    inflight.current = true
    setBusy(true); setError(null)
    try {
      const r = await api<{ sent: number; already: number; gone: number; ledgerUrl: string | null }>('POST', `/projects/${encodeURIComponent(projectId)}/ledger-files`, { messageId, index })
      setDone({ sent: r.sent, already: r.already, gone: r.gone, url: r.ledgerUrl })
      saveCardDone(api, projectId, messageId, index, { sent: r.sent, already: r.already, gone: r.gone, url: r.ledgerUrl })
      onDone()
    } catch (e) {
      setError(e instanceof WorkApiError && e.code === 'STALE' ? t('ledger_files_stale') : errorText(lang, e, pkg))
    } finally {
      inflight.current = false
      setBusy(false)
    }
  }
  const url = done?.url ?? ledgerUrl
  return (
    <div className="rounded-lg border border-[#3A3A3A] bg-[#232323] p-3 text-sm space-y-1.5">
      <p className="text-gray-200">{t('ledger_files_title')}</p>
      <ul className="max-h-40 overflow-y-auto space-y-0.5 text-xs text-gray-300">
        {files.map((f) => <li key={f.fileId} className="flex items-center gap-1.5 min-w-0"><FileText className="w-3.5 h-3.5 shrink-0 text-gray-500" /><span className="truncate">{f.name}</span></li>)}
      </ul>
      {error && <p role="alert" className="text-xs text-red-400 whitespace-pre-line">{error}</p>}
      {done !== null ? (
        <div className="space-y-1.5">
          {done.sent + done.already === 0 ? (
            <p className="text-xs text-amber-400">{t('ledger_files_gone_all')}</p>
          ) : (
            <p className="text-xs text-emerald-400 inline-flex items-center gap-1 flex-wrap">
              <CheckCircle2 className="w-3.5 h-3.5" />{t('ledger_files_done').replace('{n}', String(done.sent))}
              {done.already > 0 && <span className="text-gray-400">· {t('ledger_files_already').replace('{n}', String(done.already))}</span>}
              {done.gone > 0 && <span className="text-amber-400">· {t('ledger_files_gone').replace('{n}', String(done.gone))}</span>}
            </p>
          )}
          {url && done.sent + done.already > 0 && (
            <a href={`${url}&lang=${lang}&ask=statements`} target="_blank" rel="noopener noreferrer"
              className="px-3 py-1.5 text-sm rounded-md bg-[#E07B53] text-white hover:opacity-90 inline-flex items-center gap-1">
              <Landmark className="w-3.5 h-3.5" />{t('ledger_files_open')}<ArrowUpRight className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      ) : (
        <>
          <button disabled={disabled || busy} onClick={() => void run()}
            className="px-3 py-1.5 text-sm rounded-md bg-[#E07B53] text-white hover:opacity-90 disabled:opacity-40 inline-flex items-center gap-1">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Landmark className="w-3.5 h-3.5" />}{t('ledger_files_button').replace('{n}', String(files.length))}
          </button>
          <p className="text-[11px] text-gray-500">{t('ledger_files_note')}</p>
        </>
      )}
    </div>
  )
}
