'use client'

import React, { useState, useMemo, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { Node } from 'reactflow'
import { ChevronDown, Info, Maximize2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWorkflowContext } from '../../contexts/WorkflowContext'
import { getAvailableContextFields } from '../../utils/nodeUtils'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'

interface Condition {
  id: string
  type: 'if' | 'else-if' | 'else'
  caseName?: string
  condition?: string
  conditionMode?: 'simple' | 'builder' | 'advanced'
  conditionField?: string
  conditionOperator?: string
  conditionValue?: any
  conditionLogic?: 'all' | 'any'
  conditions?: Array<{
    field: string
    source?: string
    type: string
    operator: string
    value: any
  }>
  customExpression?: string
}

interface Props {
  node: Node
  updateNodeData: (patch: Record<string, any>) => void
}

export const IfElsePanel: React.FC<Props> = ({ node, updateNodeData }) => {
  const { workflow, ui } = useWorkflowContext()
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  const conditions = (node.data.conditions || [
    {
      id: 'if-0',
      type: 'if',
      condition: '',
      caseName: '',
      conditionMode: 'simple',
      conditionField: 'jsonData.',
      conditionOperator: '==',
      conditionValue: true
    }
  ]) as Condition[]

  const [activeConditionIndex, setActiveConditionIndex] = useState(0)
  const [showFieldDropdown, setShowFieldDropdown] = useState(false)
  const [showExpressionModal, setShowExpressionModal] = useState(false)
  const [tempExpression, setTempExpression] = useState('')
  const conditionFieldRef = useRef<HTMLInputElement>(null)

  const availableFields = useMemo(() => {
    return getAvailableContextFields(workflow.nodes, workflow.edges, node.id)
  }, [workflow.nodes, workflow.edges, node.id])

  useEffect(() => {
    let needsUpdate = false
    const updatedConditions = conditions.map(cond => {
      if (cond.type === 'else') return cond

      if (cond.conditionMode === 'simple' || !cond.conditionMode) {
        if (cond.conditionField && !cond.conditionOperator) {
          needsUpdate = true
          return { ...cond, conditionMode: 'simple', conditionOperator: '==' }
        }
      }
      return cond
    })

    if (needsUpdate) {
      updateNodeData({ conditions: updatedConditions })
    }
  }, [])

  const updateCondition = (index: number, patch: Partial<Condition>) => {
    const updatedConditions = conditions.map((cond, idx) => {
      if (idx !== index) return cond

      const updated = { ...cond, ...patch }

      if (!updated.caseName) {
        const mode = updated.conditionMode || 'simple'

        if (mode === 'simple') {
          const field = updated.conditionField || ''
          const operator = updated.conditionOperator || '=='
          const value = updated.conditionValue
          const valueStr = typeof value === 'string' ? `'${value}'` : value
          updated.condition = field ? `${field} ${operator} ${valueStr}` : ''
        } else if (mode === 'builder' && updated.conditions) {
          const logic = updated.conditionLogic === 'all' ? ' && ' : ' || '
          updated.condition = updated.conditions
            .map(c => {
              const valueStr = typeof c.value === 'string' ? `'${c.value}'` : c.value
              return `${c.field} ${c.operator} ${valueStr}`
            })
            .join(logic)
        } else if (mode === 'advanced') {
          updated.condition = updated.customExpression || ''
        }
      }

      return updated
    })
    updateNodeData({ conditions: updatedConditions })
  }

  const removeCondition = (index: number) => {
    const updatedConditions = conditions.filter((_, idx) => idx !== index)
    updateNodeData({ conditions: updatedConditions })
  }

  const addElseIf = () => {
    const newCondition: Condition = {
      id: `else-if-${Date.now()}`,
      type: 'else-if',
      condition: '',
      caseName: '',
      conditionMode: 'simple',
      conditionField: 'jsonData.',
      conditionOperator: '==',
      conditionValue: true
    }

    const elseIndex = conditions.findIndex(c => c.type === 'else')
    let updatedConditions
    if (elseIndex !== -1) {
      updatedConditions = [
        ...conditions.slice(0, elseIndex),
        newCondition,
        ...conditions.slice(elseIndex)
      ]
    } else {
      updatedConditions = [...conditions, newCondition]
    }

    updateNodeData({ conditions: updatedConditions })
  }

  const addElse = () => {
    const elseCondition: Condition = {
      id: 'else',
      type: 'else',
      caseName: '',
      condition: ''
    }
    updateNodeData({ conditions: [...conditions, elseCondition] })
  }

  const hasElse = conditions.some(c => c.type === 'else')

  const activeCondition = conditions[activeConditionIndex]
  const conditionMode = activeCondition?.conditionMode || 'simple'
  const conditionField = activeCondition?.conditionField || ''
  const conditionOperator = activeCondition?.conditionOperator || '=='
  const conditionValue = activeCondition?.conditionValue !== undefined ? activeCondition.conditionValue : true
  const conditionLogic = activeCondition?.conditionLogic || 'all'
  const builderConditions = activeCondition?.conditions || []
  const customExpression = activeCondition?.customExpression || ''

  const conditionType = typeof conditionValue === 'boolean' ? 'boolean'
    : typeof conditionValue === 'number' ? 'number'
    : 'string'

  const handleTypeChange = (newType: string) => {
    let defaultValue: any
    if (newType === 'boolean') defaultValue = true
    else if (newType === 'number') defaultValue = 0
    else defaultValue = ''

    updateCondition(activeConditionIndex, { conditionValue: defaultValue })
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
    updateCondition(activeConditionIndex, { conditionValue: finalValue })
  }

  const handleModeChange = (newMode: 'simple' | 'builder' | 'advanced') => {
    const currentMode = conditionMode
    if (currentMode === newMode) return

    const patch: Partial<Condition> = { conditionMode: newMode }

    if (currentMode === 'simple' && newMode === 'builder') {
      if (conditionField && conditionField !== 'jsonData.') {
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
      if (conditionField && conditionField !== 'jsonData.') {
        const valueStr = conditionType === 'string'
          ? `"${conditionValue}"`
          : String(conditionValue)
        patch.customExpression = `${conditionField} ${conditionOperator} ${valueStr}`
      }
    }

    if (currentMode === 'builder' && newMode === 'advanced') {
      if (builderConditions.length > 0) {
        const logic = conditionLogic === 'any' ? ' || ' : ' && '
        const expression = builderConditions.map((c: any) => {
          const valueStr = c.type === 'string' ? `"${c.value}"` : String(c.value)
          return `${c.field} ${c.operator} ${valueStr}`
        }).join(logic)
        patch.customExpression = expression
      }
    }

    if (currentMode === 'builder' && newMode === 'simple') {
      if (builderConditions.length > 0) {
        const firstCond = builderConditions[0]
        patch.conditionField = firstCond.field || 'jsonData.'
        patch.conditionOperator = firstCond.operator || '=='
        patch.conditionValue = firstCond.value !== undefined ? firstCond.value : true
      }
    }

    if (currentMode === 'advanced' && newMode === 'simple') {
      if (!conditionField || conditionField === 'jsonData.') {
        patch.conditionField = 'jsonData.'
      }
      patch.conditionOperator = conditionOperator || '=='
    }

    if (currentMode === 'advanced' && newMode === 'builder') {
      if (!builderConditions || builderConditions.length === 0) {
        patch.conditions = []
        patch.conditionLogic = 'all'
      }
    }

    updateCondition(activeConditionIndex, patch)
  }

  const getConditionPreview = (cond: Condition) => {
    const mode = cond.conditionMode || 'simple'

    if (cond.type === 'else') {
      return t.default_always_true
    }

    if (mode === 'advanced') {
      return cond.customExpression || t.no_condition_set
    } else if (mode === 'builder') {
      if (!cond.conditions || cond.conditions.length === 0) return t.no_conditions
      const logic = cond.conditionLogic === 'all' ? '&&' : '||'
      return cond.conditions
        .map((c: any) => {
          const valueStr = typeof c.value === 'string' ? `"${c.value}"` : c.value
          return `${c.field} ${c.operator} ${valueStr}`
        })
        .join(` ${logic} `)
    } else {
      // simple mode
      if (!cond.conditionField) return t.no_condition_set
      const valueType = typeof cond.conditionValue
      return `${cond.conditionField} ${cond.conditionOperator || '=='} ${
        valueType === 'string' ? `"${cond.conditionValue}"` : cond.conditionValue
      }`
    }
  }

  return (
    <div className="space-y-4">
      {/* Conditions List */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="block text-sm font-medium text-gray-200">{t.conditions}</label>
        </div>

        {conditions.map((cond, index) => {
          const isElse = cond.type === 'else'
          const isActive = index === activeConditionIndex

          return (
            <div
              key={cond.id}
              className={`p-3 rounded-lg border transition-colors cursor-pointer ${
                isActive
                  ? 'border-blue-500 bg-blue-500/10'
                  : 'border-[#3A3A3A] bg-[#1A1A1A] hover:border-[#4A4A4A]'
              }`}
              onClick={() => setActiveConditionIndex(index)}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-gray-200">
                    {isElse ? t.else_label : cond.type === 'if' ? t.if_label : t.else_if_label}
                  </span>
                  {cond.caseName && (
                    <span className="text-xs text-gray-400">- {cond.caseName}</span>
                  )}
                </div>
                {index > 0 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      removeCondition(index)
                    }}
                    className="text-xs text-red-400 hover:text-red-300"
                  >
                    {t.delete}
                  </button>
                )}
              </div>
              <div className="text-xs text-gray-400 font-mono">
                {getConditionPreview(cond)}
              </div>
            </div>
          )
        })}

        {/* Add buttons */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 border-[#3A3A3A] text-gray-300 hover:bg-[#3A3A3A] justify-center h-9"
            onClick={addElseIf}
          >
            {t.add_else_if}
          </Button>
          {!hasElse && (
            <Button
              variant="outline"
              size="sm"
              className="flex-1 border-[#3A3A3A] text-gray-300 hover:bg-[#3A3A3A] justify-center h-9"
              onClick={addElse}
            >
              {t.add_else}
            </Button>
          )}
        </div>
      </div>

      {/* Include Branches in Loop Toggle */}
      <div className="flex items-center justify-between py-3 border-t border-[#3A3A3A]">
        <div className="flex-1">
          <label className="block text-sm font-medium text-gray-200">{t.include_branches_in_loop || 'Include branches in loop'}</label>
          <p className="text-xs text-gray-500 mt-0.5">{t.include_branches_in_loop_desc || 'Execute branch actions within While/ForEach loop'}</p>
        </div>
        <button
          onClick={() => updateNodeData({ includeBranchesInLoop: !(node.data.includeBranchesInLoop !== false) })}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            node.data.includeBranchesInLoop !== false ? 'bg-blue-500' : 'bg-[#3A3A3A]'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              node.data.includeBranchesInLoop !== false ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {activeCondition && activeCondition.type !== 'else' && (
        <div className="space-y-4 pt-4 border-t border-[#3A3A3A]">
          {/* Case Name */}
          <div>
            <label className="block text-sm font-medium text-gray-200 mb-1.5">
              {t.case_name_optional}
            </label>
            <input
              type="text"
              placeholder={t.case_name_placeholder}
              className="w-full px-3 py-2 bg-[#1A1A1A] border border-[#3A3A3A] rounded-lg text-gray-200 text-sm focus:outline-none focus:border-blue-500"
              value={activeCondition.caseName || ''}
              onChange={(e) => updateCondition(activeConditionIndex, { caseName: e.target.value })}
            />
          </div>

          {/* Condition Mode Toggle */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-200">{t.condition}</label>
                <div className="group relative">
                  <Info className="w-4 h-4 text-gray-500 cursor-help" />
                  <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block w-64 p-2 bg-gray-800 text-xs text-gray-300 rounded shadow-lg z-10">
                    {t.condition_tooltip}
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
                      onChange={(e) => updateCondition(activeConditionIndex, { conditionField: e.target.value })}
                      onBlur={() => setTimeout(() => setShowFieldDropdown(false), 200)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setShowFieldDropdown(false)
                        } else if (e.key === 'Escape') {
                          setShowFieldDropdown(false)
                        }
                      }}
                      placeholder={t.context_field_placeholder}
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
                          updateCondition(activeConditionIndex, { conditionField: '' })
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
                            if (field.type === 'boolean') {
                              updateCondition(activeConditionIndex, {
                                conditionField: field.name,
                                conditionValue: true
                              })
                            } else if (field.type === 'number' || field.type === 'integer') {
                              updateCondition(activeConditionIndex, {
                                conditionField: field.name,
                                conditionValue: 0
                              })
                            } else {
                              updateCondition(activeConditionIndex, {
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
                                  <span className="text-gray-500">{t.system_field}</span>
                                ) : (
                                  <span className="text-blue-400">{t.from}: {field.source}</span>
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
                      💡 {t.add_ai_json_hint}
                    </p>
                  )}
                </div>

                {/* Operator */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">{t.operator}</label>
                  <select
                    value={conditionOperator}
                    onChange={(e) => updateCondition(activeConditionIndex, { conditionOperator: e.target.value })}
                    className="w-full px-3 py-2 bg-[#1A1A1A] border border-[#3A3A3A] rounded-lg text-gray-200 text-sm focus:outline-none focus:border-blue-500"
                  >
                    <option value="==">== (equals)</option>
                    <option value="!=">!= (not equals)</option>
                    <option value=">">{'>'} (greater than)</option>
                    <option value="<">{'<'} (less than)</option>
                    <option value=">=">{'>='} (greater than or equal)</option>
                    <option value="<=">{'<='} (less than or equal)</option>
                    <option value="contains">contains</option>
                    <option value="startsWith">starts with</option>
                    <option value="endsWith">ends with</option>
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
                  <label className="text-sm text-gray-400">{t.execute_when}</label>
                  <select
                    value={conditionLogic}
                    onChange={(e) => updateCondition(activeConditionIndex, { conditionLogic: e.target.value as 'all' | 'any' })}
                    className="px-2 py-1 bg-[#1A1A1A] border border-[#3A3A3A] rounded text-gray-200 text-sm focus:outline-none focus:border-blue-500"
                  >
                    <option value="all">{t.all}</option>
                    <option value="any">{t.any}</option>
                  </select>
                  <label className="text-sm text-gray-400">{t.of_following_true}</label>
                </div>

                {/* Conditions List */}
                <div className="space-y-2">
                  {builderConditions.map((condition: any, index: number) => (
                    <div key={index} className="relative p-3 bg-[#1A1A1A] border border-[#3A3A3A] rounded-lg">
                      {/* Remove Button */}
                      <button
                        onClick={() => {
                          const newConditions = builderConditions.filter((_: any, i: number) => i !== index)
                          updateCondition(activeConditionIndex, { conditions: newConditions })
                        }}
                        className="absolute top-2 right-2 text-gray-500 hover:text-red-400 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>

                      <div className="space-y-2 pr-6">
                        {/* Field Selection */}
                        <div className="relative">
                          <select
                            value={condition.field || ''}
                            onChange={(e) => {
                              const newConditions = [...builderConditions]
                              const selectedField = availableFields.find(f => f.name === e.target.value)
                              newConditions[index] = {
                                ...condition,
                                field: e.target.value,
                                source: selectedField?.source || '',
                                type: selectedField?.type || 'string'
                              }
                              updateCondition(activeConditionIndex, { conditions: newConditions })
                            }}
                            className="w-full px-3 py-2 pr-8 bg-[#0A0A0A] border border-[#3A3A3A] rounded text-gray-200 font-mono text-sm focus:outline-none focus:border-blue-500 appearance-none"
                            style={{
                              WebkitAppearance: 'none',
                              MozAppearance: 'none',
                              appearance: 'none'
                            }}
                          >
                            <option value="">Select field...</option>
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
                              const newConditions = [...builderConditions]
                              newConditions[index] = { ...condition, operator: e.target.value }
                              updateCondition(activeConditionIndex, { conditions: newConditions })
                            }}
                            className="flex-1 px-2 py-2 bg-[#0A0A0A] border border-[#3A3A3A] rounded text-gray-200 text-sm focus:outline-none focus:border-blue-500"
                          >
                            <option value="==">==</option>
                            <option value="!=">!=</option>
                            <option value=">">{'>'}</option>
                            <option value="<">{'<'}</option>
                            <option value=">=">{'>='}</option>
                            <option value="<=">{'<='}</option>
                            <option value="contains">contains</option>
                            <option value="startsWith">starts with</option>
                            <option value="endsWith">ends with</option>
                          </select>

                          {/* Value Type */}
                          <select
                            value={condition.type || 'string'}
                            onChange={(e) => {
                              const newConditions = [...builderConditions]
                              let defaultValue: any
                              if (e.target.value === 'boolean') defaultValue = true
                              else if (e.target.value === 'number') defaultValue = 0
                              else defaultValue = ''
                              newConditions[index] = {
                                ...condition,
                                type: e.target.value,
                                value: defaultValue
                              }
                              updateCondition(activeConditionIndex, { conditions: newConditions })
                            }}
                            className="flex-1 px-2 py-2 bg-[#0A0A0A] border border-[#3A3A3A] rounded text-gray-200 text-sm focus:outline-none focus:border-blue-500"
                          >
                            <option value="boolean">Boolean</option>
                            <option value="number">Number</option>
                            <option value="string">String</option>
                          </select>
                        </div>

                        {/* Value */}
                        <div>
                          {condition.type === 'boolean' ? (
                            <select
                              value={String(condition.value)}
                              onChange={(e) => {
                                const newConditions = [...builderConditions]
                                newConditions[index] = { ...condition, value: e.target.value === 'true' }
                                updateCondition(activeConditionIndex, { conditions: newConditions })
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
                                const newConditions = [...builderConditions]
                                const val = e.target.value
                                const numVal = val === '' ? '' : parseFloat(val)
                                newConditions[index] = { ...condition, value: isNaN(numVal as number) ? '' : numVal }
                                updateCondition(activeConditionIndex, { conditions: newConditions })
                              }}
                              placeholder="Enter number"
                              className="w-full px-3 py-2 bg-[#0A0A0A] border border-[#3A3A3A] rounded text-gray-200 font-mono text-sm focus:outline-none focus:border-blue-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />
                          ) : (
                            <input
                              type="text"
                              value={condition.value || ''}
                              onChange={(e) => {
                                const newConditions = [...builderConditions]
                                newConditions[index] = { ...condition, value: e.target.value }
                                updateCondition(activeConditionIndex, { conditions: newConditions })
                              }}
                              placeholder="Enter text value"
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
                    updateCondition(activeConditionIndex, { conditions: [...builderConditions, newCondition] })
                  }}
                  disabled={availableFields.length === 0}
                  className="w-full px-3 py-2 bg-[#1A1A1A] border border-dashed border-[#3A3A3A] rounded-lg text-gray-400 hover:text-gray-200 hover:border-blue-500 transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {t.add_condition}
                </button>

                {builderConditions.length === 0 && (
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
                    {t.js_expression_desc}
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
                            updateCondition(activeConditionIndex, { customExpression: newExpression })
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
                    <div className="text-gray-300">jsonData.needsRetry == true && jsonData.category == "urgent"</div>
                    <div className="text-gray-300">jsonData.score {'>'} 85 || jsonData.isApproved == true</div>
                    <div className="text-gray-300">jsonData.amount {'>'} 100 && (jsonData.status == "pending" || jsonData.status == "review")</div>
                  </div>
                </div>
              </div>
            )}

            {/* Preview */}
            <div className="p-3 bg-[#1A1A1A] rounded-lg border border-[#3A3A3A]">
              <div className="text-xs text-gray-400 mb-1">{t.condition_preview}:</div>
              <div className="text-sm text-gray-200 font-mono break-words">
                {getConditionPreview(activeCondition)}
              </div>
            </div>
          </div>

          {/* Common Patterns (Simple Mode Only) */}
          {conditionMode === 'simple' && (
            <div className="space-y-2 pt-2 border-t border-[#3A3A3A]">
              <label className="block text-sm font-medium text-gray-200 mb-1.5">💡 {t.common_patterns}</label>
              <div className="space-y-1 text-xs">
                <button
                  onClick={() => updateCondition(activeConditionIndex, {
                    conditionField: 'jsonData.needsRetry',
                    conditionOperator: '==',
                    conditionValue: true
                  })}
                  className="block w-full text-left px-3 py-2 bg-[#1A1A1A] hover:bg-[#3A3A3A] rounded text-gray-300 transition-colors"
                >
                  <span className="font-mono">jsonData.needsRetry == true</span> - {t.retry_logic}
                </button>
                <button
                  onClick={() => updateCondition(activeConditionIndex, {
                    conditionField: 'jsonData.score',
                    conditionOperator: '<',
                    conditionValue: 85
                  })}
                  className="block w-full text-left px-3 py-2 bg-[#1A1A1A] hover:bg-[#3A3A3A] rounded text-gray-300 transition-colors"
                >
                  <span className="font-mono">jsonData.score {'<'} 85</span> - {t.quality_check}
                </button>
                <button
                  onClick={() => updateCondition(activeConditionIndex, {
                    conditionField: 'jsonData.isApproved',
                    conditionOperator: '==',
                    conditionValue: false
                  })}
                  className="block w-full text-left px-3 py-2 bg-[#1A1A1A] hover:bg-[#3A3A3A] rounded text-gray-300 transition-colors"
                >
                  <span className="font-mono">jsonData.isApproved == false</span> - {t.approval_waiting}
                </button>
              </div>
            </div>
          )}
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
                <p className="text-xs text-gray-400 mt-0.5">{t.write_js_expression}</p>
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
                  placeholder='e.g., needsRetry == true && category == "urgent"'
                  className="flex-1 px-4 py-3 bg-[#0A0A0A] border border-[#3A3A3A] rounded-lg text-gray-200 font-mono text-base focus:outline-none focus:border-blue-500 resize-none"
                  autoFocus
                />
                <p className="text-xs text-gray-500 mt-2">
                  {t.js_expression_desc}
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
                    <div className="text-sm font-medium text-gray-200 mb-3">💡 {t.available_fields}</div>
                    <div className="space-y-1">
                      {availableFields.map((field, idx) => (
                        <button
                          key={`${field.source}-${field.name}-${idx}`}
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
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-500">{field.type}</span>
                              <span className="text-xs text-blue-400">{field.source}</span>
                            </div>
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
                    <div className="text-gray-300">jsonData.needsRetry == true && jsonData.category == "urgent"</div>
                    <div className="text-gray-300">jsonData.score {'>'} 85 || jsonData.isApproved == true</div>
                    <div className="text-gray-300">jsonData.amount {'>'} 100 && (jsonData.status == "pending" || jsonData.status == "review")</div>
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
                  updateCondition(activeConditionIndex, { customExpression: tempExpression })
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
    </div>
  )
}
