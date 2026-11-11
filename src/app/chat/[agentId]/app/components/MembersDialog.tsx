'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Mail, X } from 'lucide-react'
import { workT, type WorkLang } from '@/lib/translations/work'
import type { AppInviteResult, AppPeople, AppPerson, WorkApi } from '../lib/api'
import { errorText } from './SheetTable'
import { ConfirmDialog } from './ConfirmDialog'
import { useWorkPkg } from './work-pkg'

type Tab = 'in' | 'out'

export function MembersDialog({ api, lang, projectId, isOwner, onChanged, onClose }: {
  api: WorkApi
  lang: WorkLang
  projectId: string
  isOwner: boolean
  onChanged: () => void
  onClose: () => void
}) {
  const pkg = useWorkPkg()
  const t = (k: string, f?: string) => workT(lang, k, f, pkg)
  const [tab, setTab] = useState<Tab>('in')
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [data, setData] = useState<AppPeople | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [removing, setRemoving] = useState<AppPerson | null>(null)
  const seq = useRef(0)

  useEffect(() => {
    const h = setTimeout(() => setSearch(query.trim()), 250)
    return () => clearTimeout(h)
  }, [query])

  const load = useCallback(async () => {
    const my = ++seq.current
    try {
      const r = await api<AppPeople>('GET', `/projects/${encodeURIComponent(projectId)}/people?tab=${tab}&q=${encodeURIComponent(search)}`)
      if (my === seq.current) setData(r)
    } catch (e) { if (my === seq.current) setError(errorText(lang, e, pkg)) }
  }, [api, projectId, tab, search, lang, pkg])
  useEffect(() => { setData(null); setError(null); void load() }, [load])

  const loadMore = async () => {
    if (!data) return
    const my = seq.current
    setBusy(true)
    try {
      const r = await api<AppPeople>('GET', `/projects/${encodeURIComponent(projectId)}/people?tab=${tab}&q=${encodeURIComponent(search)}&skip=${data.items.length}&iskip=${data.invites.length}`)
      if (my === seq.current) setData((cur) => (cur ? { ...cur, items: [...cur.items, ...r.items], invites: [...cur.invites, ...r.invites], more: r.more, counts: r.counts } : r))
    } catch (e) { if (my === seq.current) setError(errorText(lang, e, pkg)) } finally { setBusy(false) }
  }

  const act = async (fn: () => Promise<string | null>) => {
    setBusy(true); setError(null); setNotice(null)
    try {
      const msg = await fn()
      if (msg) setNotice(msg)
      await load()
      onChanged()
    } catch (e) { setError(errorText(lang, e, pkg)); void load() } finally { setBusy(false) }
  }
  const base = `/projects/${encodeURIComponent(projectId)}/people`
  const add = (m: AppPerson) => act(async () => { await api('POST', base, { action: 'add', memberId: m.id }); return null })
  const remove = (m: AppPerson) => act(async () => { setRemoving(null); await api('DELETE', `${base}?memberId=${m.id}`); return null })
  const uninvite = (id: number) => act(async () => { await api('DELETE', `${base}?invitationId=${id}`); return null })
  const invite = () => act(async () => {
    const to = email.trim()
    const r = await api<AppInviteResult>('POST', base, { action: 'invite', email: to })
    setEmail('')
    const key = r.result === 'added' ? 'people_done_added' : r.result === 'extended' ? 'people_done_extended' : r.emailSent ? 'people_done_invited' : 'people_done_invited_nomail'
    return t(key).replace('{email}', to.toLowerCase())
  })

  const nameOf = (m: AppPerson) => m.name || m.email || t('member')
  const roleText = (m: AppPerson) => (m.approverOf ?? []).map((f) => t(`set_${f}`, f)).join(', ')

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 sm:px-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={t('people_title')} onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-lg max-h-[90dvh] flex flex-col rounded-t-xl sm:rounded-xl bg-[#1E1E1E] border border-[#2A2A2A]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2A2A2A]">
          <p className="font-medium text-white">{t('people_title')}</p>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-white" aria-label={t('cancel')}><X className="w-4 h-4" /></button>
        </div>

        {isOwner && (
          <div role="tablist" className="flex gap-1 px-4 pt-2 border-b border-[#2A2A2A]">
            {(['in', 'out'] as const).map((k) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setNotice(null) }}
                className={`px-3 py-1.5 text-sm border-b-2 -mb-px ${tab === k ? 'border-[#E07B53] text-white' : 'border-transparent text-gray-400 hover:text-gray-200'}`}>
                {t(k === 'in' ? 'people_tab_in' : 'people_tab_out')}
                {data && <span className="ml-1 text-xs text-gray-500">({k === 'in' ? data.counts.in + 1 : data.counts.out})</span>}
              </button>
            ))}
          </div>
        )}

        <div className="px-4 pt-3">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('people_search')} autoComplete="off"
            className="w-full rounded-md bg-[#141414] border border-[#2A2A2A] px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-[#E07B53]" />
          {!isOwner && <p className="mt-2 text-xs text-gray-500">{t('people_member_view')}</p>}
          {error && <p role="alert" className="mt-2 text-sm text-red-400 whitespace-pre-line">{error}</p>}
          {notice && <p className="mt-2 text-sm text-emerald-300">{notice}</p>}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-4 py-2">
          {!data ? (
            !error && <div className="py-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-[#E07B53]" /></div>
          ) : (
            <ul className="divide-y divide-[#2A2A2A]">
              {tab === 'in' && (
                <li className="py-2 flex items-center gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-white truncate">{data.owner.name || data.owner.email || t('owner')}</span>
                    {data.owner.email && data.owner.name && <span className="block text-xs text-gray-500 truncate">{data.owner.email}</span>}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#2A2A2A] text-gray-400">{t('owner')}</span>
                </li>
              )}
              {data.items.map((m) => (
                <li key={m.id} className="py-2 flex items-center gap-2">
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm truncate ${m.status === 'active' ? 'text-white' : 'text-gray-500'}`}>{nameOf(m)} <span className="text-xs text-gray-500">· {m.jobTitle || t('job_title_default')}</span></span>
                    {m.email && m.name && <span className="block text-xs text-gray-500 truncate">{m.email}</span>}
                    {(m.status === 'suspended' || m.sameAsOwner || m.approverOf) && (
                      <span className="block text-[11px] text-amber-300/80 truncate">
                        {[m.status === 'suspended' ? t('people_suspended') : '', m.sameAsOwner ? t('people_same_as_owner') : '', roleText(m)].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </span>
                  {isOwner && (tab === 'in'
                    ? <button onClick={() => setRemoving(m)} disabled={busy} className="shrink-0 px-2 py-1 text-xs rounded-md text-gray-300 hover:bg-[#2A2A2A] hover:text-red-300 disabled:opacity-50">{t('people_remove')}</button>
                    : <button onClick={() => void add(m)} disabled={busy} className="shrink-0 px-2 py-1 text-xs rounded-md bg-[#E07B53] text-white hover:opacity-90 disabled:opacity-50">{t('people_add')}</button>)}
                </li>
              ))}
              {tab === 'in' && data.invites.map((x) => (
                <li key={`inv-${x.id}`} className="py-2 flex items-center gap-2">
                  <Mail className="w-4 h-4 shrink-0 text-gray-500" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-gray-300 truncate">{x.email}</span>
                    <span className="block text-[11px] text-gray-500">{t('people_pending')}</span>
                  </span>
                  <button onClick={() => void uninvite(x.id)} disabled={busy} className="shrink-0 px-2 py-1 text-xs rounded-md text-gray-300 hover:bg-[#2A2A2A] hover:text-red-300 disabled:opacity-50">{t('people_remove')}</button>
                </li>
              ))}
              {data.items.length === 0 && (tab === 'out' || data.invites.length === 0) && (
                <li className="py-4 text-center text-sm text-gray-500">{search ? t('people_no_match') : tab === 'in' ? t('people_empty_in') : data.counts.team === 0 ? t('people_no_team') : t('people_empty_out')}</li>
              )}
            </ul>
          )}
          {data?.more && (
            <button onClick={() => void loadMore()} disabled={busy} className="mt-2 w-full py-1.5 text-xs rounded-md text-gray-300 hover:bg-[#2A2A2A] disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : t('act_more')}
            </button>
          )}
        </div>

        {isOwner && (
          <div className="px-4 py-3 border-t border-[#2A2A2A]">
            <p className="text-xs text-gray-400 mb-1.5">{t('people_invite_title')}</p>
            <form onSubmit={(e) => { e.preventDefault(); if (email.trim()) void invite() }} className="flex gap-2">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('people_invite_placeholder')} autoComplete="off"
                className="flex-1 min-w-0 rounded-md bg-[#141414] border border-[#2A2A2A] px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-[#E07B53]" />
              <button type="submit" disabled={busy || !email.trim()} className="shrink-0 px-3 py-1.5 text-sm rounded-md bg-[#E07B53] text-white hover:opacity-90 disabled:opacity-50">{t('people_invite_send')}</button>
            </form>
            <p className="mt-1.5 text-[11px] text-gray-500">{t('people_invite_help')}</p>
          </div>
        )}
      </div>

      {removing && (
        <div onClick={(e) => e.stopPropagation()}>
          <ConfirmDialog
            message={[t('people_remove_confirm').replace('{name}', nameOf(removing)), removing.approverOf?.length ? t('people_remove_approver').replace('{name}', nameOf(removing)).replace('{roles}', roleText(removing)) : ''].filter(Boolean).join('\n\n')}
            okLabel={t('people_remove')} cancelLabel={t('cancel')} busy={busy}
            onOk={() => void remove(removing)} onCancel={() => setRemoving(null)} />
        </div>
      )}
    </div>
  )
}
