'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Loader2, Pencil, Trash2 } from 'lucide-react'
import { workT, type WorkLang } from '@/lib/translations/work'
import { WorkApiError, type NoteKind, type NoteList, type NoteView, type TaskSummary, type WorkApi } from '../lib/api'
import { errorText } from './SheetTable'
import { ConfirmDialog } from './ConfirmDialog'
import { useWorkPkg } from './work-pkg'

const KINDS: NoteKind[] = ['conclusion', 'todo', 'source']
const inputCls = 'w-full rounded-md bg-[#2A2A2A] border border-[#3A3A3A] px-3 py-2 text-sm text-white focus:outline-none focus:border-[#E07B53]'
const MAX_CHARS = 20_000

function NoteEditor({ lang, kind: kind0, text: text0, busy, okLabel, onSave, onCancel }: {
  lang: WorkLang
  kind: NoteKind
  text: string
  busy: boolean
  okLabel: string
  onSave: (kind: NoteKind, text: string) => void
  onCancel?: () => void
}) {
  const pkg = useWorkPkg()
  const t = (k: string, f?: string) => workT(lang, k, f, pkg)
  const [kind, setKind] = useState<NoteKind>(kind0)
  const [text, setText] = useState(text0)
  const ok = text.trim() !== '' && text.length <= MAX_CHARS
  return (
    <div className="space-y-2">
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={MAX_CHARS} placeholder={t('note_placeholder')} className={`${inputCls} resize-y`} autoComplete="off" />
      <div className="flex flex-wrap items-center justify-end gap-2">
        <select value={kind} onChange={(e) => setKind(e.target.value as NoteKind)} className="rounded-md bg-[#2A2A2A] border border-[#3A3A3A] px-2 py-1.5 text-sm text-white focus:outline-none focus:border-[#E07B53]" aria-label={t('note_kind')}>
          {KINDS.map((k) => <option key={k} value={k}>{t(`note_kind_${k}`)}</option>)}
        </select>
        {onCancel && <button onClick={onCancel} disabled={busy} className="px-3 py-1.5 text-sm rounded-md text-gray-300 hover:bg-[#2A2A2A]">{t('cancel')}</button>}
        <button onClick={() => onSave(kind, text)} disabled={busy || !ok} className="px-3 py-1.5 text-sm rounded-md bg-[#E07B53] text-white hover:opacity-90 disabled:opacity-40">{okLabel}</button>
      </div>
    </div>
  )
}

