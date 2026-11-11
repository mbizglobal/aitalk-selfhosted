'use client'

import React, { useEffect, useState } from 'react'
import type { Node } from 'reactflow'
import { Check, Clock, ExternalLink, Info, Lock } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'
import { PICKABLE_APP_TEMPLATE_KINDS, isAppTemplateKind } from '@/lib/work/app-template-kinds'
import { parseWorkLang, workKindLabel } from '@/lib/translations/work'
import { APP_TEMPLATE_FEATURES, featureLabel } from '@/lib/work/app-template-features'
import { useWorkflowContext } from '../../contexts/WorkflowContext'
import { AppStartUses } from './AppStartUses'
import { PanelSection } from './PanelSection'

interface Props {
  node: Node
  updateNodeData: (patch: Record<string, any>) => void
}

const MAX_WELCOME = 1000
const SEARCH_MIN = 8

function AppTemplatePicker({ pickable, current, labelOf, searchPlaceholder, noneLabel, onPick }: {
  pickable: string[]; current: string; labelOf: (k: string) => string; searchPlaceholder: string; noneLabel: string; onPick: (k: string) => void
}) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const shown = q ? pickable.filter((k) => labelOf(k).toLowerCase().includes(q) || k.toLowerCase().includes(q)) : pickable
  return (
    <>
      {pickable.length > SEARCH_MIN && (
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={searchPlaceholder} autoComplete="off" />
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {shown.map((k) => (
          <button
            key={k || 'choose'}
            type="button"
            onClick={() => onPick(k)}
            className={`px-3 py-2 text-sm text-left rounded-md border transition-colors ${current === k
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-[#3A3A3A] text-gray-300 hover:border-gray-500'
            }`}
          >
            {labelOf(k)}
          </button>
        ))}
      </div>
      {shown.length === 0 && <p className="text-sm text-gray-500">{noneLabel}</p>}
    </>
  )
}

export type AppTemplateLockView = { allowed: string[]; reason: 'in_use' | 'tasks_before_apply' }

export const AppSettingsFields: React.FC<Props & { connectionKey?: string; canvas?: boolean; lock: AppTemplateLockView | null | undefined }> = ({ node, updateNodeData, connectionKey, canvas, lock }) => {
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  const { agent } = useWorkflowContext()
  const appTemplate: string = typeof node.data?.appTemplate === 'string' ? node.data.appTemplate : ''
  const welcome: string = typeof node.data?.appWelcomeMessage === 'string' ? node.data.appWelcomeMessage : ''
  const kinds = ['', ...PICKABLE_APP_TEMPLATE_KINDS, ...(appTemplate && !PICKABLE_APP_TEMPLATE_KINDS.includes(appTemplate) ? [appTemplate] : [])]
  const choices = lock === undefined ? [appTemplate] : lock ? kinds.filter((k) => lock.allowed.includes(k)) : kinds
  const labelOf = (k: string) => (k ? (t[`app_template_${k}`] || workKindLabel(parseWorkLang(lang), k)) : canvas ? (t.app_template_none_canvas || 'Not chosen yet') : (t.app_template_choose || 'Choose in the first chat'))
  const pickable = canvas ? choices.filter((k) => k) : choices
  const title = t.app_template_label || 'App template'
  const current = <span className="text-sm text-gray-200">{labelOf(appTemplate)}</span>

  return (
    <>
      <div>
        {!pickable.some((k) => k !== appTemplate) ? (
          <>
            <label className="text-sm font-medium text-gray-200 mb-2 block">{title}</label>
            <div className="rounded-md border border-[#3A3A3A] px-3 py-3">{current}</div>
          </>
        ) : (
          <PanelSection
            title={title}
            summary={current}
            help={canvas ? (t.app_template_pick_help_canvas || 'Once the app is in use, its app template can no longer be changed.') : undefined}
            editLabel={appTemplate ? (t.app_template_change || 'Change') : (t.app_template_pick || 'Choose')}
            doneLabel={t.app_uses_done || 'Done'}
          >
            {(close) => (
              <AppTemplatePicker
                pickable={pickable}
                current={appTemplate}
                labelOf={labelOf}
                searchPlaceholder={t.app_template_search || 'Search app templates...'}
                noneLabel={t.app_template_search_none || 'No app template found'}
                onPick={(k) => { updateNodeData({ appTemplate: k || undefined }); close() }}
              />
            )}
          </PanelSection>
        )}
        {lock && (
          <p className="mt-2 flex gap-1.5 text-xs text-amber-200">
            <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{lock.reason === 'tasks_before_apply'
              ? (t.app_template_locked_tasks || 'Tasks were created in this work app before its app template was applied, so it can no longer be applied or changed. Add another Work app node for this app template.')
              : (t.app_template_locked || 'This work app is already in use, so its app template can no longer be changed. For a different app, add another Work app node.')}</span>
          </p>
        )}
        <p className="mt-2 text-xs text-gray-500">{canvas
          ? (appTemplate ? (t.app_template_help_canvas || 'The app uses this app template.') : (t.app_template_pick_canvas || 'Choose an app template — its settings and “Open app” appear after you choose one.'))
          : (t.app_template_help || 'Fix an app template, or leave it open — the user then picks one in the first chat.')}</p>
        {isAppTemplateKind(appTemplate) && (
          <div className="mt-3 rounded-md border border-[#3A3A3A] p-3 text-xs space-y-2">
            <p className="font-medium text-gray-300">{t.app_template_features || 'What it does'}</p>
            <ul className="space-y-1">
              {APP_TEMPLATE_FEATURES[appTemplate].available.map((f) => (
                <li key={f.id} className="flex items-start gap-1.5 text-gray-300"><Check className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-400" />{featureLabel(f, lang)}</li>
              ))}
            </ul>
            {APP_TEMPLATE_FEATURES[appTemplate].planned.length > 0 && (
              <>
                <p className="font-medium text-gray-500 pt-1">{t.app_template_planned || 'Coming later'}</p>
                <ul className="space-y-1">
                  {APP_TEMPLATE_FEATURES[appTemplate].planned.map((f) => (
                    <li key={f.id} className="flex items-start gap-1.5 text-gray-500"><Clock className="w-3.5 h-3.5 mt-0.5 shrink-0" />{featureLabel(f, lang)}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>

      {!(canvas && !appTemplate) && agent.agentId && <AppStartUses node={node} updateNodeData={updateNodeData} agentId={agent.agentId} appTemplate={isAppTemplateKind(appTemplate) ? appTemplate : ''} connectionKey={connectionKey} />}

      {!(canvas && !appTemplate) && <div>
        <label className="text-sm font-medium text-gray-200 mb-2 block">{t.app_welcome_label || 'Welcome message'}</label>
        <Textarea
          value={welcome}
          maxLength={MAX_WELCOME}
          rows={3}
          autoComplete="off"
          placeholder={t.app_welcome_placeholder || 'Shown when the work app opens'}
          onChange={(e) => updateNodeData({ appWelcomeMessage: e.target.value || undefined })}
        />
      </div>}
    </>
  )
}

export const AppStartPanel: React.FC<Props> = ({ node, updateNodeData }) => {
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  const { agent, workflow, ui } = useWorkflowContext()
  const [lock, setLock] = useState<AppTemplateLockView | null | undefined>(undefined)
  useEffect(() => {
    if (!agent.workflowId) { setLock(null); return }
    setLock(undefined)
    let alive = true
    fetch(`/api/agent-studio/work-app-nodes?workflowId=${encodeURIComponent(agent.workflowId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (alive) setLock((d?.self as AppTemplateLockView | null | undefined) ?? null) })
      .catch(() => { if (alive) setLock(undefined) })
    return () => { alive = false }
  }, [agent.workflowId, agent.workflowStatus, ui.hasChanges])
  const isCanvas = (workflow.nodes ?? []).some((n: Node) => n.data?.nodeType === 'workApp')
  if (isCanvas) {
    return (
      <div className="flex gap-2 rounded-md border border-[#3A3A3A] bg-[#232323] p-3 text-xs text-gray-400">
        <Info className="w-4 h-4 shrink-0 mt-0.5" />
        <p>{t.app_canvas_start_note || 'Each Work app node on this canvas is one work app — set it up and open it from the node. After an app event (closed, new inbox row …), draw the next steps from the node’s event outputs.'}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <AppSettingsFields node={node} updateNodeData={updateNodeData} lock={lock} />

      {agent.workflowStatus === 'production' && agent.agentId && agent.workflowId ? (
        <a
          href={`/chat/${encodeURIComponent(agent.agentId)}/app?workflowId=${encodeURIComponent(agent.workflowId)}${['de', 'fr', 'ko'].includes(lang) ? `&lang=${lang}` : ''}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-md border border-[#3A3A3A] px-3 py-2 text-sm text-gray-200 hover:bg-[#3A3A3A]"
        >
          {t.app_open_link || 'Open app'}
          <ExternalLink className="w-3 h-3 ml-auto" />
        </a>
      ) : (
        <p className="text-xs text-gray-500">{t.app_open_requires_active || 'Deploy the workflow to open the app.'}</p>
      )}

      <div className="flex gap-2 rounded-md border border-[#3A3A3A] bg-[#232323] p-3 text-xs text-gray-400">
        <Info className="w-4 h-4 shrink-0 mt-0.5" />
        <p>{t.app_start_note || 'A work app opens from its own link after you deploy it — for the agent owner and invited team members. The chat widget, team chat, Telegram and phone never run this workflow. Keep this as the only Start node.'}</p>
      </div>
    </div>
  )
}
