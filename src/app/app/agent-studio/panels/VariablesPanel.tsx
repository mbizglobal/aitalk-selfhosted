'use client'

import React, { useState } from 'react'
import { ChevronDown, ChevronRight, Variable, Copy, Check, X, Maximize2 } from 'lucide-react'
import type { ContextVariables } from '../hooks/useWorkflowExecution'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'
import { useLanguage } from '@/hooks/useLanguage'

interface VariablesPanelProps {
  contextVariables: ContextVariables
}

const getValueColor = (value: any): string => {
  if (value === null || value === undefined) return 'text-gray-500'
  if (typeof value === 'string') return 'text-green-400'
  if (typeof value === 'number') return 'text-blue-400'
  if (typeof value === 'boolean') return 'text-yellow-400'
  if (Array.isArray(value)) return 'text-purple-400'
  if (typeof value === 'object') return 'text-orange-400'
  return 'text-gray-300'
}

const formatValue = (value: any, maxLength = 50): string => {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') {
    if (value.length > maxLength) {
      return `"${value.slice(0, maxLength)}..."`
    }
    return `"${value}"`
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (Array.isArray(value)) {
    return `Array(${value.length})`
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value)
    return `{${keys.length} keys}`
  }
  return String(value)
}

function VariableModal({
  name,
  value,
  onClose
}: {
  name: string
  value: any
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const jsonString = JSON.stringify(value, null, 2)

  const handleCopy = () => {
    navigator.clipboard.writeText(jsonString)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-[#1E1E1E] rounded-lg shadow-2xl border border-[#3A3A3A] w-[90vw] max-w-3xl max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#3A3A3A]">
          <div className="flex items-center gap-2">
            <Variable className="w-4 h-4 text-purple-400" />
            <span className="text-cyan-400 font-medium">{name}</span>
            <span className={`text-xs ${getValueColor(value)}`}>
              {Array.isArray(value) ? `Array(${value.length})` : typeof value}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-[#2A2A2A] hover:bg-[#3A3A3A] rounded transition-colors"
            >
              {copied ? (
                <>
                  <Check className="w-3 h-3 text-green-400" />
                  <span className="text-green-400">Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3 text-gray-400" />
                  <span className="text-gray-400">Copy</span>
                </>
              )}
            </button>
            <button
              onClick={onClose}
              className="p-1 hover:bg-[#3A3A3A] rounded transition-colors"
            >
              <X className="w-4 h-4 text-gray-400" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-scroll p-4 test-panel-scrollbar">
          <pre className="text-xs text-gray-300 font-mono whitespace-pre-wrap break-words">
            {jsonString}
          </pre>
        </div>
      </div>
    </div>
  )
}

function VariableItem({
  name,
  value,
  depth = 0,
  onOpenModal,
  translations
}: {
  name: string
  value: any
  depth?: number
  onOpenModal: (name: string, value: any) => void
  translations: { view_in_popup: string; copy_value: string }
}) {
  const [isExpanded, setIsExpanded] = useState(depth < 1)
  const [copied, setCopied] = useState(false)
  const isExpandable = (typeof value === 'object' && value !== null)
  const indent = depth * 16

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation()
    const textToCopy = typeof value === 'object'
      ? JSON.stringify(value, null, 2)
      : String(value)
    navigator.clipboard.writeText(textToCopy)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleOpenModal = (e: React.MouseEvent) => {
    e.stopPropagation()
    onOpenModal(name, value)
  }

  return (
    <div className="text-xs">
      <div
        className={`flex items-center gap-1 py-1 px-2 hover:bg-[#2A2A2A] rounded cursor-pointer group`}
        style={{ paddingLeft: `${8 + indent}px` }}
        onClick={() => isExpandable && setIsExpanded(!isExpanded)}
      >
        {isExpandable ? (
          isExpanded ? (
            <ChevronDown className="w-3 h-3 text-gray-500 flex-shrink-0" />
          ) : (
            <ChevronRight className="w-3 h-3 text-gray-500 flex-shrink-0" />
          )
        ) : (
          <span className="w-3" />
        )}
        <span className="text-cyan-400 font-medium">{name}</span>
        <span className="text-gray-500">:</span>
        <span className={`${getValueColor(value)} truncate flex-1`}>
          {formatValue(value)}
        </span>

        <button
          onClick={handleOpenModal}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:bg-[#3A3A3A] rounded"
          title={translations.view_in_popup}
        >
          <Maximize2 className="w-3 h-3 text-gray-500" />
        </button>

        <button
          onClick={handleCopy}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:bg-[#3A3A3A] rounded"
          title={translations.copy_value}
        >
          {copied ? (
            <Check className="w-3 h-3 text-green-400" />
          ) : (
            <Copy className="w-3 h-3 text-gray-500" />
          )}
        </button>
      </div>

      {isExpanded && isExpandable && (
        <div>
          {Array.isArray(value) ? (
            value.map((item, index) => (
              <VariableItem
                key={index}
                name={`[${index}]`}
                value={item}
                depth={depth + 1}
                onOpenModal={onOpenModal}
                translations={translations}
              />
            ))
          ) : (
            Object.entries(value).map(([key, val]) => (
              <VariableItem
                key={key}
                name={key}
                value={val}
                depth={depth + 1}
                onOpenModal={onOpenModal}
                translations={translations}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

export function VariablesPanel({ contextVariables }: VariablesPanelProps) {
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  const [modalData, setModalData] = useState<{ name: string; value: any } | null>(null)

  const hasVariables = Object.keys(contextVariables).length > 0

  const handleOpenModal = (name: string, value: any) => {
    setModalData({ name, value })
  }

  const handleCloseModal = () => {
    setModalData(null)
  }

  return (
    <div className="h-full flex flex-col bg-[#1A1A1A]">
      <div className="flex items-center gap-2 px-3 py-3 border-b border-[#3A3A3A]">
        <Variable className="w-4 h-4 text-purple-400" />
        <span className="text-sm font-medium text-gray-200">{t.variables}</span>
        {hasVariables && (
          <span className="text-xs text-gray-500">
            ({Object.keys(contextVariables).length})
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-scroll test-panel-scrollbar">
        {hasVariables ? (
          <div className="py-1">
            {Object.entries(contextVariables).map(([key, value]) => (
              <VariableItem
                key={key}
                name={key}
                value={value}
                onOpenModal={handleOpenModal}
                translations={{ view_in_popup: t.view_in_popup, copy_value: t.copy_value }}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 text-xs px-4 text-center">
            <Variable className="w-8 h-8 mb-2 opacity-30" />
            <p>{t.no_variables_yet}</p>
            <p className="mt-1">{t.run_workflow_to_see}</p>
          </div>
        )}
      </div>

      {modalData && (
        <VariableModal
          name={modalData.name}
          value={modalData.value}
          onClose={handleCloseModal}
        />
      )}
    </div>
  )
}
