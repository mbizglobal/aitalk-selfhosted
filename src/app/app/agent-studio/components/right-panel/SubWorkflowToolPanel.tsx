'use client'

import React, { useEffect, useState } from 'react'
import type { Node } from 'reactflow'
import { AlertCircle, ExternalLink, Info, Loader2 } from 'lucide-react'
import { useWorkflowContext } from '../../contexts/WorkflowContext'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'
import { readSubWorkflowDefinition, subWorkflowToolFunctionName, type SubWorkflowDefinition } from '@/lib/workflow/subworkflow'

interface Props {
  node: Node
  updateNodeData: (patch: Record<string, any>) => void
}

interface SubWorkflowSummary {
  workflowId: string
  name: string
  status: string
  kind?: string
}

export const SubWorkflowToolPanel: React.FC<Props> = ({ node, updateNodeData }) => {
  const { agent } = useWorkflowContext()
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)

  const subWorkflowId: string = node.data?.subWorkflowId || ''

  const [subs, setSubs] = useState<SubWorkflowSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [def, setDef] = useState<SubWorkflowDefinition | null>(null)
  const [defError, setDefError] = useState<string | null>(null)

  useEffect(() => {
    if (!agent.agentId) return
    let cancelled = false
    setLoading(true)
    setLoadError(false)
    fetch(`/api/agents/${agent.agentId}/workflows`)
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status))
        const data = await res.json()
        const list: SubWorkflowSummary[] = (data.workflows || []).filter(
          (w: SubWorkflowSummary) => w.kind === 'sub' && w.status !== 'archived',
        )
        if (!cancelled) setSubs(list)
      })
      .catch(() => { if (!cancelled) setLoadError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [agent.agentId])

  useEffect(() => {
    setDef(null); setDefError(null)
    if (!subWorkflowId) return
    let cancelled = false
    fetch(`/api/workflows/${subWorkflowId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status))
        const data = await res.json()
        const r = readSubWorkflowDefinition(data?.workflow?.workflowJson)
        if (cancelled) return
        if (r.ok) { setDef(r.def); setDefError(null) }
        else { setDef(null); setDefError(r.error) }
      })
      .catch(() => { if (!cancelled) { setDef(null); setDefError(t.subworkflow_tool_load_failed || 'Could not load the Sub-workflow') } })
    return () => { cancelled = true }
  }, [subWorkflowId, t.subworkflow_tool_load_failed])

  const selectedMissing = !!subWorkflowId && !loading && !subs.some((s) => s.workflowId === subWorkflowId)

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 p-3 bg-pink-500/10 border border-pink-500/30 rounded-lg">
        <Info className="w-4 h-4 text-pink-400 shrink-0 mt-0.5" />
        <p className="text-xs text-pink-200 leading-relaxed">
          {t.subworkflow_tool_banner ||
            'The AI calls the selected Sub-workflow as a function. Its name, description and parameters come from that Sub-workflow\'s Start node. Sub-workflows are called by reference — saving one changes what this tool does immediately.'}
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-xs text-gray-400">{t.subworkflow_select || 'Sub-workflow'}</p>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="w-4 h-4 animate-spin" />{t.loading || 'Loading…'}</div>
        ) : loadError ? (
          <p className="text-xs text-red-400 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{t.subworkflow_tool_load_failed || 'Could not load the Sub-workflow list'}</p>
        ) : (
          <select
            value={subWorkflowId}
            aria-label={t.subworkflow_select || 'Sub-workflow'}
            onChange={(e) => {
              const id = e.target.value
              const picked = subs.find((s) => s.workflowId === id)
              updateNodeData({ subWorkflowId: id, label: picked ? picked.name : (t.toolsSubworkflow || 'Sub-workflow') })
            }}
            className="w-full px-3 py-2 text-sm text-gray-100 bg-[#151515] border border-[#222] rounded-lg focus:outline-none focus:border-pink-500"
          >
            <option value="">{t.subworkflow_select_placeholder || '— select a Sub-workflow —'}</option>
            {subs.map((s) => (
              <option key={s.workflowId} value={s.workflowId}>{s.name}</option>
            ))}
            {selectedMissing && <option value={subWorkflowId}>{subWorkflowId} ({t.subworkflow_missing || 'not found / archived'})</option>}
          </select>
        )}
        {!loading && !loadError && subs.length === 0 && (
          <p className="text-xs text-amber-400 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            {t.subworkflow_none || 'No Sub-workflow in this agent yet. Create one from the workflow list (New → Sub-workflow).'}
          </p>
        )}
        {selectedMissing && (
          <p className="text-xs text-red-400 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            {t.subworkflow_missing_hint || 'The referenced Sub-workflow is missing or archived — the tool will not load at run time.'}
          </p>
        )}
      </div>

      {subWorkflowId && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400">{t.subworkflow_definition || 'What the AI sees'}</p>
            <a
              href={`/app/agent-studio?workflowId=${encodeURIComponent(subWorkflowId)}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-pink-300 hover:text-pink-200 flex items-center gap-1"
            >
              {t.subworkflow_open || 'Open Sub-workflow'} <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          {defError ? (
            <p className="text-xs text-red-400 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{defError}</p>
          ) : def ? (
            <div className="p-3 bg-[#151515] border border-[#222] rounded-lg space-y-2">
              <p className="text-sm font-mono text-gray-100">{subWorkflowToolFunctionName(def.toolName)}</p>
              <p className="text-xs text-gray-400 whitespace-pre-wrap">{def.toolDescription}</p>
              {def.inputs.length > 0 ? (
                <ul className="space-y-1">
                  {def.inputs.map((i) => (
                    <li key={i.name} className="text-xs text-gray-300">
                      <span className="font-mono">{i.name}</span>
                      <span className="text-gray-500"> : {i.type}{i.required ? ' · required' : ''}</span>
                      {i.description && <span className="text-gray-500"> — {i.description}</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-gray-500">{t.subworkflow_no_inputs || 'No inputs'}</p>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="w-4 h-4 animate-spin" />{t.loading || 'Loading…'}</div>
          )}
        </div>
      )}
    </div>
  )
}
