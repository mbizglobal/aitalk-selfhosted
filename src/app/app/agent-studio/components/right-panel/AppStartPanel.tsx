'use client'

import React from 'react'
import type { Node } from 'reactflow'
import { Check, Clock, ExternalLink, Info } from 'lucide-react'
import { Textarea } from '@/components/ui/textarea'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'
import { APP_TEMPLATE_KINDS, isAppTemplateKind } from '@/lib/work/app-template-kinds'
import { parseWorkLang, workKindLabel } from '@/lib/translations/work'
import { APP_TEMPLATE_FEATURES, featureLabel } from '@/lib/work/app-template-features'
import { useWorkflowContext } from '../../contexts/WorkflowContext'

interface Props {
  node: Node
  updateNodeData: (patch: Record<string, any>) => void
}

const MAX_WELCOME = 1000

export const AppStartPanel: React.FC<Props> = ({ node, updateNodeData }) => {
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  const { agent } = useWorkflowContext()
  const appTemplate: string = typeof node.data?.appTemplate === 'string' ? node.data.appTemplate : ''
  const welcome: string = typeof node.data?.appWelcomeMessage === 'string' ? node.data.appWelcomeMessage : ''
  const choices = ['', ...APP_TEMPLATE_KINDS]

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium text-gray-200 mb-2 block">{t.app_template_label || 'App template'}</label>
        <div className="grid grid-cols-1 gap-2">
          {choices.map((k) => (
            <button
              key={k || 'choose'}
              type="button"
              onClick={() => updateNodeData({ appTemplate: k || undefined })}
              className={`px-3 py-2 text-sm text-left rounded-md border transition-colors ${appTemplate === k
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-[#3A3A3A] text-gray-300 hover:border-gray-500'
              }`}
            >
              {k ? (t[`app_template_${k}`] || workKindLabel(parseWorkLang(lang), k)) : (t.app_template_choose || 'Choose in the first chat')}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-gray-500">{t.app_template_help || 'Fix an app template, or leave it open — the user then picks one (or builds a new structure) in the first chat.'}</p>
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

      <div>
        <label className="text-sm font-medium text-gray-200 mb-2 block">{t.app_welcome_label || 'Welcome message'}</label>
        <Textarea
          value={welcome}
          maxLength={MAX_WELCOME}
          rows={3}
          autoComplete="off"
          placeholder={t.app_welcome_placeholder || 'Shown when the work app opens'}
          onChange={(e) => updateNodeData({ appWelcomeMessage: e.target.value || undefined })}
        />
      </div>

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
