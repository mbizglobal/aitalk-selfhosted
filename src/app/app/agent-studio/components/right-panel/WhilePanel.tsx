'use client'

import React, { useState, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { Node } from 'reactflow'
import { Info, Bot, Zap, ChevronDown, Maximize2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWorkflowContext } from '../../contexts/WorkflowContext'
import { getAvailableContextFields } from '../../utils/nodeUtils'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'
import { SUB_WORKFLOW_TIMEOUT_DEFAULT_S, subWorkflowTimeoutSecondsOf } from '@/lib/workflow/subworkflow'

interface Props {
  node: Node
  updateNodeData: (patch: Record<string, any>) => void
}

export const WhilePanel: React.FC<Props> = ({ node, updateNodeData }) => {
  const { workflow, ui, agent } = useWorkflowContext()
  const isSubWorkflow = agent.workflowKind === 'sub'
  const subTimeoutSeconds = useMemo(() => {
    if (!isSubWorkflow) return SUB_WORKFLOW_TIMEOUT_DEFAULT_S
    const start = workflow.nodes.find((n: any) => n.data?.nodeType === 'start' && n.data?.triggerType === 'subworkflow')
    return subWorkflowTimeoutSecondsOf(start?.data)
  }, [isSubWorkflow, workflow.nodes])
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)

  // Loop Mode: 'while' | 'forEach'
  const loopMode = node.data.loopMode || 'while'

  const maxIterations = node.data.maxIterations || 10
  const conditionMode = node.data.conditionMode || 'simple' // 'simple' | 'builder' | 'advanced'
  const conditionField = node.data.conditionField || ''
  const conditionOperator = node.data.conditionOperator || '=='
  const conditionValue = node.data.conditionValue !== undefined ? node.data.conditionValue : ''
  const customExpression = node.data.customExpression || ''

  const forEachSource = node.data.forEachSource || ''
  const forEachItemVar = node.data.forEachItemVar || 'currentItem'

  const conditionLogic = node.data.conditionLogic || 'all' // 'all' (AND) | 'any' (OR)
  const conditions = node.data.conditions || node.data.builderConditions || []

  const [showFieldDropdown, setShowFieldDropdown] = useState(false)
  const [showExpressionModal, setShowExpressionModal] = useState(false)
  const [tempExpression, setTempExpression] = useState('')
  const [showSourceDropdown, setShowSourceDropdown] = useState(false)
  const conditionFieldRef = useRef<HTMLInputElement>(null)

  const availableFields = useMemo(() => {
    return getAvailableContextFields(workflow.nodes, workflow.edges, node.id)
  }, [workflow.nodes, workflow.edges, node.id])

  const availableArraySources = useMemo(() => {
    const sources: Array<{ path: string; description: string; source: string }> = []

    const hasImapNode = workflow.nodes.some(n =>
      n.data?.nodeType === 'imap' || n.data?.label === 'IMAP'
    )
    if (hasImapNode) {
      sources.push({
        path: 'imapResult.emails',
        description: t.foreach_imap_emails || 'Emails from IMAP',
        source: 'IMAP'
      })
    }

    const hasDataSheetsNode = workflow.nodes.some(n =>
      n.data?.nodeType === 'dataSheets' || n.data?.label === 'Data Sheets'
    )
    if (hasDataSheetsNode) {
      sources.push({
        path: 'queryResult.rows',
        description: t.foreach_datasheet_rows || 'Rows from Data Sheets',
        source: 'Data Sheets'
      })
    }

    const hasJsonOutput = workflow.nodes.some(n =>
      n.data?.outputFormat === 'json'
    )
    if (hasJsonOutput) {
      sources.push({
        path: 'jsonData.items',
        description: t.foreach_json_items || 'Items from JSON output',
        source: 'AI (JSON)'
      })
    }

    return sources
  }, [workflow.nodes, t])

  const connectedToolNodes = workflow.edges
    .filter(edge => edge.source === node.id && edge.sourceHandle === 'loop')
    .map(edge => workflow.nodes.find(n => n.id === edge.target))
    .filter((n): n is Node => n !== undefined)

  const conditionType = typeof conditionValue === 'boolean' ? 'boolean'
    : typeof conditionValue === 'number' ? 'number'
    : 'string'

  const handleTypeChange = (newType: string) => {
    let defaultValue: any
    if (newType === 'boolean') defaultValue = true
    else if (newType === 'number') defaultValue = 0
    else defaultValue = ''

    updateNodeData({ conditionValue: defaultValue })
  }

  const handleValueChange = (value: string) => {
    let finalValue: any
    if (conditionType === 'boolean') {
      finalValue = value === 'true'
    } else if (conditionType === 'number') {
      finalValue = value === '' ? '' : parseFloat(value)
      if (isNaN(finalValue)) finalValue = ''
    } else {
      finalValue = value
    }
    updateNodeData({ conditionValue: finalValue })
  }

  const handleModeChange = (newMode: 'simple' | 'builder' | 'advanced') => {
    const currentMode = conditionMode
    if (currentMode === newMode) return

    const patch: Record<string, any> = { conditionMode: newMode }

    if (currentMode === 'simple' && newMode === 'builder') {
      if (conditionField) {
        const selectedField = availableFields.find(f => f.name === conditionField)
        patch.conditions = [{
          field: conditionField,
          source: selectedField?.source || '',
          type: conditionType,
          operator: conditionOperator,
          value: conditionValue
        }]
        patch.conditionLogic = 'all'
      }
    }

    if (currentMode === 'simple' && newMode === 'advanced') {
      if (conditionField) {
        const valueStr = conditionType === 'string'
          ? `"${conditionValue}"`
          : String(conditionValue)
        patch.customExpression = `${conditionField} ${conditionOperator} ${valueStr}`
      }
    }

    if (currentMode === 'builder' && newMode === 'advanced') {
      if (conditions.length > 0) {
        const logic = conditionLogic === 'any' ? ' || ' : ' && '
        const expression = conditions.map((c: any) => {
          const valueStr = c.type === 'string' ? `"${c.value}"` : String(c.value)
          return `${c.field} ${c.operator} ${valueStr}`
        }).join(logic)
        patch.customExpression = expression
      }
    }

    if (currentMode === 'builder' && newMode === 'simple') {
      if (conditions.length > 0) {
        const firstCond = conditions[0]
        patch.conditionField = firstCond.field || ''
        patch.conditionOperator = firstCond.operator || '=='
        patch.conditionValue = firstCond.value !== undefined ? firstCond.value : ''
      }
    }

    if (currentMode === 'advanced' && newMode === 'simple') {
      if (!conditionField) {
        patch.conditionField = ''
      }
      patch.conditionOperator = conditionOperator || '=='
    }

    if (currentMode === 'advanced' && newMode === 'builder') {
      if (!conditions || conditions.length === 0) {
        patch.conditions = []
        patch.conditionLogic = 'all'
      }
    }

    updateNodeData(patch)
  }

  const conditionPreview = useMemo(() => {
    if (conditionMode === 'advanced') {
      return customExpression || t.empty_expression
    } else if (conditionMode === 'builder') {
      if (conditions.length === 0) return t.no_conditions
      const logic = conditionLogic === 'all' ? '&&' : '||'
      return conditions
        .map((c: any) => {
          const valueStr = typeof c.value === 'string' ? `"${c.value}"` : c.value
          return `${c.field} ${c.operator} ${valueStr}`
        })
        .join(` ${logic} `)
    } else {
      // simple mode
      if (!conditionField) return t.no_condition_set
      return `${conditionField} ${conditionOperator} ${
        conditionType === 'string' ? `"${conditionValue}"` : conditionValue
      }`
    }
  }, [conditionMode, customExpression, conditionLogic, conditions, conditionField, conditionOperator, conditionValue, conditionType, t])

  return (
    <div className="space-y-4">
      {/* Loop Mode Toggle */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-sm font-medium text-gray-200">{t.loop_mode || 'Loop Mode'}</label>
        </div>
        <div className="flex gap-0.5 bg-[#1A1A1A] rounded-lg p-0.5 border border-[#3A3A3A]">
          <button
            onClick={() => updateNodeData({ loopMode: 'while' })}
            className={`flex-1 px-3 py-2 text-sm rounded transition-colors ${
              loopMode === 'while'
                ? 'bg-blue-500 text-white'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            While
          </button>
          <button
            onClick={() => updateNodeData({ loopMode: 'forEach' })}
            className={`flex-1 px-3 py-2 text-sm rounded transition-colors ${
              loopMode === 'forEach'
                ? 'bg-blue-500 text-white'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            ForEach
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          {loopMode === 'while'
            ? (t.while_mode_desc || 'Loop while condition is true')
            : (t.foreach_mode_desc || 'Loop over each item in an array')}
        </p>
      </div>

      {/* ForEach Mode Settings */}
      {loopMode === 'forEach' && (
        <div className="space-y-3 pt-2 border-t border-[#3A3A3A]">
          {/* Source Array */}
          <div className="relative">
            <label className="block text-sm font-medium text-gray-200 mb-1.5">
              {t.foreach_source || 'Source Array'}
            </label>
            <div className="relative">
              <input
                type="text"
                value={forEachSource}
                onChange={(e) => updateNodeData({ forEachSource: e.target.value })}
                onFocus={() => setShowSourceDropdown(true)}
                onBlur={() => setTimeout(() => setShowSourceDropdown(false), 200)}
                placeholder="e.g., imapResult.emails"
                className="w-full px-3 py-2 pr-8 bg-[#1A1A1A] border border-[#3A3A3A] rounded-lg text-gray-200 font-mono text-sm focus:outline-none focus:border-blue-500"
              />
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setShowSourceDropdown(!showSourceDropdown)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-[#3A3A3A] rounded transition-colors"
              >
                <ChevronDown className="w-4 h-4 text-gray-500" />
              </button>
            </div>

            {/* Source Dropdown */}
            {showSourceDropdown && (
              <div className="absolute z-20 w-full mt-1 bg-[#1A1A1A] border border-[#3A3A3A] rounded-lg shadow-lg max-h-60 overflow-y-auto">
                {availableArraySources.length === 0 ? (
                  <div className="px-3 py-2.5 text-sm text-gray-500">
                    {t.no_array_sources || 'No array sources available. Add IMAP, Data Sheets, or AI (JSON) nodes first.'}
                  </div>
                ) : (
                  availableArraySources.map((source, idx) => (
                    <div
                      key={idx}
                      onClick={() => {
                        updateNodeData({ forEachSource: source.path })
                        if (source.path === 'imapResult.emails') {
                          updateNodeData({ forEachSource: source.path, forEachItemVar: 'currentEmail' })
                        } else if (source.path === 'queryResult.rows') {
                          updateNodeData({ forEachSource: source.path, forEachItemVar: 'currentRow' })
                        } else if (source.path === 'jsonData.items') {
                          updateNodeData({ forEachSource: source.path, forEachItemVar: 'currentItem' })
                        }
                        setShowSourceDropdown(false)
                      }}
                      className="px-3 py-2.5 hover:bg-[#2A2A2A] cursor-pointer transition-colors border-b border-[#2A2A2A] last:border-b-0"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-gray-200 font-mono truncate">{source.path}</div>
                          <div className="text-xs text-gray-500 mt-0.5">{source.description}</div>
                        </div>
                        <div className="flex-shrink-0">
                          <span className="text-xs px-1.5 py-0.5 bg-blue-500/20 rounded text-blue-400">
                            {source.source}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
                {/* Custom input option */}
                <div
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setShowSourceDropdown(false)}
                  className="px-3 py-2.5 hover:bg-[#2A2A2A] cursor-pointer transition-colors border-t border-[#3A3A3A]"
                >
                  <div className="text-sm text-blue-400">{t.custom_input || 'Custom input'}</div>
                  <div className="text-xs text-gray-500">{t.foreach_custom_path || 'Enter a custom array path'}</div>
                </div>
              </div>
            )}
          </div>

          {/* Item Variable Name */}
          <div>
            <label className="block text-sm font-medium text-gray-200 mb-1.5">
              {t.foreach_item_var || 'Item Variable Name'}
            </label>
            <input
              type="text"
              value={forEachItemVar}
              onChange={(e) => updateNodeData({ forEachItemVar: e.target.value.replace(/[^a-zA-Z0-9_]/g, '') || 'currentItem' })}
              placeholder="e.g., currentEmail"
              className="w-full px-3 py-2 bg-[#1A1A1A] border border-[#3A3A3A] rounded-lg text-gray-200 font-mono text-sm focus:outline-none focus:border-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              {t.foreach_item_var_help || 'Access current item as'} <code className="text-blue-400">{'{{context.' + forEachItemVar + '}}'}</code>
            </p>
          </div>

          {/* Max Iterations for ForEach */}
          <div>
            <label className="block text-sm font-medium text-gray-200 mb-1.5">{t.maximum_iterations}</label>
            <input
              type="number"
              min="1"
              max="1000"
              value={maxIterations}
              onChange={(e) => updateNodeData({ maxIterations: parseInt(e.target.value) || 100 })}
              className="w-full px-3 py-2 bg-[#1A1A1A] border border-[#3A3A3A] rounded-lg text-gray-200 text-sm focus:outline-none focus:border-blue-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <p className="text-xs text-gray-500 mt-1">
              {t.foreach_max_help || 'Maximum items to process (safety limit)'}
            </p>
          </div>

          {/* ForEach Preview */}
          <div className="p-3 bg-[#1A1A1A] rounded-lg border border-[#3A3A3A]">
            <div className="text-xs text-gray-400 mb-2">{t.foreach_preview || 'Preview'}:</div>
            <div className="text-sm font-mono text-gray-200">
              <span className="text-purple-400">for each</span> {forEachItemVar || 'item'} <span className="text-purple-400">in</span> {forEachSource || '...'}
            </div>
            <div className="text-xs text-gray-500 mt-2">
              {t.foreach_available_vars || 'Available variables'}:
              <div className="mt-1 space-y-0.5">
                <div><code className="text-blue-400">{'{{context.' + forEachItemVar + '}}'}</code> - {t.foreach_current_item || 'Current item'}</div>
                <div><code className="text-blue-400">{'{{context.currentIndex}}'}</code> - {t.foreach_current_index || 'Current index (0-based)'}</div>
                <div><code className="text-blue-400">{'{{context.totalCount}}'}</code> - {t.foreach_total_count || 'Total items count'}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* While Mode Settings */}
      {loopMode === 'while' && (
        <>
          {/* Max Iterations */}
          <div>
            <label className="block text-sm font-medium text-gray-200 mb-1.5">{t.maximum_iterations}</label>
            <input
              type="number"
              min="1"
              max="100"
              value={maxIterations}
              onChange={(e) => updateNodeData({ maxIterations: parseInt(e.target.value) || 10 })}
              className="w-full mt-1.5 px-3 py-2 bg-[#1A1A1A] border border-[#3A3A3A] rounded-lg text-gray-200 text-sm focus:outline-none focus:border-blue-500"
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
          <div className="space-y-3 pt-2 border-t border-[#3A3A3A]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-200">{t.loop_condition}</label>
            <div className="group relative">
              <Info className="w-4 h-4 text-gray-500 cursor-help" />
              <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block w-64 p-2 bg-gray-800 text-xs text-gray-300 rounded shadow-lg z-10">
                {t.loop_condition_tooltip}
              </div>
            </div>
          </div>

          {/* Mode Toggle */}
          <div className="flex gap-0.5 bg-[#1A1A1A] rounded-lg p-0.5 border border-[#3A3A3A]">
            <button
              onClick={() => handleModeChange('simple')}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                conditionMode === 'simple'
                  ? 'bg-blue-500 text-white'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {t.simple}
            </button>
            <button
              onClick={() => handleModeChange('builder')}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                conditionMode === 'builder'
                  ? 'bg-blue-500 text-white'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {t.builder}
            </button>
            <button
              onClick={() => handleModeChange('advanced')}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                conditionMode === 'advanced'
                  ? 'bg-blue-500 text-white'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {t.code}
            </button>
          </div>
        </div>

        {/* Simple Mode */}
        {conditionMode === 'simple' && (
          <>
            {/* Context Field */}
            <div className="relative">
              <label className="block text-xs text-gray-400 mb-1.5">{t.context_field}</label>
              <div className="relative">
                <input
                  ref={conditionFieldRef}
                  type="text"
                  value={conditionField}
                  onChange={(e) => updateNodeData({ conditionField: e.target.value })}
                  onBlur={() => setTimeout(() => setShowFieldDropdown(false), 200)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setShowFieldDropdown(false)
                    } else if (e.key === 'Escape') {
                      setShowFieldDropdown(false)
                    }
                  }}
                  placeholder="e.g., needsRetry, isValid, score"
                  className="w-full px-3 py-2 pr-8 bg-[#1A1A1A] border border-[#3A3A3A] rounded-lg text-gray-200 font-mono text-sm focus:outline-none focus:border-blue-500"
                />
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setShowFieldDropdown(!showFieldDropdown)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-[#3A3A3A] rounded transition-colors"
                >
                  <ChevronDown className="w-4 h-4 text-gray-500" />
                </button>
              </div>

          {showFieldDropdown && (
            <div className="absolute z-20 w-full mt-1 bg-[#1A1A1A] border border-[#3A3A3A] rounded-lg shadow-lg max-h-60 overflow-y-auto">
              <div
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  updateNodeData({ conditionField: '' })
                  setShowFieldDropdown(false)
                  setTimeout(() => conditionFieldRef.current?.focus(), 0)
                }}
                className="px-3 py-2.5 hover:bg-[#2A2A2A] cursor-pointer transition-colors border-b border-[#3A3A3A]"
              >
                <div className="flex items-center gap-2">
                  <div className="text-sm text-blue-400 font-medium">{t.custom_input}</div>
                  <div className="text-xs text-gray-500">- {t.custom_input_desc}</div>
                </div>
              </div>

              {availableFields.map((field, idx) => (
                <div
                  key={`${field.source}-${field.name}-${idx}`}
                  onClick={() => {
                    updateNodeData({ conditionField: field.name })

                    if (field.type === 'boolean') {
                      updateNodeData({
                        conditionField: field.name,
                        conditionValue: true
                      })
                    } else if (field.type === 'number' || field.type === 'integer') {
                      updateNodeData({
                        conditionField: field.name,
                        conditionValue: 0
                      })
                    } else {
                      updateNodeData({
                        conditionField: field.name,
                        conditionValue: ''
                      })
                    }

                    setShowFieldDropdown(false)
                  }}
                  className="px-3 py-2.5 hover:bg-[#2A2A2A] cursor-pointer transition-colors border-b border-[#2A2A2A] last:border-b-0"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-200 font-mono truncate">{field.name}</div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {field.source === 'System' ? (
                          <span className="text-gray-500">System field</span>
                        ) : (
                          <span className="text-blue-400">from: {field.source}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex-shrink-0">
                      <span className="text-xs px-1.5 py-0.5 bg-[#2A2A2A] rounded text-gray-400">
                        {field.type}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {availableFields.length === 0 && (
            <p className="text-xs text-amber-500 mt-1.5">
              💡 {t.add_ai_while_hint}
            </p>
          )}
        </div>

        {/* Operator */}
        <div>
          <label className="block text-xs text-gray-400 mb-1.5">{t.operator}</label>
          <select
            value={conditionOperator}
            onChange={(e) => updateNodeData({ conditionOperator: e.target.value })}
            className="w-full px-3 py-2 bg-[#1A1A1A] border border-[#3A3A3A] rounded-lg text-gray-200 text-sm focus:outline-none focus:border-blue-500"
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
          <label className="block text-xs text-gray-400 mb-1.5">{t.value_type}</label>
          <select
            value={conditionType}
            onChange={(e) => handleTypeChange(e.target.value)}
            className="w-full px-3 py-2 bg-[#1A1A1A] border border-[#3A3A3A] rounded-lg text-gray-200 text-sm focus:outline-none focus:border-blue-500"
          >
            <option value="boolean">{t.boolean}</option>
            <option value="number">{t.number}</option>
            <option value="string">{t.string}</option>
          </select>
        </div>

        {/* Value */}
        <div>
          <label className="block text-xs text-gray-400 mb-1.5">{t.value}</label>
          {conditionType === 'boolean' ? (
            <select
              value={conditionValue.toString()}
              onChange={(e) => handleValueChange(e.target.value)}
              className="w-full px-3 py-2 bg-[#1A1A1A] border border-[#3A3A3A] rounded-lg text-gray-200 text-sm focus:outline-none focus:border-blue-500"
            >
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          ) : conditionType === 'number' ? (
            <input
              type="number"
              value={conditionValue}
              onChange={(e) => handleValueChange(e.target.value)}
              className="w-full px-3 py-2 bg-[#1A1A1A] border border-[#3A3A3A] rounded-lg text-gray-200 font-mono text-sm focus:outline-none focus:border-blue-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          ) : (
            <input
              type="text"
              value={conditionValue}
              onChange={(e) => handleValueChange(e.target.value)}
              placeholder={t.enter_string_value}
              className="w-full px-3 py-2 bg-[#1A1A1A] border border-[#3A3A3A] rounded-lg text-gray-200 font-mono text-sm focus:outline-none focus:border-blue-500"
            />
          )}
        </div>
          </>
        )}

        {/* Builder Mode */}
        {conditionMode === 'builder' && (
          <div className="space-y-3">
            {/* Logic Selector (ALL/ANY) */}
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-400">{t.loop_while}</label>
              <select
                value={conditionLogic}
                onChange={(e) => updateNodeData({ conditionLogic: e.target.value })}
                className="px-2 py-1 bg-[#1A1A1A] border border-[#3A3A3A] rounded text-gray-200 text-sm focus:outline-none focus:border-blue-500"
              >
                <option value="all">{t.all}</option>
                <option value="any">{t.any}</option>
              </select>
              <label className="text-sm text-gray-400">{t.of_following_true}</label>
            </div>

            {/* Conditions List */}
            <div className="space-y-2">
              {conditions.map((condition: any, index: number) => (
                <div key={index} className="relative p-3 bg-[#1A1A1A] border border-[#3A3A3A] rounded-lg">
                  <button
                    onClick={() => {
                      const newConditions = conditions.filter((_: any, i: number) => i !== index)
                      updateNodeData({ conditions: newConditions })
                    }}
                    className="absolute top-2 right-2 text-gray-500 hover:text-red-400 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>

                  <div className="space-y-2 pr-6">
                    <div className="relative">
                      <select
                        value={condition.field || ''}
                        onChange={(e) => {
                          const newConditions = [...conditions]
                          const selectedField = availableFields.find(f => f.name === e.target.value)
                          newConditions[index] = {
                            ...condition,
                            field: e.target.value,
                            source: selectedField?.source || '',
                            type: selectedField?.type || 'string'
                          }
                          updateNodeData({ conditions: newConditions })
                        }}
                        className="w-full px-3 py-2 pr-8 bg-[#0A0A0A] border border-[#3A3A3A] rounded text-gray-200 font-mono text-sm focus:outline-none focus:border-blue-500 appearance-none"
                        style={{
                          WebkitAppearance: 'none',
                          MozAppearance: 'none',
                          appearance: 'none'
                        }}
                      >
                        <option value="">{t.select_field}</option>
                        {availableFields.map((field, idx) => (
                          <option key={`${field.name}-${idx}`} value={field.name}>
                            {field.name} ({field.type}) - {field.source}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
                    </div>

                    {/* Operator and Value Type */}
                    <div className="flex gap-2">
                      {/* Operator */}
                      <select
                        value={condition.operator || '=='}
                        onChange={(e) => {
                          const newConditions = [...conditions]
                          newConditions[index] = { ...condition, operator: e.target.value }
                          updateNodeData({ conditions: newConditions })
                        }}
                        className="flex-1 px-2 py-2 bg-[#0A0A0A] border border-[#3A3A3A] rounded text-gray-200 text-sm focus:outline-none focus:border-blue-500"
                      >
                        <option value="==">==</option>
                        <option value="!=">!=</option>
                        <option value=">">{'>'}</option>
                        <option value="<">{'<'}</option>
                        <option value=">=">{'>='}</option>
                        <option value="<=">{'<='}</option>
                      </select>

                      {/* Value Type */}
                      <select
                        value={condition.type || 'string'}
                        onChange={(e) => {
                          const newConditions = [...conditions]
                          let defaultValue: any
                          if (e.target.value === 'boolean') defaultValue = true
                          else if (e.target.value === 'number') defaultValue = 0
                          else defaultValue = ''
                          newConditions[index] = {
                            ...condition,
                            type: e.target.value,
                            value: defaultValue
                          }
                          updateNodeData({ conditions: newConditions })
                        }}
                        className="flex-1 px-2 py-2 bg-[#0A0A0A] border border-[#3A3A3A] rounded text-gray-200 text-sm focus:outline-none focus:border-blue-500"
                      >
                        <option value="boolean">{t.boolean}</option>
                        <option value="number">{t.number}</option>
                        <option value="string">{t.string}</option>
                      </select>
                    </div>

                    {/* Value */}
                    <div>
                      {condition.type === 'boolean' ? (
                        <select
                          value={String(condition.value)}
                          onChange={(e) => {
                            const newConditions = [...conditions]
                            newConditions[index] = { ...condition, value: e.target.value === 'true' }
                            updateNodeData({ conditions: newConditions })
                          }}
                          className="w-full px-3 py-2 bg-[#0A0A0A] border border-[#3A3A3A] rounded text-gray-200 text-sm focus:outline-none focus:border-blue-500"
                        >
                          <option value="true">true</option>
                          <option value="false">false</option>
                        </select>
                      ) : condition.type === 'number' ? (
                        <input
                          type="number"
                          value={condition.value ?? ''}
                          onChange={(e) => {
                            const newConditions = [...conditions]
                            const val = e.target.value
                            const numVal = val === '' ? '' : parseFloat(val)
                            newConditions[index] = { ...condition, value: isNaN(numVal as number) ? '' : numVal }
                            updateNodeData({ conditions: newConditions })
                          }}
                          placeholder={t.enter_number}
                          className="w-full px-3 py-2 bg-[#0A0A0A] border border-[#3A3A3A] rounded text-gray-200 font-mono text-sm focus:outline-none focus:border-blue-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                      ) : (
                        <input
                          type="text"
                          value={condition.value || ''}
                          onChange={(e) => {
                            const newConditions = [...conditions]
                            newConditions[index] = { ...condition, value: e.target.value }
                            updateNodeData({ conditions: newConditions })
                          }}
                          placeholder={t.enter_text_value}
                          className="w-full px-3 py-2 bg-[#0A0A0A] border border-[#3A3A3A] rounded text-gray-200 font-mono text-sm focus:outline-none focus:border-blue-500"
                        />
                      )}
                    </div>

                    {/* Source Info */}
                    {condition.source && (
                      <div className="text-xs text-blue-400">from: {condition.source}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Add Condition Button */}
            <button
              onClick={() => {
                const newCondition = {
                  field: availableFields[0]?.name || '',
                  source: availableFields[0]?.source || '',
                  type: availableFields[0]?.type || 'string',
                  operator: '==',
                  value: availableFields[0]?.type === 'boolean' ? true : ''
                }
                updateNodeData({ conditions: [...conditions, newCondition] })
              }}
              disabled={availableFields.length === 0}
              className="w-full px-3 py-2 bg-[#1A1A1A] border border-dashed border-[#3A3A3A] rounded-lg text-gray-400 hover:text-gray-200 hover:border-blue-500 transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t.add_condition}
            </button>

            {conditions.length === 0 && (
              <div className="text-xs text-gray-500 text-center py-2">
                {t.no_conditions_yet}
              </div>
            )}
          </div>
        )}

        {/* Advanced Mode */}
        {conditionMode === 'advanced' && (
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs text-gray-400">{t.custom_expression}</label>
                <button
                  onClick={() => {
                    setTempExpression(customExpression)
                    setShowExpressionModal(true)
                  }}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  <Maximize2 className="w-3 h-3" />
                  {t.open_editor}
                </button>
              </div>
              <div
                onClick={() => {
                  setTempExpression(customExpression)
                  setShowExpressionModal(true)
                }}
                className="w-full px-3 py-2 bg-[#1A1A1A] border border-[#3A3A3A] rounded-lg text-gray-200 font-mono text-sm min-h-[72px] cursor-pointer hover:border-blue-500 transition-colors"
              >
                {customExpression || <span className="text-gray-500">{t.click_open_editor}</span>}
              </div>
              <p className="text-xs text-gray-500 mt-1.5">
                {t.loop_js_desc}
              </p>
            </div>

            {/* Available Fields */}
            {availableFields.length > 0 && (
              <div className="p-3 bg-[#1A1A1A] rounded-lg border border-[#3A3A3A]">
                <div className="text-xs font-medium text-gray-400 mb-2">💡 {t.available_fields}:</div>
                <div className="space-y-1">
                  {availableFields.map((field, idx) => (
                    <button
                      key={`${field.source}-${field.name}-${idx}`}
                      onClick={() => {
                        const newExpression = customExpression
                          ? `${customExpression} ${field.name}`
                          : field.name
                        updateNodeData({ customExpression: newExpression })
                      }}
                      className="block w-full text-left px-2 py-1.5 hover:bg-[#2A2A2A] rounded text-xs transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-gray-200 font-mono">{field.name}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-gray-500">{field.type}</span>
                          <span className="text-blue-400">{field.source}</span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Examples */}
            <div className="p-3 bg-[#1A1A1A] rounded-lg border border-[#3A3A3A]">
              <div className="text-xs font-medium text-gray-400 mb-2">{t.examples}:</div>
              <div className="space-y-1 text-xs font-mono">
                <div className="text-gray-300">needsRetry == true && category == "urgent"</div>
                <div className="text-gray-300">score {'>'} 85 || isApproved == true</div>
                <div className="text-gray-300">VAT {'>'} 100 && (status == "pending" || status == "review")</div>
              </div>
            </div>
          </div>
        )}

        {/* Preview */}
        <div className="p-3 bg-[#1A1A1A] rounded-lg border border-[#3A3A3A]">
          <div className="text-xs text-gray-400 mb-1">{t.condition_preview}:</div>
          <div className="text-sm text-gray-200 font-mono break-words">
            {conditionPreview}
          </div>
        </div>
      </div>

      {/* Common Patterns (Simple Mode Only) */}
      {conditionMode === 'simple' && (
        <div className="space-y-2 pt-2 border-t border-[#3A3A3A]">
          <label className="block text-sm font-medium text-gray-200 mb-1.5">💡 {t.common_patterns}</label>
          <div className="space-y-1 text-xs">
            <button
              onClick={() => updateNodeData({
                conditionField: 'needsRetry',
                conditionOperator: '==',
                conditionValue: true
              })}
              className="block w-full text-left px-3 py-2 bg-[#1A1A1A] hover:bg-[#3A3A3A] rounded text-gray-300 transition-colors"
            >
              <span className="font-mono">needsRetry == true</span> - {t.retry_logic}
            </button>
            <button
              onClick={() => updateNodeData({
                conditionField: 'validationScore',
                conditionOperator: '<',
                conditionValue: 85
              })}
              className="block w-full text-left px-3 py-2 bg-[#1A1A1A] hover:bg-[#3A3A3A] rounded text-gray-300 transition-colors"
            >
              <span className="font-mono">validationScore {'<'} 85</span> - {t.quality_check}
            </button>
            <button
              onClick={() => updateNodeData({
                conditionField: 'isApproved',
                conditionOperator: '==',
                conditionValue: false
              })}
              className="block w-full text-left px-3 py-2 bg-[#1A1A1A] hover:bg-[#3A3A3A] rounded text-gray-300 transition-colors"
            >
              <span className="font-mono">isApproved == false</span> - {t.approval_waiting}
            </button>
          </div>
        </div>
      )}

      {/* Expression Editor Modal */}
      {showExpressionModal && createPortal(
        <div className="dark fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-[90vw] max-w-4xl h-[80vh] bg-[#1A1A1A] border border-[#3A3A3A] rounded-lg shadow-2xl flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-[#3A3A3A]">
              <div>
                <h3 className="text-lg font-semibold text-gray-200">{t.expression_editor}</h3>
                <p className="text-xs text-gray-400 mt-0.5">{t.write_loop_expression}</p>
              </div>
              <button
                onClick={() => setShowExpressionModal(false)}
                className="p-2 hover:bg-[#2A2A2A] rounded transition-colors"
              >
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 flex gap-4 p-4 overflow-hidden">
              {/* Editor */}
              <div className="flex-1 flex flex-col">
                <label className="text-sm font-medium text-gray-200 mb-2">{t.custom_expression}</label>
                <textarea
                  value={tempExpression}
                  onChange={(e) => setTempExpression(e.target.value)}
                  placeholder="e.g., needsRetry == true && category == &quot;urgent&quot;"
                  className="flex-1 px-4 py-3 bg-[#0A0A0A] border border-[#3A3A3A] rounded-lg text-gray-200 font-mono text-base focus:outline-none focus:border-blue-500 resize-none"
                  autoFocus
                />
                <p className="text-xs text-gray-500 mt-2">
                  {t.loop_js_desc}
                </p>
              </div>

              {/* Sidebar */}
              <div
                className="w-80 flex flex-col gap-4 overflow-y-auto custom-scrollbar pr-2"
                style={{
                  scrollbarWidth: 'thin',
                  scrollbarColor: '#4B5563 transparent',
                  scrollbarGutter: 'stable'
                }}
              >
                {/* Available Fields */}
                {availableFields.length > 0 && (
                  <div className="p-3 bg-[#0A0A0A] rounded-lg border border-[#3A3A3A]">
                    <div className="text-sm font-medium text-gray-200 mb-3">Available Fields</div>
                    <div className="space-y-1">
                      {availableFields.map((field, idx) => (
                        <button
                          key={`modal-${field.source}-${field.name}-${idx}`}
                          onClick={() => {
                            const newExpression = tempExpression
                              ? `${tempExpression} ${field.name}`
                              : field.name
                            setTempExpression(newExpression)
                          }}
                          className="block w-full text-left px-3 py-2 hover:bg-[#2A2A2A] rounded text-sm transition-colors"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-gray-200 font-mono">{field.name}</span>
                            <span className="text-xs text-gray-500">{field.type}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Examples */}
                <div className="p-3 bg-[#0A0A0A] rounded-lg border border-[#3A3A3A]">
                  <div className="text-sm font-medium text-gray-200 mb-3">{t.examples}</div>
                  <div className="space-y-2 text-xs font-mono">
                    <div className="text-gray-300">needsRetry == true</div>
                    <div className="text-gray-300">score {'>'} 85</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 p-4 border-t border-[#3A3A3A]">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowExpressionModal(false)}
                className="border-[#3A3A3A] text-gray-200 hover:bg-[#2A2A2A]"
              >
                {t.cancel}
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  updateNodeData({ customExpression: tempExpression })
                  setShowExpressionModal(false)
                }}
                className="bg-blue-500 hover:bg-blue-600 text-white"
              >
                {t.apply}
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}
        </>
      )}

      <div className="space-y-3 pt-2 border-t border-[#3A3A3A]">
        <label className="text-sm font-medium text-gray-200 block">{t.loop_tools}</label>
        <p className="text-xs text-gray-400 -mt-1">
          {t.loop_tools_desc}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="w-full border-[#3A3A3A] text-gray-200 hover:bg-[#3A3A3A] justify-between h-auto py-3"
          onClick={() => ui.openModal('whileTools')}
        >
          <div className="flex flex-col items-start gap-1 flex-1 min-w-0">
            {connectedToolNodes.length === 0 ? (
              <span className="text-sm text-gray-400">{t.no_loop_tools_selected}</span>
            ) : (
              <>
                <span className="text-sm font-medium truncate max-w-full">
                  {connectedToolNodes.slice(0, 3).map(n => n.data.label).join(', ')}
                  {connectedToolNodes.length > 3 && `, +${connectedToolNodes.length - 3} more`}
                </span>
                <span className="text-xs text-gray-400">{connectedToolNodes.length} {t.selected_max}</span>
              </>
            )}
          </div>
          <span className="text-xs text-gray-400 hover:text-gray-200 flex-shrink-0 ml-2">{t.edit}</span>
        </Button>
      </div>
    </div>
  )
}
