'use client'

import React, { useState } from 'react'
import type { WorkflowDebugLogEntry } from '@/lib/workflow'
import type { Node } from 'reactflow'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'
import { useLanguage } from '@/hooks/useLanguage'
import { StepItem, ProgressBar } from './steps'
import { Play, Pause, X, Copy, Check } from 'lucide-react'

function DataPopupModal({
  title,
  data,
  onClose
}: {
  title: string
  data: any
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const jsonString = typeof data === 'string' ? data : JSON.stringify(data, null, 2)

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
          <span className="text-sm font-medium text-white">{title}</span>
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

interface StepsPanelProps {
  executionLogs: WorkflowDebugLogEntry[]
  selectedStepIndex: number | null
  setSelectedStepIndex: (index: number | null) => void
  nodes: Node[]
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>
  setSelectedNode: (nodeId: string | null) => void
  fitView: any
  isExecuting?: boolean
  isPaused?: boolean
  pausedAtNodeId?: string | null
  onResume?: () => void
  onRunFromHere?: (nodeId: string, nodeInput: any) => void
  currentRunningNode?: {
    nodeId: string
    nodeName: string
    nodeType: string
  } | null
  totalNodes?: number
}

export function StepsPanel({
  executionLogs,
  selectedStepIndex,
  setSelectedStepIndex,
  nodes,
  setNodes,
  setSelectedNode,
  fitView,
  isExecuting = false,
  isPaused = false,
  pausedAtNodeId = null,
  onResume,
  onRunFromHere,
  currentRunningNode,
  totalNodes = 0
}: StepsPanelProps) {
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)

  const [expandedIndices, setExpandedIndices] = useState<Set<number>>(new Set())

  const [popupData, setPopupData] = useState<{ title: string; data: any } | null>(null)

  const toggleExpanded = (index: number, e: React.MouseEvent) => {
    e.stopPropagation()
    setExpandedIndices(prev => {
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }

  const navigateToNode = (log: WorkflowDebugLogEntry) => {
    const targetNode =
      nodes.find((n) => n.id === log.nodeId) ||
      nodes.find((n) => n.data?.label === log.nodeName)

    if (targetNode) {
      setSelectedNode(null)
      const targetNodeId = targetNode.id
      setNodes((nds) =>
        nds.map((node) => ({
          ...node,
          selected: node.id === targetNodeId,
        }))
      )
      fitView({
        padding: 0.3,
        maxZoom: 1.2,
        duration: 300,
        nodes: [targetNode]
      })
    }
  }

  const stepTranslations = {
    output: t.output,
    error: t.error,
    click_to_view_payload: t.click_to_view_payload,
    llm_call: t.llm_call,
    tool_call: t.tool_call,
    mcp_call: t.mcp_call,
    file_search: t.file_search,
    web_search: t.web_search_call,
    run_from_here: t.run_from_here,
    view_in_popup: t.view_in_popup,
    copy: t.copy
  }

  const pausedNodeName = pausedAtNodeId
    ? nodes.find(n => n.id === pausedAtNodeId)?.data?.label || pausedAtNodeId
    : null

  const handleOpenPopup = (title: string, data: any) => {
    setPopupData({ title, data })
  }

  return (
    <div className="flex flex-col border-r border-[#3A3A3A] h-full bg-[#1A1A1A]">
      <div className="p-3 border-b border-[#3A3A3A]">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-gray-200">{t.steps}</h3>
            <p className="text-[10px] text-gray-500 mt-1">
              {executionLogs.length === 1
                ? t.step_count.replace('{count}', '1')
                : t.steps_count.replace('{count}', String(executionLogs.length))}
            </p>
          </div>
          {isPaused && onResume && (
            <button
              onClick={onResume}
              className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-white bg-green-600 hover:bg-green-700 rounded transition-colors"
              title={t.resume || 'Resume'}
            >
              <Play className="w-3 h-3" />
              {t.resume || 'Resume'}
            </button>
          )}
        </div>
        {isPaused && pausedNodeName && (
          <div className="mt-2 flex items-center gap-1.5 text-[10px] text-yellow-400 bg-yellow-400/10 px-2 py-1 rounded">
            <Pause className="w-3 h-3" />
            <span>{t.paused_at || 'Paused at'}: <strong>{pausedNodeName}</strong></span>
          </div>
        )}
      </div>
      <ProgressBar
        logs={executionLogs}
        isExecuting={isExecuting}
        translations={{ progress: t.progress }}
        currentRunningNode={currentRunningNode}
        totalNodes={totalNodes}
      />
      <div className="flex-1 overflow-y-scroll test-panel-scrollbar">
        {executionLogs.length === 0 && (
          <div className="h-full flex items-center justify-center p-3">
            <div className="text-center text-gray-500">
              <p className="text-xs">{t.no_steps_yet}</p>
              <p className="text-[10px] mt-1">{t.send_message_to_start}</p>
            </div>
          </div>
        )}
        {executionLogs.map((log, index) => (
          <StepItem
            key={index}
            log={log}
            index={index}
            isSelected={selectedStepIndex === index}
            isExpanded={expandedIndices.has(index)}
            onSelect={() => setSelectedStepIndex(index)}
            onToggleExpand={(e) => toggleExpanded(index, e)}
            onNavigateToNode={() => navigateToNode(log)}
            onRunFromHere={onRunFromHere}
            onOpenPopup={handleOpenPopup}
            isExecuting={isExecuting}
            translations={stepTranslations}
          />
        ))}
      </div>

      {popupData && (
        <DataPopupModal
          title={popupData.title}
          data={popupData.data}
          onClose={() => setPopupData(null)}
        />
      )}
    </div>
  )
}
