'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { X, Info, ChevronDown, GripHorizontal, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWorkflowContext } from '../contexts/WorkflowContext'
import { getAvailableContextFields } from '../utils/nodeUtils'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'
import { useDraggable } from '../hooks/useDraggable'
import { SUB_WORKFLOW_TIMEOUT_DEFAULT_S, subWorkflowTimeoutSecondsOf } from '@/lib/workflow/subworkflow'

export function WhileModal() {
  const { ui, workflow, nodeHandlers, reloadWorkflow, agent } = useWorkflowContext()
  const isSubWorkflow = agent.workflowKind === 'sub'
  const subTimeoutSeconds = useMemo(() => {
    if (!isSubWorkflow) return SUB_WORKFLOW_TIMEOUT_DEFAULT_S
    const start = workflow.nodes.find((n: any) => n.data?.nodeType === 'start' && n.data?.triggerType === 'subworkflow')
    return subWorkflowTimeoutSecondsOf(start?.data)
  }, [isSubWorkflow, workflow.nodes])
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)

  const whileNode = React.useMemo(
    () => workflow.nodes.find(node => node.id === workflow.selectedNode && node.type === 'while'),
    [workflow.nodes, workflow.selectedNode]
  )

  // Local state
  const [maxIterations, setMaxIterations] = useState(10)
  const [conditionField, setConditionField] = useState('jsonData.needsRetry')
  const [conditionOperator, setConditionOperator] = useState<'==' | '!=' | '>' | '<' | '>=' | '<='>('==')
  const [conditionValue, setConditionValue] = useState<string>('true')
  const [conditionType, setConditionType] = useState<'boolean' | 'number' | 'string'>('boolean')
  const [showFieldDropdown, setShowFieldDropdown] = useState(false)

  const availableFields = useMemo(() => {
    if (!whileNode) return []
    return getAvailableContextFields(workflow.nodes, workflow.edges, whileNode.id)
  }, [workflow.nodes, workflow.edges, whileNode])

  // Sync with node data
  useEffect(() => {
    if (!ui.showWhileModal || !whileNode) return

    const nodeData = whileNode.data
    setMaxIterations(nodeData.maxIterations || 10)
    setConditionField(nodeData.conditionField || 'needsRetry')
    setConditionOperator(nodeData.conditionOperator || '==')

    const value = nodeData.conditionValue
    if (typeof value === 'boolean') {
      setConditionType('boolean')
      setConditionValue(value.toString())
    } else if (typeof value === 'number') {
      setConditionType('number')
      setConditionValue(value.toString())
    } else {
      setConditionType('string')
      setConditionValue(value || '')
    }
  }, [ui.showWhileModal, whileNode])

  const handleSave = () => {
    if (!whileNode) return

    let finalValue: any
    if (conditionType === 'boolean') {
      finalValue = conditionValue === 'true'
    } else if (conditionType === 'number') {
      finalValue = parseFloat(conditionValue) || 0
    } else {
      finalValue = conditionValue
    }

    nodeHandlers.updateNodeData(whileNode.id, {
      maxIterations,
      conditionField,
      conditionOperator,
      conditionValue: finalValue
    })

    ui.setShowWhileModal(false)
  }

  const { handleDragStart, dragStyle } = useDraggable({ isOpen: ui.showWhileModal })

  if (!ui.showWhileModal || !whileNode) return null

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
    >
      <div
        className="bg-[#2A2A2A] rounded-lg shadow-2xl border border-[#3A3A3A] max-w-2xl w-full max-h-[85vh] flex flex-col"
        style={dragStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="p-6 border-b border-[#3A3A3A] flex items-center justify-between cursor-move select-none"
          onMouseDown={handleDragStart}
        >
          <div className="flex items-center gap-3">
            <GripHorizontal className="w-5 h-5 text-gray-500" />
            <div>
              <h2 className="text-lg font-semibold text-gray-200">{t.node_while}</h2>
              <p className="text-sm text-gray-400 mt-1">{t.while_desc}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                if (ui.hasChanges && !window.confirm(t.reload_discard_confirm || t.unsaved_changes_confirm)) return
                await reloadWorkflow()
              }}
              className="p-1.5 rounded transition-colors text-gray-400 hover:text-gray-200"
              title={t.reload_workflow || 'Reload from server'}
            >
              <RefreshCw className="w-5 h-5" />
            </button>
            <button
              onClick={() => ui.setShowWhileModal(false)}
              className="text-gray-400 hover:text-gray-200 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto scrollbar-thin p-6 space-y-6">
          {/* Max Iterations */}
          <div>
            <label className="block text-sm font-medium text-gray-200 mb-2">
              {t.maximum_iterations}
            </label>
            <input
              type="number"
              min="1"
              max="100"
              value={maxIterations}
              onChange={(e) => setMaxIterations(parseInt(e.target.value) || 10)}
              className="w-full px-3 py-2 bg-[#1A1A1A] border border-[#3A3A3A] rounded-lg text-gray-200 focus:outline-none focus:border-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              {t.max_iterations_help}
            </p>
            {isSubWorkflow && (
              <p className="text-xs text-amber-400 mt-2 flex items-start gap-1.5">
                <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>
                  {(t.while_sub_timeout_notice || 'This Sub-workflow must finish within {seconds}s (the calling AI\'s max wait — set on the Start / Sub-workflow node). If a loop that sends e-mails or SMS runs longer, the AI gets "timed out" while the loop keeps going, and it may call again — messages can be sent twice. Keep the iteration count small.').replace('{seconds}', String(subTimeoutSeconds))}
                </span>
              </p>
            )}
          </div>

          {/* Loop Condition */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <label className="block text-sm font-medium text-gray-200">
                {t.loop_condition}
              </label>
              <div className="group relative">
                <Info className="w-4 h-4 text-gray-500 cursor-help" />
                <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block w-64 p-2 bg-gray-800 text-xs text-gray-300 rounded shadow-lg z-10">
                  {t.loop_condition_tooltip}
                </div>
              </div>
            </div>

            {/* Condition Field */}
            <div className="relative">
              <label className="block text-xs text-gray-400 mb-1">{t.context_field}</label>
              <div className="relative">
                <input
                  type="text"
                  value={conditionField}
                  onChange={(e) => setConditionField(e.target.value)}
                  onFocus={() => setShowFieldDropdown(true)}
                  onBlur={() => setTimeout(() => setShowFieldDropdown(false), 200)}
                  placeholder="e.g., jsonData.needsRetry, jsonData.score"
                  className="w-full px-3 py-2 pr-8 bg-[#1A1A1A] border border-[#3A3A3A] rounded-lg text-gray-200 font-mono text-sm focus:outline-none focus:border-blue-500"
                />
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
              </div>

              {showFieldDropdown && availableFields.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-[#1A1A1A] border border-[#3A3A3A] rounded-lg shadow-lg max-h-48 overflow-y-auto scrollbar-thin">
                  {availableFields.map((field, idx) => (
                    <div
                      key={`${field.source}-${field.name}-${idx}`}
                      onClick={() => {
                        setConditionField(field.name)
                        if (field.type === 'boolean') {
                          setConditionType('boolean')
                          setConditionValue('true')
                        } else if (field.type === 'number' || field.type === 'integer') {
                          setConditionType('number')
                          setConditionValue('0')
                        } else {
                          setConditionType('string')
                          setConditionValue('')
                        }
                        setShowFieldDropdown(false)
                      }}
                      className="px-3 py-2 hover:bg-[#2A2A2A] cursor-pointer transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-200 font-mono">{field.name}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500">{field.type}</span>
                          <span className="text-xs text-blue-400">{field.source}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {availableFields.length === 0 && (
                <p className="text-xs text-amber-500 mt-1">
                  💡 {t.add_ai_while_hint}
                </p>
              )}
            </div>

            {/* Operator */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">{t.operator}</label>
              <select
                value={conditionOperator}
                onChange={(e) => setConditionOperator(e.target.value as any)}
                className="w-full px-3 py-2 bg-[#1A1A1A] border border-[#3A3A3A] rounded-lg text-gray-200 focus:outline-none focus:border-blue-500"
              >
                <option value="==">== ({t.equals})</option>
                <option value="!=">!= ({t.not_equals})</option>
                <option value=">">{'>'} ({t.greater_than})</option>
                <option value="<">{'<'} ({t.less_than})</option>
                <option value=">=">{'>='} ({t.greater_or_equal})</option>
                <option value="<=">{'<='} ({t.less_or_equal})</option>
              </select>
            </div>

            {/* Value Type */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">{t.value_type}</label>
              <select
                value={conditionType}
                onChange={(e) => {
                  const newType = e.target.value as any
                  setConditionType(newType)
                  if (newType === 'boolean') setConditionValue('true')
                  else if (newType === 'number') setConditionValue('0')
                  else setConditionValue('')
                }}
                className="w-full px-3 py-2 bg-[#1A1A1A] border border-[#3A3A3A] rounded-lg text-gray-200 focus:outline-none focus:border-blue-500"
              >
                <option value="boolean">{t.boolean}</option>
                <option value="number">{t.number}</option>
                <option value="string">{t.string}</option>
              </select>
            </div>

            {/* Value */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">{t.value}</label>
              {conditionType === 'boolean' ? (
                <select
                  value={conditionValue}
                  onChange={(e) => setConditionValue(e.target.value)}
                  className="w-full px-3 py-2 bg-[#1A1A1A] border border-[#3A3A3A] rounded-lg text-gray-200 focus:outline-none focus:border-blue-500"
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : conditionType === 'number' ? (
                <input
                  type="number"
                  value={conditionValue}
                  onChange={(e) => setConditionValue(e.target.value)}
                  className="w-full px-3 py-2 bg-[#1A1A1A] border border-[#3A3A3A] rounded-lg text-gray-200 font-mono text-sm focus:outline-none focus:border-blue-500"
                />
              ) : (
                <input
                  type="text"
                  value={conditionValue}
                  onChange={(e) => setConditionValue(e.target.value)}
                  placeholder={t.enter_string_value}
                  className="w-full px-3 py-2 bg-[#1A1A1A] border border-[#3A3A3A] rounded-lg text-gray-200 font-mono text-sm focus:outline-none focus:border-blue-500"
                />
              )}
            </div>

            {/* Preview */}
            <div className="p-3 bg-[#1A1A1A] rounded-lg border border-[#3A3A3A]">
              <div className="text-xs text-gray-400 mb-1">{t.condition_preview}:</div>
              <div className="text-sm text-gray-200 font-mono">
                {conditionField} {conditionOperator}{' '}
                {conditionType === 'string' ? `"${conditionValue}"` : conditionValue}
              </div>
            </div>
          </div>

          {/* Common Examples */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-200">💡 {t.common_patterns}</label>
            <div className="space-y-1 text-xs">
              <button
                onClick={() => {
                  setConditionField('jsonData.needsRetry')
                  setConditionOperator('==')
                  setConditionType('boolean')
                  setConditionValue('true')
                }}
                className="block w-full text-left px-3 py-2 bg-[#1A1A1A] hover:bg-[#3A3A3A] rounded text-gray-300 transition-colors"
              >
                <span className="font-mono">jsonData.needsRetry == true</span> - {t.retry_logic}
              </button>
              <button
                onClick={() => {
                  setConditionField('jsonData.score')
                  setConditionOperator('<')
                  setConditionType('number')
                  setConditionValue('85')
                }}
                className="block w-full text-left px-3 py-2 bg-[#1A1A1A] hover:bg-[#3A3A3A] rounded text-gray-300 transition-colors"
              >
                <span className="font-mono">jsonData.score {'<'} 85</span> - {t.quality_check}
              </button>
              <button
                onClick={() => {
                  setConditionField('jsonData.isApproved')
                  setConditionOperator('==')
                  setConditionType('boolean')
                  setConditionValue('false')
                }}
                className="block w-full text-left px-3 py-2 bg-[#1A1A1A] hover:bg-[#3A3A3A] rounded text-gray-300 transition-colors"
              >
                <span className="font-mono">jsonData.isApproved == false</span> - {t.approval_waiting}
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-[#3A3A3A] flex justify-end gap-3">
          <Button
            variant="outline"
            onClick={() => ui.setShowWhileModal(false)}
            className="bg-transparent border-[#3A3A3A] text-gray-300 hover:bg-[#3A3A3A]"
          >
            {t.cancel}
          </Button>
          <Button
            onClick={handleSave}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            {t.save}
          </Button>
        </div>
      </div>
    </div>
  )
}
