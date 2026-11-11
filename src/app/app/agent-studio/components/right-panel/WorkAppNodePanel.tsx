'use client'

import React, { useEffect, useState } from 'react'
import type { Node } from 'reactflow'
import { AlertTriangle, Bot, ExternalLink, Info, Link2 } from 'lucide-react'
import { Textarea } from '@/components/ui/textarea'
import { useEdition } from '@/components/EditionProvider'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'
import { DEFAULT_APP_AI, appKeyOf } from '@/lib/work/app-canvas'
import { useWorkflowContext } from '../../contexts/WorkflowContext'
import { AppSettingsFields, type AppTemplateLockView } from './AppStartPanel'
import { WorkAppLines, useSavedTick } from './WorkAppStepPanel'
import { WorkAppHandoffsIn } from './WorkAppHandoffsIn'
import { PanelSection } from './PanelSection'
import { SharedAppChoice } from './WorkAppLinkPanel'
import { isCompanyBookKind } from '@/lib/work/app-template-kinds'
import { handoffNotice, isHandoffTarget, useHandoffReadiness } from './handoff-readiness'

interface Props {
  node: Node
  updateNodeData: (patch: Record<string, any>) => void
}

const MODELS: Array<{ id: string; name: string }> = [
  { id: 'gpt-6-sol', name: 'GPT-6 Sol' },
  { id: 'gpt-6-luna', name: 'GPT-6 Luna' },
]
const MAX_INSTRUCTIONS = 20000

type HiddenApp = { nodeId: string; workflowId: string; status: string; templateLock?: AppTemplateLockView | null }

