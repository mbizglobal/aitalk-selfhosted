'use client'

import React, { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Briefcase, Loader2, LogOut } from 'lucide-react'
import { workKindLabel, workT, type WorkLang } from '@/lib/translations/work'
import { makeAppApi, type WorkAppListItem } from '../lib/api'
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
            <span className="truncate">{memberName} · {isOwner ? t('owner') : t('member')}</span>
            {!isOwner && <button onClick={onLogout} className="p-1 hover:text-white" title={t('logout')}><LogOut className="w-4 h-4" /></button>}
          </div>
        </div>
        {error && <p className="text-sm text-red-400 whitespace-pre-line">{error}</p>}
        {!data ? (
          !error && <div className="py-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-[#E07B53]" /></div>
        ) : data.apps.length === 0 ? (
          <p className="text-sm text-gray-400">{t('app_list_empty')}</p>
        ) : (
          <ul className="space-y-2">
            {data.apps.map((a) => (
              <li key={a.workflowId}>
                <Link href={`/chat/${encodeURIComponent(agentId)}/app?workflowId=${encodeURIComponent(a.workflowId)}&lang=${lang}`}
                  className="flex items-center gap-3 rounded-lg border border-[#2A2A2A] bg-[#232323] px-4 py-3 hover:border-[#E07B53]">
                  <Briefcase className="w-5 h-5 shrink-0 text-[#E07B53]" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium truncate">{a.name}</span>
                    <span className="block text-xs text-gray-500">
                      {a.projectKind && a.projectKind !== 'free' ? workKindLabel(lang, a.projectKind) : a.appTemplate ? workKindLabel(lang, a.appTemplate) : t('app_no_template')}
                      {' · '}{t('app_tasks_count').replace('{n}', String(a.tasks))}
                    </span>
                  </span>
                  <span className="text-sm text-gray-300">{t('app_open')}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
