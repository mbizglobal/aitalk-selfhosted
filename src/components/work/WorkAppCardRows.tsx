'use client'

import Link from 'next/link'
import { ExternalLink, Link2 } from 'lucide-react'
import { useLanguage } from '@/hooks/useLanguage'
import { workAppOpenHref } from '@/lib/work/open-href'
import type { WorkflowWorkApp } from '@/lib/work/workflow-apps'

const SHOWN = 3

export function workLangOf(lang: string): string {
  return lang === 'de-ch' ? 'de' : ['en', 'de', 'fr', 'ko'].includes(lang) ? lang : 'en'
}

export function WorkAppBadge() {
  const { t } = useLanguage()
  return <span className="inline-flex items-center rounded-md bg-blue-500/15 px-2 py-0.5 text-xs font-medium text-blue-600 dark:text-blue-300">{t('work_badge')}</span>
}

export function WorkAppCardRows({ workApp, compact = false, manageLink = false }: { workApp: WorkflowWorkApp; compact?: boolean; manageLink?: boolean }) {
  const { t, currentLanguage } = useLanguage()
  const lang = workLangOf(currentLanguage)
  const stateLabel = (s: string) => s === 'live' ? t('work_state_live') : s === 'removed' ? t('work_state_removed') : s === 'orphan' ? t('work_state_orphan') : t('work_state_draft')
  const shown = workApp.apps.slice(0, SHOWN)
  const more = workApp.apps.length - shown.length
  const text = compact ? 'text-xs' : 'text-sm'
  return (
    <div className={`space-y-1 ${compact ? 'mt-1' : ''}`}>
      {shown.map((a) => {
        const href = workAppOpenHref(a, lang)
        return (
          <div key={a.projectId} className={`flex items-center gap-2 rounded-md border px-2 ${compact ? 'py-0.5' : 'py-1'} ${text}`}>
            <span className="min-w-0 flex-1 truncate font-medium" title={a.name}>{a.name}</span>
            {!compact && (
              <span className={`shrink-0 text-[11px] px-1.5 py-0.5 rounded ${a.state === 'live' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300' : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'}`}>{stateLabel(a.state)}</span>
            )}
            {href && (
              <a href={href} target="_blank" rel="noopener" className="inline-flex shrink-0 items-center gap-1 text-primary hover:underline" title={`${t('work_open')} — ${a.name}`}>
                {!compact && t('work_open')} <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
        )
      })}
      {more > 0 && (
        <Link href="/app/work" className={`block text-primary hover:underline ${compact ? 'text-[11px]' : 'text-xs'}`}>{t('work_card_more').replace('{n}', String(more))}</Link>
      )}
      {workApp.links.map((l, i) => {
        const href = l.projectId ? workAppOpenHref({ agentId: l.agentId, state: l.state, appWorkflowId: l.appWorkflowId, projectId: l.projectId }, lang) : null
        return (
          <div key={`link-${i}`} className={`flex items-center gap-2 rounded-md border border-dashed px-2 ${compact ? 'py-0.5' : 'py-1'} ${text} text-muted-foreground`}>
            <Link2 className="w-3.5 h-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate" title={l.name}>{l.projectId ? `${l.name}${compact ? '' : ` (${t('work_card_link')})`}` : t('work_card_link_missing')}</span>
            {href && (
              <a href={href} target="_blank" rel="noopener" className="inline-flex shrink-0 items-center gap-1 text-primary hover:underline" title={`${t('work_open')} — ${l.name}`}>
                {!compact && t('work_open')} <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
        )
      })}
      {workApp.undeployedNodes && workApp.apps.length === 0 && (
        <p className={`${compact ? 'text-[11px]' : 'text-xs'} text-muted-foreground`}>{t('work_card_deploy_hint')}</p>
      )}
      {manageLink && (
        <div className="text-right"><Link href="/app/work" className="text-xs text-primary hover:underline">{t('work_card_manage_link')} →</Link></div>
      )}
    </div>
  )
}
