'use client'

import React, { useEffect, useRef, useState } from 'react'
import type { Node } from 'reactflow'
import { Plus, X, Info, AlertCircle } from 'lucide-react'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'
import {
  SUB_WORKFLOW_INPUT_NAME_RE,
  SUB_WORKFLOW_INPUT_TYPES,
  SUB_WORKFLOW_MAX_DESCRIPTION_CHARS,
  SUB_WORKFLOW_MAX_INPUTS,
  SUB_WORKFLOW_TIMEOUT_DEFAULT_S,
  SUB_WORKFLOW_TIMEOUT_MAX_S,
  SUB_WORKFLOW_TIMEOUT_MIN_S,
  SUB_WORKFLOW_TOOL_NAME_RE,
  parseSubWorkflowTimeoutSeconds,
  subWorkflowToolFunctionName,
  type SubWorkflowInputType,
} from '@/lib/workflow/subworkflow'

interface Props {
  node: Node
  updateNodeData: (patch: Record<string, any>) => void
}

interface InputRow {
  name: string
  type: SubWorkflowInputType
  description?: string
  required?: boolean
}

export const SubWorkflowStartPanel: React.FC<Props> = ({ node, updateNodeData }) => {
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)

  const [toolName, setToolName] = useState<string>(node.data?.toolName || '')
  const [toolDescription, setToolDescription] = useState<string>(node.data?.toolDescription || '')
  const [inputs, setInputs] = useState<InputRow[]>(Array.isArray(node.data?.inputs) ? node.data.inputs : [])
  const [timeoutSeconds, setTimeoutSeconds] = useState<string>(() => {
    const raw = node.data?.timeoutSeconds
    return raw === undefined || raw === null ? String(SUB_WORKFLOW_TIMEOUT_DEFAULT_S) : String(raw)
  })

  useEffect(() => {
    setToolName(node.data?.toolName || '')
    setToolDescription(node.data?.toolDescription || '')
    setInputs(Array.isArray(node.data?.inputs) ? node.data.inputs : [])
  }, [node.id, node.data?.toolName, node.data?.toolDescription, node.data?.inputs])

  const editingTimeoutRef = useRef(false)
  const hydrateTimeoutFromNode = () => {
    const raw = node.data?.timeoutSeconds
    setTimeoutSeconds(raw === undefined || raw === null ? String(SUB_WORKFLOW_TIMEOUT_DEFAULT_S) : String(raw))
  }
  useEffect(() => {
    if (editingTimeoutRef.current) return
    hydrateTimeoutFromNode()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id, node.data?.timeoutSeconds])

  const timeoutParsed = parseSubWorkflowTimeoutSeconds(timeoutSeconds)
  const timeoutValid = timeoutParsed.ok
  const timeoutEffective = timeoutParsed.ok ? (timeoutParsed.seconds ?? SUB_WORKFLOW_TIMEOUT_DEFAULT_S) : SUB_WORKFLOW_TIMEOUT_DEFAULT_S

  const trimmedName = toolName.trim()
  const nameValid = SUB_WORKFLOW_TOOL_NAME_RE.test(trimmedName)

  const commitInputs = (next: InputRow[]) => {
    setInputs(next)
    updateNodeData({ inputs: next })
  }

  const inputNameIssue = (row: InputRow, idx: number): string | null => {
    const n = row.name.trim()
    if (!n) return t.subworkflow_input_name_required || 'Name required'
    if (!SUB_WORKFLOW_INPUT_NAME_RE.test(n)) return t.subworkflow_input_name_invalid || 'lowercase letters, digits, underscore'
    if (inputs.some((o, i) => i !== idx && o.name.trim() === n)) return t.subworkflow_input_name_duplicate || 'Duplicate name'
    return null
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2 p-3 bg-pink-500/10 border border-pink-500/30 rounded-lg">
        <Info className="w-4 h-4 text-pink-400 shrink-0 mt-0.5" />
        <p className="text-xs text-pink-200 leading-relaxed">
          {t.subworkflow_start_banner ||
            'This is a Sub-workflow. Other workflows attach it to an AI node as a tool; the AI calls it with the inputs below. Saving takes effect for callers immediately — there is no deploy step. Its End node must set a custom message: that text is what the calling AI receives.'}
        </p>
      </div>

      {/* Tool name */}
      <div className="space-y-2">
        <p className="text-xs text-gray-400">{t.subworkflow_tool_name || 'Tool name'}</p>
        <input
          type="text"
          value={toolName}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            const v = e.target.value
            setToolName(v)
            updateNodeData({ toolName: v })
          }}
          placeholder="add_points"
          className={`w-full px-3 py-2 text-sm font-mono text-gray-100 bg-[#151515] border rounded-lg focus:outline-none ${
            trimmedName && !nameValid ? 'border-red-500/60 focus:border-red-500' : 'border-[#222] focus:border-pink-500'
          }`}
        />
        {trimmedName && !nameValid ? (
          <p className="text-xs text-red-400 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            {t.subworkflow_tool_name_invalid || '2-40 characters: lowercase letters, digits and underscore, starting with a letter'}
          </p>
        ) : (
          <p className="text-xs text-gray-500">
            {t.subworkflow_tool_name_hint || 'The AI sees this function as'}{' '}
            <span className="font-mono text-gray-300">{subWorkflowToolFunctionName(nameValid ? trimmedName : '…')}</span>
          </p>
        )}
      </div>

      {/* Description */}
      <div className="space-y-2">
        <p className="text-xs text-gray-400">{t.subworkflow_tool_description || 'Description (what the AI reads to decide when to call it)'}</p>
        <textarea
          value={toolDescription}
          maxLength={SUB_WORKFLOW_MAX_DESCRIPTION_CHARS}
          onChange={(e) => {
            const v = e.target.value
            setToolDescription(v)
            updateNodeData({ toolDescription: v })
          }}
          placeholder={t.subworkflow_tool_description_placeholder || 'Add game points to a caller after a completed quiz round. Call it once per round with the caller phone number and the points earned.'}
          className="w-full h-24 px-3 py-2 text-sm text-gray-100 bg-[#151515] border border-[#222] rounded-lg resize-none focus:outline-none focus:border-pink-500"
        />
      </div>

      <div className="space-y-2">
        <p className="text-xs text-gray-400">{t.subworkflow_timeout_label || 'Max wait for the calling AI (seconds)'}</p>
        <input
          type="number"
          min={SUB_WORKFLOW_TIMEOUT_MIN_S}
          max={SUB_WORKFLOW_TIMEOUT_MAX_S}
          step={1}
          value={timeoutSeconds}
          autoComplete="off"
          onFocus={() => { editingTimeoutRef.current = true }}
          onBlur={() => {
            editingTimeoutRef.current = false
            hydrateTimeoutFromNode()
          }}
          onChange={(e) => {
            const v = e.target.value
            setTimeoutSeconds(v)
            const p = parseSubWorkflowTimeoutSeconds(v)
            updateNodeData({ timeoutSeconds: p.ok && p.seconds !== null ? p.seconds : undefined })
          }}
          className={`w-32 px-3 py-2 text-sm font-mono text-gray-100 bg-[#151515] border rounded-lg focus:outline-none ${
            timeoutValid ? 'border-[#222] focus:border-pink-500' : 'border-red-500/60 focus:border-red-500'
          }`}
        />
        {!timeoutValid ? (
          <p className="text-xs text-red-400 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            {(t.subworkflow_timeout_invalid || `${SUB_WORKFLOW_TIMEOUT_MIN_S}–${SUB_WORKFLOW_TIMEOUT_MAX_S} seconds. Out of range falls back to the default (${SUB_WORKFLOW_TIMEOUT_DEFAULT_S}s).`)}
          </p>
        ) : (
          <p className="text-xs text-gray-500">
            {t.subworkflow_timeout_hint || `Default ${SUB_WORKFLOW_TIMEOUT_DEFAULT_S}s. If the Sub-workflow is not finished in time, the AI gets "timed out — may still complete" and the run keeps going in the background (its actions still happen).`}
          </p>
        )}
        {timeoutValid && timeoutEffective > SUB_WORKFLOW_TIMEOUT_DEFAULT_S && (
          <p className="text-xs text-amber-400 flex items-start gap-1">
            <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
            {t.subworkflow_timeout_voice_warning || 'On a phone or voice call the caller hears silence for this long while the AI waits. Keep it as short as the work allows.'}
          </p>
        )}
      </div>

      {/* Inputs */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-400">{t.subworkflow_inputs || 'Inputs (function parameters)'}</p>
          <span className="text-xs text-gray-500">{inputs.length}/{SUB_WORKFLOW_MAX_INPUTS}</span>
        </div>
        <div className="space-y-2">
          {inputs.map((row, idx) => {
            const issue = inputNameIssue(row, idx)
            return (
              <div key={idx} className="p-2 bg-[#151515] border border-[#222] rounded-lg space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={row.name}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="phone"
                    onChange={(e) => commitInputs(inputs.map((r, i) => (i === idx ? { ...r, name: e.target.value } : r)))}
                    className={`flex-1 min-w-0 px-2 py-1.5 text-sm font-mono text-gray-100 bg-[#1f1f1f] border rounded focus:outline-none ${
                      issue ? 'border-red-500/60' : 'border-[#2a2a2a] focus:border-pink-500'
                    }`}
                  />
                  <select
                    value={row.type}
                    onChange={(e) => commitInputs(inputs.map((r, i) => (i === idx ? { ...r, type: e.target.value as SubWorkflowInputType } : r)))}
                    className="px-2 py-1.5 text-sm text-gray-100 bg-[#1f1f1f] border border-[#2a2a2a] rounded focus:outline-none focus:border-pink-500"
                  >
                    {SUB_WORKFLOW_INPUT_TYPES.map((ty) => (
                      <option key={ty} value={ty}>{ty}</option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1 text-xs text-gray-400 whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={row.required === true}
                      onChange={(e) => commitInputs(inputs.map((r, i) => (i === idx ? { ...r, required: e.target.checked } : r)))}
                      className="accent-pink-500"
                    />
                    {t.subworkflow_input_required || 'required'}
                  </label>
                  <button
                    type="button"
                    onClick={() => commitInputs(inputs.filter((_, i) => i !== idx))}
                    className="p-1 text-gray-500 hover:text-red-400"
                    aria-label={t.subworkflow_remove_input || 'Remove input'}
                    title={t.subworkflow_remove_input || 'Remove input'}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <input
                  type="text"
                  value={row.description || ''}
                  autoComplete="off"
                  placeholder={t.subworkflow_input_description_placeholder || 'Description for the AI (optional)'}
                  onChange={(e) => commitInputs(inputs.map((r, i) => (i === idx ? { ...r, description: e.target.value } : r)))}
                  className="w-full px-2 py-1.5 text-xs text-gray-200 bg-[#1f1f1f] border border-[#2a2a2a] rounded focus:outline-none focus:border-pink-500"
                />
                {issue && (
                  <p className="text-xs text-red-400 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{issue}</p>
                )}
                {!issue && row.name.trim() && (
                  <p className="text-xs text-gray-500">
                    {t.subworkflow_input_template_hint || 'Read it in nodes as'}{' '}
                    <span className="font-mono text-gray-300">{`{{context.input.${row.name.trim()}}}`}</span>
                  </p>
                )}
              </div>
            )
          })}
          {inputs.length < SUB_WORKFLOW_MAX_INPUTS && (
            <button
              type="button"
              onClick={() => commitInputs([...inputs, { name: '', type: 'string', required: true }])}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border-2 border-dashed border-[#3A3A3A] text-gray-400 hover:border-gray-500 hover:text-gray-300 transition-colors text-sm"
            >
              <Plus className="w-4 h-4" />
              {t.subworkflow_add_input || 'Add input'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
