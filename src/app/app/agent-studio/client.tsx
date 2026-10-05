'use client'

import React, { useCallback, useMemo, useEffect } from 'react'
import { WorkflowProvider, useWorkflowContext } from './contexts/WorkflowContext'
// import ErrorBoundary from './components/ErrorBoundary'
import { ModalsContainer } from './components/ModalsContainer'
import { AgentStudioLayout } from './components/AgentStudioLayout'
import { AgentStudioLayoutMobile } from './components/AgentStudioLayout-mobile'
import { ExpandedLogView } from './panels'
import { resolveInitialWorkflow, normalizeNodes, normalizeEdges } from './utils/workflowInitializer'
import { restoreNodesWithIcons } from './utils/nodeUtils'
import { applyDerivedToolFlags } from './utils/derived-tool-flags'
import { usePanelResize } from './hooks/usePanelResize'
import { useWorkflowExecution } from './hooks/useWorkflowExecution'
import { useAgentInitializer } from './hooks/useAgentInitializer'
import { useMobileDetect } from './hooks/useMobileDetect'
import { useToolsHandler } from './hooks/useToolsHandler'
import { useMiniAppsHandler } from './hooks/useMiniAppsHandler'
import { useWhileToolsHandler } from './hooks/useWhileToolsHandler'
import { useUnsavedChanges } from './hooks/useUnsavedChanges'
import { useAutoFitView } from './hooks/useAutoFitView'
import { useLanguage } from '@/hooks/useLanguage'
import type { AgentStudioContentProps } from './types'

interface AgentStudioClientProps {
  initialAgent: any | null
  initialWorkflow?: any | null
  hasOpenAIApiKey?: boolean
}

export default function AgentStudioClient(props: AgentStudioClientProps) {
  const workflowData = useMemo(
    () => {
      const base = (() => {
        if (props.initialWorkflow?.workflowJson) {
          try {
            const parsed = JSON.parse(props.initialWorkflow.workflowJson)
            return {
              nodes: restoreNodesWithIcons(normalizeNodes(parsed.nodes || [], props.initialAgent)),
              edges: normalizeEdges(parsed.edges || [])
            }
          } catch (error) {
            console.error('Failed to parse workflow JSON:', error)
            return resolveInitialWorkflow(props.initialAgent)
          }
        }
        return resolveInitialWorkflow(props.initialAgent)
      })()

      return { nodes: applyDerivedToolFlags(base.nodes, base.edges), edges: base.edges }
    },
    [props.initialWorkflow, props.initialAgent]
  )

  return (
    <div className="dark">
      <WorkflowProvider
        initialAgent={props.initialAgent}
        initialNodes={workflowData.nodes}
        initialEdges={workflowData.edges}
        hasOpenAIApiKey={props.hasOpenAIApiKey}
      >
        <AgentStudioShell
          initialAgent={props.initialAgent}
          initialWorkflow={props.initialWorkflow}
        />
      </WorkflowProvider>
    </div>
  )
}

