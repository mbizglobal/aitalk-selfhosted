'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Node } from 'reactflow'
import { Plus, Zap, Globe, GripHorizontal, Plug, ArrowLeft, X, Check, Trash2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useDraggable } from '../../hooks/useDraggable'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'
import { parseWorkLang, packageOfKind, workKindLabel, workT } from '@/lib/translations/work'
import { WORK_APP_METAS } from '@/lib/work/package-meta'
import { APP_TEMPLATE_KINDS } from '@/lib/work/app-template-kinds'
import { VENDOR_SERVER_IP } from '@/lib/vendor-network'
import { isSendQuery, type ConnectionKind, type DbEngine, type UsesConnection, type WorkAppUses } from '@/lib/work/uses'
import { parseCalSlot, type CalSlotValue } from '@/lib/work/calendar-slot'
import { useEdition } from '@/components/EditionProvider'
import { SendGridConnectionForm } from './SendGridConnectionForm'
import { SmtpConnectionForm } from './SmtpConnectionForm'

interface Props {
  node: Node
  updateNodeData: (patch: Record<string, any>) => void
  agentId: string
  appTemplate: string
  connectionKey?: string
}

interface Conn { id: string; provider: string; label: string; description?: string | null }
interface Space { id: number; name: string; isDefault: boolean }

const PROVIDERS: Partial<Record<ConnectionKind, string[]>> = { email: ['sendgrid', 'smtp'], telegram: ['telegram'], http: ['http_request'], calendar: ['google_workspace', 'microsoft_workspace'] }
const PROVIDER_NAME: Record<string, string> = { sendgrid: 'SendGrid', smtp: 'SMTP', telegram: 'Telegram', http_request: 'HTTP', google_workspace: 'Google', microsoft_workspace: 'Microsoft', db_mysql: 'MySQL', db_postgres: 'PostgreSQL', db_mssql: 'SQL Server' }
const DB_PROVIDER: Record<DbEngine, string> = { mysql: 'db_mysql', postgres: 'db_postgres', mssql: 'db_mssql' }
const DB_DEFAULT_PORT: Record<DbEngine, string> = { mysql: '3306', postgres: '5432', mssql: '1433' }
const providersOf = (c: UsesConnection): string[] | undefined => (c.kind === 'database' ? (c.engine ? [DB_PROVIDER[c.engine]] : Object.values(DB_PROVIDER)) : PROVIDERS[c.kind])
const DB_ENGINE_ORDER: DbEngine[] = ['mssql', 'postgres', 'mysql']

function usesForEdition(u: WorkAppUses | null, edition: string): WorkAppUses | null {
  if (!u || edition !== 'selfhosted' || !u.connections?.some((c) => c.kind === 'calendar')) return u
  return { ...u, connections: u.connections.filter((c) => c.kind !== 'calendar') }
}

function usesOf(kind: string): WorkAppUses | null {
  for (const m of WORK_APP_METAS) {
    if (!m.appTemplateKinds.includes(kind)) continue
    return m.uses?.[kind] ?? null
  }
  return null
}
const hasAny = (u: WorkAppUses | null) => !!u && (!!u.connections?.length || !!u.knowledge || !!u.webSearch || !!u.sends?.some((s) => s.auto))

