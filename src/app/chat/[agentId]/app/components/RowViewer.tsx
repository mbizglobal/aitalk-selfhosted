'use client'

import React from 'react'
import { Download, Paperclip, Pencil, Trash2, X } from 'lucide-react'
import { workT, type WorkLang } from '@/lib/translations/work'
import type { ColumnDef, SheetRow } from '../lib/api'
import { useWorkPkg } from './work-pkg'

interface Props {
  lang: WorkLang
  columns: ColumnDef[]
  row: SheetRow
  format: (col: ColumnDef, v: unknown) => string
  hint: (col: ColumnDef) => { text: string; title: string } | null
  derived?: ReadonlyArray<{ name: string; label: string; text: string }>
  fileColumn: string | null
  moreFilesColumn?: string | null
  details?: { column: string; columns: string[]; money?: string[]; label: string; download?: boolean } | null
  onDownloadDetails?: ((format: 'xlsx' | 'csv' | 'pdf', table: { header: string[]; rows: string[][]; align: string[] }) => void) | null
  onOpenFile: (fileId: string) => void
  onEdit: (() => void) | null
  editLabel?: string
  onClose: () => void
  alert?: string | null
  actions?: ReadonlyArray<{ key: string; label: string; onClick: () => void }>
  onDelete?: (() => void) | null
  colLabels?: Readonly<Record<string, string>>
  labels?: Readonly<Record<string, string>>
}

