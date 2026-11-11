'use client'

import React, { useEffect, useRef, useState } from 'react'
import { ImageIcon, Loader2, RefreshCw, Trash2, Upload } from 'lucide-react'
import { workT, type WorkLang } from '@/lib/translations/work'
import type { SheetRow, SheetScreen, WorkApi, WorkFiles } from '../lib/api'
import { errorText } from './SheetTable'
import { useWorkPkg } from './work-pkg'

interface Props {
  api: WorkApi
  files: WorkFiles
  lang: WorkLang
  projectId: string
  base: string
  image: NonNullable<SheetScreen['image']>
  row: SheetRow | null
  readOnly: boolean
  onChanged: () => Promise<void> | void
}

export function ImageBox({ api, files, lang, projectId, base, image, row, readOnly, onChanged }: Props) {
  const pkg = useWorkPkg()
  const t = (k: string, f?: string) => workT(lang, k, f, pkg)
  const fileId = row && typeof row.data[image.column] === 'string' ? (row.data[image.column] as string) : null
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setUrl(null)
    if (!fileId) { setLoading(false); return }
    let alive = true
    let made: string | null = null
    setLoading(true)
    setError(null)
    files.imageUrl(projectId, fileId)
      .then((u) => { made = u; if (alive) setUrl(u); else if (u) URL.revokeObjectURL(u) })
      .catch((e) => { if (alive) setError(errorText(lang, e, pkg)) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false; if (made) URL.revokeObjectURL(made) }
  }, [files, projectId, fileId, lang, pkg])

  const save = async (next: string | null) => {
    if (!row) return
    await api('PATCH', `${base}/rows/${row.id}`, { data: {}, confirm: false, fileId: next })
    await onChanged()
  }

  const pick = async (f: File) => {
    setError(null)
    if (image.mime && f.type && !image.mime.includes(f.type)) { setError(t('image_bad_type')); return }
    if (image.maxBytes && f.size > image.maxBytes) { setError(t('image_too_big').replace('{mb}', String(Math.floor(image.maxBytes / 1024 / 1024)))); return }
    setBusy(true)
    try {
      const up = await files.upload(projectId, f, 'other')
      await save(up.id)
    } catch (e) {
      setError(errorText(lang, e, pkg))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setError(null)
    setBusy(true)
    try { await save(null) } catch (e) { setError(errorText(lang, e, pkg)) } finally { setBusy(false) }
  }

  const btn = 'inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md bg-[#2A2A2A] text-white hover:bg-[#3A3A3A] disabled:opacity-40'
  const mb = image.maxBytes ? String(Math.floor(image.maxBytes / 1024 / 1024)) : ''

  return (
    <div className="mx-4 my-6 max-w-3xl rounded-lg border border-[#2A2A2A] bg-[#1C1C1C] px-5 py-4">
      <p className="text-sm font-medium text-gray-200 mb-3">{t('image_title')}</p>
      {!row ? (
        <p className="text-sm text-gray-500">{t('image_need_row')}</p>
      ) : (
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className={`flex items-center justify-center min-h-[72px] sm:w-64 rounded-md border border-dashed p-2 ${url ? 'bg-white border-[#3A3A3A]' : 'bg-[#171717] border-[#3A3A3A]'}`}>
            {loading ? <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
              : url ? <img src={url} alt={t('image_title')} className="max-h-[120px] max-w-full object-contain" />
              : fileId ? <span className="text-xs text-gray-500">{t('image_cannot_show')}</span>
              : <ImageIcon className="w-6 h-6 text-gray-600" aria-hidden />}
          </div>
          <div className="flex flex-col gap-2">
            {!readOnly && (
              <div className="flex flex-wrap gap-2">
                <input
                  ref={input}
                  type="file"
                  accept={(image.mime ?? ['image/png', 'image/jpeg']).join(',')}
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void pick(f) }}
                />
                <button type="button" onClick={() => input.current?.click()} disabled={busy} className={fileId ? btn : 'inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md bg-[#E07B53] text-white hover:opacity-90 disabled:opacity-40'}>
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : fileId ? <RefreshCw className="w-4 h-4" /> : <Upload className="w-4 h-4" />}
                  {fileId ? t('image_replace') : t('image_upload')}
                </button>
                {fileId && (
                  <button type="button" onClick={() => void remove()} disabled={busy} className={btn}>
                    <Trash2 className="w-4 h-4" /> {t('image_remove')}
                  </button>
                )}
              </div>
            )}
            <p className="text-xs text-gray-500">{image.help ? t(image.help) : t('image_hint').replace('{mb}', mb)}</p>
            {fileId && !readOnly && <p className="text-xs text-gray-500">{t('image_remove_note')}</p>}
          </div>
        </div>
      )}
      {error && <p className="mt-3 text-sm text-amber-300 whitespace-pre-line">{error}</p>}
    </div>
  )
}