export const WorkAppNodePanel: React.FC<Props> = ({ node, updateNodeData }) => {
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  const edition = useEdition()
  const { agent, ui, workflow } = useWorkflowContext()
  const saved = useSavedTick(ui.hasChanges)
  const ai = (node.data?.ai && typeof node.data.ai === 'object' ? node.data.ai : {}) as Record<string, unknown>
  const setAi = (patch: Record<string, unknown>) => updateNodeData({ ai: { ...ai, ...patch } })
  const model = typeof ai.model === 'string' && ai.model ? ai.model : DEFAULT_APP_AI.model
  const instructions = typeof ai.systemMessage === 'string' ? ai.systemMessage : DEFAULT_APP_AI.systemMessage
  const imageInput = typeof ai.imageInput === 'boolean' ? ai.imageInput : DEFAULT_APP_AI.imageInput
  const pdfInput = typeof ai.pdfInput === 'boolean' ? ai.pdfInput : DEFAULT_APP_AI.pdfInput

  const [hidden, setHidden] = useState<HiddenApp | null>(null)
  const [lock, setLock] = useState<AppTemplateLockView | null | undefined>(undefined)
  useEffect(() => {
    if (!agent.workflowId) { setLock(null); return }
    setLock(undefined)
    let alive = true
    fetch(`/api/agent-studio/work-app-nodes?workflowId=${encodeURIComponent(agent.workflowId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (!alive) return
        const h = (d?.apps as HiddenApp[] | undefined)?.find((a) => a.nodeId === node.id) ?? null
        setHidden(h)
        setLock(h?.templateLock ?? null)
      })
      .catch(() => { if (alive) { setHidden(null); setLock(undefined) } })
    return () => { alive = false }
  }, [agent.workflowId, agent.workflowStatus, node.id, saved])

  const connectionKey = agent.workflowId ? appKeyOf(agent.workflowId, node.id) : undefined
  const picked = typeof node.data?.appTemplate === 'string' && node.data.appTemplate !== ''
  const hasLines = workflow.edges.some((e) => e.source === node.id || (e.target === node.id && workflow.nodes.find((n) => n.id === e.source)?.data?.nodeType !== 'start'))

  const readiness = useHandoffReadiness(agent.workflowId, agent.workflowStatus, saved)
  const notReady = handoffNotice(node.id, readiness, isHandoffTarget(node.id, workflow.nodes, workflow.edges))
  const notReadyText: Record<string, string> = {
    not_set_up: t.work_app_handoff_not_set_up || "This app can't receive handoffs yet — it is created when the workflow is deployed. Remove the line, deploy, open this app once and apply an app template that takes handoffs, then draw the line again.",
    no_template: t.work_app_handoff_no_template || "Open this app once and apply its app template — until then saving with this line is refused.",
    no_handoff: t.work_app_handoff_no_handoff || "This app's template does not take handoffs. Hand over to an app that receives, or use a send line.",
    no_sheet: t.work_app_handoff_no_sheet || 'This app has no Handoffs sheet — open it and apply its app template again.',
  }

  const labelOf = (id: string) => { const n = workflow.nodes.find((x) => x.id === id); return (typeof n?.data?.label === 'string' && n.data.label) || 'Work app' }
  const reads = workflow.edges.filter((e) => e.sourceHandle === 'ref' && e.target === node.id)
  const sends = workflow.edges.filter((e) => e.sourceHandle === 'send' && e.source === node.id)
  const chip = (key: string, text: string, ok: boolean, color: string) => (
    <span key={key} className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] ${ok ? color : 'border-amber-600/60 text-amber-300'}`}>{text}</span>
  )
  const lineSummary = reads.length + sends.length === 0 ? (
    <span className="text-sm text-gray-400">{t.work_app_lines_none || 'No lines yet — drag from ref / send to another Work app node.'}</span>
  ) : (
    <span className="flex flex-wrap gap-1">
      {reads.map((e) => chip(e.id, `${t.work_app_lines_reads || 'Reads'}: ${labelOf(e.source)}`, Array.isArray(e.data?.sheets) && e.data.sheets.length > 0, 'border-amber-700/60 text-amber-200'))}
      {sends.map((e) => chip(e.id, `${t.work_app_lines_sends || 'Sends to'}: ${labelOf(e.target)}`, typeof e.data?.inboxFamily === 'string' && e.data.inboxFamily.length > 0, 'border-emerald-700/60 text-emerald-300'))}
      {[...reads.filter((e) => !(Array.isArray(e.data?.sheets) && e.data.sheets.length)), ...sends.filter((e) => !e.data?.inboxFamily)].length > 0 && (
        <span className="block w-full text-[11px] text-amber-300">{t.work_app_lines_needs || 'A yellow line needs a choice before you deploy — open Configure.'}</span>
      )}
    </span>
  )
  const open = hidden && hidden.status === 'production' && agent.workflowStatus === 'production' && agent.agentId

  return (
    <div className="space-y-4">
      {notReady && (
        <div className="flex gap-2 rounded-md border border-amber-700/60 bg-amber-950/40 p-3 text-xs text-amber-200">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <p>{notReadyText[notReady] ?? notReadyText.not_set_up}</p>
        </div>
      )}
      <AppSettingsFields node={node} updateNodeData={updateNodeData} connectionKey={connectionKey} canvas lock={lock} />
      {isCompanyBookKind(node.data?.appTemplate) && <SharedAppChoice node={node} hasHiddenApp={!!hidden} t={t} />}

      {!picked && hasLines && (
        <div className="flex gap-2 rounded-md border border-amber-700/60 bg-amber-950/40 p-3 text-xs text-amber-200">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <p>{t.work_app_lines_without_template || 'This app has lines to other apps or next steps. Choose an app template again, or delete those lines on the canvas.'}</p>
        </div>
      )}
      {picked && <>

      <PanelSection
        title={t.work_app_node_ai || 'AI of this work app'}
        icon={<Bot className="w-5 h-5 text-blue-400 shrink-0" />}
        editLabel={t.edit || 'Edit'}
        doneLabel={t.app_uses_done || 'Done'}
        summary={
          <>
            <span className="text-sm font-medium">{edition === 'selfhosted' ? (t.model_installation_ai_connection || 'Installation AI connection') : (MODELS.find((m) => m.id === model)?.name ?? model)}</span>
            <span className="text-xs text-gray-400">
              {[
                instructions === DEFAULT_APP_AI.systemMessage ? (t.work_app_ai_default_instructions || 'default instructions') : (t.work_app_ai_custom_instructions || 'own instructions'),
                imageInput ? (t.work_app_ai_images || 'images') : null,
                pdfInput ? 'PDF' : null,
              ].filter(Boolean).join(' · ')}
            </span>
          </>
        }
      >
        {edition === 'selfhosted' ? (
          <p className="text-xs text-gray-500">{t.model_installation_ai_connection || 'Installation AI connection'}</p>
        ) : (
          <div>
            <label className="text-xs text-gray-400 mb-1 block">{t.model || 'Model'}</label>
            <select
              value={model}
              onChange={(e) => setAi({ model: e.target.value })}
              className="w-full rounded-md border border-[#3A3A3A] bg-[#1F1F1F] px-2 py-1.5 text-sm text-gray-200"
            >
              {MODELS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              {!MODELS.some((m) => m.id === model) && <option value={model}>{model}</option>}
            </select>
          </div>
        )}
        <div>
          <label className="text-xs text-gray-400 mb-1 block">{t.work_app_node_instructions || 'Instructions'}</label>
          <Textarea
            value={instructions}
            maxLength={MAX_INSTRUCTIONS}
            rows={6}
            autoComplete="off"
            onChange={(e) => setAi({ systemMessage: e.target.value })}
          />
          <p className="mt-1 text-xs text-gray-500">{t.work_app_node_instructions_help || 'The server adds the app template guide, the project notes and a sheet summary on every turn.'}</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer select-none">
          <input type="checkbox" checked={imageInput} onChange={(e) => setAi({ imageInput: e.target.checked })} />
          {t.work_app_node_image_input || 'Read images (receipts, photos)'}
        </label>
        <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer select-none">
          <input type="checkbox" checked={pdfInput} onChange={(e) => setAi({ pdfInput: e.target.checked })} />
          {t.work_app_node_pdf_input || 'Read PDF files'}
        </label>
      </PanelSection>

      <PanelSection
        title={t.work_app_lines_title || 'Lines to other work apps'}
        icon={<Link2 className="w-5 h-5 text-teal-400 shrink-0" />}
        editLabel={t.edit || 'Edit'}
        doneLabel={t.app_uses_done || 'Done'}
        summary={lineSummary}
      >
        <div className="flex gap-2 rounded-md border border-[#3A3A3A] bg-[#232323] p-3 text-xs text-gray-400">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <p>{t.work_app_node_note || 'One work app. Draw send / ref lines to another Work app node from the ref / send points (top or bottom); draw the steps after an app event (closed, resubmitted, unlocked, new inbox row) from the points on the right.'}</p>
        </div>
        <WorkAppLines node={node} t={t} />
      </PanelSection>

      <WorkAppHandoffsIn node={node} t={t} />

      {open ? (
        <a
          href={`/chat/${encodeURIComponent(agent.agentId!)}/app?workflowId=${encodeURIComponent(hidden!.workflowId)}${['de', 'fr', 'ko'].includes(lang) ? `&lang=${lang}` : ''}`}
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
      </>}
    </div>
  )
}
