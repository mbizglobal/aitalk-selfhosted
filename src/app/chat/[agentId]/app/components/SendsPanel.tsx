'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Check, CheckCircle2, Copy, Download, Globe, Inbox, Loader2, Mail, MessageSquare, Send, Server, Database, Phone, Paperclip, XCircle, Zap, ExternalLink, CalendarPlus } from 'lucide-react'
import { workT, type WorkLang } from '@/lib/translations/work'
import { WorkApiError, type CapabilitiesView, type SendView, type WorkApi, type WorkFiles } from '../lib/api'
import { errorText } from './SheetTable'

const SQL_ERR = /^(COUNT_FAILED|COUNT_INVALID|COUNT_REQUIRED|COUNT_NOT_NEEDED|PREPARE_STALE|PREPARE_EXPIRED|PREPARE_REQUIRED|AI_SQL_OFF|AI_SQL_READ_ONLY|AI_SQL_NOT_ROWS|TARGET_CHANGED|SENDING_IN_PROGRESS|NOT_RESENDABLE)\b:?\s*(.*)$/s
const isDuplicateRisk = (e: unknown) => e instanceof WorkApiError && !!e.detail?.startsWith('DUPLICATE_RISK')
function sqlErrorText(lang: WorkLang, e: unknown, pkg: string | null | undefined, t: (k: string) => string): string {
  const m = e instanceof WorkApiError && e.detail ? SQL_ERR.exec(e.detail) : null
  if (!m) return errorText(lang, e, pkg)
  const why = m[1] === 'COUNT_FAILED' && m[2] ? `\n(${m[2].replace(/^—\s*/, '').slice(0, 200)})` : ''
  return `${t(`send_sql_err_${m[1]}`)}${why}`
}
import { ConfirmDialog } from './ConfirmDialog'
import { useWorkPkg } from './work-pkg'
import { WORK_APP_METAS } from '@/lib/work/package-meta'

const KIND_ICON: Record<SendView['kind'], React.ComponentType<{ className?: string }>> = { email: Mail, telegram: MessageSquare, http: Server, db_write: Database, db_sql: Database, sms: MessageSquare, call: Phone, work_app: Inbox, calendar: CalendarPlus }

export function sendCodeText(lang: WorkLang, code: string | null, pkg?: string | null): string | null {
  if (!code) return null
  const own = workT(lang, `send_code_${code}`, '', pkg)
  return own || workT(lang, 'send_code_other', undefined, pkg).replace('{code}', code)
}

function dbLabels(queryId: string | null, slot: string): { query: string | null; slot: string | null } {
  for (const m of WORK_APP_METAS) {
    for (const u of Object.values(m.uses ?? {})) {
      const q = (u.dbQueries ?? []).find((x) => x.id === queryId) ?? null
      const send = (u.sends ?? []).find((x) => x.id === queryId && 'query' in x)
      const query = q ?? (send && 'query' in send ? (u.dbQueries ?? []).find((x) => x.id === send.query) ?? null : null)
      if (query) return { query: (send?.label ?? query.label), slot: (u.connections ?? []).find((c) => c.id === slot)?.label ?? null }
    }
  }
  return { query: null, slot: null }
}
const PARAM_SHOW = 200
const paramText = (v: unknown) => (v === null ? 'null' : typeof v === 'string' ? v : JSON.stringify(v))

function DbParams({ params, t }: { params: Record<string, unknown>; t: (k: string, f?: string) => string }) {
  const [open, setOpen] = useState(false)
  const entries = Object.entries(params)
  if (!entries.length) return null
  const long = entries.some(([, v]) => paramText(v).length > PARAM_SHOW)
  return (
    <div className="text-xs text-gray-400 space-y-0.5">
      {entries.map(([k, v]) => {
        const s = paramText(v)
        return <p key={k} className="break-words whitespace-pre-wrap"><span className="text-gray-500">{k} = </span>{open || s.length <= PARAM_SHOW ? s : `${s.slice(0, PARAM_SHOW)}…`}</p>
      })}
      {long && <button type="button" onClick={() => setOpen((x) => !x)} className="text-[11px] text-gray-300 underline">{open ? t('send_db_show_less') : t('send_db_show_all')}</button>}
    </div>
  )
}

