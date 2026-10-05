'use client'

import React, { useState } from 'react'
import { AlertCircle, ChevronRight, ChevronDown, Play } from 'lucide-react'
import type { WorkflowDebugLogEntry } from '@/lib/workflow'
import { getNodeTypeStyles } from './nodeTypeStyles'
import { StepInlinePreview } from './StepInlinePreview'
import { StepChildren } from './StepChildren'

interface StepItemProps {
  log: WorkflowDebugLogEntry
  index: number
  isSelected: boolean
  isExpanded: boolean
  onSelect: () => void
  onToggleExpand: (e: React.MouseEvent) => void
  onNavigateToNode: () => void
  onRunFromHere?: (nodeId: string, nodeInput: any) => void
  onOpenPopup?: (title: string, data: any) => void
  isExecuting?: boolean
  translations: {
    output: string
    error: string
    click_to_view_payload: string
    llm_call: string
    tool_call: string
    mcp_call: string
    file_search: string
    web_search: string
    run_from_here?: string
    view_in_popup?: string
    copy?: string
  }
}

export function StepItem({
  log,
  index,
  isSelected,
  isExpanded,
  onSelect,
  onToggleExpand,
  onNavigateToNode,
  onRunFromHere,
  onOpenPopup,
  isExecuting = false,
  translations
}: StepItemProps) {
  const styles = getNodeTypeStyles(log.nodeType, log.status)
  const [isHovered, setIsHovered] = useState(false)

  const handleClick = () => {
    onSelect()
    onNavigateToNode()
  }

  const handleRunFromHere = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (onRunFromHere && !isExecuting) {
      onRunFromHere(log.nodeId, null)
    }
  }

  return (
    <div
      className="border-b border-[#2A2A2A]"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        onClick={handleClick}
        className={`w-full text-left px-3 py-2.5 border-l-2 hover:brightness-125 transition-all cursor-pointer ${styles.bg} ${styles.border} ${
          isSelected ? 'brightness-125' : ''
        }`}
      >
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleExpand}
            className="flex-shrink-0 p-0.5 hover:bg-white/10 rounded transition-colors"
          >
            {isExpanded ? (
              <ChevronDown className="w-3 h-3 text-gray-400" />
            ) : (
              <ChevronRight className="w-3 h-3 text-gray-400" />
            )}
          </button>
          <div className={`flex-shrink-0 w-1.5 h-1.5 rounded-full ${styles.dot}`} />
          <div className="flex-1 min-w-0">
            <p className={`text-xs font-medium truncate ${
              log.status === 'error' ? 'text-red-400' : 'text-white'
            }`}>
              {log.nodeName}
            </p>
            <p className="text-[10px] text-gray-500 mt-0.5">
              {log.duration}ms
            </p>
          </div>
          {isHovered && onRunFromHere && !isExecuting && (
            <button
              onClick={handleRunFromHere}
              className="flex-shrink-0 flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium text-blue-400 bg-blue-400/10 hover:bg-blue-400/20 rounded transition-colors"
              title={translations.run_from_here || 'Run from here'}
            >
              <Play className="w-2.5 h-2.5" />
              <span className="hidden sm:inline">{translations.run_from_here || 'Run'}</span>
            </button>
          )}
          {log.status === 'error' && (
            <AlertCircle className="flex-shrink-0 w-3.5 h-3.5 text-red-500" />
          )}
        </div>
      </div>

      {isExpanded && (
        <>
          {log.children && log.children.length > 0 && (
            <div className={`px-3 py-2 ${styles.bg} border-l-2 ${styles.border}`}>
              <StepChildren
                children={log.children}
                translations={{
                  llm_call: translations.llm_call,
                  tool_call: translations.tool_call,
                  mcp_call: translations.mcp_call,
                  file_search: translations.file_search,
                  web_search: translations.web_search
                }}
              />
            </div>
          )}
          <StepInlinePreview
            log={log}
            styles={styles}
            onViewDetails={onSelect}
            onOpenPopup={onOpenPopup}
            translations={translations}
          />
        </>
      )}
    </div>
  )
}
