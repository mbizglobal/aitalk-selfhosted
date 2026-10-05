import React, { useState, useCallback } from 'react'
import { toast } from 'sonner'
import { hasMiniAppOnUnsupportedChannel } from '../utils/nodeUtils'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Save, MoreVertical, Download, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { WorkflowCanvasMobile } from './WorkflowCanvas-mobile'
import { WorkflowSidebarMobile } from './WorkflowSidebar-mobile'
import { MobileToolbar } from './MobileToolbar'
import { LeftPaletteMobile, TestPanelMobile } from '../panels'
import { useWorkflowContext } from '../contexts/WorkflowContext'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'
import { useReactFlow } from 'reactflow'
import type { ChatMessage, PanelSizeState, UploadedFile, FileInputConfig } from '../types'
import type { WorkflowDebugLogEntry } from '@/lib/workflow'
import type { ContextVariables } from '../hooks/useWorkflowExecution'

interface AgentStudioLayoutMobileProps {
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
  fileInputConfig?: FileInputConfig
  uploadedFiles?: UploadedFile[]
  isUploading?: boolean
  onFileSelect?: (files: FileList | null) => void
  onRemoveFile?: (fileId: string) => void
  onRemovePdf?: (fileName: string) => void
}

export const AgentStudioLayoutMobile: React.FC<AgentStudioLayoutMobileProps> = ({
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
  fileInputConfig,
  uploadedFiles,
  isUploading,
  onFileSelect,
  onRemoveFile,
  onRemovePdf
}) => {
  const router = useRouter()
  const { workflow, ui, agent, test, confirmLiveSave } = useWorkflowContext()
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)

  const [showPalette, setShowPalette] = useState(false)
  const [showTestPanel, setShowTestPanel] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [currentZoom, setCurrentZoom] = useState(100)

  const handleBack = useCallback(() => {
    if (ui.hasChanges) {
      const confirmed = window.confirm(t.unsaved_changes_confirm)
      if (!confirmed) return
    }
    if (agent.agentId) {
      router.push(`/app/agents/${agent.agentId}/workflows`)
    } else {
      router.push('/app')
    }
  }, [ui.hasChanges, agent.agentId, router, t])

  const handleSave = useCallback(async (): Promise<boolean> => {
    if (!agent.workflowId) return false

    if (!(await confirmLiveSave())) return false

    if (hasMiniAppOnUnsupportedChannel(workflow.nodes, workflow.edges)) {
      toast.warning(t.miniapp_channel_unsupported_warning)
    }

    workflow.setSelectedNode(null)
    workflow.deselectAll()

    ui.setIsSaving(true)
    try {
      const workflowJson = {
        nodes: workflow.nodes.map(node => ({
          ...node,
          data: { ...node.data, icon: null }
        })),
        edges: workflow.edges
      }

      const response = await fetch(`/api/workflows/${agent.workflowId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: agent.workflowName,
          workflowJson: JSON.stringify(workflowJson),
          expectedVersion: agent.workflowVersionRef.current, // optimistic concurrency (G1)
          expectedStatus: agent.workflowStatus,
        })
      })

      if (response.ok) {
        const data = await response.json().catch(() => null)
        if (typeof data?.workflow?.version === 'number') {
          agent.workflowVersionRef.current = data.workflow.version
        }
        ui.setSaveSuccess(true)
        ui.setHasChanges(false)
        ui.setSavedSnapshot({
          nodes: workflow.nodes,
          edges: workflow.edges
        })
        return true
      } else {
        const error = await response.json().catch(() => null)
        if (error?.code === 'TRANSLATION_REQUIRES_RELIABLE_MODEL' && error?.error) {
          toast.error(error.error, { id: 'translation-model-guard', duration: Infinity, closeButton: true })
        } else if (error?.code === 'STALE_CONFLICT') {
          toast.error(t.workflow_version_conflict, { id: 'workflow-version-conflict', duration: Infinity, closeButton: true })
        } else if (error?.code === 'STATUS_CHANGED') {
          if (typeof error?.currentStatus === 'string') agent.setWorkflowStatus(error.currentStatus)
          toast.error(t.workflow_status_changed, { id: 'workflow-status-changed', duration: Infinity, closeButton: true })
        } else if (typeof error?.error === 'string' && error.error) {
          toast.error(error.error, { id: 'workflow-save-rejected', duration: Infinity, closeButton: true })
        }
        ui.setSaveSuccess(false)
        setTimeout(() => ui.setSaveSuccess(null), 3000)
      }
    } catch (error) {
      console.error('Save error:', error)
      ui.setSaveSuccess(false)
      setTimeout(() => ui.setSaveSuccess(null), 3000)
    } finally {
      ui.setIsSaving(false)
    }
    return false
  }, [agent.workflowId, agent.workflowName, workflow.nodes, workflow.edges, ui, t, confirmLiveSave])

  return (
    <div className="fixed inset-0 text-white flex flex-col bg-[#0f0f0f] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#3A3A3A] bg-[#1A1A1A] safe-area-top z-10">
        <button
          onClick={handleBack}
          className="p-2 hover:bg-[#3A3A3A] rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-gray-400" />
        </button>

        <div className="flex-1 mx-3 overflow-hidden">
          <input
            type="text"
            value={agent.workflowName}
            onChange={(e) => agent.setWorkflowName(e.target.value)}
            placeholder={t.workflow_name_placeholder}
            className="w-full px-2 py-1 text-sm font-medium bg-transparent text-white border-none outline-none text-center truncate"
          />
        </div>

        <button
          onClick={handleSave}
          disabled={ui.isSaving || !ui.hasChanges}
          className={`p-2 rounded-lg transition-colors ${
            ui.hasChanges
              ? 'text-white bg-blue-600 hover:bg-blue-700'
              : 'text-gray-500 bg-transparent'
          }`}
        >
          <Save className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-hidden relative pb-14">
        <WorkflowCanvasMobileWrapper onZoomChange={setCurrentZoom} />
      </div>

      <MobileToolbar
        onAddClick={() => setShowPalette(true)}
        onUndo={workflow.undo}
        onRedo={workflow.redo}
        onFitView={() => {
          workflow.reactFlowInstance?.fitView({ duration: 300 })
        }}
        onToggleLock={() => {
          if (!ui.isLocked) {
            workflow.deselectAll()
          }
          ui.setIsLocked(!ui.isLocked)
        }}
        onTestClick={() => setShowTestPanel(true)}
        onZoomIn={() => workflow.reactFlowInstance?.zoomIn()}
        onZoomOut={() => workflow.reactFlowInstance?.zoomOut()}
        isLocked={ui.isLocked}
        canUndo={workflow.historyIndex > 0}
        canRedo={workflow.historyIndex < workflow.history.length - 1}
        currentZoom={currentZoom}
        testLabel={t.test_short || t.test}
      />

      <WorkflowSidebarMobile />

      <LeftPaletteMobile
        isOpen={showPalette}
        onClose={() => setShowPalette(false)}
      />

      <TestPanelMobile
        isOpen={showTestPanel}
        onClose={() => setShowTestPanel(false)}
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
        fileInputConfig={fileInputConfig}
        uploadedFiles={uploadedFiles}
        isUploading={isUploading}
        onFileSelect={onFileSelect}
        onRemoveFile={onRemoveFile}
        onRemovePdf={onRemovePdf}
      />
    </div>
  )
}

function WorkflowCanvasMobileWrapper({
  onZoomChange
}: {
  onZoomChange: (zoom: number) => void
}) {
  return <WorkflowCanvasMobile onZoomChange={onZoomChange} />
}
