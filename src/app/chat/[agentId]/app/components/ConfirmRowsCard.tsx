'use client'

import React, { useRef, useState } from 'react'
import { CheckCheck, CheckCircle2, Loader2 } from 'lucide-react'
import { workT, type WorkLang } from '@/lib/translations/work'
import { WorkApiError, saveCardDone, type CardDone, type WorkApi } from '../lib/api'
import { errorText } from './SheetTable'
import { useWorkPkg } from './work-pkg'

export function ConfirmRowsCard({ sheetId, rowIds, fingerprint, count, detail, labelKey, api, lang, projectId, disabled, onDone, messageId, index, initialDone }: {
  sheetId: string
  rowIds: string[]
  fingerprint: string
  count: number
  detail: string
  labelKey?: string
  api: WorkApi
  lang: WorkLang
  projectId: string
  disabled: boolean
  onDone: () => void
  messageId?: string
  index?: number
  initialDone?: CardDone
}) {
  const pkg = useWorkPkg()
  const t = (k: string, f?: string) => workT(lang, k, f, pkg)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<number | null>(typeof initialDone?.confirmed === 'number' ? initialDone.confirmed : null)
  const [error, setError] = useState<string | null>(null)
  const inflight = useRef(false)
  const label = (labelKey ? t(labelKey, t('confirm_rows_button')) : t('confirm_rows_button')).replace('{n}', String(count))
  const run = async () => {
    if (inflight.current) return
    inflight.current = true
    setBusy(true); setError(null)
    try {
      const r = await api<{ confirmed: number }>('POST', `/projects/${encodeURIComponent(projectId)}/sheets/${encodeURIComponent(sheetId)}/confirm`, { rowIds, fingerprint })
      setDone(r.confirmed)
      saveCardDone(api, projectId, messageId, index, { confirmed: r.confirmed })
      onDone()
    } catch (e) {
      setError(e instanceof WorkApiError && e.code === 'STALE' ? t('confirm_rows_stale') : errorText(lang, e, pkg))
    } finally {
      inflight.current = false
      setBusy(false)
    }
  }
  return (
    <div className="rounded-lg border border-[#3A3A3A] bg-[#232323] p-3 text-sm space-y-1.5">
      {detail && <p className="text-gray-200 break-words">{detail}</p>}
      {error && <p role="alert" className="text-xs text-red-400 whitespace-pre-line">{error}</p>}
      {done !== null ? (
        <p className="text-xs text-emerald-400 inline-flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" />{t('confirm_rows_done').replace('{n}', String(done))}</p>
      ) : (
        <button disabled={disabled || busy} onClick={() => void run()}
          className="px-3 py-1.5 text-sm rounded-md bg-[#E07B53] text-white hover:opacity-90 disabled:opacity-40 inline-flex items-center gap-1">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCheck className="w-3.5 h-3.5" />}{label}
        </button>
      )}
    </div>
  )
}
