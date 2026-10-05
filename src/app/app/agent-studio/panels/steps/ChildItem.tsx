'use client'

import React, { useState } from 'react'
import { AlertCircle, AlertTriangle, ChevronRight, ChevronDown, Bot, Wrench, Search, Globe } from 'lucide-react'
import type { WorkflowDebugChildEntry } from '@/lib/workflow'
import { getChildTypeStyles, formatOutputPreview } from './nodeTypeStyles'

interface ChildItemProps {
  child: WorkflowDebugChildEntry
  translations: {
    llm_call: string
    tool_call: string
    mcp_call: string
    file_search: string
    web_search: string
  }
}

const getChildIcon = (type: WorkflowDebugChildEntry['type']) => {
  switch (type) {
    case 'llm_call':
      return <Bot className="w-3 h-3" />
    case 'tool_call':
    case 'mcp_call':
      return <Wrench className="w-3 h-3" />
    case 'file_search':
      return <Search className="w-3 h-3" />
    case 'web_search':
      return <Globe className="w-3 h-3" />
    default:
      return <Wrench className="w-3 h-3" />
  }
}

const getChildLabel = (
  type: WorkflowDebugChildEntry['type'],
  translations: ChildItemProps['translations']
): string => {
  switch (type) {
    case 'llm_call':
      return translations.llm_call
    case 'tool_call':
      return translations.tool_call
    case 'mcp_call':
      return translations.mcp_call
    case 'file_search':
      return translations.file_search
    case 'web_search':
      return translations.web_search
    default:
      return type
  }
}

export function ChildItem({ child, translations }: ChildItemProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const styles = getChildTypeStyles(child.type, child.status)

  return (
    <div className={`rounded ${styles.bg} border-l-2 ${styles.border}`}>
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full text-left px-2 py-1.5 flex items-center gap-1.5 hover:brightness-110 transition-all"
      >
        {isExpanded ? (
          <ChevronDown className="w-2.5 h-2.5 text-gray-400 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-2.5 h-2.5 text-gray-400 flex-shrink-0" />
        )}

        <span className={styles.icon}>{getChildIcon(child.type)}</span>

        <span className="flex-1 min-w-0">
          <span className={`text-[10px] font-medium ${
            child.status === 'error' ? 'text-red-400' :
            child.status === 'warning' ? 'text-orange-400' : 'text-gray-300'
          }`}>
            {child.name}
          </span>
          <span className="text-[9px] text-gray-500 ml-1">
            ({getChildLabel(child.type, translations)})
          </span>
        </span>

        {/* Duration */}
        <span className="text-[9px] text-gray-500 flex-shrink-0">
          {child.duration}ms
        </span>

        {child.status === 'warning' && (
          <AlertTriangle className="w-3 h-3 text-orange-500 flex-shrink-0" />
        )}

        {child.status === 'error' && (
          <AlertCircle className="w-3 h-3 text-red-500 flex-shrink-0" />
        )}
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="px-2 pb-2 ml-5">
          {/* Output */}
          {child.output !== undefined && (
            <div className="mt-1">
              <p className="text-[9px] text-gray-500 mb-0.5">Output</p>
              <pre className="text-[9px] text-gray-400 bg-black/30 rounded p-1.5 overflow-x-auto whitespace-pre-wrap break-all max-h-20">
                {formatOutputPreview(child.output)}
              </pre>
            </div>
          )}

          {child.status === 'warning' && child.output?.incompleteReason && (
            <div className="mt-1">
              <p className="text-[9px] text-orange-400 mb-0.5">Warning</p>
              <pre className="text-[9px] text-orange-300 bg-orange-900/20 rounded p-1.5 overflow-x-auto whitespace-pre-wrap break-all">
                Response incomplete: {child.output.incompleteReason}
              </pre>
            </div>
          )}

          {/* Error */}
          {child.status === 'error' && child.error && (
            <div className="mt-1">
              <p className="text-[9px] text-red-400 mb-0.5">Error</p>
              <pre className="text-[9px] text-red-300 bg-red-900/20 rounded p-1.5 overflow-x-auto whitespace-pre-wrap break-all">
                {child.error}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
