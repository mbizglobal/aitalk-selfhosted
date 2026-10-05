'use client'

import React from 'react'
import type { Node } from 'reactflow'
import type { ChatMessage, PanelSizeState, UploadedFile, FileInputConfig } from '../types'
import type { WorkflowDebugLogEntry } from '@/lib/workflow'
import type { ContextVariables } from '../hooks/useWorkflowExecution'
import { ChatPanel } from './ChatPanel'
import { SchedulePanel } from './SchedulePanel'
import { StepsPanel } from './StepsPanel'
import { DetailsPanel } from './DetailsPanel'
import { VariablesPanel } from './VariablesPanel'
import { VoiceTestPanel } from './VoiceTestPanel'

interface TestPanelProps {
  showTestPanel: boolean
  panelSize: PanelSizeState
  setPanelSize: React.Dispatch<React.SetStateAction<PanelSizeState>>
  chatMessages: ChatMessage[]
  isExecuting: boolean
  testMessage: string
  setTestMessage: (value: string) => void
  handleExecuteWorkflow: () => void
  executionLogs: WorkflowDebugLogEntry[]
  contextVariables: ContextVariables
  selectedStepIndex: number | null
  setSelectedStepIndex: (index: number | null) => void
  nodes: Node[]
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>
  setSelectedNode: (nodeId: string | null) => void
  fitView: any
  canExpandPayload: boolean
  handleLogBoxClick: (type: 'input' | 'output') => void
  isPaused?: boolean
  pausedAtNodeId?: string | null
  onResume?: () => void
  onRunFromHere?: (nodeId: string, nodeInput: any) => void
  onResetTest?: () => void
  hasScheduleNode?: boolean
  isScheduleOnlyStart?: boolean
  onScheduleTest?: () => void
  currentRunningNode?: {
    nodeId: string
    nodeName: string
    nodeType: string
  } | null
  totalNodes?: number
  isTelegramStart?: boolean
  fileInputConfig?: FileInputConfig
  uploadedFiles?: UploadedFile[]
  isUploading?: boolean
  onFileSelect?: (files: FileList | null) => void
  onRemoveFile?: (fileId: string) => void
  onRemovePdf?: (fileName: string) => void
  // ⭐ PSTN Voice Test
  isPstnStart?: boolean
  agentId?: string
  workflowId?: string
}

export function TestPanel({
  showTestPanel,
  panelSize,
  setPanelSize,
  chatMessages,
  isExecuting,
  testMessage,
  setTestMessage,
  handleExecuteWorkflow,
  executionLogs,
  contextVariables,
  selectedStepIndex,
  setSelectedStepIndex,
  nodes,
  setNodes,
  setSelectedNode,
  fitView,
  canExpandPayload,
  handleLogBoxClick,
  isPaused,
  pausedAtNodeId,
  onResume,
  onRunFromHere,
  onResetTest,
  hasScheduleNode,
  isScheduleOnlyStart,
  onScheduleTest,
  currentRunningNode,
  totalNodes,
  isTelegramStart,
  fileInputConfig,
  uploadedFiles,
  isUploading,
  onFileSelect,
  onRemoveFile,
  onRemovePdf,
  isPstnStart,
  agentId,
  workflowId
}: TestPanelProps) {
  if (!showTestPanel) return null

  const { chatWidth, stepsWidth, detailsWidth } = panelSize

  const setIsDraggingChatWidth = (value: boolean) => {
    setPanelSize(prev => ({ ...prev, isDraggingChatWidth: value }))
  }

  const setIsDraggingStepsWidth = (value: boolean) => {
    setPanelSize(prev => ({ ...prev, isDraggingStepsWidth: value }))
  }

  const setIsDraggingDetailsWidth = (value: boolean) => {
    setPanelSize(prev => ({ ...prev, isDraggingDetailsWidth: value }))
  }

  return (
    <div className="h-full flex bg-[#1A1A1A] border-t border-[#3A3A3A]">
        <div style={{ width: `${chatWidth}%` }} className="flex-shrink-0 h-full">
          {isPstnStart && agentId ? (
            <VoiceTestPanel
              agentId={agentId}
              workflowId={workflowId}
            />
          ) : isScheduleOnlyStart && onScheduleTest ? (
            <SchedulePanel
              chatMessages={chatMessages}
              isExecuting={isExecuting}
              onScheduleTest={onScheduleTest}
              onReset={onResetTest}
            />
          ) : (
            <ChatPanel
              chatMessages={chatMessages}
              isExecuting={isExecuting}
              testMessage={testMessage}
              setTestMessage={setTestMessage}
              handleExecuteWorkflow={handleExecuteWorkflow}
              onReset={onResetTest}
              hasScheduleNode={hasScheduleNode}
              onScheduleTest={onScheduleTest}
              isTelegramStart={isTelegramStart}
              fileInputConfig={fileInputConfig}
              uploadedFiles={uploadedFiles}
              isUploading={isUploading}
              onFileSelect={onFileSelect}
              onRemoveFile={onRemoveFile}
              onRemovePdf={onRemovePdf}
            />
          )}
        </div>

        <div
          onMouseDown={() => setIsDraggingChatWidth(true)}
          className="w-1 bg-[#3A3A3A] hover:bg-blue-500 cursor-ew-resize"
        />

        <div style={{ width: `${stepsWidth}%` }} className="flex-shrink-0 h-full">
          <StepsPanel
            executionLogs={executionLogs}
            selectedStepIndex={selectedStepIndex}
            setSelectedStepIndex={setSelectedStepIndex}
            nodes={nodes}
            setNodes={setNodes}
            setSelectedNode={setSelectedNode}
            fitView={fitView}
            isExecuting={isExecuting}
            isPaused={isPaused}
            pausedAtNodeId={pausedAtNodeId}
            onResume={onResume}
            onRunFromHere={onRunFromHere}
            currentRunningNode={currentRunningNode}
            totalNodes={totalNodes}
          />
        </div>

        <div
          onMouseDown={() => setIsDraggingStepsWidth(true)}
          className="w-1 bg-[#3A3A3A] hover:bg-blue-500 cursor-ew-resize"
        />

        <div style={{ width: `${detailsWidth}%` }} className="flex-shrink-0 h-full">
          <DetailsPanel
            selectedStepIndex={selectedStepIndex}
            executionLogs={executionLogs}
            canExpandPayload={canExpandPayload}
            handleLogBoxClick={handleLogBoxClick}
          />
        </div>

        <div
          onMouseDown={() => setIsDraggingDetailsWidth(true)}
          className="w-1 bg-[#3A3A3A] hover:bg-blue-500 cursor-ew-resize"
        />

        <div className="flex-1 min-w-0 h-full">
          <VariablesPanel contextVariables={contextVariables} />
        </div>
    </div>
  )
}