const APP_ROWS_SHOW = 5
function HttpValues({ data }: { data: Record<string, unknown> }) {
  const show = (v: unknown): string => {
    if (v === null || v === undefined) return '—'
    if (typeof v === 'object') { const m = v as { amount?: unknown; currency?: unknown }; return `${String(m.amount ?? '')}${m.currency ? ` ${String(m.currency)}` : ''}` }
    return String(v)
  }
  return (
    <div className="mt-1 rounded border border-[#333] bg-[#1F1F1F] px-2 py-1 text-xs space-y-0.5 max-h-64 overflow-auto">
      {Object.entries(data).map(([k, v]) => (
        <p key={k} className="break-words whitespace-pre-wrap"><span className="text-gray-500">{k}: </span><span className="text-gray-200">{show(v)}</span></p>
      ))}
    </div>
  )
}

function SmsInfo({ m, t }: { m: NonNullable<SendView['sms']>; t: (k: string, f?: string) => string }) {
  return (
    <div className="mt-1 space-y-0.5 text-xs text-gray-400">
      {m.assumed && <p className="text-amber-300">{t('sms_assumed', 'The row has {written} without a country code — it goes to Switzerland ({to}).').replace('{written}', m.written ?? '').replace('{to}', m.to)}</p>}
      <p>{(m.parts === 1 ? t('sms_cost_one', '1 SMS · {credits} Credits') : t('sms_cost', '{parts} SMS parts · {credits} Credits')).replace('{parts}', String(m.parts)).replace('{credits}', String(m.credits))}</p>
      {m.country === 'FR' && <p className="text-gray-500">{t('sms_fr_hours', 'France: delivered 08:00-21:30 (Paris time).')}</p>}
      {m.refunded && <p className="text-emerald-300">{t('sms_refunded', 'Not sent — the Credits were given back.')}</p>}
    </div>
  )
}

function CalendarEvent({ c, t }: { c: NonNullable<SendView['calendar']>; t: (k: string, f?: string) => string }) {
  const day = (x: string) => x.slice(0, 10)
  const hm = (x: string) => x.slice(11, 16)
  const when = c.allDay
    ? (() => { const last = new Date(Date.UTC(+c.end.slice(0, 4), +c.end.slice(5, 7) - 1, +c.end.slice(8, 10) - 1)).toISOString().slice(0, 10); return `${c.start}${last !== c.start ? ` – ${last}` : ''} · ${t('cal_all_day', 'all day')}` })()
    : `${day(c.start)} ${hm(c.start)} – ${day(c.end) !== day(c.start) ? `${day(c.end)} ` : ''}${hm(c.end)} (${c.timeZone})`
  return (
    <div className="mt-1 rounded border border-[#333] bg-[#1F1F1F] px-2 py-1 text-xs space-y-0.5">
      <p className="text-gray-200 break-words">{when}</p>
      <p className="text-gray-100 font-medium break-words">{c.title}</p>
      {c.description && <p className="text-gray-400 whitespace-pre-wrap break-words max-h-40 overflow-auto">{c.description}</p>}
      {c.existing && <p className="text-amber-300 break-words">{t('cal_existing').replace('{when}', (c.existing.start ?? '').replace('T', ' ').slice(0, 16)).replace('{title}', c.existing.title ?? '')}</p>}
      {c.note === 'previous_calendar' && <p className="text-gray-500">{t('cal_note_previous')}</p>}
      {c.note === 'previous_calendar_lost' && <p className="text-amber-300">{t('cal_note_lost').replace('{cal}', c.lost ?? '')}</p>}
      {c.link && <a href={c.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sky-300 hover:underline"><ExternalLink className="w-3 h-3" />{t('cal_open', 'Open in calendar')}</a>}
    </div>
  )
}

function AppRows({ rows, t }: { rows: Array<Record<string, unknown>>; t: (k: string, f?: string) => string }) {
  const [open, setOpen] = useState(false)
  const shown = open ? rows : rows.slice(0, APP_ROWS_SHOW)
  return (
    <div className="text-xs text-gray-400 space-y-1">
      {shown.map((r, i) => (
        <p key={i} className="break-words whitespace-pre-wrap rounded border border-[#333] bg-[#1F1F1F] px-2 py-1">
          {Object.entries(r).map(([k, v], j) => (
            <span key={k}>{j > 0 && <span className="text-gray-600"> · </span>}<span className="text-gray-500">{k} = </span>{paramText(v).slice(0, PARAM_SHOW)}</span>
          ))}
        </p>
      ))}
      {rows.length > APP_ROWS_SHOW && (
        <button type="button" onClick={() => setOpen((x) => !x)} className="text-[11px] text-gray-300 underline">
          {open ? t('send_db_show_less') : t('send_app_rows_more').replace('{n}', String(rows.length - APP_ROWS_SHOW))}
        </button>
      )}
    </div>
  )
}

function CopyButton({ value, label, done }: { value: string; label: string; done: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button type="button" onClick={() => { void navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => {}) }}
      className="px-2 py-1 text-xs rounded-md border border-[#3A3A3A] text-gray-300 hover:bg-[#2A2A2A] inline-flex items-center gap-1">
      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}{copied ? done : label}
    </button>
  )
}

