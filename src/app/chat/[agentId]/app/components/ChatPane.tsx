'use client'

import { stripCitationMarks } from '@/lib/work/citation-marks'
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Bell, Check, Download, Loader2, Paperclip, Send, X, FileText } from 'lucide-react'
import { MessageContent, type RenderedTable } from '@/components/chat/MessageContent'
import { isPdfFile } from '@/lib/pdf-to-image'
import { workT, type WorkLang } from '@/lib/translations/work'
import { WorkApiError, type ChatRoom, type ProjectFileView, type SendView, type ShownAttachment, type WorkApi, type WorkFiles, type WorkMessageView, type WorkAppProposal } from '../lib/api'
import { SendCard } from './SendsPanel'
import { ModuleRunCard } from './ModuleRunCard'
import { ConfirmRowsCard } from './ConfirmRowsCard'
import { LedgerLinkCard } from './LedgerLinkCard'
import { LedgerFilesCard } from './LedgerFilesCard'
import { LedgerStatementCard, type LedgerImportOpen } from './LedgerStatementCard'
import { errorText } from './SheetTable'
import { asCsv } from './ImportDialog'
import { DropOverlay, FILE_MAX_BYTES, PDF_MAX_PAGES, pdfPageBlobs, useFileDrop } from './FilesPanel'
import { useWorkPkg } from './work-pkg'
import { ReportCard, ReportDialog } from './ReportDialog'
import { useEdition } from '@/components/EditionProvider'

const MAX_FILES = 8
const TEXT_MAX_LINES = 7
const TURN_MAX_BYTES = 20 * 1024 * 1024
const TURN_MAX_PARTS = 24

function noticeText(t: (k: string, f?: string) => string, n: { key: string; params?: Record<string, string | number> } | undefined): string {
  if (!n) return ''
  const p = n.params ?? {}
  return t(n.key, '').replace(/\{(\w+)\}/g, (all, k: string) => {
    if (!(k in p)) return all
    return k === 'sheet' && typeof p.family === 'string' ? t(`sheet_${p.family}`, String(p.sheet)) : String(p[k])
  })
}