export const AppStartUses: React.FC<Props> = ({ node, updateNodeData, agentId, appTemplate, connectionKey }) => {
  const keyPrefix = connectionKey ?? node.id
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  const wl = parseWorkLang(lang)
  const tt = (k: string, en: string) => t[k] || en

  const edition = useEdition()
  const groups = useMemo(() => (appTemplate ? [appTemplate] : [...APP_TEMPLATE_KINDS]).map((k) => ({ kind: k, uses: usesForEdition(usesOf(k), edition) })).filter((g) => hasAny(g.uses)), [appTemplate, edition])
  const needConns = groups.some((g) => g.uses!.connections?.length)
  const needSpaces = groups.some((g) => g.uses!.knowledge)

  const [open, setOpen] = useState(false)
  const [conns, setConns] = useState<Conn[]>([])
  const [connsLoaded, setConnsLoaded] = useState(false)
  const [spaces, setSpaces] = useState<Space[] | null>(null)
  const [creating, setCreating] = useState<ConnectionKind | null>(null)
  const [slotForCreate, setSlotForCreate] = useState<string>('')
  const [engineForCreate, setEngineForCreate] = useState<DbEngine | null>(null)
  const [mailProvider, setMailProvider] = useState<'sendgrid' | 'smtp'>('sendgrid')
  const [savedProvider, setSavedProvider] = useState<string | null>(null)
  const [removing, setRemoving] = useState<{ key: string; connId: string; busy: boolean; err: string | null } | null>(null)
  const { handleDragStart, dragStyle } = useDraggable({ isOpen: open })
  const dialogRef = useRef<HTMLDivElement>(null)
  const openerRef = useRef<HTMLButtonElement>(null)
  const savedRef = useRef<Record<string, Record<string, string>>>({})
  useEffect(() => { if (open) dialogRef.current?.focus() }, [open])

  const loadConns = useCallback(async (): Promise<Conn[] | null> => {
    if (!needConns || !agentId) return null
    try {
      const res = await fetch(`/api/agent-studio/app-connections?agentId=${encodeURIComponent(agentId)}&providers=sendgrid,smtp,telegram,http_request,db_mysql,db_postgres,db_mssql,google_workspace,microsoft_workspace`)
      const data = await res.json()
      if (!res.ok) return null
      setConns(data.connections ?? [])
      setConnsLoaded(true)
      return data.connections ?? []
    } catch (e) { console.error('Failed to load connections:', e); return null }
  }, [agentId, needConns])
  useEffect(() => { loadConns() }, [loadConns])
  useEffect(() => {
    if (!needSpaces || !agentId) return
    fetch(`/api/storage/spaces?agentId=${encodeURIComponent(agentId)}`).then((r) => r.json()).then((d) => setSpaces(d.spaces ?? [])).catch(() => setSpaces([]))
  }, [agentId, needSpaces])

  if (!groups.length) return null

  const saved = (node.data?.connections && typeof node.data.connections === 'object' ? node.data.connections : {}) as Record<string, Record<string, string>>
  savedRef.current = saved
  const calSlots = (node.data?.calendarSlots && typeof node.data.calendarSlots === 'object' && !Array.isArray(node.data.calendarSlots) ? node.data.calendarSlots : {}) as Record<string, unknown>
  const setSlot = (kind: ConnectionKind, slot: string, id: string) => {
    const cur = savedRef.current
    const next: Record<string, Record<string, string>> = { ...cur, [kind]: { ...(cur[kind] ?? {}) } }
    if (id) next[kind][slot] = id
    else delete next[kind][slot]
    if (!Object.keys(next[kind]).length) delete next[kind]
    updateNodeData({ connections: Object.keys(next).length ? next : undefined })
  }
  const kindName = (k: ConnectionKind) => tt(`app_conn_${k}`, k)
  const ragSpaceId = typeof node.data?.ragSpaceId === 'number' ? node.data.ragSpaceId : null
  const slotState = (c: UsesConnection) => {
    const providers = providersOf(c)
    const options = providers ? conns.filter((x) => providers.includes(x.provider)) : []
    const cur = c.kind === 'calendar' ? (parseCalSlot(calSlots[c.id])?.connectionId ?? '') : saved[c.kind]?.[c.id] ?? ''
    return { providers, options, cur, connected: !!cur && options.some((o) => o.id === cur) }
  }
  const removeConnection = async (c: UsesConnection, conn: Conn) => {
    const key = `${c.kind}:${c.id}`
    setRemoving({ key, connId: conn.id, busy: true, err: null })
    const q = `agentId=${encodeURIComponent(agentId)}`
    const url =
      conn.provider === 'sendgrid' ? `/api/agent-studio/sendgrid?${q}`
      : conn.provider === 'smtp' ? `/api/agent-studio/smtp?${q}`
      : conn.provider === 'telegram' ? `/api/agent-studio/telegram?${q}`
      : conn.provider === 'http_request' ? `/api/agent-studio/http-request-auth?${q}&nodeId=${encodeURIComponent(conn.label)}`
      : `/api/agent-studio/db-connection?${q}&connectionId=${encodeURIComponent(conn.id)}`
    try {
      const res = await fetch(url, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed')
      const next: Record<string, Record<string, string>> = {}
      for (const [k, slots] of Object.entries(savedRef.current)) {
        const kept = Object.fromEntries(Object.entries(slots).filter(([, id]) => id !== conn.id))
        if (Object.keys(kept).length) next[k] = kept
      }
      updateNodeData({ connections: Object.keys(next).length ? next : undefined })
      setRemoving(null)
      loadConns()
    } catch (e: any) { setRemoving({ key, connId: conn.id, busy: false, err: e.message }) }
  }
  const aiSqlOn = (node.data?.dbAiSql && typeof node.data.dbAiSql === 'object' ? node.data.dbAiSql : {}) as Record<string, boolean>
  const setAiSql = (slot: string, on: boolean) => {
    const next = { ...aiSqlOn }
    if (on) next[slot] = true
    else delete next[slot]
    updateNodeData({ dbAiSql: Object.keys(next).length ? next : undefined })
  }
  const chats = (node.data?.telegramChats && typeof node.data.telegramChats === 'object' ? node.data.telegramChats : {}) as Record<string, string>
  const setCalSlot = (slot: string, v: CalSlotValue | null) => {
    const next = { ...calSlots }
    if (v) next[slot] = v
    else delete next[slot]
    updateNodeData({ calendarSlots: Object.keys(next).length ? next : undefined })
  }
  const setChat = (slot: string, v: string) => {
    const next = { ...chats }
    if (v.trim()) next[slot] = v.trim()
    else delete next[slot]
    updateNodeData({ telegramChats: Object.keys(next).length ? next : undefined })
  }
  const allSlots = groups.flatMap((g) => g.uses!.connections ?? [])
  const connectedCount = allSlots.filter((c) => slotState(c).connected).length
  const closeCreate = async (justSaved?: string) => {
    const kind = creating
    const slot = slotForCreate
    const savedNow = justSaved ?? savedProvider
    setCreating(null)
    setSavedProvider(null)
    const list = await loadConns()
    if (!kind || !list) return
    const shown = kind === 'email' ? mailProvider : kind === 'telegram' ? 'telegram' : kind === 'http' ? 'http_request' : null
    const provider = savedNow ?? (!savedRef.current[kind]?.[slot] ? shown : null)
    if (!provider) return
    const pick = list.find((x) => x.provider === provider && (provider !== 'http_request' || x.label === `${keyPrefix}:${slot}`))
    if (pick && savedRef.current[kind]?.[slot] !== pick.id) setSlot(kind, slot, pick.id)
  }

  const summary = (
    <div>
      <label className="text-sm font-medium text-gray-200 mb-2 block">{tt('app_uses_title', 'Connections this work app uses')}</label>
      <button
        ref={openerRef}
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-between gap-2 rounded-md border border-[#3A3A3A] px-3 py-3 text-left text-gray-200 hover:bg-[#3A3A3A] transition-colors"
      >
        <div className="flex flex-col items-start gap-1.5 flex-1 min-w-0">
          {allSlots.length > 0 ? (
            <>
              <div className="flex flex-wrap gap-1">
                {groups.flatMap(({ kind, uses }) => (uses!.connections ?? []).map((c) => {
                  const ok = slotState(c).connected
                  return (
                    <span key={`${kind}:${c.id}`} className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] ${ok ? 'border-emerald-700/60 text-emerald-300' : 'border-[#3A3A3A] text-gray-400'}`}>
                      {ok ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}{workT(wl, c.label, c.label, packageOfKind(kind))}
                    </span>
                  )
                }))}
              </div>
              <span className={`text-xs ${connectedCount < allSlots.length ? 'text-amber-300' : 'text-gray-400'}`}>
                {tt('app_uses_summary', '{ok} connected · {missing} not connected').replace('{ok}', String(connectedCount)).replace('{missing}', String(allSlots.length - connectedCount))}
              </span>
            </>
          ) : (
            <span className="text-sm text-gray-400">{tt('app_uses_none_declared', 'This app template uses no connections')}</span>
          )}
        </div>
        <span className="text-xs text-gray-400 flex-shrink-0 ml-2">{t.edit || 'Edit'}</span>
      </button>
    </div>
  )

  const slotRow = (kind: string, c: UsesConnection) => {
    const { providers, options, cur, connected } = slotState(c)
    return (
      <div key={c.id} className="space-y-1">
        <label className="block text-xs text-gray-300">{workT(wl, c.label, c.label, packageOfKind(kind))}{c.engine ? <span className="text-gray-500"> · {PROVIDER_NAME[DB_PROVIDER[c.engine]]}</span> : null}</label>
        {c.hint && <p className="text-[11px] text-gray-500">{workT(wl, c.hint, c.hint, packageOfKind(kind))}</p>}
        {c.kind === 'calendar' ? (
          <CalendarSlotField value={parseCalSlot(calSlots[c.id])} options={options} loaded={connsLoaded} onChange={(v) => setCalSlot(c.id, v)} tt={tt} />
        ) : providers ? (
          <div className="flex gap-2">
            <select
              value={connected ? cur : ''}
              onChange={(e) => setSlot(c.kind, c.id, e.target.value)}
              className="flex-1 min-w-0 rounded-md border border-[#3A3A3A] bg-[#1A1A1A] px-2 py-1.5 text-sm text-gray-200"
            >
              <option value="">{tt('app_uses_none', 'Not connected')}</option>
              {options.map((o) => <option key={o.id} value={o.id}>{PROVIDER_NAME[o.provider] ?? o.provider}{c.kind === 'database' ? (o.description ? ` — ${o.description}` : '') : c.kind === 'http' ? (o.label === `${keyPrefix}:${c.id}` ? '' : ` — ${o.label}`) : o.label && o.label !== PROVIDER_NAME[o.provider] ? ` — ${o.label}` : ''}</option>)}
            </select>
            <button
              type="button"
              title={tt('app_uses_create', 'Create a {kind} connection for this agent').replace('{kind}', kindName(c.kind))}
              onClick={() => {
                setCreating(c.kind); setSlotForCreate(c.id); setEngineForCreate(c.engine ?? null); setSavedProvider(null)
                setMailProvider(options.find((o) => o.id === cur)?.provider === 'smtp' ? 'smtp' : 'sendgrid')
              }}
              className="shrink-0 rounded-md border border-[#3A3A3A] px-2 text-gray-300 hover:bg-[#3A3A3A]"
            ><Plus className="w-4 h-4" /></button>
            {connected && (
              <button
                type="button"
                title={tt('app_uses_remove', 'Delete this connection')}
                onClick={() => setRemoving({ key: `${c.kind}:${c.id}`, connId: cur, busy: false, err: null })}
                className="shrink-0 rounded-md border border-[#3A3A3A] px-2 text-gray-400 hover:text-red-300 hover:bg-[#3A3A3A]"
              ><Trash2 className="w-4 h-4" /></button>
            )}
          </div>
        ) : (
          <p className="text-xs text-gray-500">{tt('app_uses_not_yet', 'Not available yet')}</p>
        )}
        {connected && removing?.key === `${c.kind}:${c.id}` && removing.connId === cur && (() => {
          const conn = options.find((o) => o.id === removing.connId)!
          return (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 p-2 space-y-2 text-[11px]">
              <p className="text-red-200">{c.kind === 'database' || c.kind === 'http'
                ? tt('app_uses_remove_slot', 'Delete this connection? It belongs to this slot only.')
                : tt('app_uses_remove_shared', 'Delete the {name} connection of this agent? Other workflows of this agent that use it (for example a chatbot email tool) lose it too.').replace('{name}', PROVIDER_NAME[conn.provider] ?? conn.provider)}</p>
              {removing.err && <p className="text-red-300">{removing.err}</p>}
              <div className="flex gap-2 justify-end">
                <Button size="sm" variant="outline" disabled={removing.busy} onClick={() => setRemoving(null)}>{t.cancel || 'Cancel'}</Button>
                <Button size="sm" className="bg-red-600 hover:bg-red-500 text-white" disabled={removing.busy} onClick={() => removeConnection(c, conn)}>{tt('app_uses_remove_ok', 'Delete')}</Button>
              </div>
            </div>
          )
        })()}
        {c.kind === 'database' && (() => {
          const on = aiSqlOn[c.id] === true
          return (
            <div className="space-y-1 pt-1">
              <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer select-none">
                <input type="checkbox" checked={on} onChange={(e) => setAiSql(c.id, e.target.checked)} className="accent-teal-500" />
                {tt('app_uses_ai_sql', 'Let the AI write SQL for this database (reads run at once; changes wait for a person to press Run)')}
              </label>
              {on && <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-200">{tt('app_uses_ai_sql_warn', '')}</p>}
            </div>
          )
        })()}
        {c.kind === 'http' && kind === 'assembled' && (
          <HttpTestField agentId={agentId} label={`${keyPrefix}:${c.id}`} connected={connected} tt={tt} />
        )}
        {c.kind === 'telegram' && kind === 'assembled' && (
          <TelegramChatField
            value={chats[c.id] ?? ''}
            onChange={(v) => setChat(c.id, v)}
            agentId={agentId}
            connectionId={connected ? cur : null}
            tt={tt}
          />
        )}
      </div>
    )
  }

  const listBody = groups.map(({ kind, uses }) => {
    const pkg = packageOfKind(kind)
    const label = (key: string) => workT(wl, key, key, pkg)
    const autoSends = (uses!.sends ?? []).filter((s) => !isSendQuery(s) && s.auto)
    const byKind = new Map<ConnectionKind, UsesConnection[]>()
    for (const c of uses!.connections ?? []) byKind.set(c.kind, [...(byKind.get(c.kind) ?? []), c])
    return (
      <div key={kind} className="space-y-4">
        {!appTemplate && <p className="text-xs font-medium text-gray-400">{tt('app_uses_group', 'If {name} is chosen').replace('{name}', workKindLabel(wl, kind))}</p>}
        {[...byKind.entries()].map(([k, list]) => (
          <section key={k} className="rounded-md border border-[#3A3A3A] p-3 space-y-2">
            <h3 className="text-sm font-medium text-gray-200">{kindName(k)} <span className="text-gray-500 font-normal">({list.length})</span></h3>
            {list.map((c) => slotRow(kind, c))}
          </section>
        ))}
        {uses!.knowledge && (
          <section className="rounded-md border border-[#3A3A3A] p-3 space-y-1">
            <label className="block text-sm font-medium text-gray-200">{tt('app_uses_space', 'Document space')}</label>
            <select
              value={ragSpaceId === null ? '' : String(ragSpaceId)}
              onChange={(e) => updateNodeData({ ragSpaceId: e.target.value ? Number(e.target.value) : undefined })}
              className="w-full rounded-md border border-[#3A3A3A] bg-[#1A1A1A] px-2 py-1.5 text-sm text-gray-200"
            >
              <option value="">{tt('app_uses_space_default', 'Default')}</option>
              {(spaces ?? []).filter((s) => !s.isDefault).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <p className="text-[11px] text-gray-500">{tt('app_uses_space_help', '')}</p>
            {kind === 'assembled' && <p className="text-[11px] text-gray-500">{workT(wl, 'assembled.lookup_docs_hint', 'assembled.lookup_docs_hint', packageOfKind(kind))}</p>}
          </section>
        )}
        {(autoSends.length > 0 || uses!.webSearch) && (
          <section className="rounded-md border border-[#3A3A3A] p-3 space-y-1 text-xs">
            <p className="text-sm font-medium text-gray-200">{tt('app_uses_auto_title', 'Done automatically')}</p>
            {autoSends.map((s) => (
              <p key={s.id} className="flex items-start gap-1.5 text-gray-300"><Zap className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-400" />{tt('app_uses_auto_send', 'Sends automatically: {label}').replace('{label}', label(s.label))}</p>
            ))}
            {uses!.webSearch && <p className="flex items-start gap-1.5 text-gray-300"><Globe className="w-3.5 h-3.5 mt-0.5 shrink-0 text-sky-400" />{kind === 'assembled' ? workT(wl, edition === 'selfhosted' ? 'assembled.lookup_web_hint_sh' : 'assembled.lookup_web_hint', 'assembled.lookup_web_hint', packageOfKind(kind)) : tt('app_uses_web', 'Uses web search')}</p>}
            <p className="text-gray-500">{tt('app_uses_auto_hint', '')}</p>
          </section>
        )}
      </div>
    )
  })

  const createBody = creating && (
    <div className="space-y-3">
      <button type="button" onClick={() => void closeCreate()} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200"><ArrowLeft className="w-3.5 h-3.5" />{tt('app_uses_back', 'Back')}</button>
      <p className="text-sm font-medium text-gray-200">{tt('app_uses_create', 'Create a {kind} connection for this agent').replace('{kind}', kindName(creating))}</p>
      {creating === 'database'
        ? <p className="text-[11px] text-gray-500">{tt('app_uses_db_per_slot', '')}</p>
        : creating === 'http'
        ? <p className="text-[11px] text-gray-500">{tt('app_uses_http_per_slot', 'Each slot keeps its own address and authentication.')}</p>
        : <p className="text-[11px] text-amber-300/80">{tt('app_uses_one_per_agent', '')}</p>}
      {creating === 'email' && (
        <>
          <div className="flex gap-1">
            {(['sendgrid', 'smtp'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setMailProvider(p)}
                className={`flex-1 px-2 py-1 text-xs rounded border ${mailProvider === p ? 'border-[#00A9D1] text-[#00A9D1]' : 'border-[#3A3A3A] text-gray-400 hover:text-gray-200'}`}
              >
                {PROVIDER_NAME[p]}
              </button>
            ))}
          </div>
          {mailProvider === 'sendgrid' ? <SendGridConnectionForm agentId={agentId} onChanged={() => { setSavedProvider('sendgrid'); loadConns() }} /> : <SmtpConnectionForm agentId={agentId} onChanged={() => { setSavedProvider('smtp'); loadConns() }} />}
        </>
      )}
      {creating === 'telegram' && <TelegramCreate agentId={agentId} t={t} onDone={() => void closeCreate('telegram')} />}
      {creating === 'database' && (
        <DbCreate
          key={`${slotForCreate}:${saved.database?.[slotForCreate] ?? ''}`}
          agentId={agentId}
          label={`${keyPrefix}:${slotForCreate}`}
          fixedEngine={engineForCreate}
          connectionId={saved.database?.[slotForCreate] ?? null}
          tt={tt}
          t={t}
          onDone={(id) => { setSlot('database', slotForCreate, id); setCreating(null); loadConns() }}
        />
      )}
      {creating === 'http' && <HttpCreate agentId={agentId} label={`${keyPrefix}:${slotForCreate}`} t={t} tt={tt} onDone={() => void closeCreate('http_request')} />}
    </div>
  )

  const close = () => { setOpen(false); if (creating) void closeCreate(); else loadConns(); openerRef.current?.focus() }

  return (
    <>
      {summary}
      {open && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center p-4">
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={tt('app_uses_title', 'Connections this work app uses')}
            tabIndex={-1}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.stopPropagation(); close(); return }
              if (e.key !== 'Tab' || !dialogRef.current) return
              const items = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')]
              if (!items.length) return
              const first = items[0], last = items[items.length - 1]
              if (e.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { e.preventDefault(); last.focus() }
              else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
            }}
            className="bg-[#2A2A2A] rounded-lg shadow-2xl border border-[#3A3A3A] w-full max-w-2xl max-h-[85vh] flex flex-col outline-none"
            style={dragStyle}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b border-[#3A3A3A] flex items-center justify-between cursor-move select-none" onMouseDown={handleDragStart}>
              <div className="flex items-center gap-3 min-w-0">
                <GripHorizontal className="w-5 h-5 text-gray-500 shrink-0" />
                <Plug className="w-5 h-5 text-teal-400 shrink-0" />
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-gray-200">{tt('app_uses_title', 'Connections this work app uses')}</h2>
                  <p className="text-sm text-gray-400 mt-1">{tt('app_uses_help', '')}</p>
                </div>
              </div>
              <button type="button" onClick={close} onMouseDown={(e) => e.stopPropagation()} className="p-1 text-gray-400 hover:text-gray-200 shrink-0" aria-label="Close"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 overflow-y-auto space-y-4">{creating ? createBody : listBody}</div>
            <div className="p-4 border-t border-[#3A3A3A] flex justify-end">
              <Button size="sm" onClick={close}>{tt('app_uses_done', 'Done')}</Button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

function CalendarSlotField({ value, options, loaded, onChange, tt }: { value: CalSlotValue | null; options: Conn[]; loaded: boolean; onChange: (v: CalSlotValue | null) => void; tt: (k: string, en: string) => string }) {
  const [connId, setConnId] = useState(value?.connectionId ?? '')
  const [accId, setAccId] = useState(value?.accountId ?? '')
  const [accounts, setAccounts] = useState<Array<{ id: string; ownerEmail: string; status: string }> | null>(null)
  const [cals, setCals] = useState<Array<{ id: string; name: string; primary: boolean }> | null>(null)
  const [err, setErr] = useState(false)
  useEffect(() => { if (value) { setConnId(value.connectionId); setAccId(value.accountId) } }, [value?.connectionId, value?.accountId])
  const conn = options.find((o) => o.id === connId)
  const base = conn?.provider === 'microsoft_workspace' ? '/api/agent-studio/microsoft-calendar' : '/api/agent-studio/google-calendar'
  useEffect(() => {
    setAccounts(null); setErr(false)
    if (!conn) return
    let live = true
    fetch(`${base}/accounts?connectionId=${encodeURIComponent(conn.id)}`).then((r) => r.json()).then((d) => { if (live) { if (d?.success) setAccounts(d.accounts ?? []); else setErr(true) } }).catch(() => { if (live) setErr(true) })
    return () => { live = false }
  }, [conn?.id, base])
  useEffect(() => {
    setCals(null)
    if (!conn || !accId) return
    let live = true
    fetch(`${base}/calendars?accountId=${encodeURIComponent(accId)}`).then((r) => r.json()).then((d) => {
      if (!live) return
      if (d?.success) setCals((d.calendars ?? []).map((c: { id: string; summary?: string; name?: string; primary?: boolean }) => ({ id: String(c.id), name: String(c.summary ?? c.name ?? c.id), primary: !!c.primary })))
      else setErr(true)
    }).catch(() => { if (live) setErr(true) })
    return () => { live = false }
  }, [conn?.id, accId, base])
  const sel = 'w-full rounded-md border border-[#3A3A3A] bg-[#1A1A1A] px-2 py-1.5 text-sm text-gray-200'
  if (!loaded) return null
  if (!options.length) return <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-200">{tt('app_uses_cal_none', '')}</p>
  return (
    <div className="space-y-1.5">
      <label className="block text-[11px] text-gray-400">{tt('app_uses_cal_connection', 'Connection')}</label>
      <select value={connId} onChange={(e) => { setConnId(e.target.value); setAccId(''); if (value) onChange(null) }} className={sel}>
        <option value="">{tt('app_uses_cal_pick', 'Choose…')}</option>
        {options.map((o) => <option key={o.id} value={o.id}>{PROVIDER_NAME[o.provider] ?? o.provider}{o.label && o.label !== PROVIDER_NAME[o.provider] ? ` — ${o.label}` : ''}</option>)}
      </select>
      {conn && (
        <>
          <label className="block text-[11px] text-gray-400">{tt('app_uses_cal_account', 'Account')}</label>
          <select value={accId} onChange={(e) => { setAccId(e.target.value); if (value) onChange(null) }} className={sel}>
            <option value="">{tt('app_uses_cal_pick', 'Choose…')}</option>
            {(accounts ?? []).map((a) => <option key={a.id} value={a.id} disabled={a.status !== 'active'}>{a.ownerEmail}{a.status !== 'active' ? ` (${tt('app_uses_cal_expired', 'expired')})` : ''}</option>)}
          </select>
        </>
      )}
      {conn && accId && (
        <>
          <label className="block text-[11px] text-gray-400">{tt('app_uses_cal_calendar', 'Calendar')}</label>
          <select
            value={value && value.accountId === accId ? value.calendarId : ''}
            onChange={(e) => { const c = (cals ?? []).find((x) => x.id === e.target.value); onChange(c ? { connectionId: connId, accountId: accId, calendarId: c.id, calendarName: c.name.slice(0, 120) } : null) }}
            className={sel}
          >
            <option value="">{tt('app_uses_cal_pick', 'Choose…')}</option>
            {(cals ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}{c.primary ? ' ★' : ''}</option>)}
          </select>
        </>
      )}
      {err && <p className="text-[11px] text-amber-300">{tt('app_uses_cal_load_failed', '')}</p>}
      {value && <button type="button" onClick={() => { onChange(null); setConnId(''); setAccId('') }} className="text-[11px] text-gray-400 hover:text-red-300">{tt('app_uses_cal_clear', 'Remove')}</button>}
    </div>
  )
}

function TelegramChatField({ value, onChange, agentId, connectionId, tt }: { value: string; onChange: (v: string) => void; agentId: string; connectionId: string | null; tt: (k: string, en: string) => string }) {
  const [draft, setDraft] = useState(value)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  useEffect(() => { setDraft(value) }, [value])
  const okFormat = /^(-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{3,31})$/.test(draft.trim())
  const commit = () => { const v = draft.trim(); if (v !== value && (!v || /^(-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{3,31})$/.test(v))) onChange(v) }
  const test = async () => {
    setResult(null)
    if (!connectionId) { setResult('no_bot'); return }
    if (!okFormat) { setResult('bad_format'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/agent-studio/telegram/test-chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentId, connectionId, chatId: draft.trim() }) })
      const d = await res.json().catch(() => ({}))
      setResult(typeof d.result === 'string' ? d.result : 'failed')
    } catch { setResult('failed') } finally { setBusy(false) }
  }
  const msg: Record<string, string> = {
    sent: tt('app_uses_tg_test_sent', 'Sent — check the chat.'),
    not_in_chat: tt('app_uses_tg_test_not_in_chat', 'The bot is not in that chat.'),
    bad_chat: tt('app_uses_tg_test_bad_chat', 'Telegram does not know this chat ID.'),
    no_bot: tt('app_uses_tg_test_no_bot', 'Connect the bot first.'),
    bad_bot: tt('app_uses_tg_test_bad_bot', 'Telegram does not know this bot — check the bot token.'),
    bad_format: tt('app_uses_tg_test_bad_format', 'A chat ID is a number like -1001234567890, or @channelname.'),
    failed: tt('app_uses_tg_test_failed', 'Could not send — try again in a moment.'),
  }
  return (
    <div className="space-y-1 pt-1">
      <label className="block text-xs text-gray-300">{tt('app_uses_tg_chat', 'Team chat ID')}</label>
      <div className="flex gap-2">
        <Input value={draft} onChange={(e) => { setDraft(e.target.value); setResult(null) }} onBlur={commit} autoComplete="off" placeholder="-1001234567890" className="flex-1 min-w-0 bg-[#1A1A1A] border-[#3A3A3A] text-gray-200 text-sm" />
        <Button size="sm" variant="outline" disabled={busy || !draft.trim()} onClick={() => { commit(); void test() }}>{tt('app_uses_tg_test', 'Send a test message')}</Button>
      </div>
      {draft.trim() && !okFormat && <p className="text-[11px] text-amber-300">{msg.bad_format}</p>}
      {result && <p className={`text-[11px] ${result === 'sent' ? 'text-emerald-300' : 'text-amber-300'}`}>{msg[result] ?? msg.failed}</p>}
      <p className="text-[11px] text-gray-500">{tt('app_uses_tg_chat_help', '')}</p>
    </div>
  )
}

function TelegramCreate({ agentId, t, onDone }: { agentId: string; t: Record<string, string>; onDone: () => void }) {
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const save = async () => {
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/agent-studio/telegram', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentId, botToken: token.trim() }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'Failed')
      onDone()
    } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="space-y-2">
      <label className="block text-xs text-gray-300">{t.telegram_bot_token || 'Bot Token'}</label>
      <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="new-password" placeholder="123456:ABC…" className="bg-[#2A2A2A] border-[#3A3A3A] text-gray-200" />
      {err && <p className="text-xs text-red-400">{err}</p>}
      <Button size="sm" className="w-full" disabled={busy || !token.trim()} onClick={save}>{busy ? t.saving : t.save}</Button>
    </div>
  )
}

function HttpCreate({ agentId, label, t, tt, onDone }: { agentId: string; label: string; t: Record<string, string>; tt: (k: string, en: string) => string; onDone: () => void }) {
  const [authType, setAuthType] = useState<'none' | 'bearer' | 'apiKey' | 'basic'>('bearer')
  const [url, setUrl] = useState('')
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [cur, setCur] = useState<{ authType: string; authHeaderName: string; urlHint: string } | null>(null)
  useEffect(() => {
    let alive = true
    fetch(`/api/agent-studio/http-request-auth?agentId=${encodeURIComponent(agentId)}&nodeId=${encodeURIComponent(label)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d?.hasCredentials) return
        setCur({ authType: d.authType, authHeaderName: d.authHeaderName ?? '', urlHint: d.urlHint ?? '' })
        if (['none', 'bearer', 'apiKey', 'basic'].includes(d.authType)) setAuthType(d.authType)
        if (d.authType === 'apiKey') setA(d.authHeaderName ?? '')
      })
      .catch(() => {})
    return () => { alive = false }
  }, [agentId, label])
  const sameType = cur?.authType === authType
  const errText: Record<string, string> = {
    BAD_URL: tt('app_uses_http_bad_url', 'The address must start with https:// and contain no user name or password.'),
    NO_URL: tt('app_uses_http_test_no_url', 'Set the address first.'),
    RESERVED_HEADER: tt('app_uses_http_reserved', 'This header name is set by AI Talk itself — choose another (e.g. X-Api-Key).'),
    BAD_HEADER: tt('app_uses_http_bad_header', 'This is not a valid header name.'),
    EMPTY_SECRET: tt('app_uses_http_empty', 'Fill in the token / value / user name.'),
  }
  const save = async () => {
    const credentials =
      authType === 'bearer' ? { authType, bearerToken: a.trim() }
      : authType === 'apiKey' ? { authType, authHeaderName: a.trim(), authHeaderValue: b }
      : authType === 'basic' ? { authType, basicUser: a.trim(), basicPassword: b }
      : { authType }
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/agent-studio/http-request-auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentId, nodeId: label, credentials, workApp: true, ...(url.trim() ? { url: url.trim() } : {}) }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(errText[d.error] ?? d.error ?? 'Failed')
      onDone()
    } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }
  const field = 'bg-[#2A2A2A] border-[#3A3A3A] text-gray-200'
  const needA = !sameType && (authType === 'bearer' || authType === 'basic')
  const keep = tt('app_uses_http_keep', 'Leave empty to keep the saved value')
  return (
    <div className="space-y-2">
      <label className="block text-xs text-gray-300">{tt('app_uses_http_url', 'Address (https://…)')}</label>
      <Input value={url} onChange={(e) => setUrl(e.target.value)} autoComplete="off" placeholder={cur?.urlHint ? `${cur.urlHint} — ${keep}` : 'https://hooks.example.com/…'} className={field} />
      <p className="text-[11px] text-gray-500">{tt('app_uses_http_url_help', 'Rows go only to this address. It is kept encrypted and shown shortened — a webhook address can itself be a password.')}</p>
      <label className="block text-xs text-gray-300">{tt('app_uses_http_auth', 'Authentication')}</label>
      <select value={authType} onChange={(e) => { setAuthType(e.target.value as typeof authType); setA(''); setB('') }} className="w-full rounded-md border border-[#3A3A3A] bg-[#2A2A2A] px-2 py-1.5 text-sm text-gray-200">
        <option value="none">{tt('app_uses_http_none', 'None')}</option>
        <option value="bearer">Bearer</option>
        <option value="apiKey">API key</option>
        <option value="basic">Basic</option>
      </select>
      {authType === 'bearer' && <Input type="password" value={a} onChange={(e) => setA(e.target.value)} autoComplete="new-password" placeholder={sameType ? keep : 'Token'} className={field} />}
      {authType === 'apiKey' && <>
        <Input value={a} onChange={(e) => setA(e.target.value)} autoComplete="off" placeholder="X-Api-Key" className={field} />
        <Input type="password" value={b} onChange={(e) => setB(e.target.value)} autoComplete="new-password" placeholder={sameType ? keep : 'Value'} className={field} />
      </>}
      {authType === 'basic' && <>
        <Input value={a} onChange={(e) => setA(e.target.value)} autoComplete="off" placeholder={sameType ? keep : (t.username || 'Username')} className={field} />
        <Input type="password" value={b} onChange={(e) => setB(e.target.value)} autoComplete="new-password" placeholder={sameType ? keep : (t.password || 'Password')} className={field} />
      </>}
      {err && <p className="text-xs text-red-400">{err}</p>}
      <Button size="sm" className="w-full" disabled={busy || (needA && !a.trim()) || (!cur && !url.trim())} onClick={save}>{busy ? t.saving : t.save}</Button>
    </div>
  )
}

function HttpTestField({ agentId, label, connected, tt }: { agentId: string; label: string; connected: boolean; tt: (k: string, en: string) => string }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ result: string; status?: number } | null>(null)
  const test = async () => {
    setResult(null); setBusy(true)
    try {
      const res = await fetch('/api/agent-studio/http-request-auth/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentId, label }) })
      const d = await res.json().catch(() => ({}))
      setResult(typeof d.result === 'string' ? d : { result: 'no_answer' })
    } catch { setResult({ result: 'no_answer' }) } finally { setBusy(false) }
  }
  const msg: Record<string, string> = {
    sent: tt('app_uses_http_test_sent', 'Received — the other system answered OK.'),
    refused: tt('app_uses_http_test_refused', 'The other system refused it (HTTP {status}).'),
    auth_refused: tt('app_uses_http_test_auth', 'The other system refused the authentication (HTTP {status}).'),
    redirect: tt('app_uses_http_test_redirect', 'The address redirects elsewhere — use the final address.'),
    blocked: tt('app_uses_http_test_blocked', 'This address is not allowed (private or local network).'),
    server_error: tt('app_uses_http_test_server', 'The other system had an error (HTTP {status}).'),
    no_answer: tt('app_uses_http_test_no_answer', 'No answer from the address — check it and try again.'),
    no_url: tt('app_uses_http_test_no_url', 'Set the address first.'),
    no_connection: tt('app_uses_http_test_no_conn', 'Create the connection first.'),
    auth_unsupported: tt('app_uses_http_test_auth_unsupported', 'This authentication cannot be used here.'),
  }
  return (
    <div className="space-y-1 pt-1">
      <Button size="sm" variant="outline" disabled={busy || !connected} onClick={() => void test()}>{tt('app_uses_http_test', 'Send a test request')}</Button>
      {result && <p className={`text-[11px] ${result.result === 'sent' ? 'text-emerald-300' : 'text-amber-300'}`}>{(msg[result.result] ?? msg.no_answer).replace('{status}', String(result.status ?? ''))}</p>}
      <p className="text-[11px] text-gray-500">{tt('app_uses_http_test_help', 'Sends one real request with no row data (header X-AITalk-Test: 1) — the other system may record it.')}</p>
    </div>
  )
}

function DbCreate({ agentId, label, fixedEngine, connectionId, tt, t, onDone }: { agentId: string; label: string; fixedEngine: DbEngine | null; connectionId: string | null; tt: (k: string, en: string) => string; t: Record<string, string>; onDone: (id: string) => void }) {
  const edition = useEdition()
  const [engine, setEngine] = useState<DbEngine | null>(fixedEngine)
  const [portTouched, setPortTouched] = useState(false)
  const [loading, setLoading] = useState(!!connectionId)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const [f, setF] = useState({ host: '', port: fixedEngine ? DB_DEFAULT_PORT[fixedEngine] : '', database: '', user: '', password: '', tls: 'verify', ca: '' })
  const [hasPassword, setHasPassword] = useState(false)
  const [busy, setBusy] = useState<'test' | 'save' | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => {
    if (!connectionId) { setLoading(false); return }
    setLoading(true)
    let alive = true
    fetch(`/api/agent-studio/db-connection?agentId=${encodeURIComponent(agentId)}&connectionId=${encodeURIComponent(connectionId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d || !DB_ENGINE_ORDER.includes(d.engine) || (fixedEngine && d.engine !== fixedEngine) || d.label !== label) return
        if (!fixedEngine) setEngine(d.engine)
        setPortTouched(String(d.port) !== DB_DEFAULT_PORT[d.engine as DbEngine])
        setF((x) => ({ ...x, host: d.host ?? '', port: String(d.port ?? x.port), database: d.database ?? '', user: d.user ?? '', tls: d.tls ?? 'verify', ca: d.ca ?? '' }))
        setHasPassword(!!d.hasPassword)
      })
      .catch(() => undefined)
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [agentId, connectionId, fixedEngine, label])
  const pickEngine = (e: DbEngine) => {
    setEngine(e)
    if (!portTouched) setF((x) => ({ ...x, port: DB_DEFAULT_PORT[e] }))
    setMsg(null)
  }
  const body = (more: Record<string, unknown>) => JSON.stringify({ agentId, engine, host: f.host, port: Number(f.port), database: f.database, user: f.user, password: f.password, tls: f.tls, ca: f.ca, ...more })
  const errText = (code: string) => tt(`app_uses_db_err_${code}`, code)
  const test = async () => {
    setBusy('test'); setMsg(null)
    try {
      const res = await fetch('/api/agent-studio/db-connection', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body({ test: true, label }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'Failed')
      setMsg(d.ok ? { ok: true, text: tt('app_uses_db_test_ok', 'Connected') } : { ok: false, text: errText(d.code) })
    } catch (e: any) { setMsg({ ok: false, text: e.message }) } finally { setBusy(null) }
  }
  const save = async () => {
    setBusy('save'); setMsg(null)
    try {
      const res = await fetch('/api/agent-studio/db-connection', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body({ label }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || !d.connectionId) throw new Error(d.error || 'Failed')
      if (mounted.current) onDone(d.connectionId)
    } catch (e: any) { setMsg({ ok: false, text: e.message }) } finally { setBusy(null) }
  }
  const field = 'bg-[#2A2A2A] border-[#3A3A3A] text-gray-200'
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => { if (k === 'port') setPortTouched(true); setF((x) => ({ ...x, [k]: e.target.value })) }
  const ready = !!engine && !loading && !!f.host.trim() && !!f.port && !!f.database.trim() && !!f.user.trim()
  return (
    <div className="space-y-2">
      {fixedEngine ? (
        <p className="text-xs font-medium text-gray-300">{PROVIDER_NAME[DB_PROVIDER[fixedEngine]]}</p>
      ) : (
        <div className="space-y-1">
          <label className="block text-xs text-gray-300">{tt('app_uses_db_engine', 'Database type')}</label>
          <div className="flex gap-2">
            {DB_ENGINE_ORDER.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => pickEngine(e)}
                disabled={loading || !!busy}
                className={`flex-1 px-2 py-1.5 text-xs rounded-md border ${engine === e ? 'border-[#00A9D1] text-[#00A9D1]' : 'border-[#3A3A3A] text-gray-400 hover:text-gray-200'}`}
              >{PROVIDER_NAME[DB_PROVIDER[e]]}</button>
            ))}
          </div>
          {!engine && <p className="text-[11px] text-gray-500">{tt('app_uses_db_engine_pick', 'Choose the type of your database first.')}</p>}
        </div>
      )}
      <fieldset disabled={!engine || loading} className="space-y-2 disabled:opacity-40">
      <div className="flex gap-2">
        <div className="flex-1 min-w-0 space-y-1">
          <label className="block text-xs text-gray-300">{tt('app_uses_db_host', 'Host')}</label>
          <Input value={f.host} onChange={set('host')} autoComplete="off" placeholder="db.example.com" className={field} />
        </div>
        <div className="w-24 space-y-1">
          <label className="block text-xs text-gray-300">{tt('app_uses_db_port', 'Port')}</label>
          <Input value={f.port} onChange={set('port')} autoComplete="off" inputMode="numeric" className={field} />
        </div>
      </div>
      <label className="block text-xs text-gray-300">{tt('app_uses_db_name', 'Database name')}</label>
      <Input value={f.database} onChange={set('database')} autoComplete="off" className={field} />
      <label className="block text-xs text-gray-300">{tt('app_uses_db_user', 'User')}</label>
      <Input value={f.user} onChange={set('user')} autoComplete="off" className={field} />
      <label className="block text-xs text-gray-300">{tt('app_uses_db_password', 'Password')}</label>
      <Input type="password" value={f.password} onChange={set('password')} autoComplete="new-password" placeholder={hasPassword ? tt('app_uses_db_password_keep', 'Saved — leave empty to keep it') : ''} className={field} />
      <label className="block text-xs text-gray-300">{tt('app_uses_db_tls', 'Encryption (TLS)')}</label>
      <select value={f.tls} onChange={set('tls')} className="w-full rounded-md border border-[#3A3A3A] bg-[#2A2A2A] px-2 py-1.5 text-sm text-gray-200">
        <option value="verify">{tt('app_uses_db_tls_verify', 'On — check the certificate')}</option>
        <option value="no-verify">{tt('app_uses_db_tls_noverify', "On — don't check the certificate")}</option>
        <option value="off">{tt('app_uses_db_tls_off', 'Off')}</option>
      </select>
      <div className="space-y-1">
        <label className="block text-xs text-gray-300">{tt('app_uses_db_ca', 'CA certificate (optional)')}</label>
        <textarea
          value={f.ca}
          onChange={set('ca')}
          rows={3}
          spellCheck={false}
          autoComplete="off"
          placeholder="-----BEGIN CERTIFICATE-----"
          className="w-full rounded-md border border-[#3A3A3A] bg-[#2A2A2A] px-2 py-1.5 font-mono text-[11px] text-gray-200"
        />
        <p className="text-[11px] text-gray-500">{tt('app_uses_db_ca_help', '')}</p>
      </div>
      {engine === 'mssql' && <p className="text-[11px] text-gray-500">{tt('app_uses_db_mssql_help', '')}</p>}
      {edition === 'cloud' && <p className="text-[11px] text-gray-500">{tt('app_uses_db_egress', '').replace('{ip}', VENDOR_SERVER_IP)}</p>}
      </fieldset>
      {msg && <p className={`text-xs ${msg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{msg.text}</p>}
      <div className="flex gap-2">
        <Button size="sm" variant="outline" className="flex-1" disabled={!!busy || !ready} onClick={test}>{tt('app_uses_db_test', 'Test connection')}</Button>
        <Button size="sm" className="flex-1" disabled={!!busy || !ready} onClick={save}>{busy === 'save' ? t.saving : t.save}</Button>
      </div>
    </div>
  )
}