function NoteSection({ lang, title, help, notes, locked, lockedText, busy, onCreate, onUpdate, onDelete, onReview }: {
  lang: WorkLang
  title: string
  help: string
  notes: NoteView[]
  locked: boolean
  lockedText?: string
  busy: boolean
  onCreate: (kind: NoteKind, text: string) => Promise<boolean>
  onUpdate: (n: NoteView, patch: { kind?: NoteKind; text?: string; done?: boolean }) => Promise<boolean>
  onDelete: (n: NoteView) => void
  onReview: (n: NoteView, accept: boolean) => void
}) {
  const pkg = useWorkPkg()
  const t = (k: string, f?: string) => workT(lang, k, f, pkg)
  const [editing, setEditing] = useState<{ id: string; updatedAt: string } | null>(null)
  const [draftKey, setDraftKey] = useState(0)
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium text-white">{title}</h2>
        <p className="text-xs text-gray-500">{help}</p>
      </div>
      {locked && lockedText && <p className="text-xs text-amber-300">{lockedText}</p>}
      {notes.length === 0 && <p className="text-sm text-gray-500">{t('notes_empty')}</p>}
      <ul className="space-y-2">
        {notes.map((n) => (
          <li key={n.id} className="rounded-lg border border-[#2A2A2A] bg-[#232323] p-3">
            {editing?.id === n.id ? (
              <NoteEditor lang={lang} kind={n.kind} text={n.text} busy={busy} okLabel={t('save')} onCancel={() => setEditing(null)}
                onSave={(kind, text) => void onUpdate({ ...n, updatedAt: editing.updatedAt }, { kind, text }).then((ok) => { if (ok) setEditing(null) })} />
            ) : (
              <div className="flex items-start gap-2">
                {n.kind === 'todo' && (
                  <button
                    onClick={() => void onUpdate(n, { done: !n.done })}
                    disabled={busy || locked}
                    className={`mt-0.5 w-4 h-4 shrink-0 rounded border flex items-center justify-center ${n.done ? 'bg-emerald-600 border-emerald-600' : 'border-gray-500'} disabled:opacity-60`}
                    aria-label={t('note_done')}
                    aria-pressed={!!n.done}
                  >{n.done && <Check className="w-3 h-3 text-white" />}</button>
                )}
                <div className="min-w-0 flex-1">
                  <span className="inline-block text-[10px] px-1.5 py-0.5 mb-1 rounded bg-[#2A2A2A] text-gray-400">{t(`note_kind_${n.kind}`)}</span>
                  {n.status === 'proposed' && <span className="inline-block ml-1 text-[10px] px-1.5 py-0.5 mb-1 rounded bg-sky-900/60 text-sky-300">{t('note_proposed')}</span>}
                  <p className={`text-sm whitespace-pre-wrap break-words ${n.done ? 'text-gray-500 line-through' : 'text-gray-200'}`}>{n.text}</p>
                  {n.status === 'proposed' && n.previous && <p className="mt-1 text-xs text-gray-500">{t('note_proposed_change')}</p>}
                  {n.status === 'proposed' && !locked && (
                    <div className="mt-2 flex gap-2">
                      <button onClick={() => onReview(n, true)} disabled={busy} className="px-2.5 py-1 text-xs rounded-md bg-emerald-700 text-white hover:opacity-90 disabled:opacity-40">{t('note_accept')}</button>
                      <button onClick={() => onReview(n, false)} disabled={busy} className="px-2.5 py-1 text-xs rounded-md bg-[#2A2A2A] text-gray-300 hover:text-white disabled:opacity-40">{t('note_discard')}</button>
                    </div>
                  )}
                </div>
                {!locked && (
                  <div className="flex shrink-0">
                    <button onClick={() => setEditing({ id: n.id, updatedAt: n.updatedAt })} disabled={busy} className="p-1 text-gray-500 hover:text-white" title={t('edit')} aria-label={t('edit')}><Pencil className="w-3.5 h-3.5" /></button>
                    <button onClick={() => onDelete(n)} disabled={busy} className="p-1 text-gray-500 hover:text-red-400" title={t('delete')} aria-label={t('delete')}><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {!locked && (
        <NoteEditor key={draftKey} lang={lang} kind="conclusion" text="" busy={busy} okLabel={t('note_add')}
          onSave={(kind, text) => void onCreate(kind, text).then((ok) => { if (ok) setDraftKey((k) => k + 1) })} />
      )}
    </section>
  )
}

export function NotePanel({ api, lang, projectId, task, readOnly }: { api: WorkApi; lang: WorkLang; projectId: string; task: TaskSummary | null; readOnly: boolean }) {
  const pkg = useWorkPkg()
  const t = (k: string, f?: string) => workT(lang, k, f, pkg)
  const [list, setList] = useState<NoteList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState<NoteView | null>(null)
  const inFlight = useRef(false)
  const taskId = task?.id ?? null
  const path = `/projects/${projectId}/notes${taskId ? `?taskId=${encodeURIComponent(taskId)}` : ''}`

  const load = useCallback(async () => { setList(await api<NoteList>('GET', path)) }, [api, path])

  useEffect(() => {
    let live = true
    api<NoteList>('GET', path)
      .then((r) => { if (live) setList(r) })
      .catch((e) => { if (live) setError(errorText(lang, e, pkg)) })
    return () => { live = false }
  }, [api, lang, path, pkg])

  const run = async (fn: () => Promise<unknown>): Promise<boolean> => {
    if (inFlight.current) return false
    inFlight.current = true
    setBusy(true); setError(null)
    try { await fn(); await load(); return true } catch (e) {
      setError(e instanceof WorkApiError && e.code === 'STALE' ? t('note_stale') : errorText(lang, e, pkg))
      await load().catch(() => {})
      return false
    } finally { inFlight.current = false; setBusy(false) }
  }

  const create = (tid: string | null) => (kind: NoteKind, text: string) => run(() => api('POST', `/projects/${projectId}/notes`, { taskId: tid, kind, text }))
  const update = (n: NoteView, patch: { kind?: NoteKind; text?: string; done?: boolean }) => run(() => api('PATCH', `/projects/${projectId}/notes/${n.id}`, { ...patch, updatedAt: n.updatedAt }))
  const review = (n: NoteView, accept: boolean) => void run(() => api('POST', `/projects/${projectId}/notes/${n.id}/review`, { accept, updatedAt: n.updatedAt }))

  if (!list) {
    return error ? <p className="p-4 text-sm text-red-400 whitespace-pre-line">{error}</p> : <div className="p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-[#E07B53]" /></div>
  }
  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin">
      <div className="max-w-3xl mx-auto px-4 py-4 space-y-6">
        <p className="text-xs text-gray-400">{t('notes_help')}</p>
        {error && <p role="alert" className="text-sm text-red-400 whitespace-pre-line">{error}</p>}
        {task && list.task && (
          <NoteSection lang={lang} title={t('notes_task').replace('{task}', task.title)} help={t('notes_task_help')} notes={list.task}
            locked={readOnly || list.taskLocked} lockedText={list.taskLocked ? t('notes_locked') : undefined} busy={busy}
            onCreate={create(task.id)} onUpdate={update} onDelete={setDeleting} onReview={review} />
        )}
        <NoteSection lang={lang} title={t('notes_project')} help={t('notes_project_help')} notes={list.project}
          locked={readOnly} busy={busy} onCreate={create(null)} onUpdate={update} onDelete={setDeleting} onReview={review} />
      </div>
      {deleting && (
        <ConfirmDialog message={t('note_delete_confirm')} okLabel={t('delete')} cancelLabel={t('cancel')} busy={busy}
          onOk={() => { const n = deleting; void run(() => api('DELETE', `/projects/${projectId}/notes/${n.id}`, { updatedAt: n.updatedAt })).then(() => setDeleting(null)) }}
          onCancel={() => setDeleting(null)} />
      )}
    </div>
  )
}
