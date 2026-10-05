import React, { createContext, useContext, ReactNode, useEffect, useRef, useCallback, useState } from 'react'
import { toast } from 'sonner'
import { useWorkflowState } from '../hooks/useWorkflowState'
import { useUIState } from '../hooks/useUIState'
import { useAgentState } from '../hooks/useAgentState'
import { useTestState } from '../hooks/useTestState'
import { createNodeHandlers } from '../handlers/nodeHandlers'
import { createWorkflowHandlers } from '../handlers/workflowHandlers'
import { compareNodes, compareEdges } from '../utils/deepEqual'
import { normalizeNodes, normalizeEdges } from '../utils/workflowInitializer'
import { applyDerivedToolFlags } from '../utils/derived-tool-flags'
import { restoreNodesWithIcons } from '../utils/nodeUtils'
import { setGlobalBreakpointHandler } from '../nodes/CustomNode'
import { buildJsonSchemaFromProperties } from '../types/schema'
import { isLiveSaveConfirmMuted, muteLiveSaveConfirm } from '../utils/liveSaveConsent'
import { LiveSaveConfirmModal } from '../modals/LiveSaveConfirmModal'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'

interface WorkflowContextType {
  workflow: ReturnType<typeof useWorkflowState>
  ui: ReturnType<typeof useUIState>
  agent: ReturnType<typeof useAgentState>
  test: ReturnType<typeof useTestState>
  nodeHandlers: ReturnType<typeof createNodeHandlers>
  workflowHandlers: ReturnType<typeof createWorkflowHandlers>
  saveWorkflow: () => Promise<boolean>
  confirmLiveSave: () => Promise<boolean>
  reloadWorkflow: () => Promise<{ nodes: any[]; edges: any[] } | null>
  reloadGeneration: number
  hasOpenAIApiKey: boolean
  emailProviderId: string
  setEmailProviderId: (id: string) => void
}

const WorkflowContext = createContext<WorkflowContextType | undefined>(undefined)

