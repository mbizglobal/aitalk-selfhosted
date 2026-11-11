'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Download, ExternalLink, FileText, Loader2, X } from 'lucide-react'
import { workT, type WorkLang } from '@/lib/translations/work'
import { WorkApiError, type AttentionView, type ReviewItem, type WorkApi, type WorkFiles } from '../lib/api'
import { errorText } from './SheetTable'
import { useWorkPkg } from './work-pkg'

type Review = NonNullable<AttentionView['review']>
type Action = Review['actions'][number]
type ItemAction = NonNullable<Review['items']>['actions'][number]
type Asking = { kind: 'run'; a: Action } | { kind: 'item'; a: ItemAction; itemId: string }

export function ReviewDialog({ api, files, lang, projectId, item, startTab = 'doc', onDone, onClose }: {
  api: WorkApi
  files: WorkFiles
  lang: WorkLang
  projectId: string
  item: AttentionView
  startTab?: 'doc' | 'items'
  onDone: () => void
  onClose: () => void
}) {
  const pkg = useWorkPkg()
  const t = (k: string, f?: string) => workT(lang, k, f, pkg)
  const review = item.review!
  const [doc, setDoc] = useState<{ url: string; docFp: string | null } | null>(null)
  const [items, setItems] = useState<ReviewItem[] | null>(null)
  const [tab, setTab] = useState<'doc' | 'items'>(review.items ? startTab : 'doc')
  const [pos, setPos] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState<Asking | null>(null)
  const [reason, setReason] = useState('')
  const [checked, setChecked] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const urlRef = useRef<string | null>(null)
  const seq = useRef(0)

  const loadDoc = useCallback(async (quiet = false): Promise<ReviewItem[] | null | undefined> => {
    const my = ++seq.current
    if (!quiet) setDoc(null)
    try {
      const r = await api<{ output?: { pdfBase64?: unknown; docFp?: unknown; items?: unknown } }>('POST', `/projects/${encodeURIComponent(projectId)}/modules/${encodeURIComponent(review.pdf.module)}`, { input: { ...review.pdf.input, lang } })
      const b64 = typeof r?.output?.pdfBase64 === 'string' ? r.output.pdfBase64 : ''
      if (!b64) throw new Error('no pdf')
      const bin = atob(b64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
      if (my !== seq.current) { URL.revokeObjectURL(url); return undefined }
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
      urlRef.current = url
      setDoc({ url, docFp: typeof r?.output?.docFp === 'string' ? r.output.docFp : null })
      const list = Array.isArray(r?.output?.items) ? (r.output.items as ReviewItem[]) : null
      setItems(list)
      setPos((p) => Math.max(0, Math.min(p, (list?.length ?? 1) - 1)))
      return list
    } catch (e) { if (my === seq.current) setError(errorText(lang, e, pkg)); return undefined }
  }, [api, projectId, review.pdf.module, review.pdf.input, lang, pkg])
  useEffect(() => { void loadDoc() }, [loadDoc])
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current) }, [])

  const pickTab = (x: 'doc' | 'items') => setTab(x)

  const press = async (a: Action, why?: string) => {
    if (!doc?.docFp) return
    setBusy(true); setError(null)
    try {
      const r = await api<{ output?: { archiveFailed?: unknown } }>('POST', `/projects/${encodeURIComponent(projectId)}/modules/${encodeURIComponent(a.module)}`, { input: { ...a.input, lang, docFp: doc.docFp, ...(why !== undefined ? { reason: why } : {}) } })
      setAsking(null)
      onDone()
      if (r?.output?.archiveFailed === true) { setDone(t('review_archive_failed')); return }
      onClose()
    } catch (e) {
      setAsking(null)
      setError(errorText(lang, e, pkg))
      if (e instanceof WorkApiError && e.stop?.code === 'run_changed_review_again') void loadDoc()
    } finally { setBusy(false) }
  }

  const pressItem = async (a: ItemAction, itemId: string, why?: string) => {
    const it = items?.find((x) => x.id === itemId)
    if (!it) { setAsking(null); return }
    setBusy(true); setError(null)
    try {
      await api('POST', `/projects/${encodeURIComponent(projectId)}/modules/${encodeURIComponent(a.module)}`, { input: { ...a.input, [a.key]: it.id, lang, ...(why !== undefined ? { reason: why } : {}) } })
      setAsking(null)
      if (a.next) {
        setItems((xs) => xs?.map((x) => (x.id === it.id && !x.marks.some((m) => m.mine) ? { ...x, marks: [...x.marks, { text: t('review_checked_now'), mine: true }] } : x)) ?? xs)
        setPos(Math.min(items!.indexOf(it) + 1, items!.length - 1))
        void loadDoc(true)
      } else {
        onDone()
        const left = await loadDoc(true)
        if (left === null || (left !== undefined && left.length === 0)) onClose()
      }
    } catch (e) {
      setAsking(null)
      setError(errorText(lang, e, pkg))
      void loadDoc(true)
    } finally { setBusy(false) }
  }

  const label = Object.entries(item.params ?? {}).reduce((txt, [k, v]) => txt.replace(`{${k}}`, String(v)), t(`attention_${item.code}`))
  const showItems = !!review.items && items !== null && items.length > 0
  const onItems = showItems && tab === 'items'
  const cur = onItems ? items![pos] : null
  const mine = items?.filter((x) => x.marks.some((m) => m.mine)).length ?? 0
  const askingText = asking ? t(`${asking.a.label}_ask`) : ''

  return (
    <div className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center bg-black/70 sm:p-4" onClick={() => { if (!busy) onClose() }}>
      <div role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-6xl h-full sm:h-[92dvh] flex flex-col sm:rounded-xl bg-[#1E1E1E] border border-[#2A2A2A]">
        <div className="flex items-start gap-3 px-4 py-3 border-b border-[#2A2A2A]">
          <p className="flex-1 min-w-0 text-sm text-white">{label}</p>
          {doc && tab === 'doc' && <a href={doc.url} target="_blank" rel="noopener noreferrer" className="shrink-0 inline-flex items-center gap-1 text-xs text-gray-300 hover:text-white" title={t('review_open_tab')}><ExternalLink className="w-3.5 h-3.5" /> {t('review_open_tab')}</a>}
          <button onClick={onClose} disabled={busy} className="shrink-0 p-1 text-gray-400 hover:text-white" aria-label={t('cancel')}><X className="w-4 h-4" /></button>
        </div>
        {showItems && (
          <div role="tablist" className="flex gap-1 px-4 pt-2 border-b border-[#2A2A2A]">
            {(['doc', 'items'] as const).map((x) => (
              <button key={x} role="tab" aria-selected={tab === x} onClick={() => pickTab(x)} disabled={busy || !!asking}
                className={`px-3 py-1.5 text-sm border-b-2 -mb-px ${tab === x ? 'border-[#E07B53] text-white' : 'border-transparent text-gray-400 hover:text-gray-200'}`}>
                {x === 'doc' ? t('review_tab_doc') : t('review_tab_items').replace('{n}', String(items!.length))}
              </button>
            ))}
          </div>
        )}
        {onItems && cur ? (
          <div className="flex-1 min-h-0 overflow-y-auto md:overflow-hidden flex flex-col md:flex-row">
            <div className="md:w-[24rem] shrink-0 md:overflow-y-auto scrollbar-soft border-b md:border-b-0 md:border-r border-[#2A2A2A] p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <button onClick={() => setPos((p) => Math.max(0, p - 1))} disabled={busy || !!asking || pos === 0} className="p-1.5 rounded-md text-gray-300 hover:bg-[#2A2A2A] disabled:opacity-30" aria-label={t('review_prev')}><ChevronLeft className="w-4 h-4" /></button>
                <span className="text-sm text-gray-300 tabular-nums">{t('review_item_pos').replace('{i}', String(pos + 1)).replace('{n}', String(items!.length))}</span>
                <button onClick={() => setPos((p) => Math.min(items!.length - 1, p + 1))} disabled={busy || !!asking || pos >= items!.length - 1} className="p-1.5 rounded-md text-gray-300 hover:bg-[#2A2A2A] disabled:opacity-30" aria-label={t('review_next')}><ChevronRight className="w-4 h-4" /></button>
              </div>
              <div className="rounded-lg bg-[#232323] border border-[#2F2F2F] p-3 space-y-2">
                <p className="text-base font-semibold text-white break-words">{cur.title}</p>
                {cur.sub && <p className="text-sm text-gray-400 break-words whitespace-pre-line">{cur.sub}</p>}
                {cur.amount && <p className="text-lg font-semibold text-white tabular-nums">{cur.amount}</p>}
                {cur.note && <p className={`inline-block text-xs rounded px-2 py-0.5 ${cur.noteTone === 'amber' ? 'bg-amber-500/15 text-amber-300' : cur.noteTone === 'muted' ? 'bg-[#2A2A2A] text-gray-400' : 'bg-red-500/15 text-red-300'}`}>{cur.note}</p>}
                {cur.fields.length > 0 && (
                  <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm">
                    {cur.fields.map((f) => (<React.Fragment key={f.label}><dt className="text-gray-500">{f.label}</dt><dd className="text-gray-200 break-words tabular-nums">{f.value}</dd></React.Fragment>))}
                  </dl>
                )}
                {cur.marks.length > 0 && (
                  <ul className="space-y-0.5 text-xs">
                    {cur.marks.map((m, i) => <li key={i} className={`inline-flex items-center gap-1 w-full ${m.mine ? 'text-emerald-400' : 'text-gray-400'}`}><Check className="w-3 h-3 shrink-0" />{m.text}</li>)}
                  </ul>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {review.items!.actions.map((a) => {
                  const already = !!a.next && cur.marks.some((m) => m.mine)
                  return (
                    <button key={a.label} onClick={() => { setReason(''); if (a.ask) setAsking({ kind: 'item', a, itemId: cur.id }); else void pressItem(a, cur.id) }} disabled={busy || !!asking}
                      className={`px-3 py-2 text-sm rounded-md disabled:opacity-50 inline-flex items-center gap-1 ${a.tone === 'danger' ? 'text-red-300 border border-red-500/50 hover:bg-red-500/10' : already ? 'border border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/10' : 'bg-[#E07B53] text-white hover:opacity-90'}`}>
                      {already && <Check className="w-4 h-4" />}{already ? t('review_checked_now') : t(a.label)}
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="flex-1 min-h-[60vh] md:min-h-0 bg-[#2A2A2A]">
              <OriginalView key={cur.id} ids={cur.files} files={files} projectId={projectId} t={t} />
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 bg-[#2A2A2A]">
            {doc ? <iframe src={doc.url} title={label} className="w-full h-full border-0 bg-white" />
              : !error && <div className="h-full flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-[#E07B53]" /></div>}
          </div>
        )}
        <div className="px-4 py-3 border-t border-[#2A2A2A] space-y-2">
          {error && <p role="alert" className="text-sm text-red-400 whitespace-pre-line">{error}</p>}
          {done ? (
            <div className="flex items-center justify-between gap-2">
              <p role="status" className="text-sm text-amber-300">{done}</p>
              <button onClick={onClose} className="px-3 py-2 text-sm rounded-md bg-[#2A2A2A] text-white hover:bg-[#3A3A3A]">{t('cancel')}</button>
            </div>
          ) : asking ? (
            <div className={`space-y-2 ${asking.a.ask === 'check' ? 'rounded-lg border border-amber-500/40 bg-amber-500/10 p-3' : ''}`}>
              <p className={`text-sm ${asking.a.ask === 'check' ? 'text-amber-100' : 'text-gray-200'}`}>{asking.kind === 'item' ? `${items?.find((x) => x.id === asking.itemId)?.title ?? ''} — ${askingText}` : askingText}</p>
              {asking.a.ask === 'check' && (
                <label className="flex items-start gap-2 text-sm text-white cursor-pointer select-none">
                  <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} disabled={busy} className="mt-0.5 accent-[#E07B53] w-4 h-4 shrink-0" />
                  <span>{t(`${asking.a.label}_check`)}</span>
                </label>
              )}
              {asking.a.ask === 'reason' && (
                <textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={1000} autoComplete="off" placeholder={t('review_reason')}
                  className="w-full rounded-md bg-[#141414] border border-[#2A2A2A] px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-[#E07B53]" />
              )}
              <div className="flex justify-end gap-2">
                <button onClick={() => setAsking(null)} disabled={busy} className="px-3 py-2 text-sm rounded-md text-gray-300 hover:bg-[#2A2A2A]">{t('cancel')}</button>
                <button onClick={() => { const why = asking.a.ask === 'reason' ? reason.trim() : undefined; if (asking.kind === 'item') void pressItem(asking.a, asking.itemId, why); else void press(asking.a, why) }}
                  disabled={busy || (asking.a.ask === 'reason' && !reason.trim()) || (asking.a.ask === 'check' && !checked)}
                  className={`px-3 py-2 text-sm rounded-md text-white disabled:opacity-50 ${asking.a.tone === 'danger' ? 'bg-red-500/90 hover:bg-red-500' : 'bg-[#E07B53] hover:opacity-90'}`}>
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : t(asking.a.label)}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {onItems && <span className="mr-auto text-sm text-gray-400 tabular-nums">{t('review_mine').replace('{k}', String(mine)).replace('{n}', String(items!.length))}</span>}
              {review.actions.map((a) => (
                <button key={a.label} onClick={() => { setReason(''); setChecked(false); if (a.ask) setAsking({ kind: 'run', a }); else void press(a) }} disabled={busy || !doc?.docFp}
                  className={`px-4 py-2 text-sm rounded-md disabled:opacity-50 ${a.tone === 'danger' ? 'text-red-300 border border-red-500/50 hover:bg-red-500/10' : 'bg-[#E07B53] text-white hover:opacity-90'}`}>
                  {t(a.label)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const FORMAT_KIND: Record<string, string> = { xlsx: 'Excel', xls: 'Excel', xlsm: 'Excel', csv: 'CSV', docx: 'Word', doc: 'Word', pptx: 'PowerPoint', ppt: 'PowerPoint', txt: 'Text', zip: 'ZIP' }
type OriginalFile = { url: string; type: string; name: string; ext: string }
const inline = (f: OriginalFile) => f.type === 'application/pdf' || f.type.startsWith('image/')

function OriginalView({ ids, files, projectId, t }: { ids: string[]; files: WorkFiles; projectId: string; t: (k: string) => string }) {
  const [pick, setIdx] = useState(0)
  const [list, setList] = useState<Array<OriginalFile | null> | null>(null)
  const key = ids.map((x) => x.trim()).filter(Boolean).join(',')
  const count = key ? key.split(',').length : 0
  useEffect(() => {
    if (!key) return
    let alive = true
    const made: string[] = []
    setList(null)
    void Promise.all(key.split(',').map((id) => files.referenceUrl(projectId, id).then((v) => { if (alive) made.push(v.url); else URL.revokeObjectURL(v.url); return v as OriginalFile }).catch(() => null)))
      .then((xs) => {
        if (!alive) return
        const rank = (f: OriginalFile | null) => (f === null ? 2 : inline(f) ? 0 : 1)
        setList(xs.map((f, i) => ({ f, i })).sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i).map((x) => x.f))
      })
    return () => { alive = false; for (const u of made) URL.revokeObjectURL(u) }
  }, [key, files, projectId])
  const idx = Math.min(pick, Math.max(0, count - 1))
  useEffect(() => { if (pick !== idx) setIdx(idx) }, [pick, idx])
  if (!key) return <div className="h-full min-h-[12rem] flex items-center justify-center text-sm text-gray-400">{t('review_no_file')}</div>
  const view = list ? list[idx] ?? null : undefined
  const ext = view ? (view.ext ? `.${view.ext}` : '') : ''
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-300 border-b border-[#333]">
        {count > 1 && (
          <>
            <button onClick={() => setIdx(Math.max(0, idx - 1))} disabled={idx === 0} className="p-1 rounded hover:bg-[#333] disabled:opacity-30" aria-label={t('review_prev')}><ChevronLeft className="w-3.5 h-3.5" /></button>
            <span className="tabular-nums">{t('review_file_pos').replace('{i}', String(idx + 1)).replace('{n}', String(count))}</span>
            <button onClick={() => setIdx(Math.min(count - 1, idx + 1))} disabled={idx >= count - 1} className="p-1 rounded hover:bg-[#333] disabled:opacity-30" aria-label={t('review_next')}><ChevronRight className="w-3.5 h-3.5" /></button>
          </>
        )}
        {view && (inline(view)
          ? <a href={view.url} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 hover:text-white"><ExternalLink className="w-3.5 h-3.5" /> {t('review_open_tab')}</a>
          : <a href={view.url} download={view.name || undefined} className="ml-auto inline-flex items-center gap-1 hover:text-white"><Download className="w-3.5 h-3.5" /> {t('review_download').replace('{ext}', ext)}</a>)}
      </div>
      <div className="flex-1 min-h-0">
        {view === undefined ? <div className="h-full flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-[#E07B53]" /></div>
          : view === null ? <div className="h-full flex items-center justify-center text-sm text-gray-400 px-4 text-center">{t('review_file_failed')}</div>
          : view.type === 'application/pdf' ? <iframe src={view.url} title={t('review_tab_items')} className="w-full h-full border-0 bg-white" />
          : view.type.startsWith('image/') ? <div className="h-full overflow-auto scrollbar-soft p-3 flex justify-center"><img src={view.url} alt="" className="max-w-full h-auto bg-white" /></div>
          : (
            <div className="h-full flex flex-col items-center justify-center gap-2 px-4 text-center">
              <FileText className="w-8 h-8 text-gray-500" />
              <p className="text-sm text-gray-200">{t('review_file_format').replace('{kind}', FORMAT_KIND[view.ext] ?? (view.ext.toUpperCase() || '?')).replace('{ext}', ext)}</p>
              {view.name && <p className="text-xs text-gray-400 break-all">{view.name}</p>}
              <a href={view.url} download={view.name || undefined} className="mt-1 inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md bg-[#E07B53] text-white hover:opacity-90"><Download className="w-4 h-4" /> {t('review_download').replace('{ext}', ext)}</a>
            </div>
          )}
      </div>
    </div>
  )
}
