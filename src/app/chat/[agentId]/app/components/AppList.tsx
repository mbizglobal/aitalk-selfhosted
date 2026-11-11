'use client'

import React, { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Briefcase, Loader2, LogOut } from 'lucide-react'
import { workKindLabel, workT, type WorkLang } from '@/lib/translations/work'
import { makeAppApi, type WorkAppListItem } from '../lib/api'
import { LangSwitch } from './LangSwitch'
import { errorText } from './SheetTable'

export function AppList({ agentId, token, lang, memberName, isOwner, onLogout, onAuthError }: {
  agentId: string
  token: string | null
  lang: WorkLang
  memberName: string
  isOwner: boolean
  onLogout: () => void
  onAuthError: () => void
}) {
  const t = (k: string, f?: string) => workT(lang, k, f)
  const api = useMemo(() => makeAppApi(agentId, token, onAuthError), [agentId, token, onAuthError])
  const [data, setData] = useState<{ agentTitle: string; apps: WorkAppListItem[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const groups = useMemo(() => {
    const m = new Map<string, { id: string; name: string; type: WorkAppListItem['groupType']; apps: WorkAppListItem[] }>()
    for (const a of data?.apps ?? []) {
      const g = m.get(a.groupId) ?? { id: a.groupId, name: a.groupName, type: a.groupType, apps: [] }
      g.apps.push(a)
      m.set(a.groupId, g)
    }
    const at = (a: WorkAppListItem) => (a.projectCreatedAt ? Date.parse(a.projectCreatedAt) : Number.MAX_SAFE_INTEGER)
    for (const g of m.values()) g.apps.sort((a, b) => at(a) - at(b) || a.name.localeCompare(b.name))
    const rank = { canvas: 0, workflow: 1 } as const
    return [...m.values()].sort((a, b) => rank[a.type] - rank[b.type] || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  }, [data])

  useEffect(() => {
    let live = true
    api<{ agentTitle: string; apps: WorkAppListItem[] }>('GET', '')
      .then((r) => { if (live) setData(r) })
      .catch((e) => { if (live) setError(errorText(lang, e)) })
    return () => { live = false }
  }, [api, lang])

  return (
    <div className="min-h-[100dvh] bg-[#1E1E1E] text-white">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between gap-2 mb-6">
          <div className="min-w-0">
            <p className="text-xs text-gray-500 truncate">{data?.agentTitle ?? ''}</p>
            <h1 className="text-xl font-medium">{t('app_list_title')}</h1>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <span className="truncate flex-1 min-w-0">{memberName} · {isOwner ? t('owner') : t('member')}</span>
            <LangSwitch lang={lang} title={t('language')} />
            {!isOwner && <button onClick={onLogout} className="p-1 hover:text-white" title={t('logout')}><LogOut className="w-4 h-4" /></button>}
          </div>
        </div>
        {error && <p className="text-sm text-red-400 whitespace-pre-line">{error}</p>}
        {!data ? (
          !error && <div className="py-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-[#E07B53]" /></div>
        ) : data.apps.length === 0 ? (
          <p className="text-sm text-gray-400">{t('app_list_empty')}</p>
        ) : (
          <div className="space-y-4">
            {groups.map((g) => (
              <section key={g.id} className="rounded-lg border border-[#2A2A2A] overflow-hidden">
                <div className="px-4 py-2 bg-[#232323] border-b border-[#2A2A2A]">
                  <span className="block text-sm font-medium truncate">{g.name}</span>
                </div>
                <ul className="divide-y divide-[#2A2A2A]">
                  {g.apps.map((a) => (
                    <li key={a.workflowId}>
                      <Link href={`/chat/${encodeURIComponent(agentId)}/app?workflowId=${encodeURIComponent(a.workflowId)}&lang=${lang}`}
                        className="flex items-center gap-3 px-4 py-3 hover:bg-[#262626]">
                        <Briefcase className="w-5 h-5 shrink-0 text-[#E07B53]" />
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium truncate">{a.name}</span>
                          <span className="block text-xs text-gray-500">
                            {a.projectKind && a.projectKind !== 'free' ? workKindLabel(lang, a.projectKind) : a.appTemplate ? workKindLabel(lang, a.appTemplate) : t('app_no_template')}
                            {' · '}{t(a.tasks === 1 ? 'app_tasks_count_one' : 'app_tasks_count').replace('{n}', String(a.tasks))}
                          </span>
                          <span className="mt-1 inline-block text-[11px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">{t('app_state_live')}</span>
                        </span>
                        <span className="text-sm text-gray-300">{t('app_open')}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
