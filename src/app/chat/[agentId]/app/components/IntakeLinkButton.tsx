'use client'

import React, { useEffect, useRef, useState } from 'react'
import { Link2, Webhook } from 'lucide-react'
import { WorkApiError, type WorkApi } from '../lib/api'

interface WebhookShape { mode: 'flat' | 'map'; keys: string[]; map: Record<string, string> | null; id: string | null }
interface LinkView { tableKey: string; table: string; sheetId: string | null; url: string | null; createdAt: string | null; shape?: WebhookShape }

function sampleBody(sh: WebhookShape): string {
  const bare = () => Object.create(null) as Record<string, unknown>
  const root = bare()
  const put = (path: string, v: string) => {
    const parts = path.split('.')
    let cur = root
    parts.forEach((p, i) => {
      if (i === parts.length - 1) { cur[p] = v; return }
      const next = cur[p]
      if (!next || typeof next !== 'object') cur[p] = bare()
      cur = cur[p] as Record<string, unknown>
    })
  }
  if (sh.mode === 'flat') for (const k of sh.keys) put(k, '…')
  else {
    for (const [col, path] of Object.entries(sh.map ?? {})) put(path, `… (${col})`)
    if (sh.id) put(sh.id, '… (id)')
  }
  return JSON.stringify(root, null, 2)
}

