'use client'

import React, { useState } from 'react'
import { X, MessageSquare, List, FileText, Variable } from 'lucide-react'
import type { Node } from 'reactflow'
import type { ChatMessage, PanelSizeState, UploadedFile, FileInputConfig } from '../types'
import type { WorkflowDebugLogEntry } from '@/lib/workflow'
import type { ContextVariables } from '../hooks/useWorkflowExecution'
import { ChatPanel } from './ChatPanel'
import { SchedulePanel } from './SchedulePanel'
import { StepsPanel } from './StepsPanel'
import { DetailsPanel } from './DetailsPanel'
import { VariablesPanel } from './VariablesPanel'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'

type TabType = 'chat' | 'steps' | 'details' | 'variables'

interface TestPanelMobileProps {
  isOpen: boolean
  onClose: () => void
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
}

export function TestPanelMobile({
  isOpen,
  onClose,
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
  onRemovePdf
}: TestPanelMobileProps) {
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  const [activeTab, setActiveTab] = useState<TabType>('chat')

  if (!isOpen) return null

  const tabs: { id: TabType; label: string; icon: React.ReactNode }[] = [
    { id: 'chat', label: 'Chat', icon: <MessageSquare className="w-4 h-4" /> },
    { id: 'steps', label: 'Steps', icon: <List className="w-4 h-4" /> },
    { id: 'details', label: 'Details', icon: <FileText className="w-4 h-4" /> },
    { id: 'variables', label: 'Variables', icon: <Variable className="w-4 h-4" /> }
  ]

  return (
    <div className="fixed inset-0 z-50 bg-[#0f0f0f] flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#3A3A3A] bg-[#1A1A1A]">
        <h2 className="text-sm font-semibold text-white">Test Workflow</h2>
        <button
          onClick={onClose}
          className="p-2 hover:bg-[#3A3A3A] rounded-lg transition-colors"
        >
          <X className="w-5 h-5 text-gray-400" />
        </button>
      </div>

      <div className="flex border-b border-[#3A3A3A] bg-[#1A1A1A]">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-medium transition-colors ${
              activeTab === tab.id
                ? 'text-blue-400 border-b-2 border-blue-400 bg-blue-500/10'
                : 'text-gray-400 hover:text-gray-300 hover:bg-[#2A2A2A]'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden">
        {activeTab === 'chat' && (
          <div className="h-full">
            {isScheduleOnlyStart && onScheduleTest ? (
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
        )}

        {activeTab === 'steps' && (
          <div className="h-full">
            <StepsPanel
              executionLogs={executionLogs}
              selectedStepIndex={selectedStepIndex}
              setSelectedStepIndex={(index) => {
                setSelectedStepIndex(index)
                if (index !== null) {
                  setActiveTab('details')
                }
              }}
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
        )}

        {activeTab === 'details' && (
          <div className="h-full">
            <DetailsPanel
              selectedStepIndex={selectedStepIndex}
              executionLogs={executionLogs}
              canExpandPayload={canExpandPayload}
              handleLogBoxClick={handleLogBoxClick}
            />
          </div>
        )}

        {activeTab === 'variables' && (
          <div className="h-full">
            <VariablesPanel contextVariables={contextVariables} />
          </div>
        )}
      </div>
    </div>
  )
}
