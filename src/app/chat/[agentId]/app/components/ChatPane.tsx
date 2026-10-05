'use client'

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Loader2, Paperclip, Send, X, FileText } from 'lucide-react'
import { MessageContent } from '@/components/chat/MessageContent'
import { isPdfFile } from '@/lib/pdf-to-image'
import { workT, type WorkLang } from '@/lib/translations/work'
import { WorkApiError, type ShownAttachment, type WorkApi, type WorkFiles, type WorkMessageView, type WorkAppProposal } from '../lib/api'
import { errorText } from './SheetTable'
import { asCsv } from './ImportDialog'
import { DropOverlay, FILE_MAX_BYTES, PDF_MAX_PAGES, pdfPageBlobs, useFileDrop } from './FilesPanel'

const MAX_FILES = 8
const TEXT_MAX_LINES = 7
const TURN_MAX_BYTES = 20 * 1024 * 1024
const TURN_MAX_PARTS = 24

export function ChatPane({ agentId, workflowId, token, api, files, lang, projectId, taskId, blocked, blockedText, welcome, projectIsEmpty, onApplyProposal, onTurnDone, onAuthError }: {
  agentId: string
  workflowId: string
  token: string | null
  api: WorkApi
  files: WorkFiles
  lang: WorkLang
  projectId: string
  taskId: string | null
  blocked: boolean
  blockedText?: string
  welcome: string
  projectIsEmpty: boolean
  onApplyProposal: (p: WorkAppProposal) => void
  onTurnDone: () => void
  onAuthError: () => void
}) {
  const t = (k: string, f?: string) => workT(lang, k, f)
  const [messages, setMessages] = useState<WorkMessageView[] | null>(null)
  const [text, setText] = useState('')
  const [picked, setPicked] = useState<File[]>([])
  const [sending, setSending] = useState(false)
  const [stage, setStage] = useState<'prepare' | 'answer' | null>(null)
  const [streaming, setStreaming] = useState('')
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const convKey = `${workflowId}:${taskId ?? ''}`
  const liveKey = useRef(convKey)
  liveKey.current = convKey

  const load = useCallback(async () => {
    const key = convKey
    const r = await api<{ messages: WorkMessageView[] }>('GET', `/${encodeURIComponent(workflowId)}/messages${taskId ? `?taskId=${encodeURIComponent(taskId)}` : ''}`)
    if (liveKey.current === key) setMessages(r.messages)
  }, [api, workflowId, taskId, convKey])

  useEffect(() => {
    setMessages(null); setError(null); setStreaming('')
    load().catch((e) => setError(errorText(lang, e)))
  }, [load, lang])

  useEffect(() => {
    setPicked([])
  }, [convKey, projectId])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, streaming])

  const buildTurnForm = async (): Promise<{ form: FormData; shown: ShownAttachment[] } | null> => {
    const form = new FormData()
    const shown: ShownAttachment[] = []
    let bytes = 0
    let parts = 0
    for (const f of picked) {
      if (isPdfFile(f)) {
        const room = Math.min(PDF_MAX_PAGES, TURN_MAX_PARTS - parts)
        if (room <= 0) { setError(t('chat_too_large')); return null }
        let pages: Blob[]
        try { pages = await pdfPageBlobs(f, room) } catch { pages = [] }
        if (pages.length === 0) { setError(t('chat_pdf_failed').replace('{name}', f.name)); return null }
        for (const pg of pages) { form.append('page', pg, f.name); bytes += pg.size; parts++ }
        shown.push({ name: f.name, mimeType: 'application/pdf', pages: pages.length })
      } else {
        const g = asCsv(f)
        form.append('file', g, f.name); bytes += g.size; parts++
        shown.push({ name: f.name, mimeType: g.type })
      }
    }
    if (bytes > TURN_MAX_BYTES || parts > TURN_MAX_PARTS) { setError(t('chat_too_large')); return null }
    return { form, shown }
  }

  const send = async () => {
    const body = text.trim()
    if (sending || blocked || (!body && picked.length === 0)) return
    const key = convKey
    setSending(true); setError(null)
    setStage('prepare')
    const turn = await buildTurnForm()
    if (!turn) { setSending(false); setStage(null); return }
    turn.form.set('payload', JSON.stringify({ taskId, text: body }))
    try {
      setStage('answer')
      setMessages((cur) => [...(cur ?? []), { id: `local-${Date.now()}`, role: 'user', actor: '', text: body, files: [], shown: turn.shown, proposals: [], createdAt: new Date().toISOString() }])
      setText(''); setPicked([])
      let res: Response
      try {
        res = await fetch(`/api/chat/${encodeURIComponent(agentId)}/app/${encodeURIComponent(workflowId)}/messages`, {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: turn.form,
        })
      } catch { throw new WorkApiError('network') }
      if (res.status === 401) { onAuthError(); return }
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        setError(workT(lang, `err_${j.error ?? 'INTERNAL'}`, t('chat_error')))
        return
      }
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      let acc = ''
      let failed = false
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6)
          if (payload === '[DONE]') continue
          try {
            const j = JSON.parse(payload) as { content?: unknown; error?: unknown }
            if (typeof j.content === 'string') { acc += j.content; if (liveKey.current === key) setStreaming(acc) }
            else if (j.error !== undefined) failed = true
          } catch { }
        }
      }
      if (failed && liveKey.current === key) setError(t('chat_error'))
    } catch (e) {
      setError(errorText(lang, e))
    } finally {
      setSending(false); setStage(null)
      if (liveKey.current === key) {
        setStreaming('')
        await load().catch(() => {})
      }
      onTurnDone()
    }
  }

  const onPick = (list: FileList | null) => {
    if (!list) return
    const next = [...picked]
    const skipped: string[] = []
    let over = 0
    for (const f of Array.from(list)) {
      if (f.size === 0) { skipped.push(`${f.name} — ${t('files_reason_empty')}`); continue }
      if (f.size > FILE_MAX_BYTES) { skipped.push(`${f.name} — ${t('files_reason_size')}`); continue }
      if (next.length < MAX_FILES) next.push(f)
      else over++
    }
    if (over > 0) skipped.unshift(t('chat_too_many_files').replace('{max}', String(MAX_FILES)).replace('{n}', String(over)))
    setError(skipped.length ? skipped.join('\n') : null)
    setPicked(next)
    if (fileRef.current) fileRef.current.value = ''
  }

  const fitText = useCallback(() => {
    const el = textRef.current
    if (!el) return
    const cs = getComputedStyle(el)
    const border = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth)
    const max = parseFloat(cs.lineHeight) * TEXT_MAX_LINES + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + border
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight + border, max)}px`
  }, [])
  useLayoutEffect(fitText, [text, fitText])
  const textObserver = useRef<ResizeObserver | null>(null)
  const attachText = useCallback((el: HTMLTextAreaElement | null) => {
    textObserver.current?.disconnect()
    textObserver.current = null
    textRef.current = el
    if (!el || typeof ResizeObserver === 'undefined') return
    let width = el.clientWidth
    const ro = new ResizeObserver(() => { if (el.clientWidth !== width) { width = el.clientWidth; fitText() } })
    ro.observe(el)
    textObserver.current = ro
  }, [fitText])

  const drop = useFileDrop(!blocked && !sending, onPick)

  return (
    <div className="relative flex-1 min-h-0 flex flex-col" {...drop.props}>
      {drop.over && <DropOverlay text={t('chat_drop')} />}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-3 sm:px-4">
        <div className="w-full sm:w-[85%] mx-auto py-4 space-y-4">
          {messages === null ? (
            !error && <div className="py-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-[#E07B53]" /></div>
          ) : messages.length === 0 && !streaming ? (
            <p className="py-10 text-center text-lg font-light text-gray-300">{welcome || t('chat_welcome')}</p>
          ) : null}
          {messages?.map((m) => (
            <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[92%] rounded-lg px-3 py-2 ${m.role === 'user' ? 'bg-[#2A2A2A] text-white' : 'text-gray-200'}`}>
                {m.text && (
                  <div className="prose prose-invert prose-sm max-w-none">
                    <MessageContent content={m.text} role={m.role} theme="dark" size="sm" />
                  </div>
                )}
                {m.files.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {m.files.map((f) => (
                      <button key={f.id} onClick={() => { if (!f.id.startsWith('local-')) void files.open(projectId, f.id).catch((e) => setError(errorText(lang, e))) }}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-[#1E1E1E] border border-[#3A3A3A] text-gray-300 hover:text-white">
                        <FileText className="w-3 h-3" /><span className="max-w-[180px] truncate">{f.name}</span>
                      </button>
                    ))}
                  </div>
                )}
                {m.shown.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {m.shown.map((f, i) => (
                      <span key={i} title={t('chat_shown_only')} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-dashed border-[#4A4A4A] text-gray-400">
                        <FileText className="w-3 h-3" /><span className="max-w-[180px] truncate">{f.name}</span>
                      </span>
                    ))}
                    <span className="text-[11px] text-gray-500 self-center">{t('chat_shown_only')}</span>
                  </div>
                )}
                {m.proposals.map((p, i) => p.type === 'apply_app_template' ? (
                  <div key={i} className="mt-2">
                    <button disabled={!projectIsEmpty} onClick={() => onApplyProposal(p)}
                      className="px-3 py-1.5 text-sm rounded-md bg-[#E07B53] text-white hover:opacity-90 disabled:opacity-40">
                      {projectIsEmpty ? t('apply_template_button').replace('{template}', t(`kind_${p.kind}`, p.kind)) : t('apply_template_done')}
                    </button>
                  </div>
                ) : (
                  <div key={i} className="mt-2">
                    <button disabled={blocked} onClick={() => onApplyProposal(p)}
                      className="px-3 py-1.5 text-sm rounded-md bg-[#E07B53] text-white hover:opacity-90 disabled:opacity-40">
                      {t('import_card_button').replace('{name}', p.fileName).replace('{n}', String(p.rows))}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {streaming && (
            <div className="prose prose-invert prose-sm max-w-none text-gray-200 px-3">
              <MessageContent content={streaming} role="assistant" theme="dark" size="sm" isStreaming />
            </div>
          )}
          {sending && !streaming && (
            <div className="flex items-center gap-2 px-3 text-xs text-gray-500">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />{stage === 'prepare' ? t('chat_preparing') : ''}
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      <div className="border-t border-[#2A2A2A] px-3 sm:px-4 py-3">
        <div className="w-full sm:w-[85%] mx-auto space-y-2">
          {error && <p role="alert" className="text-sm text-red-400 whitespace-pre-line">{error}</p>}
          {blocked ? (
            <p className="text-sm text-amber-300">{t(blockedText ?? 'chat_blocked')}</p>
          ) : (
            <>
              {picked.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {picked.map((f, i) => (
                    <span key={i} title={t('chat_shown_only')} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-[#2A2A2A] text-gray-300">
                      <span className="max-w-[160px] truncate">{f.name}</span>
                      <button onClick={() => setPicked((cur) => cur.filter((_, j) => j !== i))} aria-label={t('delete')}><X className="w-3 h-3" /></button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex items-end gap-2">
                <input ref={fileRef} type="file" multiple hidden accept=".csv,.pdf,.xlsx,.txt,image/jpeg,image/png,image/webp,image/heic" onChange={(e) => onPick(e.target.files)} />
                <button onClick={() => fileRef.current?.click()} disabled={sending} className="shrink-0 p-1.5 text-gray-400 hover:text-white disabled:opacity-40" title={t('chat_attach')} aria-label={t('chat_attach')}>
                  <Paperclip className="w-4 h-4" />
                </button>
                <textarea
                  ref={attachText}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() } }}
                  rows={2}
                  placeholder={t('chat_placeholder')}
                  className="flex-1 resize-none scrollbar-thin rounded-md bg-[#2A2A2A] border border-[#3A3A3A] px-3 py-2 text-sm text-white focus:outline-none focus:border-[#E07B53]"
                  autoComplete="off"
                />
                <button onClick={() => void send()} disabled={sending || (!text.trim() && picked.length === 0)} className="p-2 rounded-md bg-[#E07B53] text-white disabled:opacity-40" aria-label={t('chat_send')}>
                  {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