export function ChatPane({ agentId, workflowId, token, api, workApi, files, lang, projectId, taskId, room, blocked, blockedText, readOnly, welcome, projectIsEmpty, draft, reloadKey, onApplyProposal, onOpenLedgerImport, onTurnDone, onSendChanged, onAuthError, onRoomRead }: {
  agentId: string
  workflowId: string
  token: string | null
  api: WorkApi
  workApi: WorkApi
  readOnly: boolean
  files: WorkFiles
  lang: WorkLang
  projectId: string
  taskId: string | null
  room: ChatRoom
  blocked: boolean
  blockedText?: string
  welcome: string
  projectIsEmpty: boolean
  draft?: { text: string; n: number } | null
  onApplyProposal: (p: WorkAppProposal, card?: { messageId: string; index: number }) => void
  onOpenLedgerImport?: (o: LedgerImportOpen) => void
  onTurnDone: () => void
  onSendChanged: () => void
  onAuthError: () => void
  reloadKey?: number
  onRoomRead?: () => void
}) {
  const pkg = useWorkPkg()
  const t = (k: string, f?: string) => workT(lang, k, f, pkg)
  const [messages, setMessages] = useState<WorkMessageView[] | null>(null)
  const [me, setMe] = useState<string | null>(null)
  const [authors, setAuthors] = useState<Record<string, string>>({})
  const [shared, setShared] = useState<string | null>(null)
  const selfHosted = useEdition() === 'selfhosted'
  const [reporting, setReporting] = useState<{ messageId: string; initial: string[]; reattach: string[]; candidates: ProjectFileView[] } | null>(null)
  const openReport = async (m: WorkMessageView) => {
    const all = messages ?? []
    const at = all.findIndex((x) => x.id === m.id)
    const prev = at > 0 && all[at - 1].role === 'user' ? all[at - 1] : null
    try {
      const candidates = await files.list(projectId)
      const ids = [...new Set([...(prev?.files ?? []), ...m.files].map((f) => f.id))].filter((id) => candidates.some((c) => c.id === id))
      setReporting({ messageId: m.id, initial: ids, reattach: (prev?.shown ?? []).map((f) => f.name), candidates })
    } catch (e) { setError(errorText(lang, e, pkg)) }
  }
  const [text, setText] = useState('')
  const [picked, setPicked] = useState<File[]>([])
  const [sending, setSending] = useState(false)
  const [stage, setStage] = useState<'prepare' | 'answer' | null>(null)
  const [streaming, setStreaming] = useState('')
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const convKey = `${workflowId}:${taskId ?? ''}:${room}`
  const liveKey = useRef(convKey)
  liveKey.current = convKey
  const loadSeq = useRef(0)
  const convGen = useRef(0)
  useEffect(() => { convGen.current++ }, [convKey])
  const prevRoom = useRef(room)
  useEffect(() => { if (prevRoom.current !== room) { prevRoom.current = room; setText('') } }, [room])
  useEffect(() => { if (draft?.text) { setText(draft.text); requestAnimationFrame(() => textRef.current?.focus()) } }, [draft?.n]) // eslint-disable-line react-hooks/exhaustive-deps

  const [sends, setSends] = useState<Record<string, SendView>>({})
  const load = useCallback(async () => {
    const key = convKey
    const seq = ++loadSeq.current
    const q = new URLSearchParams({ room, ...(taskId ? { taskId } : {}) })
    const r = await api<{ messages: WorkMessageView[]; me?: string | null; authors?: Record<string, string> }>('GET', `/${encodeURIComponent(workflowId)}/messages?${q}`)
    if (liveKey.current !== key || seq !== loadSeq.current) return
    setMessages(r.messages)
    setMe(r.me ?? null); setAuthors(r.authors ?? {})
    if (room === 'team') onRoomRead?.()
    const ids = [...new Set(r.messages.flatMap((m) => [...m.proposals.flatMap((p) => (p.type === 'send' ? [p.sendId] : [])), ...(m.sendId ? [m.sendId] : [])]))].slice(-100)
    if (!ids.length) return
    try {
      const s = await workApi<{ sends: SendView[] }>('GET', `/projects/${encodeURIComponent(projectId)}/sends?ids=${ids.map(encodeURIComponent).join(',')}`)
      if (liveKey.current === key && seq === loadSeq.current) setSends(Object.fromEntries(s.sends.map((x) => [x.id, x])))
    } catch { }
  }, [api, workApi, workflowId, taskId, room, convKey, projectId]) // eslint-disable-line react-hooks/exhaustive-deps
  const cardIds = new Set((messages ?? []).flatMap((m) => m.proposals.flatMap((p) => (p.type === 'send' ? [p.sendId] : []))))
  const sendChanged = (next: SendView) => { setSends((cur) => ({ ...cur, [next.id]: next })); onSendChanged(); void load().catch(() => {}) }

  useEffect(() => {
    setMessages(null); setError(null); setStreaming(''); setShared(null)
    load().catch((e) => setError(errorText(lang, e, pkg)))
  }, [load, lang, pkg])

  useEffect(() => { if (reloadKey) load().catch(() => {}) }, [reloadKey]) // eslint-disable-line react-hooks/exhaustive-deps

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
    const gen = convGen.current
    setSending(true); setError(null)
    setStage('prepare')
    const turn = await buildTurnForm()
    if (!turn) { setSending(false); setStage(null); return }
    if (liveKey.current !== key || convGen.current !== gen) { setSending(false); setStage(null); return }
    turn.form.set('payload', JSON.stringify({ taskId, text: body, room }))
    try {
      setStage('answer')
      if (liveKey.current === key) setMessages((cur) => [...(cur ?? []), { id: `local-${Date.now()}`, role: 'user', actor: me ?? '', text: body, files: [], shown: turn.shown, proposals: [], createdAt: new Date().toISOString() }])
      if (liveKey.current === key) { setText(''); setPicked([]) }
      let res: Response
      try {
        res = await fetch(`/api/chat/${encodeURIComponent(agentId)}/app/${encodeURIComponent(workflowId)}/messages`, {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: turn.form,
        })
      } catch { throw new WorkApiError('network') }
      if (res.status === 401) { onAuthError(); return }
      if (res.ok && (res.headers.get('content-type') ?? '').includes('application/json')) { onRoomRead?.(); return }
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        setError(workT(lang, `err_${j.error ?? 'INTERNAL'}`, t('chat_error')))
        return
      }
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      let acc = ''
      let failed: false | 'error' | 'rate' | 'cpa' = false
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
            const j = JSON.parse(payload) as { content?: unknown; error?: unknown; code?: unknown }
            if (typeof j.content === 'string') { acc += j.content; if (liveKey.current === key) setStreaming(stripCitationMarks(acc)) }
            else if (j.error !== undefined) failed = j.code === 'RATE_LIMITED' ? 'rate' : j.code === 'INSUFFICIENT_CPA' ? 'cpa' : 'error'
          } catch { }
        }
      }
      if (failed && liveKey.current === key) setError(t(failed === 'rate' ? 'chat_rate_limited' : failed === 'cpa' ? 'err_INSUFFICIENT_CPA' : 'chat_error'))
    } catch (e) {
      setError(errorText(lang, e, pkg))
    } finally {
      setSending(false); setStage(null)
      if (liveKey.current === key) {
        setStreaming('')
        await load().catch(() => {})
      }
      onTurnDone()
    }
  }

  const downloadTable = async (format: 'xlsx' | 'csv' | 'pdf', read: () => RenderedTable) => {
    try {
      const table = read()
      if (!table.header.length) return
      const blob = await files.exportTable(projectId, format, table)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-')
      a.href = url; a.download = `table-${stamp}.${format}`
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
    } catch (e) { setError(errorText(lang, e, pkg)) }
  }
  const tableDownloads = useCallback((read: () => RenderedTable) => (
    <div className="mt-1 mb-2 flex items-center gap-1 text-[11px] text-gray-500">
      <Download className="w-3 h-3" />
      {(['xlsx', 'csv', 'pdf'] as const).map((f) => (
        <button key={f} type="button" onClick={() => void downloadTable(f, read)} className="px-1.5 py-0.5 rounded border border-[#3A3A3A] hover:text-[#E07B53] hover:border-[#E07B53]">
          {f === 'xlsx' ? 'Excel' : f.toUpperCase()}
        </button>
      ))}
    </div>
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [projectId, files, lang, pkg])

  const shareMessage = async (id: string) => {
    try {
      await api('POST', `/${encodeURIComponent(workflowId)}/rooms`, { action: 'share', messageId: id })
      setShared(id); onRoomRead?.()
    } catch (e) { setError(errorText(lang, e, pkg)) }
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
        <div className="w-full sm:w-[95%] mx-auto py-4 space-y-4">
          {messages === null ? (
            !error && <div className="py-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-[#E07B53]" /></div>
          ) : messages.length === 0 && !streaming ? (
            <p className="py-10 text-center text-lg font-light text-gray-300">{welcome || t('chat_welcome')}</p>
          ) : null}
          {messages?.filter((m) => !m.sendId || !cardIds.has(m.sendId)).map((m) => m.role === 'notice' ? (
            <p key={m.id} className="flex items-start gap-1.5 text-xs text-gray-400">
              <Bell className="w-3 h-3 mt-0.5 shrink-0 text-[#E07B53]" />
              <span>{m.notice?.by ? <><span className="text-gray-300">{m.notice.by === me ? t('room_you') : authors[m.notice.by] ?? t('room_someone')}</span> · </> : null}{noticeText(t, m.notice)}</span>
              <span className="text-gray-600">· {new Date(m.createdAt).toLocaleString(lang, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
            </p>
          ) : (
            <div key={m.id} className={`flex ${m.role === 'user' && (room === 'private' || m.actor === me) ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[92%] rounded-lg px-3 py-2 ${m.role === 'user' ? (room === 'team' && m.actor !== me ? 'bg-[#262a33] text-white' : 'bg-[#2A2A2A] text-white') : 'text-gray-200'}`}>
                {room === 'team' && m.role === 'user' && (m.actor !== me || m.shared) && (
                  <p className="text-[11px] text-gray-400 mb-0.5">{m.actor === me ? t('room_you') : authors[m.actor] ?? t('room_someone')}{m.shared ? ` · ${t('room_shared_mark')}` : ''}</p>
                )}
                {m.sendId ? (
                  sends[m.sendId] && <SendCard send={sends[m.sendId]} api={workApi} files={files} lang={lang} projectId={projectId} readOnly={readOnly} compact onChanged={sendChanged} />
                ) : m.text && (
                  <div className="prose prose-invert prose-sm max-w-none">
                    <MessageContent content={m.role === 'assistant' ? stripCitationMarks(m.text) : m.text} role={m.role} theme="dark" size="sm" remoteImages={false} tableActions={m.role === 'assistant' ? tableDownloads : undefined} />
                  </div>
                )}
                {m.files.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {m.files.map((f) => (
                      <button key={f.id} onClick={() => { if (!f.id.startsWith('local-')) void files.open(projectId, f.id).catch((e) => setError(errorText(lang, e, pkg))) }}
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
                ) : p.type === 'send' ? (
                  sends[p.sendId] ? <div key={i} className="mt-2"><SendCard send={sends[p.sendId]} api={workApi} files={files} lang={lang} projectId={projectId} readOnly={readOnly} onChanged={sendChanged} /></div> : null
                ) : p.type === 'module_run' ? (
                  <div key={i} className="mt-2">
                    <ModuleRunCard module={p.module} input={p.input} labelKey={p.labelKey} detail={p.detail} preview={p.preview} api={workApi} lang={lang} projectId={projectId} disabled={readOnly} onDone={onTurnDone} messageId={m.id} index={i} initialDone={m.done?.[String(i)]} />
                  </div>
                ) : p.type === 'confirm_rows' ? (
                  <div key={i} className="mt-2">
                    <ConfirmRowsCard sheetId={p.sheetId} rowIds={p.rowIds} fingerprint={p.fingerprint} count={p.count} detail={p.detail} labelKey={p.labelKey} api={workApi} lang={lang} projectId={projectId} disabled={readOnly} onDone={onTurnDone} messageId={m.id} index={i} initialDone={m.done?.[String(i)]} />
                  </div>
                ) : p.type === 'ledger_link' ? (
                  <div key={i} className="mt-2">
                    <LedgerLinkCard messageId={m.id} index={i} count={p.count} replaces={p.replaces} rows={p.rows ?? []} detail={p.detail} api={workApi} lang={lang} projectId={projectId} disabled={readOnly} onDone={onTurnDone} />
                  </div>
                ) : p.type === 'ledger_statement' ? (
                  <div key={i} className="mt-2">
                    <LedgerStatementCard messageId={m.id} index={i} fileName={p.fileName} account={p.account} summary={p.summary} api={workApi} lang={lang} projectId={projectId} disabled={readOnly || !onOpenLedgerImport} onOpen={(o) => onOpenLedgerImport?.(o)} />
                  </div>
                ) : p.type === 'attach_files' ? (
                  <div key={i} className="mt-2 rounded-lg border border-[#3A3A3A] bg-[#232323] p-3 text-sm space-y-1.5">
                    <p className="text-gray-200 break-words">{t(p.labelKey, t('chat_attach'))}</p>
                    {p.hintKey && <p className="text-xs text-gray-300 break-words whitespace-pre-line">{t(p.hintKey, '')}</p>}
                    {p.detail && <p className="text-xs text-gray-400 break-words">{p.detail}</p>}
                    <button disabled={readOnly || blocked || sending || room !== 'private' || !t(p.ask, '').trim()}
                      onClick={() => { const ask = t(p.ask, '').trim(); if (!ask) return; if (!text.trim()) setText(ask); requestAnimationFrame(() => textRef.current?.focus()); fileRef.current?.click() }}
                      className="px-3 py-1.5 text-sm rounded-md bg-[#E07B53] text-white hover:opacity-90 disabled:opacity-40 inline-flex items-center gap-1">
                      <Paperclip className="w-3.5 h-3.5" />{t(p.labelKey, t('chat_attach'))}
                    </button>
                  </div>
                ) : p.type === 'report_files' ? (
                  selfHosted ? null : <ReportCard key={i} card={p} files={files} api={workApi} lang={lang} projectId={projectId} messageId={m.id} index={i} initialDone={m.done?.[String(i)]} disabled={m.id.startsWith('local-')} withChat={room === 'private'} />
                ) : p.type === 'ledger_files' ? (
                  <div key={i} className="mt-2">
                    <LedgerFilesCard messageId={m.id} index={i} files={p.files ?? []} ledgerUrl={p.ledgerUrl ?? null} api={workApi} lang={lang} projectId={projectId} disabled={readOnly} onDone={onTurnDone} initialDone={m.done?.[String(i)]} />
                  </div>
                ) : p.type !== 'bank_import' ? null : (
                  <div key={i} className="mt-2">
                    {m.done?.[String(i)] ? (
                      <button disabled className="px-3 py-1.5 text-sm rounded-md border border-[#3A3A3A] text-gray-400 inline-flex items-center gap-1 cursor-default">
                        <Check className="w-3.5 h-3.5" />{t('import_card_done').replace('{name}', p.fileName).replace('{n}', String(m.done[String(i)].rows ?? p.rows))}
                      </button>
                    ) : (
                      <button disabled={blocked} onClick={() => onApplyProposal(p, { messageId: m.id, index: i })}
                        className="px-3 py-1.5 text-sm rounded-md bg-[#E07B53] text-white hover:opacity-90 disabled:opacity-40">
                        {t('import_card_button').replace('{name}', p.fileName).replace('{n}', String(p.rows))}
                      </button>
                    )}
                  </div>
                ))}
                {room === 'private' && !readOnly && !m.id.startsWith('local-') && (m.text.trim() || m.files.length > 0) && (
                  <button onClick={() => void shareMessage(m.id)} className="mt-1 text-[11px] text-gray-500 hover:text-[#E07B53]">{shared === m.id ? t('room_shared_done') : t('room_share')}</button>
                )}
                {room === 'private' && !selfHosted && m.role === 'assistant' && !m.id.startsWith('local-') && (
                  <button onClick={() => void openReport(m)} className="mt-1 ml-3 text-[11px] text-gray-500 hover:text-[#E07B53]">{t('chat_report')}</button>
                )}
              </div>
            </div>
          ))}
          {streaming && (
            <div className="prose prose-invert prose-sm max-w-none text-gray-200 px-3">
              <MessageContent content={streaming} role="assistant" theme="dark" size="sm" isStreaming remoteImages={false} />
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

      {reporting && (
        <ReportDialog files={files} lang={lang} projectId={projectId} candidates={reporting.candidates} initial={reporting.initial} reattach={reporting.reattach}
          source="work_chat" chatMessageId={reporting.messageId} onClose={() => setReporting(null)} />
      )}
      <div className="border-t border-[#2A2A2A] px-3 sm:px-4 py-3">
        <div className="w-full sm:w-[95%] mx-auto space-y-2">
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
              {room === 'private' && picked.length > 0
                ? <p className="text-[11px] text-green-400">{t('room_private_files_hint')}</p>
                : <p className="text-[11px] text-gray-500">{t(room === 'team' ? 'room_team_hint' : 'room_private_hint')}</p>}
              <div className="flex items-end gap-2">
                <input ref={fileRef} type="file" multiple hidden accept=".csv,.pdf,.xlsx,.txt,image/jpeg,image/png,image/webp,image/heic" onChange={(e) => onPick(e.target.files)} />
                {room === 'private' && (
                <button onClick={() => fileRef.current?.click()} disabled={sending} className="shrink-0 p-1.5 text-gray-400 hover:text-white disabled:opacity-40" title={t('room_private_files_hint')} aria-label={t('chat_attach')}>
                  <Paperclip className="w-4 h-4" />
                </button>
                )}
                <textarea
                  ref={attachText}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() } }}
                  rows={2}
                  placeholder={t(room === 'team' ? 'room_team_placeholder' : 'chat_placeholder')}
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