export const WorkflowProvider: React.FC<{
  children: ReactNode
  initialAgent?: any
  initialNodes?: any[]
  initialEdges?: any[]
  hasOpenAIApiKey?: boolean
}> = ({ children, initialAgent, initialNodes = [], initialEdges = [], hasOpenAIApiKey = false }) => {
  const workflow = useWorkflowState(initialNodes, initialEdges)
  const ui = useUIState()
  const agent = useAgentState(initialAgent)
  const test = useTestState()

  const [emailProviderId, setEmailProviderId] = useState('gmail')

  const [reloadGeneration, setReloadGeneration] = useState(0)

  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)

  const isInitialLoad = useRef(true)
  const nodeDragStateRef = useRef({ isDragging: false, startPosition: null as { x: number; y: number } | null, didMove: false })
  const reloadingRef = useRef(false)

  const [liveSaveConfirmOpen, setLiveSaveConfirmOpen] = useState(false)
  const liveSaveResolverRef = useRef<((proceed: boolean) => void) | null>(null)

  const confirmLiveSave = useCallback((): Promise<boolean> => {
    if (agent.workflowStatus !== 'production') return Promise.resolve(true)
    if (isLiveSaveConfirmMuted()) return Promise.resolve(true)
    if (liveSaveResolverRef.current) {
      toast.warning(t.live_save_confirm_pending || 'Finish the open save confirmation first.', { id: 'live-save-pending' })
      return Promise.resolve(false)
    }
    setLiveSaveConfirmOpen(true)
    return new Promise<boolean>(resolve => {
      liveSaveResolverRef.current = resolve
    })
  }, [agent.workflowStatus, t])

  const settleLiveSaveConfirm = useCallback((proceed: boolean, mute = false) => {
    if (proceed && mute) muteLiveSaveConfirm()
    setLiveSaveConfirmOpen(false)
    const resolve = liveSaveResolverRef.current
    liveSaveResolverRef.current = null
    resolve?.(proceed)
  }, [])

  useEffect(() => () => {
    const resolve = liveSaveResolverRef.current
    liveSaveResolverRef.current = null
    resolve?.(false)
  }, [])

  useEffect(() => {
    if (isInitialLoad.current) {
      ui.setSavedSnapshot({
        nodes: initialNodes,
        edges: initialEdges
      })
      isInitialLoad.current = false
    }
  }, [initialNodes, initialEdges, ui])

  useEffect(() => {
    if (isInitialLoad.current) {
      return
    }

    const nodesChanged = !compareNodes(workflow.nodes, ui.savedSnapshot.nodes)
    const edgesChanged = !compareEdges(workflow.edges, ui.savedSnapshot.edges)

    ui.setHasChanges(nodesChanged || edgesChanged)
  }, [workflow.nodes, workflow.edges, ui.savedSnapshot, ui])

  const nodeHandlers = createNodeHandlers(
    workflow.nodes,
    workflow.edges,
    workflow.setNodes,
    workflow.setEdges,
    workflow.saveToHistory,
    workflow.setSelectedNode,
    workflow.setSelectedEdge,
    nodeDragStateRef
  )

  const workflowHandlers = createWorkflowHandlers({
    nodes: workflow.nodes,
    edges: workflow.edges,
    variables: agent.variables.reduce((acc, v) => ({ ...acc, [v.name]: v.value }), {}),
    testMode: test.testMode,
    onNodeStart: test.startNodeExecution,
    onNodeComplete: test.completeNodeExecution,
    onNodeError: (nodeId, error) => test.completeNodeExecution(nodeId, null, error),
    onLog: test.addLog
  })

  const toggleBreakpoint = useCallback((nodeId: string) => {
    workflow.setNodes(nodes =>
      nodes.map(node =>
        node.id === nodeId
          ? { ...node, data: { ...node.data, hasBreakpoint: !node.data.hasBreakpoint } }
          : node
      )
    )
  }, [workflow])

  useEffect(() => {
    setGlobalBreakpointHandler(toggleBreakpoint)
    return () => setGlobalBreakpointHandler(null)
  }, [toggleBreakpoint])

  const saveWorkflow = useCallback(async (): Promise<boolean> => {
    if (!agent.workflowId) {
      console.error('No workflow ID available')
      return false
    }
    if (reloadingRef.current) {
      return false
    }

    if (!(await confirmLiveSave())) return false

    ui.setIsSaving(true)
    try {
      const inferNodeType = (label?: string): string | undefined => {
        if (!label) return undefined
        const l = label.toLowerCase()
        if (l === 'imap' || l.startsWith('imap')) return 'imap'
        if (l === 'smtp' || l.startsWith('smtp')) return 'smtp'
        if (l === 'sendgrid') return 'sendgrid'
        if (l === 'telegram') return 'telegram'
        if (l === 'end') return 'end'
        return undefined
      }

      const workflowJson = {
        nodes: workflow.nodes.map(node => {
          const nodeData = { ...node.data }

          nodeData.icon = null

          if (!nodeData.nodeType) {
            nodeData.nodeType = inferNodeType(nodeData.label)
          }

          if (nodeData.nodeType === 'ai' &&
              nodeData.outputFormat === 'json' &&
              nodeData.schemaProperties &&
              nodeData.schemaProperties.length > 0 &&
              !nodeData.jsonSchema) {
            nodeData.jsonSchema = buildJsonSchemaFromProperties(
              nodeData.schemaProperties,
              nodeData.schemaName || 'json_schema'
            )
          }

          return { ...node, data: nodeData }
        }),
        edges: workflow.edges
      }

      const updateData = {
        name: agent.workflowName,
        workflowJson: JSON.stringify(workflowJson),
        expectedVersion: agent.workflowVersionRef.current, // optimistic concurrency (G1)
        expectedStatus: agent.workflowStatus,
      }

      const response = await fetch(`/api/workflows/${agent.workflowId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData)
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
        } else {
          console.error('Workflow save failed:', error)
          toast.error(t.failed_save_workflow || 'Failed to save workflow', { id: 'workflow-save-failed' })
        }
        ui.setSaveSuccess(false)
        setTimeout(() => ui.setSaveSuccess(null), 3000)
        return false
      }
    } catch (error) {
      console.error('Workflow save error:', error)
      toast.error(t.failed_save_workflow || 'Failed to save workflow', { id: 'workflow-save-failed' })
      ui.setSaveSuccess(false)
      setTimeout(() => ui.setSaveSuccess(null), 3000)
      return false
    } finally {
      ui.setIsSaving(false)
    }
  }, [agent.workflowId, agent.workflowName, agent.workflowVersionRef, workflow.nodes, workflow.edges, ui, t, confirmLiveSave])

  const reloadWorkflow = useCallback(async (): Promise<{ nodes: any[]; edges: any[] } | null> => {
    if (!agent.workflowId) {
      console.error('No workflow ID available')
      return null
    }
    if (reloadingRef.current || ui.isSaving) {
      return null
    }
    reloadingRef.current = true
    try {
      const response = await fetch(`/api/workflows/${agent.workflowId}`)
      if (!response.ok) {
        toast.error(t.reload_failed || 'Failed to reload.')
        return null
      }
      const data = await response.json().catch(() => null)
      const wf = data?.workflow
      if (!wf?.workflowJson) {
        toast.error(t.reload_failed || 'Failed to reload.')
        return null
      }

      const parsed = JSON.parse(wf.workflowJson)
      const freshEdges = normalizeEdges(parsed.edges || [])
      const freshNodes = applyDerivedToolFlags(
        restoreNodesWithIcons(normalizeNodes(parsed.nodes || [], initialAgent)),
        freshEdges
      )

      const sel = workflow.selectedNode
      if (sel && !freshNodes.some((n: any) => n.id === sel)) {
        workflow.setSelectedNode(null)
        ui.closeAllModals()
      }
      workflow.setNodes(freshNodes)
      workflow.setEdges(freshEdges)
      workflow.resetHistory(freshNodes, freshEdges)

      ui.setSavedSnapshot({ nodes: freshNodes, edges: freshEdges })
      ui.setHasChanges(false)
      if (typeof wf.version === 'number') {
        agent.workflowVersionRef.current = wf.version
      }
      if (typeof wf.status === 'string') {
        agent.setWorkflowStatus(wf.status)
      }
      setReloadGeneration(g => g + 1)

      toast.success(t.reload_success || 'Reloaded from server.')
      return { nodes: freshNodes, edges: freshEdges }
    } catch (error) {
      console.error('Workflow reload error:', error)
      toast.error(t.reload_failed || 'Failed to reload.')
      return null
    } finally {
      reloadingRef.current = false
    }
  }, [agent.workflowId, agent.workflowVersionRef, workflow, ui, initialAgent, t])

  const value: WorkflowContextType = {
    workflow,
    ui,
    agent,
    test,
    nodeHandlers,
    workflowHandlers,
    saveWorkflow,
    confirmLiveSave,
    reloadWorkflow,
    reloadGeneration,
    hasOpenAIApiKey,
    emailProviderId,
    setEmailProviderId
  }

  return (
    <WorkflowContext.Provider value={value}>
      {children}
      <LiveSaveConfirmModal
        isOpen={liveSaveConfirmOpen}
        onConfirm={(mute) => settleLiveSaveConfirm(true, mute)}
        onCancel={() => settleLiveSaveConfirm(false)}
        t={t as unknown as Record<string, string>}
      />
    </WorkflowContext.Provider>
  )
}

export const useWorkflowContext = () => {
  const context = useContext(WorkflowContext)
  if (!context) {
    throw new Error('useWorkflowContext must be used within a WorkflowProvider')
  }
  return context
}

export const useWorkflow = () => {
  const context = useWorkflowContext()
  return context.workflow
}

export const useUI = () => {
  const context = useWorkflowContext()
  return context.ui
}

export const useAgent = () => {
  const context = useWorkflowContext()
  return context.agent
}

export const useTest = () => {
  const context = useWorkflowContext()
  return context.test
}

export const useNodeHandlers = () => {
  const context = useWorkflowContext()
  return context.nodeHandlers
}

export const useWorkflowHandlers = () => {
  const context = useWorkflowContext()
  return context.workflowHandlers
}
