'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { FileText, Loader2, Lock, Trash2, Upload, X } from 'lucide-react'
import { convertPdfToImages, isPdfFile } from '@/lib/pdf-to-image'
import { workT, type WorkLang } from '@/lib/translations/work'
import { WorkApiError, type ProjectFileView, type WorkFiles } from '../lib/api'
import { errorText } from './SheetTable'
import { ConfirmDialog } from './ConfirmDialog'
import { asCsv } from './ImportDialog'
import { useWorkPkg } from './work-pkg'

export const FILE_MAX_BYTES = 20 * 1024 * 1024
export const PDF_MAX_PAGES = 10

export function fileKind(f: File): string {
  const n = f.name.toLowerCase()
  if (f.type === 'text/csv' || n.endsWith('.csv')) return 'bank_csv'
  if (f.type.startsWith('image/') || isPdfFile(f)) return 'receipt'
  return 'other'
}

export async function pdfPageBlobs(f: File | Blob, maxPages: number): Promise<Blob[]> {
  const pages = await convertPdfToImages(f as File, { scale: 2, maxPages })
  return pages.map((pg) => {
    const bin = atob(pg.base64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new Blob([bytes], { type: 'image/jpeg' })
  })
}

export function useFileDrop(enabled: boolean, onFiles: (list: FileList) => void) {
  const [over, setOver] = useState(false)
  const isFiles = (e: React.DragEvent) => e.dataTransfer.types.includes('Files')
  const props = {
    onDragOver: (e: React.DragEvent) => {
      if (!isFiles(e)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = enabled ? 'copy' : 'none'
      if (enabled && !over) setOver(true)
    },
    onDragLeave: (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false) },
    onDrop: (e: React.DragEvent) => {
      if (!isFiles(e)) return
      e.preventDefault()
      setOver(false)
      if (enabled && e.dataTransfer.files.length > 0) onFiles(e.dataTransfer.files)
    },
  }
  return { over: over && enabled, props }
}

export function DropOverlay({ text }: { text: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-md border-2 border-dashed border-[#E07B53] bg-[#1A1A1A]/85">
      <span className="inline-flex items-center gap-2 text-sm text-white"><Upload className="w-4 h-4" />{text}</span>
    </div>
  )
}

function sizeText(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`
}

interface Report {
  kind: 'upload' | 'delete'
  total: number
  done: number
  existing: string[]
  failed: Array<{ name: string; reason: string }>
  notes: string[]
}

function ReportBox({ report: r, lang, onClose }: { report: Report; lang: WorkLang; onClose: () => void }) {
  const pkg = useWorkPkg()
  const t = (k: string, f?: string) => workT(lang, k, f, pkg)
  const bad = r.failed.length > 0
  return (
    <div role="status" className={`rounded-md border px-3 py-2 text-sm space-y-1 ${bad ? 'border-amber-500/40 bg-amber-500/5' : 'border-emerald-500/30 bg-emerald-500/5'}`}>
      <div className="flex items-start justify-between gap-2">
        <p className={bad ? 'text-amber-200' : 'text-emerald-300'}>
          {t(r.kind === 'upload' ? 'files_result_uploaded' : 'files_result_deleted').replace('{done}', String(r.done)).replace('{total}', String(r.total))}
        </p>
        <button onClick={onClose} className="text-gray-500 hover:text-white" aria-label={t('cancel')}><X className="w-3.5 h-3.5" /></button>
      </div>
      {r.existing.length > 0 && <p className="text-xs text-gray-400">{t('files_result_existing')} {r.existing.join(' · ')}</p>}
      {r.failed.length > 0 && (
        <ul className="text-xs text-amber-200 space-y-0.5">
          {r.failed.map((x, i) => <li key={i}><span className="text-gray-300">{x.name}</span> — {x.reason}</li>)}
        </ul>
      )}
      {r.notes.map((n, i) => <p key={i} className="text-xs text-gray-400">{n}</p>)}
    </div>
  )
}

export function FilesPanel({ files, lang, projectId, readOnly }: {
  files: WorkFiles
  lang: WorkLang
  projectId: string
  readOnly: boolean
}) {
  const pkg = useWorkPkg()
  const t = (k: string, f?: string) => workT(lang, k, f, pkg)
  const [list, setList] = useState<ProjectFileView[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<Report | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState<ProjectFileView[] | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const seq = useRef(0)
  const load = useCallback(async () => {
    const my = ++seq.current
    try {
      const l = await files.list(projectId)
      if (my !== seq.current) return
      setList(l)
      setSelected((cur) => new Set([...cur].filter((id) => l.some((f) => f.id === id && !f.locked))))
    } catch (e) { if (my === seq.current) setError(errorText(lang, e, pkg)) }
  }, [files, projectId, lang, pkg])

  useEffect(() => { void load() }, [load])

  const uploadReason = (e: unknown): string => {
    if (e instanceof WorkApiError && e.code === 'INVALID') return e.detail?.includes('too large') ? t('files_reason_size') : t('files_reason_type')
    return errorText(lang, e, pkg)
  }

  const upload = async (picked: FileList | null) => {
    if (!picked || picked.length === 0) return
    const all = Array.from(picked)
    setBusy(true); setError(null); setReport(null)
    const r: Report = { kind: 'upload', total: all.length, done: 0, existing: [], failed: [], notes: [] }
    for (const f of all) {
      if (f.size === 0) { r.failed.push({ name: f.name, reason: t('files_reason_empty') }); continue }
      if (f.size > FILE_MAX_BYTES) { r.failed.push({ name: f.name, reason: t('files_reason_size') }); continue }
      let saved: { id: string; created: boolean }
      try { saved = await files.upload(projectId, asCsv(f), fileKind(f)) } catch (e) { r.failed.push({ name: f.name, reason: uploadReason(e) }); continue }
      if (!saved.created) r.existing.push(f.name)
      else r.done++
      const hadPages = saved.created ? 0 : (list?.find((x) => x.id === saved.id)?.pages ?? 0)
      if (isPdfFile(f) && hadPages < PDF_MAX_PAGES) {
        try {
          const pages = await pdfPageBlobs(f, PDF_MAX_PAGES)
          if (pages.length > hadPages) for (let i = 0; i < pages.length; i++) await files.upload(projectId, pages[i], 'page_image', { name: `${f.name} p${i + 1}.jpg`, parentFileId: saved.id })
        } catch {
          r.notes.push(t('chat_pdf_failed').replace('{name}', f.name))
        }
      }
    }
    if (inputRef.current) inputRef.current.value = ''
    await load()
    setReport(r)
    setBusy(false)
  }

  const remove = async (targets: ProjectFileView[]) => {
    setBusy(true); setError(null); setReport(null)
    const r: Report = { kind: 'delete', total: targets.length, done: 0, existing: [], failed: [], notes: [] }
    for (const f of targets) {
      try {
        await files.remove(projectId, f.id)
        r.done++
      } catch (e) {
        const code = e instanceof WorkApiError ? e.code : ''
        r.failed.push({ name: f.name, reason: code === 'LOCKED' ? t('files_reason_locked') : code === 'IN_USE' ? t('files_reason_in_use') : errorText(lang, e, pkg) })
      }
    }
    setDeleting(null)
    await load()
    setReport(r)
    setBusy(false)
  }

  const deletable = (list ?? []).filter((f) => !f.locked)
  const allOn = deletable.length > 0 && deletable.every((f) => selected.has(f.id))
  const toggle = (id: string) => setSelected((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const drop = useFileDrop(!readOnly && !busy, (l) => void upload(l))

  return (
    <div className="relative flex-1 min-h-0 flex flex-col" {...drop.props}>
      {drop.over && <DropOverlay text={t('files_drop')} />}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs text-gray-500">{t('files_help')}</p>
          {!readOnly && (
            <>
              <input ref={inputRef} type="file" multiple hidden accept=".csv,.pdf,.xlsx,.txt,image/jpeg,image/png,image/webp,image/heic" onChange={(e) => void upload(e.target.files)} />
              <button onClick={() => inputRef.current?.click()} disabled={busy} className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md bg-[#E07B53] text-white hover:opacity-90 disabled:opacity-40">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}{busy ? t('files_working') : t('file_upload')}
              </button>
            </>
          )}
        </div>
        {error && <p role="alert" className="text-sm text-red-400 whitespace-pre-line">{error}</p>}
        {report && <ReportBox report={report} lang={lang} onClose={() => setReport(null)} />}
        {list === null ? (
          !error && <div className="py-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-[#E07B53]" /></div>
        ) : list.length === 0 ? (
          <p className="text-sm text-gray-500">{t('files_empty')}</p>
        ) : (
          <>
            {!readOnly && deletable.length > 0 && (
              <div className="flex items-center justify-between gap-2 px-1">
                <label className="inline-flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                  <input type="checkbox" className="accent-[#E07B53]" checked={allOn} disabled={busy}
                    onChange={() => setSelected(allOn ? new Set() : new Set(deletable.map((f) => f.id)))} />
                  {t('files_select_all')}
                </label>
                {selected.size > 0 && (
                  <button onClick={() => setDeleting((list ?? []).filter((f) => selected.has(f.id)))} disabled={busy}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md border border-red-500/50 text-red-300 hover:bg-red-500/10 disabled:opacity-40">
                    <Trash2 className="w-3.5 h-3.5" />{t('files_delete_selected').replace('{n}', String(selected.size))}
                  </button>
                )}
              </div>
            )}
            <ul className="divide-y divide-[#2A2A2A] rounded-lg border border-[#2A2A2A]">
              {list.map((f) => (
                <li key={f.id} className="group flex items-center gap-2 px-3 py-2">
                  {!readOnly && (
                    f.locked
                      ? <span title={t('files_locked')} className="w-4 flex justify-center text-gray-500"><Lock className="w-3.5 h-3.5" /></span>
                      : <input type="checkbox" className="accent-[#E07B53] shrink-0" checked={selected.has(f.id)} disabled={busy} onChange={() => toggle(f.id)} aria-label={f.name} />
                  )}
                  <button onClick={() => void files.open(projectId, f.id).catch((e) => setError(errorText(lang, e, pkg)))} className="flex-1 min-w-0 flex items-center gap-2 text-left">
                    <FileText className="w-4 h-4 shrink-0 text-gray-400" />
                    <span className="min-w-0">
                      <span className="block text-sm text-gray-200 truncate hover:text-white">{f.name}</span>
                      <span className="block text-[11px] text-gray-500">{f.uploadedAt.slice(0, 10)} · {sizeText(f.sizeBytes)}</span>
                    </span>
                  </button>
                  {readOnly && f.locked && <span title={t('files_locked')} className="p-1 text-gray-500"><Lock className="w-3.5 h-3.5" /></span>}
                  {!readOnly && !f.locked && (
                    <button onClick={() => setDeleting([f])} disabled={busy} className="p-1 text-gray-600 hover:text-red-400 sm:opacity-0 sm:group-hover:opacity-100" title={t('delete')} aria-label={t('delete')}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
        {deleting && (
          <ConfirmDialog
            message={deleting.length === 1 ? t('files_delete_confirm').replace('{name}', deleting[0].name) : t('files_delete_many_confirm').replace('{n}', String(deleting.length))}
            okLabel={t('delete')} cancelLabel={t('cancel')} busy={busy} onOk={() => void remove(deleting)} onCancel={() => setDeleting(null)} />
        )}
      </div>
    </div>
  )
}