export function RowViewer({ lang, columns, row, format, hint, derived = [], fileColumn, moreFilesColumn = null, details = null, onDownloadDetails = null, onOpenFile, onEdit, onClose, alert = null, actions = [], onDelete = null, colLabels = {}, labels = {}, editLabel }: Props) {
  const pkg = useWorkPkg()
  const t = (k: string, f?: string) => workT(lang, k, f, pkg)
  const fileId = fileColumn && typeof row.data[fileColumn] === 'string' ? (row.data[fileColumn] as string) : null
  const moreIds = moreFilesColumn && typeof row.data[moreFilesColumn] === 'string' ? (row.data[moreFilesColumn] as string).split(',').map((x) => x.trim()).filter(Boolean) : []
  const items = details && Array.isArray(row.data[details.column]) ? (row.data[details.column] as unknown[]).filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)) : []
  const itemText = (c: string, v: unknown) => (v === undefined || v === null ? '' : typeof v === 'boolean' ? (v ? '✓' : '') : c === 'category' && typeof v === 'string' ? t(`opt_${v}`, v) : String(v))
  const closeRef = React.useRef<HTMLButtonElement>(null)
  const onCloseRef = React.useRef(onClose)
  onCloseRef.current = onClose
  React.useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="row-viewer-title" className={`w-full ${items.length ? 'sm:max-w-3xl' : 'sm:max-w-lg'} max-h-[90dvh] flex flex-col rounded-t-xl sm:rounded-xl bg-[#1E1E1E] border border-[#2A2A2A]`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2A2A2A]">
          <h2 id="row-viewer-title" className="text-white font-medium">{t('view_row')}</h2>
          <button ref={closeRef} onClick={onClose} className="text-gray-400 hover:text-white" aria-label={t('close')}><X className="w-5 h-5" /></button>
        </div>
        {alert && <p role="status" className="px-4 py-2 text-sm text-red-200 bg-red-500/10 border-b border-red-500/30 whitespace-pre-line break-words">{alert}</p>}
        <dl className="flex-1 overflow-y-auto scrollbar-thin px-4 py-3 space-y-3">
          {columns.map((c) => {
            const text = format(c, row.data[c.name])
            const h = text === '' ? hint(c) : null
            return (
              <div key={c.name}>
                <dt className="text-xs text-gray-400 mb-1">{labels[c.name] ?? t(colLabels[c.name] ?? `col_${c.name}`, c.name)}</dt>
                <dd className={`text-sm whitespace-pre-wrap break-words ${c.type === 'json' && /^[[{]/.test(text) ? 'font-mono text-xs' : ''} ${text ? 'text-white' : 'text-gray-500'}`} title={h?.title}>
                  {text || h?.text || '—'}
                </dd>
              </div>
            )
          })}
          {details && items.length > 0 && (
            <div>
              <dt className="text-xs text-gray-400 mb-1">{labels[details.label] ?? t(details.label)} ({items.length})</dt>
              <dd className="overflow-x-auto scrollbar-thin -mx-4 px-4">
                <table className="min-w-full text-xs text-white">
                  <thead>
                    <tr className="text-gray-400 border-b border-[#2A2A2A]">
                      {details.columns.map((c) => <th key={c} scope="col" className={`px-2 py-1 font-normal whitespace-nowrap ${details.money?.includes(c) ? 'text-right' : 'text-left'}`}>{labels[c] ?? t(`col_${c}`, c)}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, i) => (
                      <tr key={typeof it.id === 'string' ? it.id : i} className="border-b border-[#2A2A2A]/60 align-top">
                        {details.columns.map((c) => <td key={c} className={`px-2 py-1 ${details.money?.includes(c) ? 'text-right tabular-nums whitespace-nowrap' : c === 'merchant' ? 'min-w-[8rem] break-words' : 'whitespace-nowrap'}`}>{itemText(c, it[c])}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </dd>
              {details.download && onDownloadDetails && (
                <div className="mt-2 flex items-center gap-1.5 text-xs text-gray-400">
                  <Download className="w-3.5 h-3.5" /> <span className="mr-1">{t('sheet_download')}</span>
                  {(['xlsx', 'csv', 'pdf'] as const).map((f) => (
                    <button key={f} type="button" onClick={() => onDownloadDetails(f, {
                      header: details.columns.map((c) => labels[c] ?? t(`col_${c}`, c)),
                      rows: items.map((it) => details.columns.map((c) => itemText(c, it[c]))),
                      align: details.columns.map((c) => (details.money?.includes(c) ? 'right' : 'left')),
                    })} className="px-2 py-0.5 rounded border border-[#3A3A3A] hover:text-[#E07B53] hover:border-[#E07B53]">
                      {f === 'xlsx' ? 'Excel' : f.toUpperCase()}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {derived.map((d) => (
            <div key={`derived:${d.name}`}>
              <dt className="text-xs text-gray-400 mb-1">{d.label}</dt>
              <dd className="text-sm text-white whitespace-pre-wrap break-words">{d.text}</dd>
            </div>
          ))}
          {(fileId || moreIds.length > 0) && (
            <div>
              <dt className="text-xs text-gray-400 mb-1">{t('file')}</dt>
              <dd className="flex flex-wrap gap-x-4 gap-y-1">
                {[...new Set([...(fileId ? [fileId] : []), ...moreIds])].map((id, i, all) => (
                  <button key={id} type="button" onClick={() => onOpenFile(id)} className="inline-flex items-center gap-1 text-sm text-[#E07B53] hover:underline">
                    <Paperclip className="w-4 h-4" /> {t('file_open')}{all.length > 1 ? ` ${i + 1}` : ''}
                  </button>
                ))}
              </dd>
            </div>
          )}
        </dl>
        <div className="flex flex-wrap gap-2 justify-end px-4 py-3 border-t border-[#2A2A2A]">
          {onDelete && <button onClick={onDelete} className="mr-auto inline-flex items-center gap-1 px-3 py-2 text-sm rounded-md text-red-300 border border-red-500/40 hover:bg-red-500/10"><Trash2 className="w-4 h-4" />{t('delete')}</button>}
          <button onClick={onClose} className="px-3 py-2 text-sm rounded-md text-gray-300 hover:bg-[#2A2A2A]">{t('close')}</button>
          {onEdit && (
            <button onClick={onEdit} className="inline-flex items-center gap-1 px-3 py-2 text-sm rounded-md bg-[#2A2A2A] text-white hover:bg-[#3A3A3A]"><Pencil className="w-4 h-4" />{editLabel ?? t('edit')}</button>
          )}
          {actions.map((a) => <button key={a.key} onClick={a.onClick} className="px-3 py-2 text-sm rounded-md bg-[#E07B53] text-white hover:opacity-90">{a.label}</button>)}
        </div>
      </div>
    </div>
  )
}
