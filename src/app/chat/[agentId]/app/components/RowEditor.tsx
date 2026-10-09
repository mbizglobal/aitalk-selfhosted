'use client'

import React, { useState } from 'react'
import { FileUp, Loader2, Paperclip, X } from 'lucide-react'
import { workT, type WorkLang } from '@/lib/translations/work'
import type { ColumnDef, SheetRow } from '../lib/api'
import { useWorkPkg } from './work-pkg'

interface Props {
  lang: WorkLang
  title: string
  columns: ColumnDef[]
  options: Record<string, string[]>
  refOptions: Record<string, string[]>
  row: SheetRow | null
  confirmable: boolean
  busy: boolean
  error: string | null
  fileColumn: string | null
  onUpload: (file: File) => Promise<string>
  onOpenFile: (fileId: string) => void
  onSave: (data: Record<string, unknown>, confirm: boolean, fileChange: string | null | undefined) => void
  onClose: () => void
}

function toValue(col: ColumnDef, raw: string | boolean): unknown {
  if (col.type === 'boolean') return raw === 'true' ? true : raw === 'false' ? false : undefined
  const s = String(raw).trim()
  if (s === '') return undefined
  if (col.type === 'number') return Number(s)
  if (col.type === 'json') { try { return JSON.parse(s) } catch { return s } }
  if (col.type === 'datetime') { const d = new Date(s); return Number.isNaN(d.getTime()) ? s : d.toISOString() }
  return s
}

function toRaw(col: ColumnDef, v: unknown): string | boolean {
  if (col.type === 'boolean') return v === true ? 'true' : v === false ? 'false' : ''
  if (v === undefined || v === null) return ''
  if (col.type === 'json') return JSON.stringify(v, null, 2)
  if (col.type === 'datetime' && typeof v === 'string') { const d = new Date(v); return Number.isNaN(d.getTime()) ? v : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) }
  return String(v)
}

