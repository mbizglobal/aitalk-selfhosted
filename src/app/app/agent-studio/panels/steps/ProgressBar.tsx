'use client'

import React from 'react'
import type { WorkflowDebugLogEntry } from '@/lib/workflow'

interface ProgressBarProps {
  logs: WorkflowDebugLogEntry[]
  isExecuting: boolean
  translations: {
    progress: string
  }
  currentRunningNode?: {
    nodeId: string
    nodeName: string
    nodeType: string
  } | null
  totalNodes?: number
}

export function ProgressBar({
  logs,
  isExecuting,
  translations,
  currentRunningNode,
  totalNodes = 0
}: ProgressBarProps) {
  const completedCount = logs.filter(log => log.status === 'success').length
  const errorCount = logs.filter(log => log.status === 'error').length

  const runningCount = currentRunningNode ? 1 : 0
  const totalCount = Math.max(
    totalNodes,
    logs.length + runningCount
  )

  const progress = isExecuting
    ? totalCount > 0
      ? Math.round((completedCount / totalCount) * 100)
      : 0
    : (logs.length > 0 ? 100 : 0)

  if (logs.length === 0 && !isExecuting) return null

  return (
    <div className="px-3 py-2 border-b border-[#3A3A3A]">
      <div className="h-1.5 bg-[#2A2A2A] rounded-full overflow-hidden">
        <div
          className={`h-full transition-all duration-300 ${
            errorCount > 0
              ? 'bg-red-500'
              : isExecuting
                ? 'bg-blue-500 animate-pulse'
                : 'bg-green-500'
          }`}
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="flex items-center justify-between mt-1">
        <span className="text-[9px] text-gray-500">
          {translations.progress}
        </span>
        <span className={`text-[9px] ${
          errorCount > 0 ? 'text-red-400' : isExecuting ? 'text-blue-400' : 'text-gray-400'
        }`}>
          {isExecuting ? (
            <>
              {completedCount}/{totalNodes > 0 && logs.length > totalNodes ? `${logs.length}+` : totalCount}
              {currentRunningNode && (
                <span className="ml-1 text-gray-500">
                  ({currentRunningNode.nodeName}...)
                </span>
              )}
            </>
          ) : (
            <>{completedCount}/{logs.length}</>
          )}
          {errorCount > 0 && ` (${errorCount} error${errorCount > 1 ? 's' : ''})`}
        </span>
      </div>
    </div>
  )
}
