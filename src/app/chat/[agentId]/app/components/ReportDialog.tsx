'use client'

import React, { useRef, useState } from 'react'
import { Check, Flag, Loader2, Paperclip, X } from 'lucide-react'
import { workT, type WorkLang } from '@/lib/translations/work'
import { REPORT_CONSENT_V, REPORT_MAX_ATTACH, REPORT_MAX_FILES, REPORT_NOTE_MAX } from '@/lib/work/report-limits'
import { saveCardDone, type CardDone, type ProjectFileView, type WorkApi, type WorkFiles } from '../lib/api'
import { errorText } from './SheetTable'
import { useWorkPkg } from './work-pkg'

const ACCEPT = '.csv,.pdf,.xlsx,.txt,image/jpeg,image/png,image/webp,image/heic'

export function ReportDialog({ files, lang, projectId, candidates, initial, initialNote, reattach, source, chatMessageId, onSent, onClose }: {
  files: WorkFiles
  lang: WorkLang
  projectId: string
  candidates: ProjectFileView[]
  initial: string[]
  source: 'work_files' | 'work_chat'
  chatMessageId?: string
  reattach?: string[]
  initialNote?: string
  onSent?: (number: number) => void
  onClose: () => void
}) {
  const pkg = useWorkPkg()
  const t = (k: string, f?: string) => workT(lang, k, f, pkg)
  const [picked, setPicked] = useState<Set<string>>(() => new Set(initial.slice(0, REPORT_MAX_FILES)))
  const [attached, setAttached] = useState<File[]>([])
  const [note, setNote] = useState(() => (initialNote ?? '').slice(0, REPORT_NOTE_MAX))
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<number | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const over = initial.length > REPORT_MAX_FILES
  const [ordered] = useState(() => [...candidates.filter((f) => initial.includes(f.id)), ...candidates.filter((f) => !initial.includes(f.id))])

  const toggle = (id: string) => setPicked((cur) => {
    const next = new Set(cur)
    if (next.has(id)) next.delete(id)
    else if (next.size < REPORT_MAX_FILES) next.add(id)
    return next
  })
  const empty = picked.size === 0 && attached.length === 0 && !chatMessageId

  const send = async () => {
    if (!consent || empty || busy) return
    setBusy(true); setError(null)
    try {
      const r = await files.report(projectId, { source, fileIds: [...picked], note: note.trim(), chatMessageId, consentV: REPORT_CONSENT_V, lang, attached })
      setDone(r.number)
      onSent?.(r.number)
    } catch (e) { setError(errorText(lang, e, pkg)) } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4" onClick={busy ? undefined : onClose}>
      <div className="w-full max-w-2xl max-h-[92dvh] overflow-y-auto scrollbar-thin rounded-xl bg-[#1E1E1E] border border-[#2A2A2A] p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-sm font-medium text-white">{t('report_title')}</h2>
          <button onClick={onClose} disabled={busy} aria-label={t('cancel')} className="p-1 text-gray-500 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        {done !== null ? (
          <>
            <p className="text-sm text-green-400">{t('report_sent').replace('{n}', String(done))}</p>
            <div className="flex justify-end"><button onClick={onClose} className="px-3 py-2 text-sm rounded-md bg-[#E07B53] text-white hover:opacity-90">{t('close')}</button></div>
          </>
        ) : (
          <>
            <p className="text-xs text-gray-400">{t('report_intro')}</p>
            {chatMessageId && <p className="text-xs text-gray-400">{t('report_chat_included')}</p>}
            {reattach && reattach.length > 0 && <p className="text-xs text-amber-300">{t('report_reattach').replace('{names}', reattach.join(', '))}</p>}
            {candidates.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-gray-300">{t('report_files').replace('{n}', String(REPORT_MAX_FILES))} · <span className="text-[#E07B53]">{t('report_picked').replace('{n}', String(picked.size))}</span></p>
                {over && <p className="text-xs text-amber-300">{t('report_over').replace('{n}', String(REPORT_MAX_FILES))}</p>}
                <ul className="max-h-[40dvh] overflow-y-auto scrollbar-thin rounded-md border border-[#2A2A2A] divide-y divide-[#2A2A2A]">
                  {ordered.map((f) => (
                    <li key={f.id}>
                      <label className="flex items-center gap-2 px-2 py-1.5 text-xs text-gray-200 cursor-pointer">
                        <input type="checkbox" className="accent-[#E07B53] shrink-0" checked={picked.has(f.id)} disabled={busy || (!picked.has(f.id) && picked.size >= REPORT_MAX_FILES)} onChange={() => toggle(f.id)} />
                        <span className="truncate">{f.name}</span>
                        {f.status?.status === 'unreadable' && <span className="shrink-0 text-[10px] text-red-300">{t('files_status_unreadable')}</span>}
                        {f.reported !== undefined && <span className="shrink-0 text-[10px] text-amber-300">{t('files_reported').replace('{n}', String(f.reported))}</span>}
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-1">
                {attached.map((f, i) => (
                  <span key={i} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-[#2A2A2A] text-gray-300">
                    <span className="max-w-[160px] truncate">{f.name}</span>
                    <button onClick={() => setAttached((cur) => cur.filter((_, j) => j !== i))} disabled={busy} aria-label={t('delete')}><X className="w-3 h-3" /></button>
                  </span>
                ))}
                {attached.length < REPORT_MAX_ATTACH && (
                  <button onClick={() => fileRef.current?.click()} disabled={busy} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-[#3A3A3A] text-gray-400 hover:text-gray-200">
                    <Paperclip className="w-3 h-3" />{t('report_attach')}
                  </button>
                )}
              </div>
              <input ref={fileRef} type="file" multiple hidden accept={ACCEPT}
                onChange={(e) => { const l = Array.from(e.target.files ?? []); e.target.value = ''; setAttached((cur) => [...cur, ...l].slice(0, REPORT_MAX_ATTACH)) }} />
            </div>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={initialNote ? 7 : 3} maxLength={REPORT_NOTE_MAX} placeholder={t('report_note')} disabled={busy} autoComplete="off"
              className="w-full rounded-md bg-[#141414] border border-[#2A2A2A] px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-[#E07B53]" />
            <label className="flex items-start gap-2 text-xs text-gray-200 cursor-pointer">
              <input type="checkbox" className="accent-[#E07B53] mt-0.5 shrink-0" checked={consent} disabled={busy} onChange={(e) => setConsent(e.target.checked)} />
              <span>{t('report_consent')}</span>
            </label>
            <p className="text-[11px] text-gray-500">{t('report_reply_note')}</p>
            {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={onClose} disabled={busy} className="px-3 py-2 text-sm rounded-md text-gray-300 hover:bg-[#2A2A2A]">{t('cancel')}</button>
              <button onClick={() => void send()} disabled={busy || !consent || empty} className="inline-flex items-center gap-1 px-3 py-2 text-sm rounded-md bg-[#E07B53] text-white hover:opacity-90 disabled:opacity-50">
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}{t('report_send')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export function ReportCard({ card, files, api, lang, projectId, messageId, index, initialDone, disabled, withChat }: {
  card: { files: Array<{ fileId: string; name: string; problem: string }>; part: number; parts: number }
  files: WorkFiles
  api: WorkApi
  lang: WorkLang
  projectId: string
  messageId: string
  index: number
  initialDone?: CardDone
  disabled?: boolean
  withChat: boolean
}) {
  const pkg = useWorkPkg()
  const t = (k: string, f?: string) => workT(lang, k, f, pkg)
  const [sent, setSent] = useState<number | null>(typeof initialDone?.report === 'number' ? initialDone.report : null)
  const [open, setOpen] = useState<ProjectFileView[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const start = async () => {
    setError(null)
    try { setOpen(await files.list(projectId)) } catch (e) { setError(errorText(lang, e, pkg)) }
  }
  return (
    <div className="mt-2 rounded-lg border border-[#3A3A3A] bg-[#232323] p-3 text-sm space-y-1.5">
      <p className="text-gray-200">{t('report_card_title')}{card.parts > 1 ? ` · ${card.part}/${card.parts}` : ''}</p>
      <ul className="space-y-0.5">
        {card.files.map((f) => <li key={f.fileId} className="text-xs text-gray-400 break-words"><span className="text-gray-200">{f.name}</span> — {f.problem}</li>)}
      </ul>
      {sent !== null ? (
        <p className="inline-flex items-center gap-1 text-xs text-green-400"><Check className="w-3.5 h-3.5" />{t('report_card_sent').replace('{n}', String(sent))}</p>
      ) : (
        <button onClick={() => void start()} disabled={disabled}
          className="px-3 py-1.5 text-sm rounded-md bg-[#E07B53] text-white hover:opacity-90 disabled:opacity-40 inline-flex items-center gap-1">
          <Flag className="w-3.5 h-3.5" />{t('report_card_button')}
        </button>
      )}
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
      {open && (() => {
        const pick = card.files.filter((f) => open.some((x) => x.id === f.fileId && x.reported === undefined))
        return (
        <ReportDialog files={files} lang={lang} projectId={projectId} candidates={open} initial={pick.map((f) => f.fileId)}
          initialNote={pick.map((f) => `${f.name.slice(0, 80)} — ${f.problem}`).join('\n')} source={withChat ? 'work_chat' : 'work_files'} chatMessageId={withChat ? messageId : undefined}
          onSent={(n) => { setSent(n); saveCardDone(api, projectId, messageId, index, { report: n }) }}
          onClose={() => setOpen(null)} />
        )
      })()}
    </div>
  )
}
