'use client'

import React from 'react'
import type { Node } from 'reactflow'
import { AlertCircle, Info, Loader2 } from 'lucide-react'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'
import { WORK_APP_METAS } from '@/lib/work/package-meta'
import type { UsesInbox } from '@/lib/work/uses'
import { useWorkApps, type WorkAppOption } from './WorkEventStartPanel'

interface Props {
  node: Node
  updateNodeData: (patch: Record<string, any>) => void
}

const selectClass = 'w-full px-3 py-2 text-sm text-gray-100 bg-[#151515] border border-[#222] rounded-lg focus:outline-none focus:border-teal-500'

function toolInboxesOf(a: WorkAppOption | undefined): Array<{ family: string; label: string; identify?: UsesInbox['identify']; intake?: { by: 'phone' | 'telegram'; label: string } }> {
  if (!a) return []
  if (a.inboxes) return a.inboxes.map((b) => ({ family: b.family, label: b.label, ...(b.identify ? { intake: b.identify } : {}) }))
  return inboxesOf(a.projectKind ?? a.appTemplate).map((b) => ({ family: b.family, label: b.family, identify: b.identify }))
}

export function inboxesOf(kind: string | null | undefined): readonly UsesInbox[] {
  if (!kind) return []
  for (const m of WORK_APP_METAS) if (m.appTemplateKinds.includes(kind)) return m.uses?.[kind]?.inbox ?? []
  return []
}

export const WorkInboxToolPanel: React.FC<Props> = ({ node, updateNodeData }) => {
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  const { apps, loading, loadError } = useWorkApps()

  const targetId: string = typeof node.data?.targetWorkflowId === 'string' ? node.data.targetWorkflowId : ''
  const family: string = typeof node.data?.inboxFamily === 'string' ? node.data.inboxFamily : ''
  const picked = apps.find((a) => a.workflowId === targetId)
  const selectedMissing = !!targetId && !loading && !loadError && !picked
  const inboxes = toolInboxesOf(picked)
  const decl = inboxes.find((b) => b.family === family)

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm font-medium text-gray-200">{t.work_app_step_target || 'Work app'}</p>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="w-4 h-4 animate-spin" />{t.loading || 'Loading…'}</div>
        ) : loadError ? (
          <p className="text-xs text-red-400 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{t.work_apps_load_failed || 'Could not load the work apps'}</p>
        ) : (
          <select
            value={targetId}
            aria-label={t.work_app_step_target || 'Work app'}
            onChange={(e) => {
              const id = e.target.value
              const a = apps.find((x) => x.workflowId === id)
              const only = toolInboxesOf(a)
              updateNodeData({
                targetWorkflowId: id || undefined,
                inboxFamily: only.length === 1 ? only[0].family : undefined,
                label: a ? `${t.work_inbox_tool || 'Work app inbox'} · ${a.name}` : (t.work_inbox_tool || 'Work app inbox'),
              })
            }}
            className={selectClass}
          >
            <option value="">{t.work_app_select_placeholder || '— choose a work app —'}</option>
            {apps.map((a) => (
              <option key={a.workflowId} value={a.workflowId}>
                {a.name}{a.agentTitle ? ` · ${a.agentTitle}` : ''}{a.opened ? '' : ` (${t.work_app_not_opened || 'not opened yet'})`}
              </option>
            ))}
            {selectedMissing && <option value={targetId}>{targetId} ({t.work_app_missing || 'not found'})</option>}
          </select>
        )}
        {picked && !picked.opened && (
          <p className="text-xs text-amber-400">{t.work_app_open_once || 'This work app has not been opened yet — open it once first, so its project exists.'}</p>
        )}
        {selectedMissing && (
          <p className="text-xs text-red-400">{t.work_app_missing_hint || 'The chosen work app is missing or no longer deployed.'}</p>
        )}
      </div>

      {picked && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-200">{t.work_inbox_family || 'Inbox'}</p>
          {inboxes.length === 0 ? (
            <p className="text-xs text-amber-400 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{t.work_inbox_none || 'This work app has no inbox — its app template does not declare one.'}</p>
          ) : (
            <select value={family} aria-label={t.work_inbox_family || 'Inbox'} onChange={(e) => updateNodeData({ inboxFamily: e.target.value || undefined })} className={selectClass}>
              <option value="">{t.work_inbox_family_placeholder || '— choose an inbox —'}</option>
              {inboxes.map((b) => <option key={b.family} value={b.family}>{b.label}</option>)}
            </select>
          )}
        </div>
      )}

      {decl?.intake && (
        <div className="flex gap-2 rounded-md border border-[#3A3A3A] bg-[#232323] p-3 text-xs text-gray-400">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <p>{(decl.intake.by === 'phone'
            ? (t.work_inbox_intake_phone || 'On phone calls the caller\'s number fills «{column}» — the AI asks for a contact only when the number is hidden. Customers cannot look up their earlier requests.')
            : (t.work_inbox_intake_telegram || 'On Telegram the user\'s Telegram id fills «{column}». Customers cannot look up their earlier requests.')).replace('{column}', decl.intake.label)}</p>
        </div>
      )}

      {decl?.identify && (
        <div className="flex gap-2 rounded-md border border-[#3A3A3A] bg-[#232323] p-3 text-xs text-gray-400">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <p>{decl.identify.by === 'phone'
            ? (t.work_inbox_read_phone || 'On phone calls the caller can also hear their own earlier requests (recognised by the calling number — hidden numbers cannot). Chat widget, Telegram and web voice only add.')
            : (t.work_inbox_read_telegram || 'On Telegram the user can also hear their own earlier requests (recognised by their Telegram id). Phone, chat widget and web voice only add.')}</p>
        </div>
      )}

      <div className="flex gap-2 rounded-md border border-[#3A3A3A] bg-[#232323] p-3 text-xs text-gray-400">
        <Info className="w-4 h-4 shrink-0 mt-0.5" />
        <p>{t.work_inbox_help || 'Every request becomes an unconfirmed row — a person on your team reviews it in the work app. Each new row also raises the work app event «New inbox row». One inbox tool per AI node.'}</p>
      </div>
    </div>
  )
}