export function IntakeLinkButton(props: { api: WorkApi; projectId: string; sheetId: string; t: (k: string, f?: string) => string; kind?: 'form' | 'webhook' }) {
  const { api, projectId, sheetId, t } = props
  const hook = props.kind === 'webhook'
  const path = hook ? 'webhooks' : 'intake-links'
  const tk = (name: string, f: string) => t(hook ? `webhook_${name}` : `intake_link_${name}`, f)
  const [tableKey, setTableKey] = useState<string | null>(null)
  const [link, setLink] = useState<LinkView | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [ask, setAsk] = useState<'new' | 'off' | null>(null)
  const [copied, setCopied] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const seq = useRef(0)

  const load = async () => {
    const my = ++seq.current
    try {
      const r = await api<{ links: LinkView[] }>('GET', `/projects/${projectId}/${path}`)
      if (my !== seq.current) return
      const found = r.links.find((l) => l.sheetId === sheetId) ?? null
      setLink(found)
      setTableKey(found?.tableKey ?? null)
      setLoadFailed(false)
    } catch (e) {
      if (my !== seq.current) return
      if (e instanceof WorkApiError && (e.code === 'FORBIDDEN' || e.code === 'UNAUTHORIZED')) { setLink(null); setLoadFailed(false) }
      else { setLink(null); setLoadFailed(true) }
    }
  }
  useEffect(() => { void load() }, [projectId, sheetId]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!link) {
    if (!loadFailed) return null
    return (
      <button onClick={() => void load()} className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md bg-[#2A2A2A] text-gray-300 hover:bg-[#3A3A3A]">
        {hook ? <Webhook className="w-4 h-4" /> : <Link2 className="w-4 h-4" />} {hook ? t('webhook', 'Webhook') : t('intake_link', 'Intake link')} ↻
      </button>
    )
  }

  const live = !!link.createdAt
  const act = async (kind: 'new' | 'off') => {
    if (busy) return
    setBusy(true); setErr(null); setAsk(null)
    const my = ++seq.current
    try {
      if (kind === 'new') {
        const r = await api<{ url: string | null }>('POST', `/projects/${projectId}/${path}`, { table: tableKey })
        if (my === seq.current) setLink({ ...link, url: r.url, createdAt: new Date().toISOString() })
      } else {
        await api('DELETE', `/projects/${projectId}/${path}`, { table: tableKey })
        if (my === seq.current) setLink({ ...link, url: null, createdAt: null })
      }
    } catch {
      setErr(tk('error', hook ? 'Could not change the address — try again.' : 'Could not change the link — try again.'))
      await load()
    } finally {
      setBusy(false)
    }
  }
  const copy = async () => {
    if (!link.url) return
    try { await navigator.clipboard.writeText(link.url); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { }
  }

  return (
    <div className="relative">
      <button onClick={() => { if (busy) return; if (!open) void load(); setOpen((x) => !x) }} className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md bg-[#2A2A2A] text-white hover:bg-[#3A3A3A]">
        {hook ? <Webhook className="w-4 h-4" /> : <Link2 className="w-4 h-4" />} {hook ? t('webhook', 'Webhook') : t('intake_link', 'Intake link')}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-80 rounded-lg border border-[#333] bg-[#1E1E1E] p-3 text-sm text-gray-200 shadow-xl space-y-2">
          <p className="text-xs text-gray-400">{hook
            ? tk('help', 'Another system (shop, form service, Zapier, your own program) can POST JSON to this secret address to add a row — no AI, no Credits. Rows arrive unconfirmed. Keep the address secret.')
            : tk('help', 'Anyone with this link can add a row with only the intake columns — no login, no AI. Rows arrive unconfirmed.')}</p>
          {live ? (
            <>
              {link.url
                ? <input readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} className="w-full rounded border border-[#333] bg-[#151515] px-2 py-1 text-xs text-gray-100" />
                : <p className="text-xs text-amber-300">{tk('hidden', 'A link is on, but its address cannot be shown — make a new link to get one.')}</p>}
              <div className="flex flex-wrap gap-2">
                {link.url && <button onClick={copy} className="px-2 py-1 rounded bg-[#E07B53] text-white text-xs">{copied ? tk('copied', 'Copied') : tk('copy', 'Copy')}</button>}
                {link.url && !hook && <a href={link.url} target="_blank" rel="noreferrer" className="px-2 py-1 rounded bg-[#2A2A2A] text-xs">{t('intake_link_open', 'Open')}</a>}
                <button onClick={() => setAsk('new')} disabled={busy} className="px-2 py-1 rounded bg-[#2A2A2A] text-xs disabled:opacity-40">{tk('new', hook ? 'New address' : 'New link')}</button>
                <button onClick={() => setAsk('off')} disabled={busy} className="px-2 py-1 rounded bg-[#2A2A2A] text-xs text-red-300 disabled:opacity-40">{tk('off', 'Turn off')}</button>
              </div>
            </>
          ) : (
            <button onClick={() => void act('new')} disabled={busy} className="px-2 py-1 rounded bg-[#E07B53] text-white text-xs disabled:opacity-40">{tk('make', hook ? 'Make an address' : 'Make a link')}</button>
          )}
          {ask && (
            <div className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-200 space-y-2">
              <p>{ask === 'new'
                ? tk('new_ask', hook ? 'The current address stops working — the sending system must get the new one. Make a new one?' : 'The current link stops working. Make a new one?')
                : tk('off_ask', hook ? 'The address stops working — the other system can no longer send. Turn it off?' : 'The link stops working — customers can no longer send. Turn it off?')}</p>
              <div className="flex gap-2">
                <button onClick={() => void act(ask)} disabled={busy} className="px-2 py-1 rounded bg-amber-600 text-white">{tk('yes', 'Yes')}</button>
                <button onClick={() => setAsk(null)} className="px-2 py-1 rounded bg-[#2A2A2A]">{t('cancel', 'Cancel')}</button>
              </div>
            </div>
          )}
          {hook && link.shape && (
            <div className="space-y-1">
              <p className="text-xs text-gray-400">{link.shape.mode === 'flat'
                ? tk('shape_flat', 'Send POST with Content-Type: application/json — a flat object of these keys (other keys are refused). Send the same Idempotency-Key header again and no second row is made.')
                : link.shape.id
                  ? tk('shape_map', 'Send POST with Content-Type: application/json — your system\'s own JSON; only these paths are read. The same request id again makes no second row.')
                  : tk('shape_map_noid', 'Send POST with Content-Type: application/json — your system\'s own JSON; only these paths are read. To avoid a second row when the system sends again, send the same Idempotency-Key header.')}</p>
              <pre className="max-h-40 overflow-auto rounded border border-[#333] bg-[#151515] p-2 text-[11px] text-gray-300">{sampleBody(link.shape)}</pre>
            </div>
          )}
          {err && <p className="text-xs text-red-300">{err}</p>}
        </div>
      )}
    </div>
  )
}