export function SendCard({ send, api, files, lang, projectId, readOnly, compact, onChanged }: {
  send: SendView
  api: WorkApi
  files?: WorkFiles
  lang: WorkLang
  projectId: string
  readOnly: boolean
  compact?: boolean
  onChanged: (next: SendView) => void
}) {
  const pkg = useWorkPkg()
  const t = (k: string, f?: string) => workT(lang, k, f, pkg)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [danger, setDanger] = useState(false)
  const [dup, setDup] = useState(false)
  const [counted, setCounted] = useState<{ prepareId: string; n: number } | null>(null)
  const base = `/projects/${encodeURIComponent(projectId)}/sends/${encodeURIComponent(send.id)}`
  const act = async (path: 'approve' | 'discard' | 'reissue' | 'manual', body?: unknown) => {
    setBusy(true); setError(null)
    try {
      const r = await api<{ send: SendView }>('POST', `${base}/${path}`, body ?? {})
      onChanged(r.send)
      setDup(false)
    } catch (e) {
      if (path === 'approve' && isDuplicateRisk(e)) setDup(true)
      else { setError(sqlErrorText(lang, e, pkg, t)); setDup(false) }
    } finally {
      setBusy(false); setConfirm(false); setDanger(false); setCounted(null)
    }
  }
  const prepare = async () => {
    setBusy(true); setError(null)
    try {
      const r = await api<{ prepareId: string; n: number }>('POST', `${base}/prepare`, {})
      setCounted({ prepareId: r.prepareId, n: r.n })
    } catch (e) {
      setError(sqlErrorText(lang, e, pkg, t))
    } finally {
      setBusy(false)
    }
  }
  const Icon = KIND_ICON[send.kind] ?? Send
  const db = send.kind === 'db_write' ? dbLabels(send.declared, send.slot) : { query: null, slot: null }
  const sql = send.kind === 'db_sql' ? send.aiSql ?? null : null
  const schema = !!sql && ['create_table', 'create_other', 'alter', 'drop', 'truncate', 'rename'].includes(sql.kind)
  const app = send.kind === 'work_app' ? send.appSend ?? null : null
  const rows = schema && send.affectedRows !== null ? t('send_sql_done_schema')
    : send.affectedRows === null ? null
    : app ? (send.affectedRows === 1 ? t('send_app_rows_one') : t('send_app_rows').replace('{n}', String(send.affectedRows)))
    : send.affectedRows === 0 ? t('send_db_rows_zero') : send.affectedRows === 1 ? t('send_db_rows_one') : t('send_db_rows').replace('{n}', String(send.affectedRows))
  const st = send.status
  const reason = sendCodeText(lang, send.code, pkg)
  const autoAlert = send.declared === 'assembled.telegram'
  const httpCard = send.kind === 'http' && !!send.declared?.startsWith('assembled.http:')
  const httpData = send.kind === 'http' && send.json && typeof send.json === 'object' && 'data' in (send.json as Record<string, unknown>) ? (send.json as { data: Record<string, unknown> }).data : null
  const calCard = send.kind === 'calendar' && !!send.declared?.startsWith('assembled.calendar:')
  const smsCard = send.kind === 'sms' && !!send.declared?.startsWith('assembled.sms:')
  const canResend = !readOnly && !autoAlert && !httpCard && !calCard && !smsCard && !send.reissued && (st === 'failed' || st === 'refused' || st === 'unknown')
  const tone = st === 'sent' ? 'text-emerald-400' : st === 'unknown' ? 'text-amber-300' : st === 'pending' || st === 'sending' ? 'text-gray-300' : st === 'discarded' ? 'text-gray-500' : 'text-red-400'
  const noConn = st === 'pending' && send.kind === 'email' && send.slotConnected === false
  const StatusIcon = st === 'sent' ? CheckCircle2 : st === 'unknown' ? AlertTriangle : st === 'sending' ? Loader2 : st === 'pending' ? null : XCircle

  return (
    <div className={`rounded-lg border border-[#3A3A3A] bg-[#232323] ${compact ? 'px-3 py-2' : 'p-3'} text-sm space-y-1.5`}>
      <div className="flex items-start gap-2 min-w-0">
        <Icon className="w-4 h-4 mt-0.5 shrink-0 text-gray-400" />
        <div className="min-w-0 flex-1">
          <p className="text-gray-200 break-words">
            <span className="text-gray-500">{t(`send_kind_${send.kind}`, send.kind)} · </span>
            {send.kind === 'db_write' ? (db.query ? t(db.query, send.declared ?? '') : send.declared ?? '—') : send.to.length ? send.to.join(', ') : '—'}
            {app?.url && <a href={`${app.url}&lang=${lang}`} target="_blank" rel="noopener noreferrer" className="ml-1.5 inline-flex items-center gap-0.5 text-xs text-sky-300 hover:text-sky-200 underline-offset-2 hover:underline">{t('send_app_open')}<ExternalLink className="w-3 h-3" /></a>}
            {sql && <span className={`ml-1.5 inline-block rounded px-1.5 py-0.5 text-[11px] ${sql.oneStep ? 'bg-[#2A2A2A] text-gray-300' : 'bg-red-500/15 text-red-300'}`}>{t(`send_sql_kind_${sql.kind}`, sql.kind)}</span>}
            {send.auto && <span className="ml-1.5 inline-flex items-center gap-0.5 text-[11px] text-amber-300"><Zap className="w-3 h-3" />{t('send_auto')}</span>}
          </p>
          {send.kind === 'db_write' && <p className="text-xs text-gray-500 break-words">{db.slot ? t(db.slot, send.slot) : send.slot}{send.to.length ? ` · ${send.to.join(', ')}` : ''}</p>}
          {send.subject && <p className="text-gray-300 truncate">{send.subject}</p>}
          {!compact && send.kind === 'db_write' && send.params && <DbParams params={send.params} t={t} />}
          {!compact && app && <AppRows rows={app.rows} t={t} />}
          {!compact && sql && (
            <>
              <pre className="mt-1 max-h-64 overflow-auto rounded-md border border-[#3A3A3A] bg-[#1A1A1A] p-2 font-mono text-[11px] leading-relaxed text-gray-200 whitespace-pre-wrap break-words">{sql.sql}</pre>
              {sql.reason && <p className="text-xs text-gray-500 break-words"><span className="text-gray-600">{t('send_sql_reason')} </span>{sql.reason}</p>}
              {sql.countSql && (
                <>
                  <p className="text-[11px] text-gray-500">{t('send_sql_count_label')}</p>
                  <pre className="max-h-32 overflow-auto rounded-md border border-[#3A3A3A] bg-[#1A1A1A] p-2 font-mono text-[11px] leading-relaxed text-gray-300 whitespace-pre-wrap break-words">{sql.countSql}</pre>
                </>
              )}
              {st === 'pending' && (sql.countSql
                ? <p className="text-xs text-gray-400">{t('send_sql_count_hint')}</p>
                : <p className="text-xs text-red-300 flex items-start gap-1"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />{t('send_sql_danger_hint')}</p>)}
            </>
          )}
          {!compact && httpData && <HttpValues data={httpData} />}
          {!compact && send.calendar && <CalendarEvent c={send.calendar} t={t} />}
          {!compact && send.sms && <SmsInfo m={send.sms} t={t} />}
          {!compact && send.text && !httpData && <p className="text-xs text-gray-500 whitespace-pre-wrap line-clamp-3 break-words">{send.text}</p>}
          {!compact && send.attachments.length > 0 && (
            <p className="text-xs text-gray-400 flex items-center gap-1 flex-wrap"><Paperclip className="w-3 h-3" />{send.attachments.map((a) => a.name ?? '—').join(', ')}</p>
          )}
        </div>
      </div>
      <p className={`text-xs ${tone}`}>
        <span className="inline-flex items-center gap-1 whitespace-nowrap align-middle">
          {StatusIcon && <StatusIcon className={`w-3.5 h-3.5 ${st === 'sending' ? 'animate-spin' : ''}`} />}
          {st === 'sent' && send.code === 'MANUAL' ? t('send_sent_manual') : smsCard && st === 'sent' ? t('sms_status_sent', 'Accepted by the SMS service') : httpCard && st === 'failed' ? t('send_http_failed') : t(`send_status_${st}`, st)}
        </span>
        {st === 'unknown' && <span className="text-gray-400"> — {sql ? t('send_sql_unknown_hint') : calCard ? t('cal_unknown_hint') : smsCard ? t('sms_unknown_hint', 'no answer from the SMS service — it may have gone out; the Credits stay') : t('send_unknown_hint')}</span>}
        {st === 'sent' && rows && <span className={send.affectedRows === 0 ? 'text-amber-300' : 'text-gray-400'}> — {rows}</span>}
      </p>
      {reason && st !== 'sent' && st !== 'unknown' && <p className="text-xs text-gray-400">{reason}</p>}
      {httpCard && !compact && (st === 'failed' || st === 'unknown' || st === 'refused') && <p className="text-xs text-gray-500">{t('send_http_again_hint')}</p>}
      {calCard && !compact && (st === 'failed' || st === 'refused') && send.code !== 'DELETED_IN_CALENDAR' && <p className="text-xs text-gray-500">{t('cal_again_hint')}</p>}
      {smsCard && !compact && (st === 'failed' || st === 'unknown' || st === 'refused') && <p className="text-xs text-gray-500">{t('sms_again_hint', 'To try again, press the SMS button on the row — it makes a new card with the number and text of now.')}</p>}
      {compact && send.calendar?.link && st === 'sent' && <a href={send.calendar.link} target="_blank" rel="noopener noreferrer" className="text-xs text-sky-300 hover:underline">{t('cal_open', 'Open in calendar')}</a>}
      {error && <p role="alert" className="text-xs text-red-400 whitespace-pre-line">{error}</p>}
      {noConn && !readOnly && (
        <div className="space-y-1.5 rounded-md border border-[#3A3A3A] bg-[#1F1F1F] p-2">
          <p className="text-xs text-gray-400">{t('send_no_conn_hint')}</p>
          <div className="flex gap-1.5 flex-wrap">
            {send.to.length > 0 && <CopyButton value={send.to.join(', ')} label={t('send_copy_to')} done={t('send_copied')} />}
            {send.subject && <CopyButton value={send.subject} label={t('send_copy_subject')} done={t('send_copied')} />}
            {(send.copyText ?? send.text) && <CopyButton value={send.copyText ?? send.text ?? ''} label={t('send_copy_text')} done={t('send_copied')} />}
            {files && send.attachments.map((a) => (
              <button key={a.id} type="button" onClick={() => void files.open(projectId, a.id).catch((e) => setError(errorText(lang, e, pkg)))}
                className="px-2 py-1 text-xs rounded-md border border-[#3A3A3A] text-gray-300 hover:bg-[#2A2A2A] inline-flex items-center gap-1 min-w-0">
                <Download className="w-3 h-3 shrink-0" /><span className="truncate">{t('send_download')}{a.name ? ` · ${a.name}` : ''}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {st === 'pending' && !readOnly && (
        <div className="flex gap-2 pt-0.5">
          {autoAlert ? null : noConn ? (
            <button disabled={busy} onClick={() => void act('manual')} className="px-3 py-1.5 text-sm rounded-md bg-[#E07B53] text-white hover:opacity-90 disabled:opacity-40 inline-flex items-center gap-1">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}{t('send_btn_manual')}
            </button>
          ) : (
            <button disabled={busy} onClick={() => (sql ? (sql.countSql ? void prepare() : setDanger(true)) : void act('approve'))} className="px-3 py-1.5 text-sm rounded-md bg-[#E07B53] text-white hover:opacity-90 disabled:opacity-40 inline-flex items-center gap-1">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}{sql ? t('send_btn_run') : t('send_btn_send')}
            </button>
          )}
          <button disabled={busy} onClick={() => void act('discard')} className="px-3 py-1.5 text-sm rounded-md text-gray-300 hover:bg-[#2A2A2A] disabled:opacity-40">{t('send_btn_discard')}</button>
        </div>
      )}
      {canResend && (
        <button disabled={busy} onClick={() => (st === 'unknown' ? setConfirm(true) : void act('reissue', {}))} className="px-3 py-1.5 text-xs rounded-md border border-[#3A3A3A] text-gray-300 hover:bg-[#2A2A2A] disabled:opacity-40">
          {t('send_btn_resend')}
        </button>
      )}
      {counted && sql && (
        <ConfirmDialog
          message={(counted.n === 0 ? t('send_sql_count_zero') : t(`${sql.kind === 'delete' ? 'send_sql_count_delete' : sql.kind === 'insert' ? 'send_sql_count_insert' : 'send_sql_count_update'}${counted.n === 1 ? '_one' : ''}`)).replace('{n}', String(counted.n))}
          okLabel={t('send_sql_count_ok')} cancelLabel={t('cancel')} busy={busy} tone={sql.kind === 'delete' ? 'danger' : 'primary'}
          onOk={() => void act('approve', { prepareId: counted.prepareId })} onCancel={() => setCounted(null)} />
      )}
      {danger && sql && (
        <ConfirmDialog message={t('send_sql_danger_confirm')} okLabel={t('send_sql_danger_ok')} cancelLabel={t('cancel')} busy={busy} tone="danger"
          onOk={() => void act('approve', { confirmDanger: true })} onCancel={() => setDanger(false)} />
      )}
      {dup && (
        <ConfirmDialog message={smsCard ? t('sms_dup_confirm', 'An earlier SMS of this row to this number may have gone out (no answer). If you send now, the customer may get it twice and {credits} Credits are charged again.').replace('{credits}', String(send.sms?.credits ?? '')) : t('send_http_dup_confirm')} okLabel={smsCard ? t('sms_dup_ok', 'Send anyway') : t('send_http_dup_ok')} cancelLabel={t('cancel')} busy={busy} tone="primary"
          onOk={() => void act('approve', { confirmDuplicate: true })} onCancel={() => setDup(false)} />
      )}
      {confirm && (
        <ConfirmDialog message={t('send_resend_confirm')} okLabel={t('send_resend_ok')} cancelLabel={t('cancel')} busy={busy} tone="primary"
          onOk={() => void act('reissue', { confirmDuplicate: true })} onCancel={() => setConfirm(false)} />
      )}
    </div>
  )
}

export function SendsPanel({ api, files, lang, projectId, readOnly, onChanged }: {
  api: WorkApi
  files?: WorkFiles
  lang: WorkLang
  projectId: string
  readOnly: boolean
  onChanged: () => void
}) {
  const pkg = useWorkPkg()
  const t = (k: string, f?: string) => workT(lang, k, f, pkg)
  const [sends, setSends] = useState<SendView[] | null>(null)
  const [cap, setCap] = useState<CapabilitiesView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const base = `/projects/${encodeURIComponent(projectId)}`
  const load = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([api<{ sends: SendView[] }>('GET', `${base}/sends`), api<CapabilitiesView>('GET', `${base}/capabilities`)])
      setSends(s.sends); setCap(c)
    } catch (e) { setError(errorText(lang, e, pkg)) }
  }, [api, base, lang, pkg])
  useEffect(() => { void load() }, [load])

  const toggle = async (body: { autoSend?: { id: string; off: boolean }; webSearchOff?: boolean }) => {
    setSaving(true); setError(null)
    try { setCap(await api<CapabilitiesView>('PUT', `${base}/capabilities`, body)) } catch (e) { setError(errorText(lang, e, pkg)) } finally { setSaving(false) }
  }
  const label = (key: string) => workT(lang, key, key, cap?.pkg ?? pkg)

  return (
    <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin p-4 space-y-4">
      {error && <p role="alert" className="text-sm text-red-400 whitespace-pre-line">{error}</p>}
      {cap?.v3 && (
        <section className="rounded-lg border border-[#3A3A3A] p-3 space-y-2">
          <p className="text-sm font-medium text-gray-200">{t('cap_title')}</p>
          {cap.autoSends.length === 0 && !cap.webSearch.declared && <p className="text-xs text-gray-500">{t('cap_none')}</p>}
          {cap.autoSends.map((a) => (
            <Switch key={a.id} on={!a.off} disabled={readOnly || saving} lang={lang}
              label={t('cap_auto_send').replace('{label}', label(a.label))}
              onChange={(on) => void toggle({ autoSend: { id: a.id, off: !on } })} />
          ))}
          {cap.webSearch.declared && (
            <Switch on={!cap.webSearch.off} disabled={readOnly || saving} lang={lang} icon={<Globe className="w-3.5 h-3.5 text-sky-400" />}
              label={t('cap_web')} onChange={(on) => void toggle({ webSearchOff: !on })} />
          )}
          {cap.connections.length > 0 && (
            <div className="pt-1 space-y-1">
              <p className="text-xs font-medium text-gray-400">{t('cap_conn_title')}</p>
              {cap.connections.map((c) => (
                <p key={c.slot} className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-gray-300 truncate">{label(c.label)}</span>
                  <span className={c.connected ? 'text-emerald-400' : 'text-gray-500'}>{c.connected ? t('cap_connected') : t('cap_not_connected')}</span>
                </p>
              ))}
            </div>
          )}
        </section>
      )}
      {sends === null ? (
        !error && <div className="py-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-[#E07B53]" /></div>
      ) : sends.length === 0 ? (
        <p className="text-sm text-gray-500">{t('sends_none')}</p>
      ) : (
        <div className="space-y-2">
          {sends.map((s) => (
            <SendCard key={s.id} send={s} api={api} files={files} lang={lang} projectId={projectId} readOnly={readOnly}
              onChanged={() => { void load(); onChanged() }} />
          ))}
        </div>
      )}
    </div>
  )
}

function Switch({ on, disabled, label, icon, lang, onChange }: { on: boolean; disabled: boolean; label: string; icon?: React.ReactNode; lang: WorkLang; onChange: (on: boolean) => void }) {
  return (
    <div className={`flex items-center justify-between gap-3 text-xs ${disabled ? 'opacity-60' : ''}`}>
      <span className="flex items-start gap-1.5 text-gray-300 min-w-0">{icon ?? <Zap className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-400" />}<span className="break-words">{label}</span></span>
      <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)}
        className={`shrink-0 relative w-9 h-5 rounded-full transition-colors ${on ? 'bg-[#E07B53]' : 'bg-[#3A3A3A]'}`}
        title={workT(lang, on ? 'cap_on' : 'cap_off')}>
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
    </div>
  )
}
