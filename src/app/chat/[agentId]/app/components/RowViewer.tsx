'use client'

import React from 'react'
import { Paperclip, Pencil, X } from 'lucide-react'
import { workT, type WorkLang } from '@/lib/translations/work'
import type { ColumnDef, SheetRow } from '../lib/api'
import { useWorkPkg } from './work-pkg'

interface Props {
  lang: WorkLang
  columns: ColumnDef[]
  row: SheetRow
  format: (col: ColumnDef, v: unknown) => string
  hint: (col: ColumnDef) => { text: string; title: string } | null
  fileColumn: string | null
  onOpenFile: (fileId: string) => void
  onEdit: (() => void) | null
  onClose: () => void
}

export function RowViewer({ lang, columns, row, format, hint, fileColumn, onOpenFile, onEdit, onClose }: Props) {
  const pkg = useWorkPkg()
  const t = (k: string, f?: string) => workT(lang, k, f, pkg)
  const fileId = fileColumn && typeof row.data[fileColumn] === 'string' ? (row.data[fileColumn] as string) : null
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
      <div role="dialog" aria-modal="true" aria-labelledby="row-viewer-title" className="w-full sm:max-w-lg max-h-[90dvh] flex flex-col rounded-t-xl sm:rounded-xl bg-[#1E1E1E] border border-[#2A2A2A]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2A2A2A]">
          <h2 id="row-viewer-title" className="text-white font-medium">{t('view_row')}</h2>
          <button ref={closeRef} onClick={onClose} className="text-gray-400 hover:text-white" aria-label={t('close')}><X className="w-5 h-5" /></button>
        </div>
        <dl className="flex-1 overflow-y-auto scrollbar-thin px-4 py-3 space-y-3">
          {columns.map((c) => {
            const text = format(c, row.data[c.name])
            const h = text === '' ? hint(c) : null
            return (
              <div key={c.name}>
                <dt className="text-xs text-gray-400 mb-1">{t(`col_${c.name}`, c.name)}</dt>
                <dd className={`text-sm whitespace-pre-wrap break-words ${c.type === 'json' ? 'font-mono text-xs' : ''} ${text ? 'text-white' : 'text-gray-500'}`} title={h?.title}>
                  {text || h?.text || '—'}
                </dd>
              </div>
            )
          })}
          {fileId && (
            <div>
              <dt className="text-xs text-gray-400 mb-1">{t('file')}</dt>
              <dd>
                <button type="button" onClick={() => onOpenFile(fileId)} className="inline-flex items-center gap-1 text-sm text-[#E07B53] hover:underline">
                  <Paperclip className="w-4 h-4" /> {t('file_open')}
                </button>
              </dd>
            </div>
          )}
        </dl>
        <div className="flex flex-wrap gap-2 justify-end px-4 py-3 border-t border-[#2A2A2A]">
          <button onClick={onClose} className="px-3 py-2 text-sm rounded-md text-gray-300 hover:bg-[#2A2A2A]">{t('close')}</button>
          {onEdit && (
            <button onClick={onEdit} className="inline-flex items-center gap-1 px-3 py-2 text-sm rounded-md bg-[#2A2A2A] text-white hover:bg-[#3A3A3A]"><Pencil className="w-4 h-4" />{t('edit')}</button>
          )}
        </div>
      </div>
    </div>
  )
}
