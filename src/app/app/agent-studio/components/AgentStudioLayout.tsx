import React, { useState } from 'react'
import { Menu, X } from 'lucide-react'
import { WorkflowHeader } from './WorkflowHeader'
import { WorkflowCanvas } from './WorkflowCanvas'
import { WorkflowSidebar } from './WorkflowSidebar'
import { LeftPalette, TestPanel, AIAssistantPanel } from '../panels'
import { useWorkflowContext } from '../contexts/WorkflowContext'
import type { PanelSizeState, ChatMessage, UploadedFile, FileInputConfig } from '../types'
import type { WorkflowDebugLogEntry } from '@/lib/workflow'
import type { ContextVariables } from '../hooks/useWorkflowExecution'

interface AgentStudioLayoutProps {
  isMobile: boolean
  handleDragStart: (event: React.DragEvent, component: { id: string }) => void
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
  canExpandPayload: boolean
  handleLogBoxClick: (type: 'input' | 'output') => void
  isPaused?: boolean
  pausedAtNodeId?: string | null
  onResume?: () => void
  onRunFromHere?: (nodeId: string, nodeInput: any) => void
  handleResetTest?: () => void
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
  // ⭐ PSTN Voice Test
  isPstnStart?: boolean
  agentId?: string
  workflowId?: string
  fileInputConfig?: FileInputConfig
  uploadedFiles?: UploadedFile[]
  isUploading?: boolean
  onFileSelect?: (files: FileList | null) => void
  onRemoveFile?: (fileId: string) => void
  onRemovePdf?: (fileName: string) => void
}

export const AgentStudioLayout: React.FC<AgentStudioLayoutProps> = ({
  isMobile,
  handleDragStart,
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
  canExpandPayload,
  handleLogBoxClick,
  isPaused,
  pausedAtNodeId,
  onResume,
  onRunFromHere,
  handleResetTest,
  hasScheduleNode,
  isScheduleOnlyStart,
  onScheduleTest,
  currentRunningNode,
  totalNodes,
  isTelegramStart,
  isPstnStart,
  agentId,
  workflowId,
  fileInputConfig,
  uploadedFiles,
  isUploading,
  onFileSelect,
  onRemoveFile,
  onRemovePdf
}) => {
  const { workflow, ui } = useWorkflowContext()
  const [isDragging, setIsDragging] = useState(false)

  return (
    <div
      className="relative h-screen text-white flex flex-col"
      style={{
        backgroundColor: '#0f0f0f'
      }}
    >
      <div className="absolute top-0 left-0 right-0 z-[60]">
        <WorkflowHeader />
      </div>

      <div
        className="flex overflow-hidden relative"
        style={{
          height: ui.showDebugPanel ? `calc(${100 - panelSize.height}vh - 1px)` : '100vh',
          transition: ui.showDebugPanel ? 'none' : 'height 0.3s ease'
        }}
      >
        {!isMobile && (
          <LeftPalette
            isMobile={isMobile}
            onDragStart={handleDragStart}
            activeTab={ui.activeTab}
            isLocked={ui.isLocked}
          />
        )}

        {isMobile && (
          <button
            onClick={() => ui.setShowLeftPalette(true)}
            className="absolute top-20 left-4 z-20 p-2 bg-[#2A2A2A]/95 backdrop-blur-sm rounded-lg border border-[#3A3A3A] hover:bg-[#3A3A3A] transition-colors"
            aria-label="Open components menu"
          >
            <Menu className="w-5 h-5 text-gray-300" />
          </button>
        )}

        {isMobile && ui.showLeftPalette && (
          <>
            <div
              className={`fixed inset-0 bg-black/50 z-30 ${isDragging ? 'pointer-events-none' : ''}`}
              onClick={() => !isDragging && ui.setShowLeftPalette(false)}
            />
            <div className={`fixed top-14 left-0 bottom-0 w-40 bg-[#1A1A1A] z-40 shadow-2xl animate-slide-in-left ${isDragging ? 'opacity-30' : ''}`}>
              <div className="flex items-center justify-between px-3 py-2 border-b border-[#3A3A3A]">
                <span className="text-xs font-medium text-gray-400">Components</span>
                <button
                  onClick={() => ui.setShowLeftPalette(false)}
                  className="p-1 hover:bg-[#3A3A3A] rounded transition-colors"
                >
                  <X className="w-4 h-4 text-gray-400" />
                </button>
              </div>
              <div className="p-1.5 overflow-y-auto" style={{ height: 'calc(100% - 44px)' }}>
                <LeftPalette
                  isMobile={true}
                  onDragStart={(e, comp) => {
                    setIsDragging(true)
                    handleDragStart(e, comp)
                  }}
                  onDragEnd={() => {
                    setIsDragging(false)
                    ui.setShowLeftPalette(false)
                  }}
                  activeTab={ui.activeTab}
                  isLocked={ui.isLocked}
                  isOverlay={true}
                />
              </div>
            </div>
          </>
        )}

        <div className="flex flex-1 overflow-hidden">
          <WorkflowCanvas />
        </div>
        {workflow.selectedNode && <WorkflowSidebar />}
      </div>

      {ui.showDebugPanel && (
        <div
          className="h-1 bg-gray-700 hover:bg-blue-500 cursor-ns-resize flex items-center justify-center flex-shrink-0"
          onMouseDown={() => setPanelSize(prev => ({ ...prev, isDraggingHeight: true }))}
        >
          <div className="w-12 h-1 bg-gray-500 rounded-full" />
        </div>
      )}

      {ui.showDebugPanel && (
        <div
          style={{ height: `${panelSize.height}vh` }}
          className="overflow-hidden flex-shrink-0"
        >
          <TestPanel
            showTestPanel
            panelSize={panelSize}
            setPanelSize={setPanelSize}
            chatMessages={chatMessages}
            isExecuting={isExecuting}
            testMessage={testMessage}
            setTestMessage={setTestMessage}
            handleExecuteWorkflow={handleExecuteWorkflow}
            executionLogs={executionLogs}
            contextVariables={contextVariables}
            selectedStepIndex={selectedStepIndex}
            setSelectedStepIndex={setSelectedStepIndex}
            nodes={workflow.nodes}
            setNodes={workflow.setNodes}
            setSelectedNode={workflow.setSelectedNode}
            fitView={workflow.reactFlowInstance?.fitView}
            canExpandPayload={canExpandPayload}
            handleLogBoxClick={handleLogBoxClick}
            isPaused={isPaused}
            pausedAtNodeId={pausedAtNodeId}
            onResume={onResume}
            onRunFromHere={onRunFromHere}
            onResetTest={handleResetTest}
            hasScheduleNode={hasScheduleNode}
            isScheduleOnlyStart={isScheduleOnlyStart}
            onScheduleTest={onScheduleTest}
            currentRunningNode={currentRunningNode}
            totalNodes={totalNodes}
            isTelegramStart={isTelegramStart}
            isPstnStart={isPstnStart}
            agentId={agentId}
            workflowId={workflowId}
            fileInputConfig={fileInputConfig}
            uploadedFiles={uploadedFiles}
            isUploading={isUploading}
            onFileSelect={onFileSelect}
            onRemoveFile={onRemoveFile}
            onRemovePdf={onRemovePdf}
          />
        </div>
      )}

      <AIAssistantPanel
        showPanel={ui.showAIAssistant}
        onClose={() => ui.closeAIAssistant()}
      />
    </div>
  )
}