export function RowEditor({ lang, title, columns, options, refOptions, row, confirmable, busy, error, fileColumn, onUpload, onOpenFile, onSave, onClose }: Props) {
  const pkg = useWorkPkg()
  const t = (k: string, f?: string) => workT(lang, k, f, pkg)
  const [raw, setRaw] = useState<Record<string, string | boolean>>(() => Object.fromEntries(columns.map((c) => [c.name, toRaw(c, row?.data[c.name])])))

  const initialFile = fileColumn && typeof row?.data[fileColumn] === 'string' ? (row.data[fileColumn] as string) : null
  const [fileId, setFileId] = useState<string | null>(initialFile)
  const [uploading, setUploading] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const uploadSeq = React.useRef(0)
  const pickFile = async (f: File | undefined) => {
    if (!f) return
    const seq = ++uploadSeq.current
    setUploading(true); setFileError(null)
    try {
      const id = await onUpload(f)
      if (seq === uploadSeq.current) setFileId(id)
    } catch (e) {
      if (seq === uploadSeq.current) setFileError(e instanceof Error ? e.message : String(e))
    } finally {
      if (seq === uploadSeq.current) setUploading(false)
    }
  }
  const removeFile = () => { uploadSeq.current++; setUploading(false); setFileId(null) }

  const submit = (confirm: boolean) => {
    if (busy || uploading) return
    const data: Record<string, unknown> = {}
    for (const c of columns) {
      const v = toValue(c, raw[c.name])
      if (v !== undefined) data[c.name] = v
      else if (row && row.data[c.name] !== undefined && row.data[c.name] !== null) data[c.name] = null
    }
    onSave(data, confirm, fileId === initialFile ? undefined : fileId)
  }

  const inputCls = 'w-full rounded-md bg-[#2A2A2A] border border-[#3A3A3A] px-3 py-2 text-sm text-white focus:outline-none focus:border-[#E07B53]'

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-full sm:max-w-lg max-h-[90dvh] flex flex-col rounded-t-xl sm:rounded-xl bg-[#1E1E1E] border border-[#2A2A2A]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2A2A2A]">
          <h2 className="text-white font-medium">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white" aria-label={t('close')}><X className="w-5 h-5" /></button>
        </div>
        <form className="flex-1 overflow-y-auto scrollbar-thin px-4 py-3 space-y-3" autoComplete="off" onSubmit={(e) => { e.preventDefault(); submit(false) }}>
          {columns.map((c) => {
            const label = t(`col_${c.name}`, c.name)
            const opts = options[c.name]
            const refs = refOptions[c.name]
            const v = raw[c.name]
            const set = (x: string | boolean) => setRaw((r) => ({ ...r, [c.name]: x }))
            return (
              <label key={c.name} className="block">
                <span className="block text-xs text-gray-400 mb-1">
                  {label}{c.required && <span className="text-[#E07B53]"> *</span>}
                </span>
                {c.type === 'boolean' ? (
                  <select value={String(v)} onChange={(e) => set(e.target.value)} className={inputCls}>
                    <option value="">{t('choose')}</option>
                    <option value="true">{t('yes')}</option>
                    <option value="false">{t('no')}</option>
                  </select>
                ) : refs ? (
                  <>
                    <select value={String(v)} onChange={(e) => set(e.target.value)} className={inputCls}>
                      <option value="">{t('choose')}</option>
                      {[...new Set([...refs, ...(String(v) ? [String(v)] : [])])].map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                    {refs.length === 0 && <span className="block mt-1 text-xs text-amber-300">{t('ref_empty')}</span>}
                  </>
                ) : opts ? (
                  <select value={String(v)} onChange={(e) => set(e.target.value)} className={inputCls}>
                    <option value="">{t('choose')}</option>
                    {opts.map((o) => <option key={o} value={o}>{t(`opt_${o}`, o)}</option>)}
                  </select>
                ) : c.type === 'text' || c.type === 'json' ? (
                  <textarea value={String(v)} onChange={(e) => set(e.target.value)} rows={c.type === 'json' ? 5 : 3} className={`${inputCls} ${c.type === 'json' ? 'font-mono text-xs' : ''}`} autoComplete="off" />
                ) : (
                  <input
                    type={c.type === 'date' ? 'date' : c.type === 'datetime' ? 'datetime-local' : c.type === 'number' ? 'number' : 'text'}
                    inputMode={c.type === 'money' || c.type === 'decimal' ? 'decimal' : undefined}
                    value={String(v)}
                    onChange={(e) => set(e.target.value)}
                    className={`${inputCls} ${c.type === 'money' || c.type === 'decimal' || c.type === 'number' ? 'text-right tabular-nums' : ''}`}
                    autoComplete="off"
                  />
                )}
              </label>
            )
          })}
          {fileColumn && (
            <div>
              <span className="block text-xs text-gray-400 mb-1">{t('file')}</span>
              <div className="flex flex-wrap items-center gap-2">
                {fileId && (
                  <button type="button" onClick={() => onOpenFile(fileId)} className="inline-flex items-center gap-1 text-sm text-[#E07B53] hover:underline">
                    <Paperclip className="w-4 h-4" /> {t('file_open')}
                  </button>
                )}
                <label className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md bg-[#2A2A2A] text-white hover:bg-[#3A3A3A] cursor-pointer">
                  {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />} {fileId ? t('file_replace') : t('file_upload')}
                  <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/heic" capture="environment" className="hidden" disabled={uploading || busy} onChange={(e) => { void pickFile(e.target.files?.[0]); e.target.value = '' }} />
                </label>
                {(fileId || uploading) && <button type="button" onClick={removeFile} className="text-xs text-gray-400 hover:text-red-400">{t('file_remove')}</button>}
              </div>
              <p className="mt-1 text-xs text-gray-500">{t('file_help')}</p>
              {fileError && <p className="mt-1 text-xs text-red-400 whitespace-pre-line">{fileError}</p>}
            </div>
          )}
          <button type="submit" className="hidden" />
        </form>
        {error && <p role="alert" className="px-4 pt-3 text-sm text-red-400 whitespace-pre-line border-t border-[#2A2A2A]">{error}</p>}
        <div className="flex flex-wrap gap-2 justify-end px-4 py-3 border-t border-[#2A2A2A]">
          <button onClick={onClose} disabled={busy} className="px-3 py-2 text-sm rounded-md text-gray-300 hover:bg-[#2A2A2A]">{t('cancel')}</button>
          <button onClick={() => submit(false)} disabled={busy || uploading} className="px-3 py-2 text-sm rounded-md bg-[#2A2A2A] text-white hover:bg-[#3A3A3A] disabled:opacity-50">{t('save')}</button>
          {confirmable && (
            <button onClick={() => submit(true)} disabled={busy || uploading} className="px-3 py-2 text-sm rounded-md bg-[#E07B53] text-white hover:opacity-90 disabled:opacity-50">{t('save_confirm')}</button>
          )}
        </div>
      </div>
    </div>
  )
}
