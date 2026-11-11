'use client'

import React, { useRef, useState } from 'react'
import { FileText, Landmark, Loader2 } from 'lucide-react'
import { workT, type WorkLang } from '@/lib/translations/work'
import type { ImportStart } from './ImportDialog'
import { WorkApiError, type SheetImport, type WorkApi } from '../lib/api'
import { errorText } from './SheetTable'
import { useWorkPkg } from './work-pkg'

export interface LedgerImportOpen { projectId: string; spec: SheetImport; start: ImportStart; period: { from: string; until: string } }

export function LedgerStatementCard({ messageId, index, fileName, account, summary, api, lang, projectId, disabled, onOpen }: {
  messageId: string
  index: number
  fileName: string
  account: { last4: string; currency: string; label: string }
  summary: { lines: number; from: string; until: string; opening: string; closing: string; rounding?: string }
  api: WorkApi
  lang: WorkLang
  projectId: string
  disabled: boolean
  onOpen: (o: LedgerImportOpen) => void
}) {
  const pkg = useWorkPkg()
  const t = (k: string, f?: string) => workT(lang, k, f, pkg)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inflight = useRef(false)
  const run = async () => {
    if (inflight.current) return
    inflight.current = true
    setBusy(true); setError(null)
    try {
      const r = await api<{ ledgerProjectId: string; fileId: string; fileName: string; reader: { statement: unknown }; accounts: Record<string, string>; spec: SheetImport }>('POST', `/projects/${encodeURIComponent(projectId)}/ledger-statement`, { messageId, index })
      onOpen({ projectId: r.ledgerProjectId, spec: r.spec, start: { fileId: r.fileId, fileName: r.fileName, reader: r.reader, accounts: r.accounts }, period: { from: summary.from, until: summary.until } })
    } catch (e) {
      setError(e instanceof WorkApiError && e.code === 'STALE' ? t('ledger_files_stale') : errorText(lang, e, pkg))
    } finally {
      inflight.current = false
      setBusy(false)
    }
  }
  return (
    <div className="rounded-lg border border-[#3A3A3A] bg-[#232323] p-3 text-sm space-y-1.5">
      <p className="text-gray-200">{t('ledger_statement_title')}</p>
      <p className="flex items-center gap-1.5 min-w-0 text-xs text-gray-300"><FileText className="w-3.5 h-3.5 shrink-0 text-gray-500" /><span className="truncate">{fileName}</span></p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-gray-500">{t('ledger_statement_account')}</dt><dd className="text-gray-300 break-words">{account.label ? `${account.label} · ` : ''}··{account.last4} · {account.currency}</dd>
        <dt className="text-gray-500">{t('ledger_statement_period')}</dt><dd className="text-gray-300 tabular-nums">{summary.from} – {summary.until}</dd>
        <dt className="text-gray-500">{t('ledger_statement_lines')}</dt><dd className="text-gray-300 tabular-nums">{summary.lines}</dd>
        <dt className="text-gray-500">{t('ledger_statement_balance')}</dt><dd className="text-gray-300 tabular-nums">{summary.opening} → {summary.closing}</dd>
      </dl>
      {summary.rounding && <p className="text-xs text-amber-300">{t('ledger_statement_rounding').replace('{amount}', `${summary.rounding} ${account.currency}`)}</p>}
      {error && <p role="alert" className="text-xs text-red-400 whitespace-pre-line">{error}</p>}
      <button disabled={disabled || busy} onClick={() => void run()}
        className="px-3 py-1.5 text-sm rounded-md bg-[#E07B53] text-white hover:opacity-90 disabled:opacity-40 inline-flex items-center gap-1">
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Landmark className="w-3.5 h-3.5" />}{t('ledger_statement_button')}
      </button>
      <p className="text-[11px] text-gray-500">{t('ledger_statement_note')}</p>
    </div>
  )
}