function AgentStudioShell({ initialAgent, initialWorkflow, initialAgentId }: AgentStudioContentProps) {
  const { agent, ui, workflow } = useWorkflowContext()
  const { lang } = useLanguage()
  const isMobile = useMobileDetect()
  const { panelSize, setPanelSize } = usePanelResize()
  const {
    chatMessages,
    testMessage,
    setTestMessage,
    executionLogs,
    contextVariables,
    selectedStepIndex,
    setSelectedStepIndex,
    expandedLogView,
    setExpandedLogView,
    isExecuting,
    handleExecuteWorkflow,
    handleLogBoxClick,
    canExpandPayload,
    isPaused,
    pausedAtNodeId,
    handleResume,
    updateBreakpointNodes,
    handleExecuteFromNode,
    handleResetTest,
    currentRunningNode,
    totalNodes,
    isTelegramStart,
    isPstnStart,
    uploadedFiles,
    isUploading,
    handleFileSelect,
    removeFile,
    removePdf
  } = useWorkflowExecution(
    agent.agentId,
    workflow.workflowId,
    { nodes: workflow.nodes, edges: workflow.edges },
    lang
  )

  useEffect(() => {
    const breakpointNodeIds = workflow.nodes
      .filter(node => node.data?.hasBreakpoint)
      .map(node => node.id)
    updateBreakpointNodes(breakpointNodeIds)
  }, [workflow.nodes, updateBreakpointNodes])

  const hasScheduleNode = useMemo(() => {
    return workflow.nodes.some(node =>
      node.data?.triggerType === 'schedule' ||
      node.data?.nodeType === 'schedule'
    )
  }, [workflow.nodes])

  const isScheduleOnlyStart = useMemo(() => {
    const hasChatWidgetStart = workflow.nodes.some(node =>
      node.data?.nodeType === 'start' && node.data?.triggerType !== 'schedule'
    )
    return hasScheduleNode && !hasChatWidgetStart
  }, [workflow.nodes, hasScheduleNode])

  const fileInputConfig = useMemo(() => {
    const aiNode = workflow.nodes.find(node =>
      node.data?.nodeType === 'ai' || node.type === 'ai'
    )
    if (!aiNode) {
      return { imageInput: false, pdfInput: false, csvInput: false }
    }
    return {
      imageInput: aiNode.data?.imageInput || false,
      pdfInput: aiNode.data?.pdfInput || false,
      csvInput: aiNode.data?.csvInput || false
    }
  }, [workflow.nodes])

  const handleScheduleTest = useCallback(() => {
    handleExecuteWorkflow(false, true) // isScheduledTrigger = true
  }, [handleExecuteWorkflow])

  useAgentInitializer(agent, initialAgent, initialWorkflow, initialAgentId)

  useToolsHandler()

  useMiniAppsHandler()

  useWhileToolsHandler()

  useUnsavedChanges({ hasChanges: ui.hasChanges })

  useAutoFitView()

  const handleDragStart = useCallback((event: React.DragEvent, component: { id: string }) => {
    event.dataTransfer.setData('application/reactflow', component.id)
    event.dataTransfer.effectAllowed = 'move'
  }, [])

  if (isMobile) {
    return (
      <>
        <AgentStudioLayoutMobile
          chatMessages={chatMessages}
          isExecuting={isExecuting}
          testMessage={testMessage}
          setTestMessage={setTestMessage}
          handleExecuteWorkflow={handleExecuteWorkflow}
          executionLogs={executionLogs}
          contextVariables={contextVariables}
          selectedStepIndex={selectedStepIndex}
          setSelectedStepIndex={setSelectedStepIndex}
          canExpandPayload={canExpandPayload}
          handleLogBoxClick={handleLogBoxClick}
          isPaused={isPaused}
          pausedAtNodeId={pausedAtNodeId}
          onResume={handleResume}
          onRunFromHere={handleExecuteFromNode}
          handleResetTest={handleResetTest}
          hasScheduleNode={hasScheduleNode}
          isScheduleOnlyStart={isScheduleOnlyStart}
          onScheduleTest={handleScheduleTest}
          currentRunningNode={currentRunningNode}
          totalNodes={totalNodes}
          isTelegramStart={isTelegramStart}
          fileInputConfig={fileInputConfig}
          uploadedFiles={uploadedFiles}
          isUploading={isUploading}
          onFileSelect={handleFileSelect}
          onRemoveFile={removeFile}
          onRemovePdf={removePdf}
        />
        <ExpandedLogView
          expandedLogView={expandedLogView}
          setExpandedLogView={setExpandedLogView}
        />
        <ModalsContainer />
      </>
    )
  }

  return (
    <>
      <AgentStudioLayout
        isMobile={isMobile}
        handleDragStart={handleDragStart}
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
        canExpandPayload={canExpandPayload}
        handleLogBoxClick={handleLogBoxClick}
        isPaused={isPaused}
        pausedAtNodeId={pausedAtNodeId}
        onResume={handleResume}
        onRunFromHere={handleExecuteFromNode}
        handleResetTest={handleResetTest}
        hasScheduleNode={hasScheduleNode}
        isScheduleOnlyStart={isScheduleOnlyStart}
        onScheduleTest={handleScheduleTest}
        currentRunningNode={currentRunningNode}
        totalNodes={totalNodes}
        isTelegramStart={isTelegramStart}
        isPstnStart={isPstnStart}
        agentId={agent.agentId}
        workflowId={workflow.workflowId}
        fileInputConfig={fileInputConfig}
        uploadedFiles={uploadedFiles}
        isUploading={isUploading}
        onFileSelect={handleFileSelect}
        onRemoveFile={removeFile}
        onRemovePdf={removePdf}
      />
      <ExpandedLogView
        expandedLogView={expandedLogView}
        setExpandedLogView={setExpandedLogView}
      />
      <ModalsContainer />
    </>
  )
}

export const MemoizedAgentStudioClient = React.memo(AgentStudioClient)
