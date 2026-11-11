'use client'

import React, { useRef, useState } from 'react'
import { CheckCircle2, Eye, Loader2, Play } from 'lucide-react'
import { workT, type WorkLang } from '@/lib/translations/work'
import { saveCardDone, type CardDone, type WorkApi } from '../lib/api'
import { errorText } from './SheetTable'
import { useWorkPkg } from './work-pkg'

export function ModuleRunCard({ module, input, labelKey, detail, preview, api, lang, projectId, disabled, onDone, messageId, index, initialDone }: {
  module: string
  input: Record<string, unknown>
  labelKey?: string
  detail: string
  preview?: { module: string; input: Record<string, unknown> }
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
  const [done, setDone] = useState<string | null>(initialDone ? String(initialDone.status ?? '') : null)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inflight = useRef(false)
  const label = labelKey ? t(labelKey, module) : t(`mod_${module}`, module)
  const run = async () => {
    if (inflight.current) return
    inflight.current = true
    setBusy(true); setError(null)
    try {
      const r = await api<{ output?: { status?: unknown } }>('POST', `/projects/${encodeURIComponent(projectId)}/modules/${encodeURIComponent(module)}`, { input })
      const status = typeof r?.output?.status === 'string' ? r.output.status : ''
      if (status === 'issuing') { setNote(t('module_run_busy')); return }
      setNote(null)
      setDone(status)
      saveCardDone(api, projectId, messageId, index, { status })
      onDone()
    } catch (e) {
      setError(errorText(lang, e, pkg))
    } finally {
      inflight.current = false
      setBusy(false)
    }
  }
  const [previewing, setPreviewing] = useState(false)
  const [previewLink, setPreviewLink] = useState<string | null>(null)
  const previewInflight = useRef(false)
  const showPreview = async () => {
    if (!preview || previewInflight.current) return
    previewInflight.current = true
    if (previewLink) { URL.revokeObjectURL(previewLink); setPreviewLink(null) }
    const w = window.open('', '_blank')
    setPreviewing(true); setError(null)
    try {
      const r = await api<{ output?: { pdfBase64?: unknown; fileName?: unknown } }>('POST', `/projects/${encodeURIComponent(projectId)}/modules/${encodeURIComponent(preview.module)}`, { input: preview.input })
      const b64 = typeof r?.output?.pdfBase64 === 'string' ? r.output.pdfBase64 : ''
      if (!b64) throw new Error('no preview')
      const bin = atob(b64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
      if (w) {
        w.location.href = url
        setTimeout(() => URL.revokeObjectURL(url), 60_000)
      } else if (!window.open(url, '_blank')) {
        setPreviewLink(url)
      } else setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e) {
      w?.close()
      setError(errorText(lang, e, pkg))
    } finally {
      previewInflight.current = false
      setPreviewing(false)
    }
  }
  return (
    <div className="rounded-lg border border-[#3A3A3A] bg-[#232323] p-3 text-sm space-y-1.5">
      <p className="text-gray-200 break-words">{label}</p>
      {detail && <p className="text-xs text-gray-400 break-words">{detail}</p>}
      {error && <p role="alert" className="text-xs text-red-400 whitespace-pre-line">{error}</p>}
      {note && <p className="text-xs text-amber-300">{note}</p>}
      {previewLink && <p className="text-xs"><a href={previewLink} target="_blank" rel="noopener noreferrer" className="text-sky-300 underline">{t('module_run_preview_open')}</a></p>}
      {done !== null ? (
        <p className="text-xs text-emerald-400 inline-flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" />{t('module_run_done')}{done ? <span className="text-gray-400"> · {t(`status_${done}`, done)}</span> : null}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {preview && (
            <button disabled={previewing} onClick={() => void showPreview()}
              className="px-3 py-1.5 text-sm rounded-md border border-[#4A4A4A] text-gray-200 hover:bg-[#2E2E2E] disabled:opacity-40 inline-flex items-center gap-1">
              {previewing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}{t('module_run_preview')}
            </button>
          )}
          <button disabled={disabled || busy} onClick={() => void run()}
            className="px-3 py-1.5 text-sm rounded-md bg-[#E07B53] text-white hover:opacity-90 disabled:opacity-40 inline-flex items-center gap-1">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}{label}
          </button>
        </div>
      )}
    </div>
  )
}
